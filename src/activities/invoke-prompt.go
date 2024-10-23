package activities

import (
	"context"
	"encoding/json"
	"fmt"
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
	data, _ := FetchData(ctx, conn, input.Query)

	var conversationFilename = "related-documentation.json"

	jsonData, err := json.Marshal(map[string]interface{}{
		"context": data,
	})
	if err != nil {
		fmt.Println("Error marshaling JSON:", err)
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

	return InvokePromptOutput{}, nil
}
