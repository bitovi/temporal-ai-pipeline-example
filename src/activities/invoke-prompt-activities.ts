import { getPGVectorStore } from './process-documents-activities'
import { getS3Object, putS3Object } from './s3-activities'

import { createMemoizedOpenAI } from '../chat-gpt'
import { Document } from '@langchain/core/documents'

const getGPTModel = createMemoizedOpenAI();

type GetRelatedDocumentsInput = {
  query: string
  latestDocumentProcessingId: string
  s3Bucket: string
  failRate?: number
}

type GetRelatedDocumentsOutput = {
  relatedDocumentsContentFileName: string
}

export async function getRelatedDocuments(input: GetRelatedDocumentsInput): Promise<GetRelatedDocumentsOutput> {
  const { query, latestDocumentProcessingId, s3Bucket, failRate } = input

  const pgVectorStore = await getPGVectorStore()
  const results = await pgVectorStore.similaritySearch(query, 5, {
    workflowId: latestDocumentProcessingId
  });

  if (failRate) {
    const randomErr = Math.random()
    if (randomErr < failRate) {
     throw new Error("Failed to Read Embeddings Data: PSQL Connection refused.")
    }
  }

  const relatedDocumentsContentFileName = 'related-documentation.json'
  putS3Object({
    bucket: s3Bucket,
    key: relatedDocumentsContentFileName,
    body: Buffer.from(JSON.stringify({
      context: results
    }))
  })

  return {
    relatedDocumentsContentFileName: relatedDocumentsContentFileName
  }
}

type InvokePromptInput = {
  query: string
  s3Bucket: string
  relatedDocumentsContentFileName: string
  failRate?: number
}
type InvokePromptOutput = {
  response: string
}
export async function invokePrompt(input: InvokePromptInput): Promise<InvokePromptOutput> {
  const { query, s3Bucket, relatedDocumentsContentFileName , failRate } = input

  const conversationResponse = await getS3Object({
    bucket: s3Bucket,
    key: relatedDocumentsContentFileName
  })
  const conversationContext = await conversationResponse.Body?.transformToString()

  let relevantDocumentation: string[] = []
  if (conversationContext) {
    const documentation: { context: Document<Record<string, any>>[] } = JSON.parse(conversationContext)
    relevantDocumentation = documentation.context.map(({ pageContent }) => pageContent)
  }
  const gptModel = getGPTModel()
  if (failRate) {
    const randomErr = Math.random()
    if (randomErr < failRate) {
      throw new Error('Failed to Prompt LLM - Exceeded OpenAI Rate Limit')
    }
  }
  const response = await gptModel.invoke([
    [ 'system', 'You are a friendly, helpful software assistant. Your goal is to help users write CRUD-based software applications using the the Hatchify open-source project in TypeScript.' ],
    [ 'system', 'You should respond in short paragraphs, using Markdown formatting, separated with two newlines to keep your responses easily readable.' ],
    [ 'system', 'Whenever possible, use code examples derived from the documentation provided.' ],
    [ 'system', 'Import references must be included where relevant so that the reader can easily figure out how to import the necessary dependencies.' ],
    [ 'system', 'Do not use your existing knowledge to determine import references, only use import references as they appear in the relevant documentation for Hatchify' ],
    [ 'system', `Here is the Hatchify documentation that is relevant to the user's query:` + relevantDocumentation.join('\n\n') ],
    ['human', query]
  ])

  return {
    response: response.content.toString()
  }
}