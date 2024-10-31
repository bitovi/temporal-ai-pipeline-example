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
	if len(args) < 1 {
		log.Fatal("Usage: go run main.go <query> <conversationId>")
	}
	query := args[0]

	var conversationID string = ""

	if len(args) >= 2 {
		conversationID = args[1]
	}

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
		Query:          query,
		ConversationID: conversationID,
	}

	we, err := c.ExecuteWorkflow(context.Background(), workflowOptions, workflows.InvokePromptWorkflow, input)
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
