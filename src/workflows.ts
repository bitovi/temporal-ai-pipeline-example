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
type DocumentsProcessingWorkflowInput = {
  id: string
  repository: Repository
}
type DocumentsProcessingWorkflowOutput = {
  tableName: string
}
export async function documentsProcessingWorkflow(input: DocumentsProcessingWorkflowInput): Promise<DocumentsProcessingWorkflowOutput> {
  const { id, repository } = input

  await createS3Bucket({ bucket: id })

  const { url, branch, path, fileExtensions } = repository

  const { zipFileName } = await collectDocuments({
    workflowId: id,
    s3Bucket: id,
    gitRepoUrl: url,
    gitRepoBranch: branch,
    gitRepoDirectory: path,
    fileExtensions
  });

  const { tableName } = await processDocuments({
    workflowId: id,
    s3Bucket: id,
    zipFileName
  })

  await deleteS3Object({ bucket: id, key: zipFileName })

  await deleteS3Bucket({ bucket: id })

  return {
    tableName
  }
}
