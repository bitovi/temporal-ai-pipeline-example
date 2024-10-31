package activities

import (
	"context"
	"encoding/json"
	"strings"
)

type GetRelatedDocumentsInput struct {
	Query                      string
	LatestDocumentProcessingId string
	S3Bucket                   string
}

type GetRelatedDocumentsOutput struct {
	ConversationFilename string
}

func GeneratePrompt(ctx context.Context, input GetRelatedDocumentsInput) (GetRelatedDocumentsOutput, error) {
	conn, _ := GetConn(ctx)

	queryEmbedding, _ := FetchEmbeddings([]string{input.Query})

	data, _ := FetchEmbeddingsFromDatabase(ctx, conn, queryEmbedding, input.LatestDocumentProcessingId)

	var conversationFilename = "related-documentation.json"

	jsonData, err := json.Marshal(map[string]interface{}{
		"context": data,
	})
	if err != nil {
		return GetRelatedDocumentsOutput{}, err
	}

	putS3Object(ctx, PutS3ObjectInput{Body: jsonData, Bucket: input.S3Bucket, Key: conversationFilename})

	return GetRelatedDocumentsOutput{ConversationFilename: conversationFilename}, nil
}

type InvokePromptInput struct {
	Query                string
	S3Bucket             string
	ConversationFilename string
}

type InvokePromptOutput struct {
	Response string
}

func InvokePrompt(ctx context.Context, input InvokePromptInput) (InvokePromptOutput, error) {
	S3Bucket := input.S3Bucket
	_ = input.Query
	conversationFilename := input.ConversationFilename

	response, err := GetS3Object(ctx, GetS3ObjectInput{S3Bucket, conversationFilename})
	if err != nil {
		return InvokePromptOutput{}, err
	}

	conversationContext := string(response)
	var relevantDocumentation []string
	if conversationContext != "" {
		var documentation struct {
			Context []struct {
				PageContent string `json:"Content"`
			} `json:"context"`
		}

		json.Unmarshal([]byte(conversationContext), &documentation)

		for _, doc := range documentation.Context {
			_ = append(relevantDocumentation, doc.PageContent)
		}
	}

	//Format data in user friendly format
	prompt := [][]string{
		{"system", "You are a friendly, helpful software assistant. Your goal is to help users write CRUD-based software applications using the the Hatchify open-source project in TypeScript."},
		{"system", "You should respond in short paragraphs, using Markdown formatting, separated with two newlines to keep your responses easily readable."},
		{"system", "Whenever possible, use code examples derived from the documentation provided."},
		{"system", "Import references must be included where relevant so that the reader can easily figure out how to import the necessary dependencies."},
		{"system", "Do not use your existing knowledge to determine import references, only use import references as they appear in the relevant documentation for Hatchify"},
		{"system", "Here is the Hatchify documentation that is relevant to the user's query: " + strings.Join(relevantDocumentation, "\n\n")},
		{"user", input.Query},
	}

	invokeResponse, _ := Invoke(prompt)
	return InvokePromptOutput{invokeResponse.Choices[0].Message.Content}, nil
}
