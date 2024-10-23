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
	logger := workflow.GetLogger(ctx)

	//Create Bucket
	createS3BucketInput := activities.CreateS3BucketInput{Bucket: input.ID}
	err := workflow.ExecuteActivity(ctx, activities.CreateS3Bucket, createS3BucketInput).Get(ctx, nil)
	if err != nil {
		logger.Error("Activity failed.", "Error", err)
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
		logger.Error("Activity failed.", "Error", err)
		return DocumentsProcessingWorkflowOutput{}, err
	}

	// Process Documents
	//TODO: Think of  better naming for activities options
	aoLongTime := workflow.ActivityOptions{
		StartToCloseTimeout: 50 * time.Minute,
	}
	ctx = workflow.WithActivityOptions(ctx, aoLongTime)

	processDocumentsInput := activities.ProcessDocumentsInput{WorkflowID: id, S3Bucket: id, ZipFileName: zipFileName.ZipFileName}

	var tableName activities.ProcessDocumentsOutput
	err = workflow.ExecuteActivity(ctx, activities.ProcessDocuments, processDocumentsInput).Get(ctx, &tableName)
	if err != nil {
		logger.Error("Activity failed.", "Error", err)
		return DocumentsProcessingWorkflowOutput{}, err
	}

	//Delete S3 Object
	ctx = workflow.WithActivityOptions(ctx, ao)
	deleteS3ObjectInput := activities.DeleteS3ObjectInput{Bucket: input.ID, Key: zipFileName.ZipFileName}
	err = workflow.ExecuteActivity(ctx, activities.DeleteS3Object, deleteS3ObjectInput).Get(ctx, nil)
	if err != nil {
		logger.Error("Activity failed.", "Error", err)
		return DocumentsProcessingWorkflowOutput{}, err
	}
	//Delete S3 Bucket
	deleteS3BucketInput := activities.DeleteS3BucketInput{Bucket: input.ID}
	err = workflow.ExecuteActivity(ctx, activities.DeleteS3Bucket, deleteS3BucketInput).Get(ctx, nil)
	if err != nil {
		logger.Error("Activity failed.", "Error", err)
		return DocumentsProcessingWorkflowOutput{}, err
	}

	return DocumentsProcessingWorkflowOutput{TableName: tableName.TableName}, nil
}

type QueryWorkflowInput struct {
	LatestDocumentProcessingID string
	Query                      string
	ConversationID             string
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
	logger := workflow.GetLogger(ctx)

	conversationID := input.ConversationID
	latestDocumentProcessingID := input.LatestDocumentProcessingID
	query := input.Query

	// Generate a new conversation ID if one isn't provided
	if conversationID == "" {
		conversationID = fmt.Sprintf("conversation-%s", uuid.New().String())
		createS3BucketInput := activities.CreateS3BucketInput{Bucket: conversationID}
		err := workflow.ExecuteActivity(ctx, activities.CreateS3Bucket, createS3BucketInput).Get(ctx, nil)
		if err != nil {
			logger.Error("Activity failed.", "Error", err)
			return QueryWorkflowOutput{}, err
		}
	}

	// Generate a new conversation ID if one isn't provided
	getRelatedDocumentsInput := activities.GetRelatedDocumentsInput{Query: query, LatestDocumentProcessingId: latestDocumentProcessingID, S3Bucket: conversationID}
	var conversationFilename activities.CollectDocumentsOutput
	err := workflow.ExecuteActivity(ctx, activities.GeneratePrompt, getRelatedDocumentsInput).Get(ctx, &conversationFilename)
	if err != nil {
		logger.Error("Activity failed.", "Error", err)
		return QueryWorkflowOutput{}, err
	}

	return QueryWorkflowOutput{
		ConversationID: "conversationID",
		Response:       "response",
	}, nil
}
