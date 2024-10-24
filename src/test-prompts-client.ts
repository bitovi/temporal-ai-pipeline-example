import { Connection, Client } from '@temporalio/client';
import { testPromptsWorkflow } from './workflows';
import { nanoid } from 'nanoid';

async function run() {
  const connection = await Connection.connect(getTemporalClientOptions());  
  const client = new Client({ 
    connection,
    namespace: process.env.NAMESPACE,
  });

  const [ latestDocumentProcessingId ] = process.argv.slice(2)

  const id = `test-prompts-workflow-${nanoid()}`.toLowerCase().replaceAll('_', '')
  const handle = await client.workflow.start(testPromptsWorkflow, {
    taskQueue: 'prompt-testing-queue',
    args: [{
      latestDocumentProcessingId,
      testName: "hatchify-assistant"
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
