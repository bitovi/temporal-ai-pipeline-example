import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities';

const { createS3Bucket, deleteS3Bucket } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
});

const { collectDocuments } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minute',
});

const { vectorizeDocuments } = proxyActivities<typeof activities>({
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
export async function VectorizeFilesWorkflow(input: GetDocsUpdateIndexInput): Promise<void> {
  const { id, repository } = input

  await createS3Bucket({ bucket: id })

  const { url, branch, path, fileExtensions } = repository

  const { zipFileName } = await collectDocuments({
    temporaryDirectory: `${id}-github-download`,
    s3Bucket: id,
    gitRepoUrl: url,
    gitRepoBranch: branch,
    gitRepoDirectory: path,
    fileExtensions
  });

  await vectorizeDocuments({
    temporaryDirectory: `${id}-s3-download`,
    s3Bucket: id,
    zipFileName
  })

  // const size = 5;
  // const promises = [];
  // for (let i = 0; i < totalFiles; i += size) {
  //   const iFrom = i;
  //   const iTo = Math.min(i + size, totalFiles);
  //   const promise = vectorizeDocsList(bucket, filename, iFrom, iTo);
  //   promises.push(promise);
  // }

  // const indexes = await Promise.all(promises);

  // return `Workfow completed: ${totalFiles} files in ${indexes.length} chunks`

  // await deleteS3Bucket({ bucket })
}
