import { proxyActivities, startChild, uuid4 } from '@temporalio/workflow'  
import * as activities from './activities'

const { createS3Bucket, deleteS3Object, deleteS3Bucket, generatePrompt, invokePrompt, loadTestCases } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
})

const { collectDocuments, validateQueryResult, summarizeValidationResults } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minute',
})

const { processDocuments } = proxyActivities<typeof activities>({
  startToCloseTimeout: '50 minute',
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

  console.log(`Processing documents from ${input.repository.url}.`);
  const { id, repository } = input

  await createS3Bucket({ bucket: id }) 
  console.log('Successfully created S3 bucket.');
 
  const { url, branch, path, fileExtensions } = repository


  console.log(`Collecting documents from ${path}.`); 
  const { zipFileName } = await collectDocuments({
    workflowId: id,
    s3Bucket: id,
    gitRepoUrl: url,
    gitRepoBranch: branch,
    gitRepoDirectory: path,
    fileExtensions
  }) 
  console.log(`Successfully collected documents from ${path}.`); 

  console.log(`Processing bucket ${id}'s documents.`); 
  const { tableName } = await processDocuments({
    workflowId: id,
    s3Bucket: id,
    zipFileName
  }) 
  console.log(`Successfully processed documents.`); 

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