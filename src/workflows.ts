import { proxyActivities, startChild, uuid4, workflowInfo } from '@temporalio/workflow'  
import * as activities from './activities'

const { createS3Bucket, deleteS3Object, deleteS3Bucket, generatePrompt, invokePrompt, loadTestCases } = proxyActivities<typeof activities>({
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
}
type DocumentsProcessingWorkflowOutput = {
  tableName: string
}
export async function documentsProcessingWorkflow(input: DocumentsProcessingWorkflowInput): Promise<DocumentsProcessingWorkflowOutput> { 
  console.log(`Processing documents from ${input.repository.url}.`);
  const { id, repository } = input

  await createS3Bucket({ bucket: id }) 
  console.log(`Created S3 bucket with name ${id}.`);
 
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
  console.log(`Collected documents from ${path}.`); 

  console.log(`Processing bucket ${id}'s documents.`); 
  const { tableName } = await processDocuments({
    workflowId: id,
    s3Bucket: id,
    zipFileName
  }) 
  console.log(`Finished processing documents.`); 

  console.log(`Cleaning up`);
  await deleteS3Object({ bucket: id, key: zipFileName }) 
  console.log(`Deleted S3 bucket ${id} object ${zipFileName}.`);

  await deleteS3Bucket({ bucket: id }) 
  console.log(`Deleted S3 bucket ${id}.`);


  console.log(`Finished workflow: ${input.id}, result: ${tableName}`);
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
export async function invokePromptWorkflow( input: QueryWorkflowInput): Promise<QueryWorkflowOutput> { 
  console.log(`Invoking prompt with query: ${input.query}.`);

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
 
  console.log(`Finished workflow ${ workflowInfo().workflowId}. Resulting conversationId: ${conversationId}, resulting response: "\n" ${response}`);
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