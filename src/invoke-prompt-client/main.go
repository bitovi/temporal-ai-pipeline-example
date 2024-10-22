package main

import (
	"context"
	"log"
	"os"
	"strings"
	workflows "temporal-hello-world/src"

	"github.com/pborman/uuid"
	"go.temporal.io/sdk/client"
)

func main() {
	args := os.Args[1:]
	if len(args) < 3 {
		log.Fatal("Usage: go run main.go <latestDocumentProcessingId> <query> <conversationId>")
	}
	latestDocumentProcessingID := args[0]
	query := args[1]
	conversationID := args[2]

	c, err := client.Dial(client.Options{HostPort: "localhost:7233"})
	if err != nil {
		log.Fatalln("Unable to create client", err)
	}
	defer c.Close()

	workflowID := "invoke-prompt-workflow-" + strings.ToLower(uuid.New())
	workflowID = strings.ToLower(strings.ReplaceAll(workflowID, "_", ""))

	workflowOptions := client.StartWorkflowOptions{
		ID:        workflowID,
		TaskQueue: "invoke-prompt-queue",
	}

	//Input
	input := workflows.QueryWorkflowInput{
		Query:                      query,
		LatestDocumentProcessingID: latestDocumentProcessingID,
		ConversationID:             conversationID,
	}

	we, err := c.ExecuteWorkflow(context.Background(), workflowOptions, workflows.DocumentsProcessingWorkflow, input)
	if err != nil {
		log.Fatalln("Unable to execute workflow", err)
	}

	log.Println("Workflow ", we.GetID(), "running")

	var result workflows.QueryWorkflowOutput
	err = we.Get(context.Background(), &result)
	if err != nil {
		log.Fatalln("Unable get workflow result", err)
	}
	log.Println("Workflow result:", result)
}
