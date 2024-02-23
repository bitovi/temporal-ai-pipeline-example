import { Connection, Client } from '@temporalio/client';
import { VectorizeFilesWorkflow } from './workflows';
import { nanoid } from 'nanoid';

async function run() {
  const connection = await Connection.connect({ address: 'localhost:7233' });

  const client = new Client({
    connection
  });

  const id = `index-workflow-${nanoid()}`
  const handle = await client.workflow.start(VectorizeFilesWorkflow, {
    taskQueue: 'vectorize-queue',
    args: [{
      id,
      repos: [{
        url: 'https://github.com/bitovi/hatchify.git',
        path: 'docs'
      }]
    }],
    workflowId: id
  });

  console.log(`Started workflow ${handle.workflowId}`);

  console.log(await handle.result());
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
