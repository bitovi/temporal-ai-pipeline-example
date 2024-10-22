package workflows

import (
	"temporal-hello-world/src/activities"
	"time"

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
