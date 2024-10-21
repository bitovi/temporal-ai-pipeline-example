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

	_, err := GetS3Object(ctx, GetS3ObjectInput{s3Bucket, zipFileName})
	if err != nil {
		return ProcessDocumentsOutput{}, err
	}

	return ProcessDocumentsOutput{TableName: "Placeholder"}, nil
}
