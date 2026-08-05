import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { HumanCheckpointStore } from './store.js';

describe('HumanCheckpointStore', () => {
  it('seeds a realistic queue and scopes reusable history', () => {
    const store = new HumanCheckpointStore(':memory:');
    store.seedDemoData();

    expect(
      store.listSupportRequests('open').map((request) => request.id),
    ).toEqual(['SR-2048']);
    expect(store.listSupportRequests('closed')).toHaveLength(4);
    expect(
      store.listSupportRequests('pending-review').map((request) => request.id),
    ).toEqual(['SR-1984']);
    expect(
      store
        .listSupportRequestsForCustomer('CUST-NORTH-WATER', 'closed')
        .map((request) => request.id),
    ).toEqual(['SR-1671', 'SR-1538', 'SR-1172']);
    expect(
      store.getSupportRequestForCustomer('SR-1902', 'CUST-NORTH-WATER'),
    ).toBeNull();
    expect(
      store.listReusableHistory('SR-2048').map((request) => request.id),
    ).toEqual(['SR-1671', 'SR-1538', 'SR-1172']);

    store.close();
  });

  it('starts one stable workflow until it reaches a terminal state', () => {
    const store = new HumanCheckpointStore(':memory:');
    store.seedDemoData();

    const first = store.startWorkflow('SR-2048');
    const second = store.startWorkflow('SR-2048');

    expect(second.id).toBe(first.id);
    expect(store.listEvents(first.id).map((event) => event.eventType)).toEqual([
      'workflow.started',
    ]);
    expect(() => store.startWorkflow('SR-1984')).toThrow('is not open');

    store.close();
  });

  it('persists completed steps and recovery state across a server restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'human-checkpoint-store-'));
    const databasePath = join(directory, 'demo.sqlite');
    const input = { requestId: 'SR-2048', revision: 1 };

    const first = new HumanCheckpointStore(databasePath);
    first.seedDemoData();
    const workflow = first.startWorkflow('SR-2048');
    first.beginStep(workflow.id, 'review-request', input);
    first.completeStep(workflow.id, 'review-request', input, {
      taskId: 'task-1',
    });
    first.transitionWorkflow(
      workflow.id,
      'waiting-for-public-source-approval',
      'approve-public-source-check',
      'workflow.waiting-for-human',
    );
    first.close();

    const reopened = new HumanCheckpointStore(databasePath);
    const [recovered] = reopened.listRecoverableWorkflows();

    expect(recovered?.workflow.id).toBe(workflow.id);
    expect(recovered?.workflow.state).toBe(
      'waiting-for-public-source-approval',
    );
    expect(recovered?.steps[0]?.result).toEqual({ taskId: 'task-1' });
    expect(recovered?.events.map((event) => event.eventType)).toEqual([
      'workflow.started',
      'step.started',
      'step.completed',
      'workflow.waiting-for-human',
    ]);

    reopened.close();
  });

  it('does not replay a completed step with different input', () => {
    const store = new HumanCheckpointStore(':memory:');
    store.seedDemoData();
    const workflow = store.startWorkflow('SR-2048');
    store.beginStep(workflow.id, 'review-request', { revision: 1 });
    store.completeStep(
      workflow.id,
      'review-request',
      { revision: 1 },
      { accepted: true },
    );

    expect(() =>
      store.beginStep(workflow.id, 'review-request', { revision: 2 }),
    ).toThrow('different input');

    store.close();
  });

  it('keeps MoltNet attempts and human decisions in the workflow snapshot', () => {
    const store = new HumanCheckpointStore(':memory:');
    store.seedDemoData();
    const workflow = store.startWorkflow('SR-2048');

    store.linkMoltNetTask({
      workflowId: workflow.id,
      taskRole: 'request-review',
      taskId: 'task-review-1',
      attempt: 1,
      status: 'completed',
      outputRef: 'moltnet://tasks/task-review-1/outputs/final',
    });
    store.linkSigningRequest({
      workflowId: workflow.id,
      decision: 'public-source-check',
      signingRequestId: 'signing-request-1',
      status: 'pending',
      messageHash: 'abc123',
    });
    store.updateSigningRequestStatus(
      workflow.id,
      'public-source-check',
      'expired',
    );

    const snapshot = store.getWorkflowSnapshot(workflow.id);
    expect(snapshot.tasks[0]?.taskId).toBe('task-review-1');
    expect(snapshot.approvals[0]?.decision).toBe('public-source-check');
    expect(snapshot.approvals[0]?.status).toBe('expired');
    expect(snapshot.events.map((event) => event.eventType)).toContain(
      'moltnet.task.linked',
    );
    expect(snapshot.events.map((event) => event.eventType)).toContain(
      'human.decision.linked',
    );
    expect(snapshot.events.map((event) => event.eventType)).toContain(
      'human.decision.refreshed',
    );

    store.close();
  });
});
