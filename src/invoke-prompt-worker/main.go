package main

import (
	"log"
	"os"
	workflows "temporal-hello-world/src"
	"temporal-hello-world/src/activities"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
)

var TEMPORAL_ADDRESS string = os.Getenv("TEMPORAL_ADDRESS")

func main() {
	c, err := client.Dial(client.Options{HostPort: TEMPORAL_ADDRESS})
	if err != nil {
		log.Fatalln("Unable to create cliente", err)
	}
	defer c.Close()

	w := worker.New(c, "invoke-prompt-queue", worker.Options{})

	w.RegisterWorkflow(workflows.InvokePromptWorkflow)
	w.RegisterActivity(activities.CreateS3Bucket)
	w.RegisterActivity(activities.GeneratePrompt)
	w.RegisterActivity(activities.InvokePrompt)

	err = w.Run(worker.InterruptCh())
	if err != nil {
		log.Fatalln("Unable to start worker", err)
	}
}
