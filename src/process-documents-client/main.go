package main

import (
	"context"
	"log"
	"strings"
	workflows "temporal-hello-world/src"

	"github.com/pborman/uuid"
	"go.temporal.io/sdk/client"
)

func main() {
	c, err := client.Dial(client.Options{HostPort: "localhost:7233"})
	if err != nil {
		log.Fatalln("Unable to create client", err)
	}
	defer c.Close()

	workflowId := "process-documents-workflow-" + strings.ToLower(uuid.New())

	workflowOptions := client.StartWorkflowOptions{
		ID:        workflowId,
		TaskQueue: "documents-processing-queue",
	}

	//Input
	repo := workflows.Repository{
		URL:            "https://github.com/bitovi/hatchify.git",
		Branch:         "main",
		Path:           "docs",
		FileExtensions: []string{"md"},
	}
	input := workflows.DocumentsProcessingWorkflowInput{
		ID:         workflowId,
		Repository: repo,
	}

	we, err := c.ExecuteWorkflow(context.Background(), workflowOptions, workflows.DocumentsProcessingWorkflow, input)
	if err != nil {
		log.Fatalln("Unable to execute workflow", err)
	}

	log.Println("Workflow ", we.GetID(), "running")

	var result workflows.DocumentsProcessingWorkflowOutput
	err = we.Get(context.Background(), &result)
	if err != nil {
		log.Fatalln("Unable get workflow result", err)
	}
	log.Println("Workflow result:", result)
}
