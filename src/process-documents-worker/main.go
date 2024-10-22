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

	w := worker.New(c, "documents-processing-queue", worker.Options{})

	w.RegisterWorkflow(workflows.DocumentsProcessingWorkflow)
	w.RegisterActivity(activities.CreateS3Bucket)
	w.RegisterActivity(activities.CollectDocuments)
	w.RegisterActivity(activities.ProcessDocuments)
	w.RegisterActivity(activities.DeleteS3Object)
	w.RegisterActivity(activities.DeleteS3Bucket)

	err = w.Run(worker.InterruptCh())
	if err != nil {
		log.Fatalln("Unable to start worker", err)
	}
}
