package activities

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"
	pgxvector "github.com/pgvector/pgvector-go/pgx"
	"go.temporal.io/sdk/activity"
)

type CollectDocumentsInput struct {
	WorkflowID       string
	S3Bucket         string
	GitRepoURL       string
	GitRepoBranch    string
	GitRepoDirectory string
	FileExtensions   []string
}

type CollectDocumentsOutput struct {
	ZipFileName string
}

func CollectDocuments(ctx context.Context, input CollectDocumentsInput) (CollectDocumentsOutput, error) {
	logger := activity.GetLogger(ctx)

	temporaryDirectory := input.WorkflowID
	if err := os.MkdirAll(temporaryDirectory, os.ModePerm); err != nil {
		return CollectDocumentsOutput{}, err
	}

	parts := strings.Split(input.GitRepoURL, "/")
	organization := parts[3]
	repository := strings.TrimSuffix(parts[4], ".git")
	repoPath := fmt.Sprintf("%s/%s", organization, repository)

	temporaryGitHubDirectory := filepath.Join(temporaryDirectory, repoPath)
	if err := os.RemoveAll(temporaryGitHubDirectory); err != nil {
		logger.Error("Error when deleting files at temporaryGitHubDirectory.", err)
		return CollectDocumentsOutput{}, err
	}

	// Clone the git repository
	cmd := exec.Command("git", "clone", "--depth", "1", "--branch", input.GitRepoBranch, fmt.Sprintf("https://github.com/%s.git", repoPath), temporaryGitHubDirectory)
	if err := cmd.Run(); err != nil {
		logger.Error("Error when cloning github repository.", err)
		return CollectDocumentsOutput{}, err
	}

	var filteredFileList []string
	err := filepath.Walk(temporaryGitHubDirectory, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}

		fileExtension := strings.TrimPrefix(filepath.Ext(info.Name()), ".")

		if slices.Contains(input.FileExtensions, fileExtension) {
			filteredFileList = append(filteredFileList, path)
		}
		return nil
	})
	if err != nil {
		logger.Error("Error when filtering files in temporaryGitHubDirectory.", err)
		return CollectDocumentsOutput{}, err
	}

	//Create zip
	zipFileName := "files.zip"
	zipFileLocation := filepath.Join(temporaryDirectory, zipFileName)
	zipFile, err := os.Create(zipFileLocation)
	if err != nil {
		return CollectDocumentsOutput{}, err
	}
	defer zipFile.Close()

	archive := zip.NewWriter(zipFile)
	defer archive.Close()

	// Add files to the zip
	for _, filePath := range filteredFileList {
		sourceFile, err := os.Open(filePath)
		if err != nil {
			logger.Error("Error when opening file.", err)
			return CollectDocumentsOutput{}, err
		}
		defer sourceFile.Close()

		fileName := filepath.Base(filePath)
		writer, err := archive.Create(fileName)
		if err != nil {
			logger.Error("Error when adding file to zip.", err)
			return CollectDocumentsOutput{}, err
		}

		_, err = io.Copy(writer, sourceFile)
		if err != nil {
			logger.Error("Error when writing file into zip.", err)
			return CollectDocumentsOutput{}, err
		}
	}
	archive.Close()

	// Upload to S3
	fileContent, err := os.ReadFile(zipFileLocation)
	if err != nil {
		logger.Error("Error when reading file content.", err)
		return CollectDocumentsOutput{}, err
	}

	putS3Object(ctx, PutS3ObjectInput{Body: fileContent, Bucket: input.S3Bucket, Key: zipFileName})

	return CollectDocumentsOutput{ZipFileName: zipFileName}, nil
}

type ProcessDocumentsInput struct {
	WorkflowID  string
	S3Bucket    string
	ZipFileName string
}

type ProcessDocumentsOutput struct {
	TableName string
}

