import "dotenv/config"; 
import { Connection, Client } from '@temporalio/client';
import { nanoid } from 'nanoid';
import { documentsProcessingWorkflow } from './workflows';

import { getTemporalClientOptions } from './utils';

async function run() {
  const connection = await Connection.connect(getTemporalClientOptions());  

  const client = new Client({ 
    connection,
    namespace: process.env.NAMESPACE,
  });

  const [ failRate ] = process.argv.slice(2)

  const id = `process-documents-workflow-${nanoid()}`.toLowerCase().replaceAll('_', '')
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
      failRate: Number(failRate ?? 0)
    }],
    workflowId: id
  });

  console.log(`Documents Processing Workflow with id: ${handle.workflowId} is running`);

  console.log(await handle.result());
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
