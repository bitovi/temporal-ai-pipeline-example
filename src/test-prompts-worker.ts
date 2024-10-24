import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities';
import { getTemporalClientOptions } from './utils';

async function run() {
  const temporalClientOptions = getTemporalClientOptions();  
  const connection = await NativeConnection.connect(temporalClientOptions); 

  const worker = await Worker.create({
    connection,
    namespace: process.env.NAMESPACE,
    taskQueue: 'prompt-testing-queue',
    workflowsPath: require.resolve('./workflows'),
    activities
  });

  await worker.run();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
