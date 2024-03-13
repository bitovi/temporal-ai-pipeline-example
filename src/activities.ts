/* eslint-disable @typescript-eslint/ban-ts-comment */
import fs from 'node:fs'
import path from 'node:path'
import child_process from 'node:child_process'

import {
  S3Client,
  S3ClientConfig,
  GetObjectCommand,
  GetObjectCommandOutput,
  PutObjectCommand,
  PutObjectCommandOutput,
  DeleteObjectCommand,
  DeleteObjectCommandOutput,
  CreateBucketCommand,
  CreateBucketCommandOutput,
  DeleteBucketCommand,
  DeleteBucketCommandOutput
} from '@aws-sdk/client-s3'
import { OpenAIEmbeddings } from '@langchain/openai'
import { PGVectorStore, PGVectorStoreArgs } from '@langchain/community/vectorstores/pgvector'
import { PoolConfig } from 'pg'
import archiver from 'archiver'
import extractZip from 'extract-zip'

const AWS_URL = process.env.AWS_URL
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY

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
}
type ProcessDocumentsOutput = {
    tableName: string
}
export async function processDocuments(input: ProcessDocumentsInput): Promise<ProcessDocumentsOutput> {
  const { workflowId, s3Bucket, zipFileName } = input

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

  const pgvectorStore = await PGVectorStore.initialize(
    embeddingsModel,
    config
  )

  // @ts-ignore
  const fileList = fs.readdirSync(temporaryDirectory, { recursive: true })
  const filesOnly = fileList.filter((fileName) => fileName.indexOf('.') >= 0)

  for (const fileName of filesOnly) {
    const pageContent = fs.readFileSync(path.join(temporaryDirectory, fileName), { encoding: 'utf-8' })
    if (pageContent.length > 0) {
      await pgvectorStore.addDocuments([{
        pageContent,
        metadata: { fileName, workflowId }
      }])
    }
  }
  pgvectorStore.end()

  fs.rmSync(temporaryDirectory, { force: true, recursive: true })

  return {
    tableName: DATABASE_TABLE_NAME
  }
}

let _s3Client: S3Client
function getClient(): S3Client {
  if(!_s3Client) {
    const s3ClientOptions: S3ClientConfig = {
      region: 'us-east-1',
      endpoint: AWS_URL,
      forcePathStyle: true
    }

    if (AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY) {
      s3ClientOptions.credentials = {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY
      }
    }
    _s3Client = new S3Client(s3ClientOptions)
  }

  return _s3Client
}

type CreateS3BucketInput = {
  bucket: string
}
export async function createS3Bucket(input: CreateS3BucketInput): Promise<CreateBucketCommandOutput> {
  const { bucket } = input
  const s3Client = getClient()
  return s3Client.send(new CreateBucketCommand({ Bucket: bucket }))
}

type DeleteS3BucketInput = {
  bucket: string
}
export async function deleteS3Bucket(input: DeleteS3BucketInput): Promise<DeleteBucketCommandOutput> {
  const { bucket } = input
  const s3Client = getClient()
  return s3Client.send(new DeleteBucketCommand({ Bucket: bucket }))
}

type GetS3ObjectInput = {
  bucket: string
  key: string
}
export async function getS3Object(input: GetS3ObjectInput): Promise<GetObjectCommandOutput> {
  const { bucket, key } = input
  const s3Client = getClient()
  return s3Client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  )
}

type PutS3ObjectInput = {
  body: Buffer
  bucket: string
  key: string
}
export async function putS3Object(input: PutS3ObjectInput): Promise<PutObjectCommandOutput> {
  const { body, bucket, key } = input
  const s3Client = getClient()
  return s3Client.send(
    new PutObjectCommand({
      Body: body,
      Bucket: bucket,
      Key: key
    })
  )
}

type DeleteS3ObjectInput = {
  bucket: string
  key: string
}
export async function deleteS3Object(input: DeleteS3ObjectInput): Promise<DeleteObjectCommandOutput> {
  const { bucket, key } = input
  const s3Client = getClient()
  return s3Client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key
    })
  )
}
