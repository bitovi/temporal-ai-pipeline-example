# Temporal AI workflow

The following is a simplified sample Temporal workflow to create custom embeddings from large list of files for use in an LLM-based application.

## Installing and running dependencies

This repo contains a simple local development setup. For production use, we would recommend using Temporal Cloud and AWS.

Use the following command to run everything you need locally:

- Localstack (for storing files in local S3)
- Postgres (where embeddings are stored)
- Temporal (runs `temporal server start-dev` in a docker container)
- A Temporal Worker (to run your Workflow/Activity code)

```bash
OPENAI_API_KEY=<your OpenAPI key> docker compose up --build -d
```

## Tearing everything down

Run the following command to turn everything off:

```bash
docker compose down -v
```

## Create embeddings

```bash
npm run process-documents
```

Generated embeddings are stored in a Postgres table:

![Alt text](image.png)

## Invoke a prompt

```bash
npm run invoke-prompt <embeddings workflowID> "<query>"
```
