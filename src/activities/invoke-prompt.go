package activities

import (
	"context"
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
	_ = FetchData(ctx, conn, input.Query)

	return GetRelatedDocumentsOutput{}, nil
}

func invokePrompt(input InvokePromptInput) (InvokePromptOutput, error) {
	return InvokePromptOutput{}, nil
}

func joinDocumentation(docs []string) bool {
	return true
}
