import { proxyActivities, startChild, uuid4 } from '@temporalio/workflow'
import * as activities from './activities'

const { createS3Bucket, deleteS3Object, deleteS3Bucket, getRelatedDocuments, invokePrompt, loadTestCases, getLatestDocumentProcessingId } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
  retry: {
    backoffCoefficient: 1,
    initialInterval: '3 seconds'
  }
})

const { collectDocuments, validateQueryResult, summarizeValidationResults } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minute',
  retry: {
    backoffCoefficient: 1,
    initialInterval: '3 seconds'
  }
})

const { processDocuments } = proxyActivities<typeof activities>({
  startToCloseTimeout: '50 minute',
  retry: {
    backoffCoefficient: 1,
    initialInterval: '3 seconds'
  }
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
  failRate: number
}
type DocumentsProcessingWorkflowOutput = {
  tableName: string
}
export async function documentsProcessingWorkflow(input: DocumentsProcessingWorkflowInput): Promise<DocumentsProcessingWorkflowOutput> {
  const { id, repository, failRate } = input
  const { url, branch, path, fileExtensions } = repository

  await createS3Bucket({
    bucket: id,
    failRate
  })

  const { zipFileName } = await collectDocuments({
    workflowId: id,
    s3Bucket: id,
    gitRepoUrl: url,
    gitRepoBranch: branch,
    gitRepoDirectory: path,
    fileExtensions,
    failRate
  })

  const { tableName } = await processDocuments({
    workflowId: id,
    s3Bucket: id,
    zipFileName,
    failRate
  })

  await deleteS3Object({ bucket: id, key: zipFileName })

  await deleteS3Bucket({ bucket: id })

  return { tableName }
}

type QueryWorkflowInput = {
  query: string 
  failRate: number
}
type QueryWorkflowOutput = {
  conversationId: string
  response: string
}
export async function invokePromptWorkflow(input: QueryWorkflowInput): Promise<QueryWorkflowOutput> {
  const { query, failRate } = input 
  const latestDocumentProcessingId = await getLatestDocumentProcessingId()  
  const conversationId = `conversation-${uuid4()}`

  await createS3Bucket({
    bucket: conversationId,
    failRate
  })

  const { relatedDocumentsContentFileName } = await getRelatedDocuments({
    query,
    latestDocumentProcessingId,
    s3Bucket: conversationId,
    failRate
  })

  const { response } = await invokePrompt({
    query,
    s3Bucket: conversationId,
    relatedDocumentsContentFileName,
    failRate
  })

  return { conversationId, response }
}

type TestPromptsWorkflowInput = {
  latestDocumentProcessingId: string
  testName: string
}
type TestPromptsWorkflowOutput = {
  validationResults: {
    query: string
    answer: string
    score: number
    reason: string
  }[],
  summary: string
  averageScore: number
}
export async function testPromptsWorkflow(input: TestPromptsWorkflowInput): Promise<TestPromptsWorkflowOutput> {
  const testCases = await loadTestCases({
    testName: input.testName
  }) 
  console.log("Loaded test cases.") 
  const queries = Object.keys(testCases)


  const childWorkflowHandles = await Promise.all(
    queries.map((query) => {
      return startChild('invokePromptWorkflow', {
        taskQueue: 'invoke-prompt-queue',
        args: [{
          query,
          latestDocumentProcessingId: input.latestDocumentProcessingId,
        }]
      })
    }
  ));

  const childWorkflowResponses = await Promise.all(
    childWorkflowHandles.map(async (handle, index) => {
      const query = queries[index];
      const expectedResponse = testCases[query]
      const result = await handle.result();

      return {
        query,
        expectedResponse,
        actualResponse: result.response,
      }
    })
  );

  const validationResults = await Promise.all(
    childWorkflowResponses.map(async (input) => validateQueryResult(input))
  )

  const { summary, averageScore } = await summarizeValidationResults({ validationResults })

  return {
    validationResults,
    summary,
    averageScore
  }
}