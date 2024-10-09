import { Connection, Client } from '@temporalio/client';
import { documentsProcessingWorkflow } from './workflows';
import { nanoid } from 'nanoid';

async function run() {
  const connection = await Connection.connect({ address: 'localhost:7233' });

  const client = new Client({
    connection
  });

  const id = `process-documents-workflow-fail-${nanoid()}`.toLowerCase().replaceAll('_', '')
  const handle = await client.workflow.start(documentsProcessingWorkflow, {
    taskQueue: 'documents-processing-queue',
    args: [{
      id,
      repository: {
        url: 'https://github.com/bitovi/hatchify.git',
        branch: 'main',
        path: 'docs',
        fileExtensions: ['md']
      },
      tossError: true
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
