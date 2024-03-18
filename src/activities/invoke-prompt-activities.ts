import { getPGVectorStore } from './process-documents-activities'
import { getS3Object, putS3Object } from './s3-activities'

import { ChatPromptTemplate } from "@langchain/core/prompts"
import { ChatOpenAI } from "@langchain/openai"
import { Document } from '@langchain/core/documents'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY

let _gptModel: ChatOpenAI
function getGPTModel(): ChatOpenAI {
  if (!_gptModel) {
    _gptModel = new ChatOpenAI({
      openAIApiKey: OPENAI_API_KEY,
      temperature: 0,
      modelName: 'gpt-3.5-turbo'
    })
  }
  return _gptModel
}

type GetRelatedDocumentsInput = {
  query: string
  latestDocumentProcessingId: string
  s3Bucket: string
}
type GetRelatedDocumentsOutput = {
  conversationFilename: string
}
export async function generatePrompt(input: GetRelatedDocumentsInput): Promise<GetRelatedDocumentsOutput> {
  const { query, latestDocumentProcessingId, s3Bucket } = input

  const pgVectorStore = await getPGVectorStore()
  const results = await pgVectorStore.similaritySearch(query, 5, {
    workflowId: latestDocumentProcessingId
  });

  const conversationFilename = 'related-documentation.json'
  putS3Object({
    bucket: s3Bucket,
    key: conversationFilename,
    body: Buffer.from(JSON.stringify({
      context: results
    }))
  })

  return {
    conversationFilename
  }
}

type InvokePromptInput = {
  query: string
  s3Bucket: string
  conversationFilename: string
}
type InvokePromptOutput = {
  response: string
}
export async function invokePrompt(input: InvokePromptInput): Promise<InvokePromptOutput> {
  const { query, s3Bucket, conversationFilename } = input

  const conversationResponse = await getS3Object({
    bucket: s3Bucket,
    key: conversationFilename
  })
  const conversationContext = await conversationResponse.Body?.transformToString()

  let relevantDocumentation: string[] = []
  if (conversationContext) {
    const documentation: { context: Document<Record<string, any>>[] } = JSON.parse(conversationContext)
    relevantDocumentation = documentation.context.map(({ pageContent }) => pageContent)
  }
  const gptModel = getGPTModel()

  const response = await gptModel.invoke([
    [ 'system', 'You are a friendly, helpful software assistant. Your goal is to help users write CRUD-based software applications using the the Hatchify open-source project in TypeScript.' ],
    [ 'system', 'You should respond in short paragraphs, using Markdown formatting, seperated with two newlines to keep your responses easily readable.' ],
    [ 'system', `Here is the documentation that is relevant to the user's query:` + relevantDocumentation.join('\n\n') ],
    ['human', query]
  ])

  return {
    response: response.content.toString()
  }
}