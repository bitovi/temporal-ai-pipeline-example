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

type InvokePromptInput struct {
	Query                string
	S3Bucket             string
	ConversationFilename string
}

type InvokePromptOutput struct {
	Response string
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

func invokePrompt(input InvokePromptInput) (InvokePromptOutput, error) {
	return InvokePromptOutput{}, nil
}

func joinDocumentation(docs []string) bool {
	return true
}
