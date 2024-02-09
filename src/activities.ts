/* eslint-disable @typescript-eslint/ban-ts-comment */
import dotenv from 'dotenv';
import fs from 'node:fs';
import https from 'node:https';
import fsp from 'node:fs/promises';
import path from 'path';
import child_process from 'child_process';
import { putS3Object, getS3Object } from './s3';

import { PGVectorStore, SimpleDirectoryReader, storageContextFromDefaults, VectorStoreIndex } from 'llamaindex';

dotenv.config();
const repoDirectory = './../tmpRepos';

export async function gitClone(url: string, docsPath: string): Promise<[string, string, number]> {
  const dirPath = path.join(__dirname, repoDirectory);

  // create temp folder of it does not exist
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log('Directory created:', dirPath);
  }
  // https://github.com/bitovi/hatchify.git
  const parts = url.split('/');
  //todo check url
  const username = parts[3];
  const repo = parts[4].split('.git')[0];
  const repoPath = `${username}/${repo}`;
  const repoExists = fs.existsSync(`${dirPath}/repos/${repoPath}`);
  const branch = 'main';

  const repoFullPath = gitPullOrClone(repoExists, username, dirPath, repo, branch);

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const filelist = await fsp.readdir(`${repoFullPath}/${docsPath}`, { recursive: true });

  // filter only filenames with ".md"
  // convert to github raw file links https://raw.githubusercontent.com/bitovi/hatchify/main/docs/
  const rawBaseUrl = `https://raw.githubusercontent.com/${repoPath}/${branch}/${docsPath}/`;
  const filteredFileList = filelist
    .filter((name) => name.toLowerCase().endsWith('.md'))
    .map((name) => `${rawBaseUrl}${name}`);
  console.log(`Found ${filteredFileList.length} files`);

  // Save in s3 bucket as filelist.csv and return the [s3 url, length]

  const response = await putS3Object(Buffer.from(filteredFileList.join('\n')), 'training', 'docslist.csv');
  console.log('putS3Object response.httpStatusCode', response['$metadata'].httpStatusCode);

  return ['training', 'docslist.csv', filteredFileList.length];
}

export async function vectorizeDocsList(bucket = 'training', key = 'docslist.csv', iFrom = 0, iTo = 0): Promise<any> {
  // get document from s3
  const response = await getS3Object(bucket, key);

  const docsListFull = (await response.Body.transformToString()).split('\n');

  console.log('getS3Object response httpStatusCode:', response['$metadata'].httpStatusCode);

  if (iTo === 0) iTo = docsListFull.length;
  if (iTo < 0 || iTo > docsListFull.length || iFrom < 0 || iFrom > docsListFull.length - 1) {
    throw new Error('vectorizeDocsList docslist Indexes are outside of bounds');
  }

  console.log(`Getting files from indexes ${iFrom} to ${iTo - 1}`);

  const docsBasePath = `./../tmpDocs/f${iFrom}_${iTo}/`;
  // TODO: clear docsBasePath before downloading new files

  const promises = docsListFull.slice(iFrom, iTo).map(async (url: string) => {
    return downloadFile(url, docsBasePath);
  });

  try {
    await Promise.all(promises);
    console.log('All files downloaded successfully!');
  } catch (error) {
    console.error('One or more downloads failed:', error);
  }

  // vectorize
  // store in db,
  const indexId = await vectorizeFolder(docsBasePath);

  console.log(`done files from: ${iTo} to ${iFrom}`);
  return indexId;
}

function gitPullOrClone(repoExists = false, username = '', dirPath = '.', repo = '', branch = 'master') {
  console.log('gitPullOrClone called');
  if (!repoExists) {
    child_process.execSync(
      `git clone --depth 1 https://github.com/${username}/${repo}.git ${dirPath}/repos/${username}/${repo}`
    );
  } else {
    child_process.execSync(`cd ${dirPath}/repos/${username}/${repo} && git pull origin ${branch} --rebase`);
  }
  return `${dirPath}/repos/${username}/${repo}`;
}

function extractFolderStructure(url: string): string[] {
  const urlParts = url.split('/');
  let fileName = urlParts.pop() || '';

  if (!fileName) {
    fileName = urlParts.pop() || '';
  }

  const folderPath = urlParts.slice(3).join('/');

  return [folderPath, fileName];
}

async function mkdirIfNotExists(dirPath: string) {
  try {
    await fs.promises.access(dirPath, fs.constants.F_OK);
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      await fs.promises.mkdir(dirPath, { recursive: true });
    }
  }
}

async function downloadFile(url: string, basePath = './../tmpDocs/') {
  try {
    const response: any = await new Promise((resolve, reject) => {
      const req = https.get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to download ${url}, status code: ${res.statusCode}`));
        } else {
          resolve(res);
        }
      });

      req.on('error', reject);
    });
    const [folderPath, fileName] = extractFolderStructure(url);
    const dirPath = path.join(__dirname, `${basePath}${folderPath}`);
    await mkdirIfNotExists(dirPath);

    console.log(`writing file: ${dirPath}/${fileName}`);
    const fileStream = fs.createWriteStream(`${dirPath}/${fileName}`);

    response.pipe(fileStream);
    await new Promise((resolve, reject) => {
      fileStream.on('finish', resolve);
      fileStream.on('error', reject);
    });

    console.log(`File ${fileName} downloaded successfully!`);
  } catch (error: any) {
    console.error(`Error downloading ${url}: ${error.message}`);
  }
}

async function vectorizeFolder(docsBasePath: string) {
  try {
    // Create Documents object
    const folderFullPath = path.join(__dirname, docsBasePath.split('/').slice(0,-1).join('/'));
    const docs = await new SimpleDirectoryReader().loadData({
      directoryPath: folderFullPath,
      // @ts-ignore
      recursive: true,
    });

    const pgvs = new PGVectorStore();
    pgvs.setCollection(folderFullPath);
    await pgvs.clearCollection().catch(console.error);

    const ctx = await storageContextFromDefaults({ vectorStore: pgvs });

    console.debug('  - creating vector store');
    const index = await VectorStoreIndex.fromDocuments(docs, {
      storageContext: ctx,
    });
    const indexId = index?.indexStruct?.indexId;
    console.debug('vectorizing - done.', indexId);
    return indexId;
  } catch (err) {
    console.log('vectorizeFolder ERROR',err);
    return false;
  }
}
