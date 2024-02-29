import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities';

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS

async function run() {
  const connection = await NativeConnection.connect({
    address: TEMPORAL_ADDRESS
  });

  const worker = await Worker.create({
    connection,
    namespace: 'default',
    taskQueue: 'documents-processing-queue',
    workflowsPath: require.resolve('./workflows'),
    activities
  });

  await worker.run();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
