/* eslint-disable @typescript-eslint/ban-ts-comment */
import fs from 'node:fs'
import path from 'node:path'
import child_process from 'node:child_process'
import { Client, PoolConfig} from "pg"


import { OpenAIEmbeddings } from '@langchain/openai'
import { PGVectorStore, PGVectorStoreArgs } from '@langchain/community/vectorstores/pgvector'
import archiver from 'archiver'
import extractZip from 'extract-zip'

import { getS3Object, putS3Object } from './s3-activities'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY

const DATABASE_CONNECTION_STRING = process.env.DATABASE_CONNECTION_STRING
const DATABASE_TABLE_NAME = process.env.DATABASE_TABLE_NAME || 'vector_db'

type CollectDocumentsInput = {
  workflowId: string
  s3Bucket: string
  gitRepoUrl: string
  gitRepoBranch: string
  gitRepoDirectory: string
  fileExtensions: string[]
  failRate?: number
}
type CollectDocumentsOutput = {
  zipFileName: string
}
export async function collectDocuments(input: CollectDocumentsInput): Promise<CollectDocumentsOutput> {
  const {
    workflowId,
    s3Bucket,
    gitRepoUrl,
    gitRepoBranch,
    gitRepoDirectory,
    fileExtensions,
    failRate
  } = input

  const temporaryDirectory = workflowId
  if (!fs.existsSync(temporaryDirectory)) {
    fs.mkdirSync(temporaryDirectory, { recursive: true })
  }

  const parts = gitRepoUrl.split('/')
  const organization = parts[3]
  const repository = parts[4].split('.git')[0]
  const repoPath = `${organization}/${repository}`

  const temporaryGitHubDirectory = `${temporaryDirectory}/${repoPath}`
  fs.rmSync(temporaryGitHubDirectory, { force: true, recursive: true })

  child_process.execSync(
    `git clone --depth 1 --branch ${gitRepoBranch} https://github.com/${repoPath}.git ${temporaryGitHubDirectory}`
  )

  const fileList = await fs.promises.readdir(temporaryGitHubDirectory, { recursive: true })
  const filteredFileList = fileList.filter((fileName: string) => {
    const fileExtension = fileName.slice(fileName.lastIndexOf('.') + 1)
    return fileName.startsWith(gitRepoDirectory) && fileExtensions.includes(fileExtension)
  })

  const archive = archiver('zip', {
    zlib: { level: 9 }
  })

  const zipFileName = 'files.zip'
  const zipFileLocation = `${temporaryDirectory}/${zipFileName}`
  const zipFile = fs.createWriteStream(zipFileLocation)

  archive.pipe(zipFile)
  const zipFileReady = new Promise<void>((resolve, reject) => {
    zipFile.on('close', resolve)
  })

  filteredFileList.forEach((fileName: string) =>
    archive.file(`${temporaryGitHubDirectory}/${fileName}`, { name: fileName })
  )

  archive.finalize()
  await zipFileReady

  if (failRate) {
    const randomErr = Math.random()
    if (randomErr < failRate) {
      throw new Error('Upload to S3 Failed - AWS is totally down')
    }
  }

  await putS3Object({
    body: Buffer.from(fs.readFileSync(zipFileLocation)),
    bucket: s3Bucket,
    key: zipFileName
  })

  fs.rmSync(temporaryDirectory, { force: true, recursive: true })

  return {
    zipFileName
  }
}

type ProcessDocumentsInput = {
  workflowId: string
  s3Bucket: string
  zipFileName: string
  failRate?: number
}
type ProcessDocumentsOutput = {
    tableName: string
}
export async function processDocuments(input: ProcessDocumentsInput): Promise<ProcessDocumentsOutput> {
  const { workflowId, s3Bucket, zipFileName, failRate } = input

  const temporaryDirectory = workflowId
  if (!fs.existsSync(temporaryDirectory)) {
    fs.mkdirSync(temporaryDirectory, { recursive: true })
  }

  const response = await getS3Object({
    bucket: s3Bucket,
    key: zipFileName
  })

  fs.writeFileSync(zipFileName, await response?.Body?.transformToByteArray() || new Uint8Array())
  await extractZip(zipFileName, { dir: path.resolve(temporaryDirectory) })
  fs.rmSync(zipFileName)

  if (failRate !== undefined) {
    const randomErr = Math.random()
    if (randomErr < failRate) {
      throw new Error('Failed to initialize Embeddings model - Exceeded OpenAI Rate Limit')
    }
  }
  const pgVectorStore = await getPGVectorStore()

  const fileList = await fs.promises.readdir(temporaryDirectory, { recursive: true })
  const filesOnly = fileList.filter((fileName) => fileName.indexOf('.') >= 0)

  for (const fileName of filesOnly) {
    const pageContent = fs.readFileSync(path.join(temporaryDirectory, fileName), { encoding: 'utf-8' })
    if (pageContent.length > 0) {
      await pgVectorStore.addDocuments([{
        pageContent,
        metadata: { fileName, workflowId }
      }])
    }
  }

  pgVectorStore.end()

  fs.rmSync(temporaryDirectory, { force: true, recursive: true })
 
  await saveWorkflowId(workflowId)
  
  return {
    tableName: DATABASE_TABLE_NAME
  }
}

export function getPGVectorStore(): Promise<PGVectorStore> {
  const embeddingsModel = new OpenAIEmbeddings({
    openAIApiKey: OPENAI_API_KEY,
    batchSize: 512,
    modelName: 'text-embedding-ada-002'
  })

  const config: PGVectorStoreArgs = {
    postgresConnectionOptions: {
      connectionString: DATABASE_CONNECTION_STRING
    } as PoolConfig,
    tableName: DATABASE_TABLE_NAME,
    columns: {
      idColumnName: 'id',
      vectorColumnName: 'vector',
      contentColumnName: 'content',
      metadataColumnName: 'metadata',
    }
  }
  
  return PGVectorStore.initialize(
    embeddingsModel,
    config
  )   
}

export async function saveWorkflowId(workflowId: string): Promise<void> {   
  const query = `
  CREATE TABLE IF NOT EXISTS process_documents (
    id SERIAL PRIMARY KEY,
    workflow_id VARCHAR(255) NOT NULL, 
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`;
  await createTable(query)
  await save(workflowId) 
}


async function createTable(query: string): Promise<void> {  
  try { 
    const client = await getClient()
    await client.connect();
    await client.query(query); 
    await client.end()
  } catch (err) { 
  }  
}

async function save(workflowId: string): Promise<void> {  
  const client = await getClient() 
  const query = `
    INSERT INTO process_documents (workflow_id)
    VALUES ('${workflowId}');
  `;

  try {
    await client.connect();
    await client.query(query); 
    await client.end()
  } catch (err) { 
  }  
}



async function getClient(): Promise<Client>{
  const client = new Client({connectionString: DATABASE_CONNECTION_STRING})   
  return client
}


interface ProcessDocument {
  id: number;
  workflow_id: string;
  created_at: Date;
}

export async function getLatestDocumentProcessingId(): Promise<string> {  
  const client = await getClient()

  let response: Array<ProcessDocument> = [];
 
  const query = `
    SELECT * 
    FROM process_documents 
    ORDER BY created_at DESC 
    LIMIT 1;
  `;

  try {
    await client.connect();  
    response = (await client.query(query)).rows as Array<ProcessDocument> ; 
    await client.end()
  } catch (err) { 
  }
  
  return response[0].workflow_id
}
