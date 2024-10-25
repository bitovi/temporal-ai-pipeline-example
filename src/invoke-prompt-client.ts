import "dotenv/config"; 
import { Connection, Client } from '@temporalio/client';
import { nanoid } from 'nanoid';
import { invokePromptWorkflow } from './workflows';
import { getTemporalClientOptions } from './utils';

async function run() {   
  const connection = await Connection.connect(getTemporalClientOptions());  
  const client = new Client({ 
    connection,
    namespace: process.env.NAMESPACE,
  });

  const [ failRate, latestDocumentProcessingId, query  ] = process.argv.slice(2)
  
  const id = `invoke-prompt-workflow-${nanoid()}`.toLowerCase().replaceAll('_', '')
  const handle = await client.workflow.start(invokePromptWorkflow, {
    taskQueue: 'invoke-prompt-queue',
    args: [{
      query,
      latestDocumentProcessingId,
      failRate: Number(failRate ?? 0)
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
