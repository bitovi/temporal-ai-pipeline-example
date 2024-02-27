import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities';
import type * as s3Activities from './s3';

const { createS3Bucket, deleteS3Bucket } = proxyActivities<typeof s3Activities>({
  startToCloseTimeout: '1 minute',
});

const { ArchiveFilesFromGitHubInS3: cloneRepoAndUploadToS3 } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minute',
});

const { vectorizeDocsList } = proxyActivities<typeof activities>({
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

  await cloneRepoAndUploadToS3({
    temporaryDirectory: id,
    s3Bucket: id,
    gitRepoUrl: url,
    gitRepoBranch: branch,
    gitRepoDirectory: path,
    fileExtensions
  });

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