var (
	OPENAI_API_KEY             = os.Getenv("OPENAI_API_KEY")
	DATABASE_CONNECTION_STRING = os.Getenv("DATABASE_CONNECTION_STRING")
	DATABASE_TABEL_NAME        = os.Getenv("DATABASE_TABEL_NAME")
)

func ProcessDocuments(ctx context.Context, input ProcessDocumentsInput) (ProcessDocumentsOutput, error) {
	logger := activity.GetLogger(ctx)
	workflowID := input.WorkflowID
	s3Bucket := input.S3Bucket
	zipFileName := input.ZipFileName
	temporaryDirectory := workflowID

	if _, err := os.Stat(temporaryDirectory); os.IsNotExist(err) {
		err := os.MkdirAll(temporaryDirectory, 0755)
		if err != nil {
			logger.Error("Error creating directory.")
			return ProcessDocumentsOutput{}, err
		}
	}

	response, err := GetS3Object(ctx, GetS3ObjectInput{s3Bucket, zipFileName})
	if err != nil {
		return ProcessDocumentsOutput{}, err
	}

	err = os.WriteFile(zipFileName, response, 0644)
	if err != nil {
		return ProcessDocumentsOutput{}, err
	}

	err = Unzip(zipFileName, temporaryDirectory)
	if err != nil {
		return ProcessDocumentsOutput{}, err
	}

	err = os.Remove(zipFileName)
	if err != nil {
		return ProcessDocumentsOutput{}, err
	}
	_, err = os.ReadDir(temporaryDirectory)
	if err != nil {
		return ProcessDocumentsOutput{}, err
	}
	getPGVectorStore(ctx)

	return ProcessDocumentsOutput{TableName: "Placeholder"}, nil
}

func Unzip(src, dest string) error {
	r, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer func() {
		if err := r.Close(); err != nil {
			panic(err)
		}
	}()

	os.MkdirAll(dest, 0755)

	extractAndWriteFile := func(f *zip.File) error {
		rc, err := f.Open()
		if err != nil {
			return err
		}
		defer func() {
			if err := rc.Close(); err != nil {
				panic(err)
			}
		}()

		path := filepath.Join(dest, f.Name)
		if !strings.HasPrefix(path, filepath.Clean(dest)+string(os.PathSeparator)) {
			return fmt.Errorf("illegal file path: %s", path)
		}

		if f.FileInfo().IsDir() {
			os.MkdirAll(path, f.Mode())
		} else {
			os.MkdirAll(filepath.Dir(path), f.Mode())
			f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, f.Mode())
			if err != nil {
				return err
			}
			defer func() {
				if err := f.Close(); err != nil {
					panic(err)
				}
			}()

			_, err = io.Copy(f, rc)
			if err != nil {
				return err
			}
		}
		return nil
	}

	for _, f := range r.File {
		err := extractAndWriteFile(f)
		if err != nil {
			return err
		}
	}

	return nil
}

func getPGVectorStore(ctx context.Context) {

	conn, _ := getConn(ctx)
	createTable(ctx, conn)

}

func getConn(ctx context.Context) (*pgx.Conn, error) {
	conn, err := pgx.Connect(ctx, DATABASE_CONNECTION_STRING)
	if err != nil {
		//TODO: Error handling
		panic(err)
	}
	//Todo: see if this line can be cut
	/*defer conn.Close(ctx) */
	return conn, nil
}

func createTable(ctx context.Context, conn *pgx.Conn) {
	_, err := conn.Exec(ctx, "CREATE EXTENSION IF NOT EXISTS vector")
	if err != nil {
		panic(err)
	}

	err = pgxvector.RegisterTypes(ctx, conn)
	if err != nil {
		panic(err)
	}

	_, err = conn.Exec(ctx, "DROP TABLE IF EXISTS documents")
	if err != nil {
		panic(err)
	}

	_, err = conn.Exec(ctx, "CREATE TABLE documents (id bigserial PRIMARY KEY, content text, embedding vector(1536))")
	if err != nil {
		panic(err)
	}
}
