import { resolve } from 'node:path';

import { HumanCheckpointStore } from '@human-checkpoint/store';

let store: HumanCheckpointStore | null = null;

export function workflowStore(): HumanCheckpointStore {
  if (store) return store;
  const databasePath =
    process.env.HUMAN_CHECKPOINT_DATABASE_PATH ??
    resolve(
      process.cwd(),
      '.moltnet/human-checkpoint-demo/human-checkpoint.sqlite',
    );
  store = new HumanCheckpointStore(databasePath);
  store.seedDemoData();
  return store;
}

export function closeWorkflowStoreForTest(): void {
  store?.close();
  store = null;
}
