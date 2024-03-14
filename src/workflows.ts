import { proxyActivities, uuid4 } from '@temporalio/workflow';
import * as activities from './activities';

const { createS3Bucket, deleteS3Object, deleteS3Bucket } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
});

const { collectDocuments } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minute',
});

const { processDocuments } = proxyActivities<typeof activities>({
  startToCloseTimeout: '50 minute',
});

const { generatePrompt, invokePrompt } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute'
})

type Repository = {
  url: string
  branch: string
  path: string
  fileExtensions: string[]
}
type DocumentsProcessingWorkflowInput = {
  id: string
  repository: Repository
}
type DocumentsProcessingWorkflowOutput = {
  tableName: string
}
export async function documentsProcessingWorkflow(input: DocumentsProcessingWorkflowInput): Promise<DocumentsProcessingWorkflowOutput> {
  const { id, repository } = input

  await createS3Bucket({ bucket: id })

  const { url, branch, path, fileExtensions } = repository

  const { zipFileName } = await collectDocuments({
    workflowId: id,
    s3Bucket: id,
    gitRepoUrl: url,
    gitRepoBranch: branch,
    gitRepoDirectory: path,
    fileExtensions
  });

  const { tableName } = await processDocuments({
    workflowId: id,
    s3Bucket: id,
    zipFileName
  })

  await deleteS3Object({ bucket: id, key: zipFileName })

  await deleteS3Bucket({ bucket: id })

  return {
    tableName
  }
}

type QueryWorkflowInput = {
  conversationId?: string
  query: string
  latestDocumentProcessingId: string
}
type QueryWorkflowOutput = {
  conversationId: string
  response: string
}
export async function invokePromptWorkflow(input: QueryWorkflowInput): Promise<QueryWorkflowOutput> {
  const { latestDocumentProcessingId, query } = input
  let { conversationId } = input

  if (!conversationId) {
    conversationId = `conversation-${uuid4()}`
    await createS3Bucket({ bucket: conversationId })
  }

  const { conversationFilename } = await generatePrompt({
    query,
    latestDocumentProcessingId,
    s3Bucket: conversationId
  })

  const { response } = await invokePrompt({
    query,
    s3Bucket: conversationId,
    conversationFilename
  })

  return { conversationId, response }
}