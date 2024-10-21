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

	return DocumentsProcessingWorkflowOutput{TableName: "Valid tableName, placeholder."}, nil

	//TODO: Implement correct return
	/* 	return DocumentsProcessingWorkflowOutput{TableName: tableName}, nil
	 */
}
