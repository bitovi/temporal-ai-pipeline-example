import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities';

const { createS3Bucket, deleteS3Object, deleteS3Bucket } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
});

const { collectDocuments } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minute',
});

const { processDocuments } = proxyActivities<typeof activities>({
  startToCloseTimeout: '50 minute',
});

type Repository = {
  url: string
  branch: string
  path: string
  fileExtensions: string[]
}
type GetDocsUpdateIndexInput = {
  id: string
  repository: Repository
}
type GetDocsUpdateIndexOutput = {
  collection: string
}
export async function VectorizeFilesWorkflow(input: GetDocsUpdateIndexInput): Promise<GetDocsUpdateIndexOutput> {
  const { id, repository } = input

  await createS3Bucket({ bucket: id })

  const { url, branch, path, fileExtensions } = repository

  const { zipFileName } = await collectDocuments({
    temporaryDirectory: id,
    s3Bucket: id,
    gitRepoUrl: url,
    gitRepoBranch: branch,
    gitRepoDirectory: path,
    fileExtensions
  });

  const { collection } = await processDocuments({
    temporaryDirectory: id,
    s3Bucket: id,
    zipFileName
  })

  await deleteS3Object({ bucket: id, key: zipFileName })

  await deleteS3Bucket({ bucket: id })

  return {
    collection
  }
}
