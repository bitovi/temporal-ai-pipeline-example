import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities';
import type * as s3Activities from './s3';

const { createS3Bucket, deleteS3Bucket } = proxyActivities<typeof s3Activities>({
  startToCloseTimeout: '1 minute',
});

const { gitClone } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minute',
});

const { vectorizeDocsList } = proxyActivities<typeof activities>({
  startToCloseTimeout: '50 minute',
});


// TODO: update all the inputs/return values to be objects
type Repo = {
  url: string
  path: string
}
type GetDocsUpdateIndexInput = {
  id: string
  repos: Repo[]
}
export async function VectorizeFilesWorkflow(input: GetDocsUpdateIndexInput): Promise<void> {
  const { id } = input

  const bucket = id.toLowerCase()

  await createS3Bucket({ bucket })

  // const [bucket, filename, totalFiles] = await gitClone(url, docsPath);

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

  await deleteS3Bucket({ bucket })
}
