import { closeDatabase } from '@open-fms/database';
import { parseWorkerConfig } from './config.ts';
import { runScanWorker } from './worker.ts';

const controller = new AbortController();
function stop(): void {
  controller.abort();
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
try {
  await runScanWorker(parseWorkerConfig(process.env), controller.signal);
} catch {
  console.error('SCAN_WORKER_FAILED');
  process.exitCode = 1;
} finally {
  controller.abort();
  process.removeListener('SIGTERM', stop);
  process.removeListener('SIGINT', stop);
  await closeDatabase();
}
