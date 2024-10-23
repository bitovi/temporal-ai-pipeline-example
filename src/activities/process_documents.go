package activities

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/pgvector/pgvector-go"
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
	DATABASE_TABLE_NAME        = os.Getenv("DATABASE_TABLE_NAME")
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

	err = os.Remove(filepath.Join(temporaryDirectory, zipFileName))
	if err != nil {
		return ProcessDocumentsOutput{}, err
	}

	vectorStoreConn := getPGVectorStore(ctx)

	fileList, err := os.ReadDir(temporaryDirectory)
	if err != nil {
		return ProcessDocumentsOutput{}, err
	}

	for _, file := range fileList {
		if !file.IsDir() && strings.Contains(file.Name(), ".") {

			filePath := filepath.Join(temporaryDirectory, file.Name())
			pageContent, err := os.ReadFile(filePath)

			if err != nil {
				return ProcessDocumentsOutput{}, fmt.Errorf("error reading file: %v", err)
			}

			if len(pageContent) > 0 {
				err := saveData(ctx, vectorStoreConn, string(pageContent), input.WorkflowID)
				if err != nil {
					return ProcessDocumentsOutput{}, fmt.Errorf("error adding document to vector store: %v", err)
				}
			}
		}
	}

	err = os.RemoveAll(temporaryDirectory)
	if err != nil {
		return ProcessDocumentsOutput{}, fmt.Errorf("error removing temporary directory: %v", err)
	}

	return ProcessDocumentsOutput{TableName: DATABASE_TABLE_NAME}, nil
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

func getPGVectorStore(ctx context.Context) *pgx.Conn {
	conn, _ := GetConn(ctx)
	createTable(ctx, conn)

	return conn
}

// TODO: (IMPORTANT) Share con
func GetConn(ctx context.Context) (*pgx.Conn, error) {
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

	_, err = conn.Exec(ctx, "CREATE TABLE IF NOT EXISTS documents (id bigserial PRIMARY KEY, workflow_id text, content text, embedding vector(1536))")
	if err != nil {
		panic(err)
	}
}

func saveData(ctx context.Context, conn *pgx.Conn, content string, workflowId string) error {
	embeddings, err := FetchEmbeddings([]string{content})
	if err != nil {
		return err
	}
	_, err = conn.Exec(ctx, "INSERT INTO documents (workflow_id, content, embedding) VALUES ($1, $2, $3)", workflowId, content, pgvector.NewVector(embeddings))

	if err != nil {
		panic(err)
	}

	return nil
}

type Document struct {
	ID      int64
	Content string
}

func FetchData(ctx context.Context, conn *pgx.Conn, queryEmbedding []float32, latestDocumentProcessingId string) ([]Document, error) {
	rows, err := conn.Query(ctx, "SELECT id, content FROM documents WHERE workflow_id =$1  ORDER BY embedding <=> $2 LIMIT 5", latestDocumentProcessingId, pgvector.NewVector(queryEmbedding))

	if err != nil {
		panic(err)
	}

	defer rows.Close()

	var documents []Document

	for rows.Next() {
		var doc Document
		err = rows.Scan(&doc.ID, &doc.Content)
		if err != nil {
			return nil, err
		}
		documents = append(documents, doc)
	}

	if rows.Err() != nil {
		panic(rows.Err())
	}

	return documents, nil
}

type FetchEmbeddingsApiRequest struct {
	Input []string `json:"input"`
	Model string   `json:"model"`
}
type embeddingResponse struct {
	Data []struct {
		Embedding []float32 `json:"embedding"`
	} `json:"data"`
}

func FetchEmbeddings(input []string) ([]float32, error) {
	url := "https://api.openai.com/v1/embeddings"

	data := &FetchEmbeddingsApiRequest{
		Input: input,
		Model: "text-embedding-ada-002",
	}

	b, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(b))
	if err != nil {
		return nil, err
	}

	req.Header.Add("Authorization", fmt.Sprintf("Bearer %s", OPENAI_API_KEY))
	req.Header.Add("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("bad status code: %d - %s", resp.StatusCode, body)
	}

	var result embeddingResponse
	err = json.NewDecoder(resp.Body).Decode(&result)
	if err != nil {
		return nil, err
	}

	return result.Data[0].Embedding, nil
}

// Remove unecessary typing
type ChatCompletion struct {
	ID                string   `json:"id"`
	Object            string   `json:"object"`
	Created           int64    `json:"created"`
	Model             string   `json:"model"`
	Choices           []Choice `json:"choices"`
	Usage             Usage    `json:"usage"`
	SystemFingerprint *string  `json:"system_fingerprint"`
}

type Choice struct {
	Index        int     `json:"index"`
	Message      Message `json:"message"`
	Logprobs     *string `json:"logprobs"`
	FinishReason string  `json:"finish_reason"`
}

type Message struct {
	Role    string  `json:"role"`
	Content string  `json:"content"`
	Refusal *string `json:"refusal"`
}

type Usage struct {
	PromptTokens            int                    `json:"prompt_tokens"`
	CompletionTokens        int                    `json:"completion_tokens"`
	TotalTokens             int                    `json:"total_tokens"`
	PromptTokensDetails     TokenDetails           `json:"prompt_tokens_details"`
	CompletionTokensDetails CompletionTokenDetails `json:"completion_tokens_details"`
}

type TokenDetails struct {
	CachedTokens int `json:"cached_tokens"`
}

type CompletionTokenDetails struct {
	ReasoningTokens int `json:"reasoning_tokens"`
}

type InvokeApiRequest struct {
	Model       string             `json:"model"`
	Messages    []InvokeApiMessage `json:"messages"`
	Temperature float64            `json:"temperature"`
}

type InvokeApiMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func Invoke(input [][]string) (ChatCompletion, error) {
	url := "https://api.openai.com/v1/chat/completions"

	messages := make([]InvokeApiMessage, len(input))
	for i, p := range input {
		messages[i] = InvokeApiMessage{
			Role:    p[0],
			Content: p[1],
		}
	}

	data := InvokeApiRequest{
		Model:    "gpt-3.5-turbo",
		Messages: messages,
	}

	//TODO: (IMPORTANT) Reuse the following code
	b, err := json.Marshal(data)
	if err != nil {

		return ChatCompletion{}, err
	}

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(b))
	if err != nil {
		return ChatCompletion{}, err
	}

	req.Header.Add("Authorization", fmt.Sprintf("Bearer %s", OPENAI_API_KEY))
	req.Header.Add("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return ChatCompletion{}, err
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return ChatCompletion{}, fmt.Errorf("bad status code: %d - %s", resp.StatusCode, body)
	}

	var result ChatCompletion
	err = json.NewDecoder(resp.Body).Decode(&result)
	if err != nil {
		return ChatCompletion{}, err
	}

	return result, nil
}
