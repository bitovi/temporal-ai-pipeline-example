/* eslint-disable @typescript-eslint/ban-ts-comment */
import fs from 'node:fs'
import https from 'node:https'
import fsp from 'node:fs/promises'
import path from 'path'
import child_process from 'child_process'
import archiver from 'archiver'
import { putS3Object, getS3Object } from './s3'

import { PGVectorStore, SimpleDirectoryReader, storageContextFromDefaults, VectorStoreIndex } from 'llamaindex'

export * from './s3'

type GitCloneInput = {
  temporaryDirectory: string
  s3Bucket: string
  gitRepoUrl: string
  gitRepoBranch: string
  gitRepoDirectory: string
  fileExtensions: string[]
}
type GitCloneOutput = {
  uploadedFiles: string[]
}
export async function ArchiveFilesFromGitHubInS3(input: GitCloneInput): Promise<GitCloneOutput> {
  const {
    temporaryDirectory,
    s3Bucket,
    gitRepoUrl,
    gitRepoBranch,
    gitRepoDirectory,
    fileExtensions,
  } = input

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
  const filelist = await fsp.readdir(temporaryGitHubDirectory, { recursive: true })

  const filteredFileList = filelist.reduce((filteredFileList: string[], fileName: string) => {
    const fileExtension = fileName.slice(fileName.lastIndexOf('.') + 1)
    if (fileName.startsWith(gitRepoDirectory) && fileExtensions.includes(fileExtension)) {
      filteredFileList.push(fileName)
    }
    return filteredFileList
  }, [])

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
    body: Buffer.from(await fsp.readFile(zipFileLocation)),
    bucket: s3Bucket,
    key: zipFileName
  })

  fs.rmSync(temporaryDirectory, { force: true, recursive: true })

  return {
    uploadedFiles: filteredFileList
  }
}

export async function vectorizeDocsList(bucket = 'training', key = 'docslist.csv', iFrom = 0, iTo = 0): Promise<any> {
  // get document from s3
  const response = await getS3Object({ bucket, key })

  const docsListFull = (await response.Body.transformToString()).split('\n')

  console.log('getS3Object response httpStatusCode:', response['$metadata'].httpStatusCode)

  if (iTo === 0) iTo = docsListFull.length
  if (iTo < 0 || iTo > docsListFull.length || iFrom < 0 || iFrom > docsListFull.length - 1) {
    throw new Error('vectorizeDocsList docslist Indexes are outside of bounds')
  }

  console.log(`Getting files from indexes ${iFrom} to ${iTo - 1}`)

  const docsBasePath = `./../tmpDocs/f${iFrom}_${iTo}/`
  // TODO: clear docsBasePath before downloading new files

  const promises = docsListFull.slice(iFrom, iTo).map(async (url: string) => {
    return downloadFile(url, docsBasePath)
  })

  try {
    await Promise.all(promises)
    console.log('All files downloaded successfully!')
  } catch (error) {
    console.error('One or more downloads failed:', error)
  }

  // vectorize
  // store in db,
  const indexId = await vectorizeFolder(docsBasePath)

  console.log(`done files from: ${iTo} to ${iFrom}`)
  return indexId
}

function extractFolderStructure(url: string): string[] {
  const urlParts = url.split('/')
  let fileName = urlParts.pop() || ''

  if (!fileName) {
    fileName = urlParts.pop() || ''
  }

  const folderPath = urlParts.slice(3).join('/')

  return [folderPath, fileName]
}

async function mkdirIfNotExists(dirPath: string) {
  try {
    await fs.promises.access(dirPath, fs.constants.F_OK)
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      await fs.promises.mkdir(dirPath, { recursive: true })
    }
  }
}

async function downloadFile(url: string, basePath = './../tmpDocs/') {
  try {
    const response: any = await new Promise((resolve, reject) => {
      const req = https.get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to download ${url}, status code: ${res.statusCode}`))
        } else {
          resolve(res)
        }
      })

      req.on('error', reject)
    })
    const [folderPath, fileName] = extractFolderStructure(url)
    const dirPath = path.join(__dirname, `${basePath}${folderPath}`)
    await mkdirIfNotExists(dirPath)

    console.log(`writing file: ${dirPath}/${fileName}`)
    const fileStream = fs.createWriteStream(`${dirPath}/${fileName}`)

    response.pipe(fileStream)
    await new Promise((resolve, reject) => {
      fileStream.on('finish', resolve)
      fileStream.on('error', reject)
    })

    console.log(`File ${fileName} downloaded successfully!`)
  } catch (error: any) {
    console.error(`Error downloading ${url}: ${error.message}`)
  }
}

async function vectorizeFolder(docsBasePath: string) {
  try {
    // Create Documents object
    const folderFullPath = path.join(__dirname, docsBasePath.split('/').slice(0,-1).join('/'))
    const docs = await new SimpleDirectoryReader().loadData({
      directoryPath: folderFullPath,
      // @ts-ignore
      recursive: true,
    })

    const pgvs = new PGVectorStore()
    pgvs.setCollection(folderFullPath)
    await pgvs.clearCollection().catch(console.error)

    const ctx = await storageContextFromDefaults({ vectorStore: pgvs })

    console.debug('  - creating vector store')
    const index = await VectorStoreIndex.fromDocuments(docs, {
      storageContext: ctx,
    })
    const indexId = index?.indexStruct?.indexId
    console.debug('vectorizing - done.', indexId)
    return indexId
  } catch (err) {
    console.log('vectorizeFolder ERROR',err)
    return false
  }
}
