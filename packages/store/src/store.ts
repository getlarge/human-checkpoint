import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementResultingChanges } from 'node:sqlite';

import type {
  MoltNetTaskLink,
  SigningRequestLink,
  StoredSupportRequestAttachment,
  SupportRequest,
  SupportRequestAttachment,
  SupportRequestStatus,
  WorkflowEvent,
  WorkflowInstance,
  WorkflowSnapshot,
  WorkflowState,
  WorkflowStep,
} from './types.js';

type Row = Record<string, unknown>;

const TERMINAL_STATES: WorkflowState[] = ['released', 'failed', 'cancelled'];

export class HumanCheckpointStore {
  private readonly database: DatabaseSync;
  private readonly now: () => Date;

  constructor(databasePath: string, options: { now?: () => Date } = {}) {
    if (databasePath !== ':memory:')
      mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.now = options.now ?? (() => new Date());
    this.database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (databasePath !== ':memory:') {
      this.database.exec(
        'PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;',
      );
    }
    this.migrate();
  }

  close(): void {
    this.database.close();
  }

  seedDemoData(): void {
    const insert = this.database.prepare(`
      INSERT OR IGNORE INTO support_requests (
        id, customer_id, customer_name, site_name, asset_id, asset_name, asset_model,
        summary, description, priority, status, opened_at, closed_at, assigned_role, assigned_shift,
        confirmed_resolution, approved_for_reuse, manual_id, manual_revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateDescription = this.database.prepare(`
      UPDATE support_requests SET description = ?
      WHERE id = ? AND (description IS NULL OR description = '')
    `);
    const insertAttachment = this.database.prepare(`
      INSERT INTO support_request_attachments (
        id, support_request_id, media_type, label, alt_text, content, sha256, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        support_request_id = excluded.support_request_id,
        media_type = excluded.media_type,
        label = excluded.label,
        alt_text = excluded.alt_text,
        content = excluded.content,
        sha256 = excluded.sha256,
        sort_order = excluded.sort_order
    `);
    this.transaction(() => {
      for (const request of DEMO_REQUESTS) {
        insert.run(
          request.id,
          request.customerId,
          request.customerName,
          request.siteName,
          request.assetId,
          request.assetName,
          request.assetModel,
          request.summary,
          request.description ?? null,
          request.priority,
          request.status,
          request.openedAt,
          request.closedAt,
          request.assignedRole,
          request.assignedShift,
          request.confirmedResolution,
          request.approvedForReuse ? 1 : 0,
          request.manualId,
          request.manualRevision,
        );
        updateDescription.run(request.description ?? null, request.id);
      }
      for (const attachment of DEMO_ATTACHMENTS) {
        insertAttachment.run(
          attachment.id,
          attachment.supportRequestId,
          attachment.mediaType,
          attachment.label,
          attachment.altText,
          attachment.content,
          attachment.sha256,
          attachment.sortOrder,
        );
      }
    });
  }

  listSupportRequests(status?: SupportRequestStatus): SupportRequest[] {
    const rows = status
      ? this.database
          .prepare(
            'SELECT * FROM support_requests WHERE status = ? ORDER BY opened_at DESC',
          )
          .all(status)
      : this.database
          .prepare('SELECT * FROM support_requests ORDER BY opened_at DESC')
          .all();
    return rows.map((row) => this.supportRequest(row as Row));
  }

  listSupportRequestsForCustomer(
    customerId: string,
    status?: SupportRequestStatus,
  ): SupportRequest[] {
    const rows = status
      ? this.database
          .prepare(
            `
            SELECT * FROM support_requests
            WHERE customer_id = ? AND status = ?
            ORDER BY opened_at DESC
          `,
          )
          .all(customerId, status)
      : this.database
          .prepare(
            `
            SELECT * FROM support_requests
            WHERE customer_id = ?
            ORDER BY opened_at DESC
          `,
          )
          .all(customerId);
    return rows.map((row) => this.supportRequest(row as Row));
  }

  getSupportRequest(id: string): SupportRequest | null {
    const row = this.database
      .prepare('SELECT * FROM support_requests WHERE id = ?')
      .get(id);
    return row ? this.supportRequest(row as Row) : null;
  }

  getSupportRequestForCustomer(
    id: string,
    customerId: string,
  ): SupportRequest | null {
    const row = this.database
      .prepare(
        'SELECT * FROM support_requests WHERE id = ? AND customer_id = ?',
      )
      .get(id, customerId);
    return row ? this.supportRequest(row as Row) : null;
  }

  listReusableHistory(requestId: string): SupportRequest[] {
    const current = this.requireSupportRequest(requestId);
    const rows = this.database
      .prepare(
        `
        SELECT * FROM support_requests
        WHERE id <> ?
          AND customer_id = ?
          AND asset_model = ?
          AND status = 'closed'
          AND approved_for_reuse = 1
        ORDER BY closed_at DESC
      `,
      )
      .all(current.id, current.customerId, current.assetModel);
    return rows.map((row) => this.supportRequest(row as Row));
  }

  getSupportRequestAttachment(
    id: string,
  ): StoredSupportRequestAttachment | null {
    const row = this.database
      .prepare(
        `
        SELECT a.*, length(a.content) AS byte_length
        FROM support_request_attachments a
        WHERE a.id = ?
      `,
      )
      .get(id);
    return row ? storedAttachment(row as Row) : null;
  }

  startWorkflow(supportRequestId: string): WorkflowInstance {
    const request = this.requireSupportRequest(supportRequestId);
    if (request.status !== 'open') {
      throw new Error(`Support request ${supportRequestId} is not open`);
    }
    return this.transaction(() => {
      const active = this.database
        .prepare(
          `
          SELECT * FROM workflow_instances
          WHERE support_request_id = ? AND state NOT IN ('released', 'failed', 'cancelled')
          ORDER BY created_at DESC LIMIT 1
        `,
        )
        .get(supportRequestId);
      if (active) return workflowInstance(active as Row);

      const id = randomUUID();
      const now = this.timestamp();
      this.database
        .prepare(
          `
          INSERT INTO workflow_instances (
            id, support_request_id, state, current_step, version, created_at, updated_at
          ) VALUES (?, ?, 'assigned', 'claim-request', 1, ?, ?)
        `,
        )
        .run(id, supportRequestId, now, now);
      this.appendEventWithinTransaction(id, 'workflow.started', {
        supportRequestId,
      });
      return this.requireWorkflow(id);
    });
  }

  transitionWorkflow(
    workflowId: string,
    state: WorkflowState,
    currentStep: string,
    eventType: string,
    payload: unknown = {},
  ): WorkflowInstance {
    return this.transaction(() => {
      this.requireWorkflow(workflowId);
      const now = this.timestamp();
      const result = this.database
        .prepare(
          `
          UPDATE workflow_instances
          SET state = ?, current_step = ?, version = version + 1, updated_at = ?, last_error = NULL
          WHERE id = ?
        `,
        )
        .run(state, currentStep, now, workflowId);
      assertChanged(result, `Unknown workflow ${workflowId}`);
      this.appendEventWithinTransaction(workflowId, eventType, payload);
      return this.requireWorkflow(workflowId);
    });
  }

  failWorkflow(workflowId: string, error: string): WorkflowInstance {
    return this.transaction(() => {
      const workflow = this.requireWorkflow(workflowId);
      if (workflow.state === 'released' || workflow.state === 'cancelled') {
        throw new Error(`Cannot fail ${workflow.state} workflow ${workflowId}`);
      }
      const now = this.timestamp();
      this.database
        .prepare(
          `
          UPDATE workflow_instances
          SET state = 'failed', current_step = 'failed', version = version + 1,
              updated_at = ?, last_error = ?
          WHERE id = ?
        `,
        )
        .run(now, error, workflowId);
      this.appendEventWithinTransaction(workflowId, 'workflow.failed', {
        error,
      });
      return this.requireWorkflow(workflowId);
    });
  }

  beginStep(workflowId: string, stepKey: string, input: unknown): WorkflowStep {
    const inputHash = hashJson(input);
    return this.transaction(() => {
      this.requireWorkflow(workflowId);
      const existing = this.database
        .prepare(
          'SELECT * FROM workflow_steps WHERE workflow_id = ? AND step_key = ?',
        )
        .get(workflowId, stepKey);
      if (existing) {
        const step = workflowStep(existing as Row);
        if (step.inputHash !== inputHash) {
          throw new Error(
            `Step ${stepKey} was already started with different input`,
          );
        }
        if (step.status === 'completed') return step;
        this.database
          .prepare(
            `
            UPDATE workflow_steps
            SET status = 'running', attempt_count = attempt_count + 1,
                started_at = ?, completed_at = NULL, last_error = NULL
            WHERE workflow_id = ? AND step_key = ?
          `,
          )
          .run(this.timestamp(), workflowId, stepKey);
      } else {
        this.database
          .prepare(
            `
            INSERT INTO workflow_steps (
              workflow_id, step_key, status, attempt_count, input_hash, result_json,
              started_at, completed_at, last_error
            ) VALUES (?, ?, 'running', 1, ?, NULL, ?, NULL, NULL)
          `,
          )
          .run(workflowId, stepKey, inputHash, this.timestamp());
      }
      this.appendEventWithinTransaction(workflowId, 'step.started', {
        stepKey,
        inputHash,
      });
      return this.requireStep(workflowId, stepKey);
    });
  }

  completeStep(
    workflowId: string,
    stepKey: string,
    input: unknown,
    result: unknown,
  ): WorkflowStep {
    const inputHash = hashJson(input);
    return this.transaction(() => {
      const existing = this.requireStep(workflowId, stepKey);
      if (existing.inputHash !== inputHash) {
        throw new Error(`Step ${stepKey} cannot complete with different input`);
      }
      if (existing.status === 'completed') return existing;
      const completedAt = this.timestamp();
      this.database
        .prepare(
          `
          UPDATE workflow_steps
          SET status = 'completed', result_json = ?, completed_at = ?, last_error = NULL
          WHERE workflow_id = ? AND step_key = ?
        `,
        )
        .run(JSON.stringify(result), completedAt, workflowId, stepKey);
      this.appendEventWithinTransaction(workflowId, 'step.completed', {
        stepKey,
      });
      return this.requireStep(workflowId, stepKey);
    });
  }

  replaceCompletedStepResult(
    workflowId: string,
    stepKey: string,
    result: unknown,
  ): WorkflowStep {
    return this.transaction(() => {
      const existing = this.requireStep(workflowId, stepKey);
      if (existing.status !== 'completed') {
        throw new Error(
          `Step ${stepKey} must be completed before its result can be normalized`,
        );
      }
      this.database
        .prepare(
          `
          UPDATE workflow_steps
          SET result_json = ?
          WHERE workflow_id = ? AND step_key = ?
        `,
        )
        .run(JSON.stringify(result), workflowId, stepKey);
      this.appendEventWithinTransaction(workflowId, 'step.result_normalized', {
        stepKey,
      });
      return this.requireStep(workflowId, stepKey);
    });
  }

  failStep(workflowId: string, stepKey: string, error: string): WorkflowStep {
    return this.transaction(() => {
      this.requireStep(workflowId, stepKey);
      this.database
        .prepare(
          `
          UPDATE workflow_steps SET status = 'failed', completed_at = ?, last_error = ?
          WHERE workflow_id = ? AND step_key = ?
        `,
        )
        .run(this.timestamp(), error, workflowId, stepKey);
      this.appendEventWithinTransaction(workflowId, 'step.failed', {
        stepKey,
        error,
      });
      return this.requireStep(workflowId, stepKey);
    });
  }

  linkMoltNetTask(
    input: Omit<MoltNetTaskLink, 'createdAt' | 'updatedAt'>,
  ): MoltNetTaskLink {
    return this.transaction(() => {
      this.requireWorkflow(input.workflowId);
      const now = this.timestamp();
      this.database
        .prepare(
          `
          INSERT INTO moltnet_task_links (
            workflow_id, task_role, task_id, attempt, status, output_ref, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(workflow_id, task_role, attempt) DO UPDATE SET
            task_id = excluded.task_id,
            status = excluded.status,
            output_ref = excluded.output_ref,
            updated_at = excluded.updated_at
        `,
        )
        .run(
          input.workflowId,
          input.taskRole,
          input.taskId,
          input.attempt,
          input.status,
          input.outputRef,
          now,
          now,
        );
      this.appendEventWithinTransaction(
        input.workflowId,
        'moltnet.task.linked',
        {
          taskRole: input.taskRole,
          taskId: input.taskId,
          attempt: input.attempt,
          status: input.status,
        },
      );
      return this.requireTaskLink(
        input.workflowId,
        input.taskRole,
        input.attempt,
      );
    });
  }

  linkSigningRequest(
    input: Omit<SigningRequestLink, 'createdAt' | 'updatedAt'>,
  ): SigningRequestLink {
    return this.transaction(() => {
      this.requireWorkflow(input.workflowId);
      const now = this.timestamp();
      this.database
        .prepare(
          `
          INSERT INTO signing_request_links (
            workflow_id, decision, signing_request_id, status, message_hash, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(workflow_id, decision) DO UPDATE SET
            signing_request_id = excluded.signing_request_id,
            status = excluded.status,
            message_hash = excluded.message_hash,
            updated_at = excluded.updated_at
        `,
        )
        .run(
          input.workflowId,
          input.decision,
          input.signingRequestId,
          input.status,
          input.messageHash,
          now,
          now,
        );
      this.appendEventWithinTransaction(
        input.workflowId,
        'human.decision.linked',
        {
          decision: input.decision,
          signingRequestId: input.signingRequestId,
          status: input.status,
        },
      );
      return this.requireSigningLink(input.workflowId, input.decision);
    });
  }

  updateSigningRequestStatus(
    workflowId: string,
    decision: SigningRequestLink['decision'],
    status: string,
  ): SigningRequestLink {
    return this.transaction(() => {
      this.requireSigningLink(workflowId, decision);
      this.database
        .prepare(
          `
          UPDATE signing_request_links SET status = ?, updated_at = ?
          WHERE workflow_id = ? AND decision = ?
        `,
        )
        .run(status, this.timestamp(), workflowId, decision);
      this.appendEventWithinTransaction(
        workflowId,
        'human.decision.refreshed',
        {
          decision,
          status,
        },
      );
      return this.requireSigningLink(workflowId, decision);
    });
  }

  closeSupportRequest(id: string, confirmedResolution: string): SupportRequest {
    return this.transaction(() => {
      this.requireSupportRequest(id);
      this.database
        .prepare(
          `
          UPDATE support_requests
          SET status = 'closed', closed_at = ?, confirmed_resolution = ?
          WHERE id = ?
        `,
        )
        .run(this.timestamp(), confirmedResolution, id);
      return this.requireSupportRequest(id);
    });
  }

  getWorkflowSnapshot(workflowId: string): WorkflowSnapshot {
    const workflow = this.requireWorkflow(workflowId);
    return {
      workflow,
      request: this.requireSupportRequest(workflow.supportRequestId),
      steps: this.database
        .prepare(
          'SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY started_at',
        )
        .all(workflowId)
        .map((row) => workflowStep(row as Row)),
      tasks: this.database
        .prepare(
          'SELECT * FROM moltnet_task_links WHERE workflow_id = ? ORDER BY created_at',
        )
        .all(workflowId)
        .map((row) => taskLink(row as Row)),
      approvals: this.database
        .prepare(
          'SELECT * FROM signing_request_links WHERE workflow_id = ? ORDER BY created_at',
        )
        .all(workflowId)
        .map((row) => signingLink(row as Row)),
      events: this.listEvents(workflowId),
    };
  }

  listRecoverableWorkflows(): WorkflowSnapshot[] {
    const placeholders = TERMINAL_STATES.map(() => '?').join(', ');
    const rows = this.database
      .prepare(
        `SELECT id FROM workflow_instances WHERE state NOT IN (${placeholders}) ORDER BY updated_at`,
      )
      .all(...TERMINAL_STATES);
    return rows.map((row) => this.getWorkflowSnapshot(String((row as Row).id)));
  }

  listEvents(workflowId: string): WorkflowEvent[] {
    return this.database
      .prepare(
        'SELECT * FROM workflow_events WHERE workflow_id = ? ORDER BY sequence',
      )
      .all(workflowId)
      .map((row) => workflowEvent(row as Row));
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    const current = this.database
      .prepare(
        'SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations',
      )
      .get() as Row;
    let version = Number(current.version);
    if (version < 1) {
      this.transaction(() => {
        this.database.exec(SCHEMA_V1);
        this.database
          .prepare(
            'INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)',
          )
          .run(this.timestamp());
      });
      version = 1;
    }
    if (version < 2) {
      this.transaction(() => {
        this.database.exec(SCHEMA_V2);
        this.database
          .prepare(
            'INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?)',
          )
          .run(this.timestamp());
      });
    }
  }

  private supportRequest(row: Row): SupportRequest {
    const request = supportRequest(row);
    const attachments = this.database
      .prepare(
        `
        SELECT id, support_request_id, media_type, label, alt_text,
               length(content) AS byte_length, sha256
        FROM support_request_attachments
        WHERE support_request_id = ?
        ORDER BY sort_order, id
      `,
      )
      .all(request.id)
      .map((attachment) => attachmentMetadata(attachment as Row));
    return { ...request, attachments };
  }

  private requireSupportRequest(id: string): SupportRequest {
    const request = this.getSupportRequest(id);
    if (!request) throw new Error(`Unknown support request ${id}`);
    return request;
  }

  private requireWorkflow(id: string): WorkflowInstance {
    const row = this.database
      .prepare('SELECT * FROM workflow_instances WHERE id = ?')
      .get(id);
    if (!row) throw new Error(`Unknown workflow ${id}`);
    return workflowInstance(row as Row);
  }

  private requireStep(workflowId: string, stepKey: string): WorkflowStep {
    const row = this.database
      .prepare(
        'SELECT * FROM workflow_steps WHERE workflow_id = ? AND step_key = ?',
      )
      .get(workflowId, stepKey);
    if (!row)
      throw new Error(`Unknown step ${stepKey} in workflow ${workflowId}`);
    return workflowStep(row as Row);
  }

  private requireTaskLink(
    workflowId: string,
    taskRole: MoltNetTaskLink['taskRole'],
    attempt: number,
  ): MoltNetTaskLink {
    const row = this.database
      .prepare(
        `
        SELECT * FROM moltnet_task_links
        WHERE workflow_id = ? AND task_role = ? AND attempt = ?
      `,
      )
      .get(workflowId, taskRole, attempt);
    if (!row)
      throw new Error(`Missing MoltNet task link ${taskRole}/${attempt}`);
    return taskLink(row as Row);
  }

  private requireSigningLink(
    workflowId: string,
    decision: SigningRequestLink['decision'],
  ): SigningRequestLink {
    const row = this.database
      .prepare(
        `
        SELECT * FROM signing_request_links WHERE workflow_id = ? AND decision = ?
      `,
      )
      .get(workflowId, decision);
    if (!row) throw new Error(`Missing signing request link ${decision}`);
    return signingLink(row as Row);
  }

  private appendEventWithinTransaction(
    workflowId: string,
    eventType: string,
    payload: unknown,
  ): void {
    this.database
      .prepare(
        `
        INSERT INTO workflow_events (workflow_id, event_type, payload_json, created_at)
        VALUES (?, ?, ?, ?)
      `,
      )
      .run(workflowId, eventType, JSON.stringify(payload), this.timestamp());
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

const SCHEMA_V1 = `
  CREATE TABLE support_requests (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    site_name TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    asset_name TEXT NOT NULL,
    asset_model TEXT NOT NULL,
    summary TEXT NOT NULL,
    priority TEXT NOT NULL CHECK(priority IN ('routine', 'urgent')),
    status TEXT NOT NULL CHECK(status IN ('open', 'pending-review', 'closed')),
    opened_at TEXT NOT NULL,
    closed_at TEXT,
    assigned_role TEXT,
    assigned_shift TEXT,
    confirmed_resolution TEXT,
    approved_for_reuse INTEGER NOT NULL DEFAULT 0 CHECK(approved_for_reuse IN (0, 1)),
    manual_id TEXT NOT NULL,
    manual_revision TEXT NOT NULL
  );
  CREATE INDEX support_requests_queue_idx ON support_requests(status, opened_at DESC);
  CREATE INDEX support_requests_history_idx
    ON support_requests(customer_id, asset_model, status, approved_for_reuse);

  CREATE TABLE workflow_instances (
    id TEXT PRIMARY KEY,
    support_request_id TEXT NOT NULL REFERENCES support_requests(id),
    state TEXT NOT NULL,
    current_step TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_error TEXT
  );
  CREATE INDEX workflow_request_idx ON workflow_instances(support_request_id, updated_at DESC);

  CREATE TABLE workflow_steps (
    workflow_id TEXT NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
    step_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
    attempt_count INTEGER NOT NULL,
    input_hash TEXT NOT NULL,
    result_json TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    last_error TEXT,
    PRIMARY KEY(workflow_id, step_key)
  );

  CREATE TABLE workflow_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_id TEXT NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX workflow_events_workflow_idx ON workflow_events(workflow_id, sequence);

  CREATE TABLE moltnet_task_links (
    workflow_id TEXT NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
    task_role TEXT NOT NULL CHECK(task_role IN ('request-review', 'technician-brief')),
    task_id TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    status TEXT NOT NULL,
    output_ref TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(workflow_id, task_role, attempt),
    UNIQUE(task_id)
  );

  CREATE TABLE signing_request_links (
    workflow_id TEXT NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
    decision TEXT NOT NULL CHECK(decision IN ('public-source-check', 'work-order-release')),
    signing_request_id TEXT NOT NULL,
    status TEXT NOT NULL,
    message_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(workflow_id, decision),
    UNIQUE(signing_request_id)
  );
`;

const SCHEMA_V2 = `
  ALTER TABLE support_requests ADD COLUMN description TEXT;

  CREATE TABLE support_request_attachments (
    id TEXT PRIMARY KEY,
    support_request_id TEXT NOT NULL REFERENCES support_requests(id) ON DELETE CASCADE,
    media_type TEXT NOT NULL CHECK(media_type IN ('image/webp')),
    label TEXT NOT NULL,
    alt_text TEXT NOT NULL,
    content BLOB NOT NULL,
    sha256 TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX support_request_attachments_request_idx
    ON support_request_attachments(support_request_id, sort_order);
`;

type DemoRequest = Omit<SupportRequest, 'attachments' | 'description'> & {
  description?: string | null;
};

const DEMO_REQUESTS: DemoRequest[] = [
  {
    id: 'SR-2048',
    customerId: 'CUST-NORTH-WATER',
    customerName: 'North River Water',
    siteName: 'East pumping station',
    assetId: 'P-2048',
    assetName: 'Cooling-water circulation pump P-2048',
    assetModel: 'SKF-CWP-200',
    summary: 'Drive-end vibration increased from 2.1 to 4.8 mm/s RMS.',
    priority: 'urgent',
    status: 'open',
    openedAt: '2026-08-05T06:42:00.000Z',
    closedAt: null,
    assignedRole: 'Lead field technician',
    assignedShift: 'Day / A',
    confirmedResolution: null,
    approvedForReuse: false,
    manualId: 'MAN-SKF-CWP-200-REV-F',
    manualRevision: 'F',
  },
  {
    id: 'SR-2075',
    customerId: 'CUST-ASTER-COMPONENTS',
    customerName: 'Aster Components',
    siteName: 'Assembly Hall · Packing line 2',
    assetId: 'CV-204',
    assetName: 'Packaging conveyor CV-204',
    assetModel: 'Dorner 2100 Series End Drive',
    summary:
      'Conveyor belt drifts toward the operator side after 10 to 15 minutes.',
    description:
      'Cartons begin rubbing the side guide after the conveyor has been running for several minutes. The line team re-centered the belt once, but the drift returned. Three reported photographs are attached; no guard has been removed.',
    priority: 'routine',
    status: 'open',
    openedAt: '2026-08-05T07:40:00.000Z',
    closedAt: null,
    assignedRole: 'Field service technician',
    assignedShift: 'Day / A',
    confirmedResolution: null,
    approvedForReuse: false,
    manualId: 'MAN-DORNER-2100-REV-J',
    manualRevision: '851-043 Rev. J',
  },
  {
    id: 'SR-1872',
    customerId: 'CUST-ASTER-COMPONENTS',
    customerName: 'Aster Components',
    siteName: 'Assembly Hall · Packing line 2',
    assetId: 'CV-204',
    assetName: 'Packaging conveyor CV-204',
    assetModel: 'Dorner 2100 Series End Drive',
    summary: 'Belt drifted toward the operator side after washdown.',
    priority: 'routine',
    status: 'closed',
    openedAt: '2026-02-12T07:15:00.000Z',
    closedAt: '2026-02-12T15:44:00.000Z',
    assignedRole: 'Field service technician',
    assignedShift: 'Day / A',
    confirmedResolution:
      'Residue was removed from the drive spindle; tracking was then observed under load for 30 minutes.',
    approvedForReuse: true,
    manualId: 'MAN-DORNER-2100-REV-J',
    manualRevision: '851-043 Rev. J',
  },
  {
    id: 'SR-1938',
    customerId: 'CUST-ASTER-COMPONENTS',
    customerName: 'Aster Components',
    siteName: 'Assembly Hall · Packing line 1',
    assetId: 'CV-118',
    assetName: 'Packaging conveyor CV-118',
    assetModel: 'Dorner 2100 Series End Drive',
    summary: 'Tracking changed after the packing line was relocated.',
    priority: 'routine',
    status: 'closed',
    openedAt: '2026-05-04T08:20:00.000Z',
    closedAt: '2026-05-04T14:36:00.000Z',
    assignedRole: 'Mechanical maintenance technician',
    assignedShift: 'Late / B',
    confirmedResolution:
      'The mounting surface and frame were found out of plane; the frame was realigned and tracking verified under load.',
    approvedForReuse: true,
    manualId: 'MAN-DORNER-2100-REV-J',
    manualRevision: '851-043 Rev. J',
  },
  {
    id: 'SR-2010',
    customerId: 'CUST-ASTER-COMPONENTS',
    customerName: 'Aster Components',
    siteName: 'Assembly Hall · Packing line 1',
    assetId: 'CV-118',
    assetName: 'Packaging conveyor CV-118',
    assetModel: 'Dorner 2100 Series End Drive',
    summary: 'Conveyor stopped under load and restarted after cartons cleared.',
    priority: 'urgent',
    status: 'closed',
    openedAt: '2026-06-18T10:12:00.000Z',
    closedAt: '2026-06-18T13:40:00.000Z',
    assignedRole: 'Mechanical maintenance technician',
    assignedShift: 'Day / A',
    confirmedResolution:
      'A damaged timing belt was replaced. No belt-tracking symptom was recorded.',
    approvedForReuse: true,
    manualId: 'MAN-DORNER-2100-REV-J',
    manualRevision: '851-043 Rev. J',
  },
  {
    id: 'SR-2051',
    customerId: 'CUST-ASTER-COMPONENTS',
    customerName: 'Aster Components',
    siteName: 'Assembly Hall · Packing line 2',
    assetId: 'CV-204',
    assetName: 'Packaging conveyor CV-204',
    assetModel: 'Dorner 2100 Series End Drive',
    summary: 'Recurring operator-side drift; outcome awaiting review.',
    priority: 'routine',
    status: 'pending-review',
    openedAt: '2026-07-29T12:05:00.000Z',
    closedAt: null,
    assignedRole: 'Field service technician',
    assignedShift: 'Day / A',
    confirmedResolution: null,
    approvedForReuse: false,
    manualId: 'MAN-DORNER-2100-REV-J',
    manualRevision: '851-043 Rev. J',
  },
  {
    id: 'SR-1172',
    customerId: 'CUST-NORTH-WATER',
    customerName: 'North River Water',
    siteName: 'East pumping station',
    assetId: 'P-2048',
    assetName: 'Cooling-water circulation pump P-2048',
    assetModel: 'SKF-CWP-200',
    summary: 'Intermittent coupling-side vibration after planned shutdown.',
    priority: 'routine',
    status: 'closed',
    openedAt: '2026-02-12T07:15:00.000Z',
    closedAt: '2026-02-12T15:44:00.000Z',
    assignedRole: 'Field service technician',
    assignedShift: 'Day / A',
    confirmedResolution:
      'Coupling alignment corrected; post-work vibration returned to 2.0 mm/s RMS.',
    approvedForReuse: true,
    manualId: 'MAN-SKF-CWP-200-REV-F',
    manualRevision: 'F',
  },
  {
    id: 'SR-1538',
    customerId: 'CUST-NORTH-WATER',
    customerName: 'North River Water',
    siteName: 'West filtration plant',
    assetId: 'P-1180',
    assetName: 'Process-water pump P-1180',
    assetModel: 'SKF-CWP-200',
    summary: 'Steady drive-end vibration increase following seal replacement.',
    priority: 'routine',
    status: 'closed',
    openedAt: '2026-04-21T09:20:00.000Z',
    closedAt: '2026-04-22T11:08:00.000Z',
    assignedRole: 'Reliability technician',
    assignedShift: 'Day / A',
    confirmedResolution:
      'Soft-foot condition corrected and alignment verified against the manufacturer procedure.',
    approvedForReuse: true,
    manualId: 'MAN-SKF-CWP-200-REV-F',
    manualRevision: 'F',
  },
  {
    id: 'SR-1671',
    customerId: 'CUST-NORTH-WATER',
    customerName: 'North River Water',
    siteName: 'West filtration plant',
    assetId: 'P-1180',
    assetName: 'Process-water pump P-1180',
    assetModel: 'SKF-CWP-200',
    summary: 'Local indicator lamp failed during routine round.',
    priority: 'routine',
    status: 'closed',
    openedAt: '2026-05-18T13:10:00.000Z',
    closedAt: '2026-05-18T14:02:00.000Z',
    assignedRole: 'Electrical technician',
    assignedShift: 'Day / A',
    confirmedResolution: 'Failed indicator module replaced.',
    approvedForReuse: true,
    manualId: 'MAN-SKF-CWP-200-REV-F',
    manualRevision: 'F',
  },
  {
    id: 'SR-1984',
    customerId: 'CUST-NORTH-WATER',
    customerName: 'North River Water',
    siteName: 'North intake',
    assetId: 'P-0774',
    assetName: 'Intake pump P-0774',
    assetModel: 'SKF-CWP-200',
    summary: 'Reported bearing noise; resolution awaiting engineering review.',
    priority: 'urgent',
    status: 'pending-review',
    openedAt: '2026-07-29T22:40:00.000Z',
    closedAt: null,
    assignedRole: 'Night maintenance technician',
    assignedShift: 'Night / B',
    confirmedResolution: null,
    approvedForReuse: false,
    manualId: 'MAN-SKF-CWP-200-REV-F',
    manualRevision: 'F',
  },
  {
    id: 'SR-2063',
    customerId: 'CUST-NORTH-WATER',
    customerName: 'North River Water',
    siteName: 'Central treatment plant',
    assetId: 'C-0012',
    assetName: 'Instrument-air compressor C-12',
    assetModel: 'Atlas Copco GA37',
    summary:
      'Discharge temperature reaches 108 °C within twenty minutes of loading.',
    priority: 'urgent',
    status: 'pending-review',
    openedAt: '2026-08-01T14:25:00.000Z',
    closedAt: null,
    assignedRole: 'Mechanical maintenance technician',
    assignedShift: 'Day / A',
    confirmedResolution: null,
    approvedForReuse: false,
    manualId: 'MAN-ATLAS-GA37-REV-C',
    manualRevision: 'C',
  },
  {
    id: 'SR-1714',
    customerId: 'CUST-NORTH-WATER',
    customerName: 'North River Water',
    siteName: 'Administration building',
    assetId: 'AHU-0003',
    assetName: 'Air-handling unit AHU-3',
    assetModel: 'Trane Performance Climate Changer',
    summary: 'Supply airflow fell below the occupied-hours setpoint.',
    priority: 'routine',
    status: 'closed',
    openedAt: '2026-06-03T08:10:00.000Z',
    closedAt: '2026-06-03T12:46:00.000Z',
    assignedRole: 'Building systems technician',
    assignedShift: 'Day / A',
    confirmedResolution:
      'Loose supply-fan belt replaced and airflow verified at the local controller.',
    approvedForReuse: true,
    manualId: 'MAN-TRANE-PCC-REV-B',
    manualRevision: 'B',
  },
  {
    id: 'SR-1902',
    customerId: 'CUST-SOUTH-ENERGY',
    customerName: 'South Basin Energy',
    siteName: 'Cooling loop 2',
    assetId: 'P-5501',
    assetName: 'Cooling loop pump P-5501',
    assetModel: 'SKF-CWP-200',
    summary: 'Drive-end vibration above the local alert threshold.',
    priority: 'urgent',
    status: 'closed',
    openedAt: '2026-06-11T03:15:00.000Z',
    closedAt: '2026-06-11T18:31:00.000Z',
    assignedRole: 'Rotating equipment technician',
    assignedShift: 'Night / B',
    confirmedResolution:
      'Baseplate fasteners re-torqued under the customer procedure.',
    approvedForReuse: true,
    manualId: 'MAN-SKF-CWP-200-REV-E',
    manualRevision: 'E',
  },
];

type DemoAttachment = StoredSupportRequestAttachment & { sortOrder: number };

const DEMO_ATTACHMENTS: DemoAttachment[] = [
  fixtureAttachment({
    id: 'ATT-881',
    supportRequestId: 'SR-2075',
    filename: 'att-881-operator-side-belt-edge.webp',
    label: 'Operator-side belt edge',
    altText:
      'Close view of the blue conveyor belt beside the operator-side stainless guide.',
    sortOrder: 1,
  }),
  fixtureAttachment({
    id: 'ATT-882',
    supportRequestId: 'SR-2075',
    filename: 'att-882-drive-end-spindle.webp',
    label: 'Drive-end spindle',
    altText: 'Close view of the conveyor drive-end cover, bearing, and belt.',
    sortOrder: 2,
  }),
  fixtureAttachment({
    id: 'ATT-883',
    supportRequestId: 'SR-2075',
    filename: 'att-883-conveyor-frame-guide.webp',
    label: 'Conveyor frame and guide',
    altText:
      'Wider view of the conveyor frame, blue belt, and side-guide arrangement.',
    sortOrder: 3,
  }),
];

function fixtureAttachment(input: {
  id: string;
  supportRequestId: string;
  filename: string;
  label: string;
  altText: string;
  sortOrder: number;
}): DemoAttachment {
  const content = readFileSync(
    new URL(`../fixtures/attachments/${input.filename}`, import.meta.url),
  );
  return {
    id: input.id,
    supportRequestId: input.supportRequestId,
    mediaType: 'image/webp',
    label: input.label,
    altText: input.altText,
    byteLength: content.byteLength,
    sha256: createHash('sha256').update(content).digest('hex'),
    url: `/dashboard/api/attachments/${encodeURIComponent(input.id)}`,
    content,
    sortOrder: input.sortOrder,
  };
}

function supportRequest(row: Row): SupportRequest {
  return {
    id: String(row.id),
    customerId: String(row.customer_id),
    customerName: String(row.customer_name),
    siteName: String(row.site_name),
    assetId: String(row.asset_id),
    assetName: String(row.asset_name),
    assetModel: String(row.asset_model),
    summary: String(row.summary),
    description: nullableString(row.description),
    priority: row.priority as SupportRequest['priority'],
    status: row.status as SupportRequestStatus,
    openedAt: String(row.opened_at),
    closedAt: nullableString(row.closed_at),
    assignedRole: nullableString(row.assigned_role),
    assignedShift: nullableString(row.assigned_shift),
    confirmedResolution: nullableString(row.confirmed_resolution),
    approvedForReuse: Number(row.approved_for_reuse) === 1,
    manualId: String(row.manual_id),
    manualRevision: String(row.manual_revision),
    attachments: [],
  };
}

function attachmentMetadata(row: Row): SupportRequestAttachment {
  return {
    id: String(row.id),
    supportRequestId: String(row.support_request_id),
    mediaType: row.media_type as SupportRequestAttachment['mediaType'],
    label: String(row.label),
    altText: String(row.alt_text),
    byteLength: Number(row.byte_length),
    sha256: String(row.sha256),
    url: `/dashboard/api/attachments/${encodeURIComponent(String(row.id))}`,
  };
}

function storedAttachment(row: Row): StoredSupportRequestAttachment {
  const content = row.content;
  if (!(content instanceof Uint8Array)) {
    throw new Error('Stored request attachment is not binary data');
  }
  return { ...attachmentMetadata(row), content };
}

function workflowInstance(row: Row): WorkflowInstance {
  return {
    id: String(row.id),
    supportRequestId: String(row.support_request_id),
    state: row.state as WorkflowState,
    currentStep: String(row.current_step),
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastError: nullableString(row.last_error),
  };
}

function workflowStep(row: Row): WorkflowStep {
  return {
    workflowId: String(row.workflow_id),
    stepKey: String(row.step_key),
    status: row.status as WorkflowStep['status'],
    attemptCount: Number(row.attempt_count),
    inputHash: String(row.input_hash),
    result: parseJson(row.result_json),
    startedAt: String(row.started_at),
    completedAt: nullableString(row.completed_at),
    lastError: nullableString(row.last_error),
  };
}

function workflowEvent(row: Row): WorkflowEvent {
  return {
    sequence: Number(row.sequence),
    workflowId: String(row.workflow_id),
    eventType: String(row.event_type),
    payload: parseJson(row.payload_json),
    createdAt: String(row.created_at),
  };
}

function taskLink(row: Row): MoltNetTaskLink {
  return {
    workflowId: String(row.workflow_id),
    taskRole: row.task_role as MoltNetTaskLink['taskRole'],
    taskId: String(row.task_id),
    attempt: Number(row.attempt),
    status: String(row.status),
    outputRef: nullableString(row.output_ref),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function signingLink(row: Row): SigningRequestLink {
  return {
    workflowId: String(row.workflow_id),
    decision: row.decision as SigningRequestLink['decision'],
    signingRequestId: String(row.signing_request_id),
    status: String(row.status),
    messageHash: String(row.message_hash),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function parseJson(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : null;
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function assertChanged(
  result: StatementResultingChanges,
  message: string,
): void {
  if (result.changes === 0) throw new Error(message);
}
