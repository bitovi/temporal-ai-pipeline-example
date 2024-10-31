package workflows

import (
	"fmt"
	"temporal-hello-world/src/activities"
	"time"

	"github.com/google/uuid"
	"go.temporal.io/sdk/workflow"
)

type Repository struct {
	URL            string
	Branch         string
	Path           string
	FileExtensions []string
}
type DocumentsProcessingWorkflowInput struct {
	ID         string
	Repository Repository
}
type DocumentsProcessingWorkflowOutput struct {
	TableName string
}

func DocumentsProcessingWorkflow(ctx workflow.Context, input DocumentsProcessingWorkflowInput) (DocumentsProcessingWorkflowOutput, error) {
	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 1 * time.Minute,
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	//Create Bucket
	createS3BucketInput := activities.CreateS3BucketInput{Bucket: input.ID}
	err := workflow.ExecuteActivity(ctx, activities.CreateS3Bucket, createS3BucketInput).Get(ctx, nil)
	if err != nil {
		return DocumentsProcessingWorkflowOutput{}, err
	}

	// Collect Documents
	aoMediumTime := workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
	}
	ctx = workflow.WithActivityOptions(ctx, aoMediumTime)

	id := input.ID
	repository := input.Repository
	collectDocumentsInput := activities.CollectDocumentsInput{WorkflowID: id, S3Bucket: id, GitRepoURL: repository.URL, GitRepoBranch: repository.Branch, GitRepoDirectory: repository.Path, FileExtensions: repository.FileExtensions}

	var zipFileName activities.CollectDocumentsOutput
	err = workflow.ExecuteActivity(ctx, activities.CollectDocuments, collectDocumentsInput).Get(ctx, &zipFileName)
	if err != nil {
		return DocumentsProcessingWorkflowOutput{}, err
	}

	// Process Documents
	aoLongTime := workflow.ActivityOptions{
		StartToCloseTimeout: 50 * time.Minute,
	}
	ctx = workflow.WithActivityOptions(ctx, aoLongTime)

	processDocumentsInput := activities.ProcessDocumentsInput{WorkflowID: id, S3Bucket: id, ZipFileName: zipFileName.ZipFileName}

	var tableName activities.ProcessDocumentsOutput
	err = workflow.ExecuteActivity(ctx, activities.ProcessDocuments, processDocumentsInput).Get(ctx, &tableName)
	if err != nil {
		return DocumentsProcessingWorkflowOutput{}, err
	}

	//Delete S3 Object
	ctx = workflow.WithActivityOptions(ctx, ao)
	deleteS3ObjectInput := activities.DeleteS3ObjectInput{Bucket: input.ID, Key: zipFileName.ZipFileName}
	err = workflow.ExecuteActivity(ctx, activities.DeleteS3Object, deleteS3ObjectInput).Get(ctx, nil)
	if err != nil {

		return DocumentsProcessingWorkflowOutput{}, err
	}
	//Delete S3 Bucket
	deleteS3BucketInput := activities.DeleteS3BucketInput{Bucket: input.ID}
	err = workflow.ExecuteActivity(ctx, activities.DeleteS3Bucket, deleteS3BucketInput).Get(ctx, nil)
	if err != nil {

		return DocumentsProcessingWorkflowOutput{}, err
	}

	return DocumentsProcessingWorkflowOutput{TableName: tableName.TableName}, nil
}

type QueryWorkflowInput struct {
	Query          string
	ConversationID string
}

type QueryWorkflowOutput struct {
	ConversationID string
	Response       string
}

func InvokePromptWorkflow(ctx workflow.Context, input QueryWorkflowInput) (QueryWorkflowOutput, error) {
	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 1 * time.Minute,
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	conversationID := input.ConversationID
	query := input.Query

	//Gets most recent process-document workflow id
	var latestDocumentProcessingID string
	err := workflow.ExecuteActivity(ctx, activities.GetLatestDocumentProcessingId).Get(ctx, &latestDocumentProcessingID)
	if err != nil {
		return QueryWorkflowOutput{}, err
	}

	// Generate a new conversation ID if one isn't provided
	if conversationID == "" {
		conversationID = fmt.Sprintf("conversation-%s", uuid.New().String())
		createS3BucketInput := activities.CreateS3BucketInput{Bucket: conversationID}
		err := workflow.ExecuteActivity(ctx, activities.CreateS3Bucket, createS3BucketInput).Get(ctx, nil)
		if err != nil {
			return QueryWorkflowOutput{}, err
		}
	}

	// Generates conversationFilename
	getRelatedDocumentsInput := activities.GetRelatedDocumentsInput{Query: query, LatestDocumentProcessingId: latestDocumentProcessingID, S3Bucket: conversationID}
	var conversationFilename activities.GetRelatedDocumentsOutput
	err = workflow.ExecuteActivity(ctx, activities.GeneratePrompt, getRelatedDocumentsInput).Get(ctx, &conversationFilename)
	if err != nil {
		return QueryWorkflowOutput{}, err
	}

	// Generates conversationFilename
	invokePromptInput := activities.InvokePromptInput{Query: query, S3Bucket: conversationID, ConversationFilename: conversationFilename.ConversationFilename}
	var response activities.InvokePromptOutput
	err = workflow.ExecuteActivity(ctx, activities.InvokePrompt, invokePromptInput).Get(ctx, &response)
	if err != nil {
		return QueryWorkflowOutput{}, err
	}

	return QueryWorkflowOutput{
		ConversationID: conversationID,
		Response:       response.Response,
	}, nil
}
