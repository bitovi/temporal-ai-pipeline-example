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
		return CollectDocumentsOutput{}, err
	}

	// Clone the git repository
	cmd := exec.Command("git", "clone", "--depth", "1", "--branch", input.GitRepoBranch, fmt.Sprintf("https://github.com/%s.git", repoPath), temporaryGitHubDirectory)
	if err := cmd.Run(); err != nil {
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
			return CollectDocumentsOutput{}, err
		}
		defer sourceFile.Close()

		fileName := filepath.Base(filePath)
		writer, err := archive.Create(fileName)
		if err != nil {
			return CollectDocumentsOutput{}, err
		}

		_, err = io.Copy(writer, sourceFile)
		if err != nil {
			return CollectDocumentsOutput{}, err
		}
	}
	archive.Close()

	fileContent, err := os.ReadFile(zipFileLocation)
	if err != nil {
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
	workflowID := input.WorkflowID
	s3Bucket := input.S3Bucket
	zipFileName := input.ZipFileName
	temporaryDirectory := workflowID

	if _, err := os.Stat(temporaryDirectory); os.IsNotExist(err) {
		err := os.MkdirAll(temporaryDirectory, 0755)
		if err != nil {
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

	err = os.Remove(zipFileName)
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
				err := saveDocumentEmbedding(ctx, vectorStoreConn, string(pageContent), input.WorkflowID)
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

	saveWorkflowId(ctx, workflowID)

	return ProcessDocumentsOutput{TableName: DATABASE_TABLE_NAME}, nil
}

type FetchEmbeddingsApiRequest struct {
	Input []string `json:"input"`
	Model string   `json:"model"`
}
type EmbeddingResponse struct {
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

	var result EmbeddingResponse
	result, err := PostRequest(url, data, result, OPENAI_API_KEY)
	if err != nil {
		return nil, err
	}
	return result.Data[0].Embedding, nil
}

type ChatCompletion struct {
	Choices []Choice `json:"choices"`
}

type Choice struct {
	Message Message `json:"message"`
}

type Message struct {
	Content string `json:"content"`
}

type InvokeApiRequest struct {
	Model    string             `json:"model"`
	Messages []InvokeApiMessage `json:"messages"`
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

	var result ChatCompletion
	result, err := PostRequest(url, data, result, OPENAI_API_KEY)
	if err != nil {
		return ChatCompletion{}, err
	}

	return result, nil
}

func PostRequest[T any](url string, body any, result T, apiKey string) (T, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return result, err
	}
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(b))
	if err != nil {
		return result, err
	}

	req.Header.Add("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	req.Header.Add("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return result, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return result, fmt.Errorf("bad status code: %d - %s", resp.StatusCode, body)
	}

	err = json.NewDecoder(resp.Body).Decode(&result)
	if err != nil {
		return result, err
	}

	return result, nil
}
