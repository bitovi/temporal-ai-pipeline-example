import { proxyActivities } from '@temporalio/workflow';
// Only import the activity types
import type * as activities from './activities';

const { gitClone } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minute',
});
const { vectorizeDocsList } = proxyActivities<typeof activities>({
  startToCloseTimeout: '50 minute',
});


export async function getDocsUpdateIndex(url: string, docsPath: string): Promise<string> {
  console.log('getDocsUpdateIndex starting');
  const [bucket, filename, totalFiles] = await gitClone(url, docsPath);
  console.log('-------------gitClone done');

  const size = 5;
  const promises = [];
  for (let i = 0; i < totalFiles; i += size) {
    const iFrom = i;
    const iTo = Math.min(i + size, totalFiles);
    const promise = vectorizeDocsList(bucket, filename, iFrom, iTo); // Store the returned value
    promises.push(promise);
  }

  const indexes = await Promise.all(promises);

  return `Workfow completed: ${totalFiles} files in ${indexes.length} chunks`
}
