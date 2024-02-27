import { Connection, Client } from '@temporalio/client';
import { VectorizeFilesWorkflow } from './workflows';
import { nanoid } from 'nanoid';

async function run() {
  const connection = await Connection.connect({ address: 'localhost:7233' });

  const client = new Client({
    connection
  });

  const id = `index-workflow-${nanoid()}`.toLowerCase().replaceAll('_', '')
  const handle = await client.workflow.start(VectorizeFilesWorkflow, {
    taskQueue: 'vectorize-queue',
    args: [{
      id,
      repository: {
        url: 'https://github.com/bitovi/hatchify.git',
        branch: 'main',
        path: 'docs',
        fileExtensions: ['md']
      }
    }],
    workflowId: id
  });

  console.log(`Workflow ${handle.workflowId} running`);

  console.log(await handle.result());
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});