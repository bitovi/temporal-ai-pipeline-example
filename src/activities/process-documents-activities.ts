/* eslint-disable @typescript-eslint/ban-ts-comment */
import fs from 'node:fs'
import path from 'node:path'
import child_process from 'node:child_process'


import { OpenAIEmbeddings } from '@langchain/openai'
import { PGVectorStore, PGVectorStoreArgs } from '@langchain/community/vectorstores/pgvector'
import { PoolConfig } from 'pg'
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
  tossError?: boolean
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
    tossError = false
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

  // @ts-ignore
  const fileList = fs.readdirSync(temporaryGitHubDirectory, { recursive: true })
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

  if (tossError) {
    const randomErr = Math.random()
    if (randomErr < 0.6) {
      throw new Error()
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
  tossError?: boolean
}
type ProcessDocumentsOutput = {
    tableName: string
}
export async function processDocuments(input: ProcessDocumentsInput): Promise<ProcessDocumentsOutput> {
  const { workflowId, s3Bucket, zipFileName, tossError = false } = input

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

  if (tossError) {
    const randomErr = Math.random()
    if (randomErr < 0.8) {
      throw new Error()
    }
  }
  const pgVectorStore = await getPGVectorStore()

  // @ts-ignore
  const fileList = fs.readdirSync(temporaryDirectory, { recursive: true })
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