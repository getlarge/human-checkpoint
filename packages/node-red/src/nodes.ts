import { createHash } from 'node:crypto';

import {
  assertApprovedCheckpoint,
  createCheckpointEnvelope,
  createProofBundle,
  parseCheckpointEnvelope,
  verifyProofArtifact,
} from '@human-checkpoint/core';
import type { WorkflowState } from '@human-checkpoint/store';
import {
  buildFreeform,
  type ContextBinding,
  type CreateTaskBody,
} from '@themoltnet/sdk';
import { MoltNetAgentClient } from './moltnet-client.js';
import { installHttpRoutesFromEnvironment } from './http-routes.js';
import { invokeExaAfterAuthoritativeApproval } from './research.js';
import { workflowStore } from './workflow-store.js';

interface RedNode {
  on(
    event: 'input',
    handler: (
      msg: Record<string, unknown>,
      send: (msg: unknown) => void,
      done: (error?: Error) => void,
    ) => void,
  ): void;
  status(value: Record<string, unknown>): void;
  error(error: Error, msg?: unknown): void;
  client?: MoltNetAgentClient;
}
interface RedApi {
  nodes: {
    createNode(node: RedNode, config: Record<string, unknown>): void;
    registerType(
      name: string,
      constructor: new (config: Record<string, unknown>) => RedNode,
      options?: Record<string, unknown>,
    ): void;
    getNode(id: string): RedNode | null;
  };
  httpNode?: never;
  settings?: { httpNodeMiddleware?: unknown };
}

export default function registerNodes(RED: RedApi): void {
  installHttpRoutesFromEnvironment(RED as never);
  class AgentNode implements RedNode {
    client?: MoltNetAgentClient;
    declare on: RedNode['on'];
    declare status: RedNode['status'];
    declare error: RedNode['error'];
    constructor(config: Record<string, unknown>) {
      RED.nodes.createNode(this, config);
      const credentials = (
        this as unknown as { credentials?: Record<string, string> }
      ).credentials;
      const clientSecret =
        credentials?.clientSecret ??
        process.env.HUMAN_CHECKPOINT_AGENT_CLIENT_SECRET;
      if (clientSecret) {
        this.client = new MoltNetAgentClient({
          baseUrl: resolveEnv(String(config.moltNetUrl)),
          tokenUrl: resolveEnv(String(config.tokenUrl)),
          clientId: resolveEnv(String(config.clientId)),
          clientSecret,
          teamId: resolveEnv(String(config.teamId)),
        });
      }
      (this as unknown as { exaApiKey: string | undefined }).exaApiKey =
        credentials?.exaApiKey ?? process.env.HUMAN_CHECKPOINT_EXA_API_KEY;
    }
  }

  class CreateNode implements RedNode {
    declare on: RedNode['on'];
    declare status: RedNode['status'];
    declare error: RedNode['error'];
    constructor(config: Record<string, unknown>) {
      RED.nodes.createNode(this, config);
      this.on('input', async (msg, send, done) => {
        try {
          const agent = requireAgent(RED, String(config.agent));
          const checkpoint = String(config.checkpoint || msg.checkpoint);
          if (
            checkpoint !== 'research-authorization' &&
            checkpoint !== 'field-release'
          ) {
            throw new Error(
              'Checkpoint must be research-authorization or field-release',
            );
          }
          const payload = msg.payload;
          if (!payload || typeof payload !== 'object' || Array.isArray(payload))
            throw new Error('msg.payload must be an object');
          const localPayload = structuredClone(payload);
          const created = createCheckpointEnvelope(
            checkpoint as 'research-authorization',
            String(
              msg.serviceRequestId ||
                (msg.supportRequest as Record<string, unknown> | undefined)
                  ?.id ||
                '',
            ),
            resolveEnv(String(config.teamId || msg.teamId)),
            localPayload as never,
          );
          const request = await agent.createSigningRequest({
            message: created.canonicalMessage,
            purpose: `human-checkpoint:${checkpoint}`,
          });
          if (typeof msg.workflowId === 'string' && msg.workflowId) {
            workflowStore().linkSigningRequest({
              workflowId: msg.workflowId,
              decision:
                checkpoint === 'research-authorization'
                  ? 'public-source-check'
                  : 'work-order-release',
              signingRequestId: request.id,
              status: request.status,
              messageHash: createHash('sha256')
                .update(created.canonicalMessage)
                .digest('hex'),
            });
          }
          send({
            ...msg,
            signingRequestId: request.id,
            canonicalMessage: created.canonicalMessage,
            payload: request,
          });
          done();
        } catch (error) {
          done(asError(error));
        }
      });
    }
  }

  class GetNode implements RedNode {
    declare on: RedNode['on'];
    declare status: RedNode['status'];
    declare error: RedNode['error'];
    constructor(config: Record<string, unknown>) {
      RED.nodes.createNode(this, config);
      this.on('input', async (msg, send, done) => {
        try {
          const agent = requireAgent(RED, String(config.agent));
          const id = String(config.requestId || msg.signingRequestId);
          const request = await agent.getSigningRequest(id);
          if (request.status === 'completed')
            parseCheckpointEnvelope(request.message);
          if (
            typeof msg.workflowId === 'string' &&
            (msg.decision === 'public-source-check' ||
              msg.decision === 'work-order-release')
          ) {
            workflowStore().updateSigningRequestStatus(
              msg.workflowId,
              msg.decision,
              request.status,
            );
          }
          send({ ...msg, payload: request });
          done();
        } catch (error) {
          done(asError(error));
        }
      });
    }
  }

  class ResearchNode implements RedNode {
    declare on: RedNode['on'];
    declare status: RedNode['status'];
    declare error: RedNode['error'];
    constructor(config: Record<string, unknown>) {
      RED.nodes.createNode(this, config);
      this.on('input', async (msg, send, done) => {
        try {
          const configNode = RED.nodes.getNode(String(config.agent));
          const agent = requireAgent(RED, String(config.agent));
          const signingRequestId = String(msg.signingRequestId);
          const request = await agent.getSigningRequest(signingRequestId);
          const results = await invokeExaAfterAuthoritativeApproval({
            request,
            expected: {
              requestId: signingRequestId,
              teamId: String(msg.teamId),
              checkpoint: 'research-authorization',
              purpose: 'human-checkpoint:research-authorization',
              canonicalMessage: String(msg.canonicalMessage),
            },
            apiKey: String(
              (configNode as unknown as { exaApiKey: string | undefined })
                ?.exaApiKey ?? '',
            ),
          });
          send({ ...msg, payload: results, authoritativeRequest: request });
          done();
        } catch (error) {
          done(asError(error));
        }
      });
    }
  }

  class ReleaseNode implements RedNode {
    declare on: RedNode['on'];
    declare status: RedNode['status'];
    declare error: RedNode['error'];
    constructor(config: Record<string, unknown>) {
      RED.nodes.createNode(this, config);
      this.on('input', async (msg, send, done) => {
        try {
          const agent = requireAgent(RED, String(config.agent));
          const request = await agent.getSigningRequest(
            String(msg.signingRequestId),
          );
          assertApprovedCheckpoint(request, {
            requestId: String(msg.signingRequestId),
            teamId: String(msg.teamId),
            checkpoint: 'field-release',
            purpose: 'human-checkpoint:field-release',
            canonicalMessage: String(msg.canonicalMessage),
          });
          send({
            ...msg,
            payload: { released: true, releasedAt: request.completedAt },
            authoritativeRequest: request,
          });
          done();
        } catch (error) {
          done(asError(error));
        }
      });
    }
  }

  class ProofNode implements RedNode {
    declare on: RedNode['on'];
    declare status: RedNode['status'];
    declare error: RedNode['error'];
    constructor(config: Record<string, unknown>) {
      RED.nodes.createNode(this, config);
      this.on('input', async (msg, send, done) => {
        try {
          const agent = requireAgent(RED, String(config.agent));
          const research = await agent.getSigningRequest(
            String(msg.researchRequestId),
          );
          const release = await agent.getSigningRequest(
            String(msg.releaseRequestId),
          );
          send({
            ...msg,
            payload: createProofBundle({
              teamId: String(msg.teamId),
              research,
              release,
            }),
          });
          done();
        } catch (error) {
          done(asError(error));
        }
      });
    }
  }

  class VerifyProofNode implements RedNode {
    declare on: RedNode['on'];
    declare status: RedNode['status'];
    declare error: RedNode['error'];
    constructor(config: Record<string, unknown>) {
      RED.nodes.createNode(this, config);
      this.on('input', (msg, send, done) => {
        try {
          send({ ...msg, payload: verifyProofArtifact(msg.payload) });
          done();
        } catch (error) {
          done(asError(error));
        }
      });
    }
  }

  class RequestListNode implements RedNode {
    declare on: RedNode['on'];
    declare status: RedNode['status'];
    declare error: RedNode['error'];
    constructor(config: Record<string, unknown>) {
      RED.nodes.createNode(this, config);
      this.on('input', (msg, send, done) => {
        try {
          const customerIds = demoCustomerIds();
          send({
            payload: {
              kind: 'human-checkpoint:request-queue',
              requests: workflowStore()
                .listSupportRequests()
                .filter((request) => customerIds.has(request.customerId)),
            },
          });
          done();
        } catch (error) {
          done(asError(error));
        }
      });
    }
  }

  class RequestStartNode implements RedNode {
    declare on: RedNode['on'];
    declare status: RedNode['status'];
    declare error: RedNode['error'];
    constructor(config: Record<string, unknown>) {
      RED.nodes.createNode(this, config);
      this.on('input', (msg, send, done) => {
        try {
          const requestId = String(
            msg.requestId ||
              (msg.payload as Record<string, unknown> | undefined)?.requestId ||
              '',
          );
          const store = workflowStore();
          const request = store.getSupportRequest(requestId);
          if (!request || !demoCustomerIds().has(request.customerId))
            throw new Error('Support request not found');
          if (request.status !== 'open')
            throw new Error('Only open support requests can start work');
          const workflow = store.startWorkflow(request.id);
          send({
            payload: {
              kind: 'human-checkpoint:navigate',
              url: `/dashboard/ui/technician-briefing#workflow=${encodeURIComponent(workflow.id)}`,
            },
          });
          done();
        } catch (error) {
          done(asError(error));
        }
      });
    }
  }

  class WorkflowLoadNode implements RedNode {
    declare on: RedNode['on'];
    declare status: RedNode['status'];
    declare error: RedNode['error'];
    constructor(config: Record<string, unknown>) {
      RED.nodes.createNode(this, config);
      this.on('input', (msg, send, done) => {
        try {
          const workflowId = String(msg.workflowId || '');
          if (!workflowId)
            throw new Error(
              'Open the assigned request before starting this action',
            );
          const store = workflowStore();
          const snapshot = store.getWorkflowSnapshot(workflowId);
          msg.workflowId = workflowId;
          msg.workflowSnapshot = snapshot;
          msg.supportRequest = snapshot.request;
          msg.reusableHistory = store.listReusableHistory(snapshot.request.id);
          send(msg);
          done();
        } catch (error) {
          done(asError(error));
        }
      });
    }
  }

  class TaskRunNode implements RedNode {
    declare on: RedNode['on'];
    declare status: RedNode['status'];
    declare error: RedNode['error'];
    constructor(config: Record<string, unknown>) {
      RED.nodes.createNode(this, config);
      this.on('input', async (msg, send, done) => {
        try {
          const agent = requireAgent(RED, String(config.agent));
          const workflowId = String(msg.workflowId || '');
          const taskRole = String(config.taskRole);
          if (
            taskRole !== 'request-review' &&
            taskRole !== 'technician-brief'
          ) {
            throw new Error('Task role is not configured');
          }
          const stepKey = String(config.stepKey || taskRole);
          const artifactKind = String(config.artifactKind || '');
          const taskBody = buildTaskBody(msg.payload, {
            workflowId,
            teamId: resolveEnv(String(config.teamId)),
            diaryId: resolveEnv(String(config.diaryId)),
            runtimeProfileId: resolveEnv(String(config.runtimeProfileId || '')),
          });
          const store = workflowStore();
          let snapshot = store.getWorkflowSnapshot(workflowId);
          let step = snapshot.steps.find((item) => item.stepKey === stepKey);
          if (!step || step.status === 'failed')
            step = store.beginStep(workflowId, stepKey, taskBody);
          if (step.status === 'completed') {
            const normalized = normalizeTaskResult(taskRole, step.result);
            if (normalized.changed) {
              step = store.replaceCompletedStepResult(
                workflowId,
                stepKey,
                normalized.result,
              );
            }
            send([
              { ...msg, payload: step.result, taskResult: step.result },
              null,
            ]);
            done();
            return;
          }

          snapshot = store.getWorkflowSnapshot(workflowId);
          const latest = snapshot.tasks
            .filter((item) => item.taskRole === taskRole)
            .sort((left, right) => right.attempt - left.attempt)[0];
          let taskId =
            latest &&
            !['failed', 'cancelled', 'expired'].includes(latest.status)
              ? latest.taskId
              : '';
          const attempt =
            latest && taskId ? latest.attempt : (latest?.attempt ?? 0) + 1;
          let currentStatus = latest?.status ?? 'queued';
          if (!taskId) {
            const created = await agent.createTask(taskBody);
            taskId = created.id;
            currentStatus = created.status;
            store.linkMoltNetTask({
              workflowId,
              taskRole,
              taskId,
              attempt,
              status: created.status,
              outputRef: null,
            });
          }
          send([
            null,
            taskProgressMessage(msg, {
              taskId,
              taskRole,
              attempt,
              status: currentStatus,
            }),
          ]);
          this.status({
            fill: 'blue',
            shape: 'ring',
            text: `waiting for ${taskRole}`,
          });
          const result = await agent.waitForTask(taskId, {
            ...(artifactKind ? { artifactKind } : {}),
            onStatus: (task) => {
              store.linkMoltNetTask({
                workflowId,
                taskRole,
                taskId,
                attempt,
                status: task.status,
                outputRef: null,
              });
              send([
                null,
                taskProgressMessage(msg, {
                  taskId,
                  taskRole,
                  attempt,
                  status: task.status,
                }),
              ]);
            },
          });
          const rawStoredResult = {
            accepted: result.accepted,
            taskId,
            taskStatus: result.task.status,
            summary: result.summary,
            output: result.output,
            outputRef: result.outputRef,
            artifact: result.artifact,
            artifactBody: result.artifactBody,
          };
          const storedResult = normalizeTaskResult(
            taskRole,
            rawStoredResult,
          ).result;
          store.linkMoltNetTask({
            workflowId,
            taskRole,
            taskId,
            attempt,
            status: result.task.status,
            outputRef: JSON.stringify(result.outputRef),
          });
          if (!result.accepted) {
            store.failStep(
              workflowId,
              stepKey,
              `MoltNet task ${taskId} was not accepted`,
            );
            throw new Error(
              `The assistant task stopped without an accepted ${taskRole} result`,
            );
          }
          store.completeStep(workflowId, stepKey, taskBody, storedResult);
          this.status({
            fill: 'green',
            shape: 'dot',
            text: `${taskRole} complete`,
          });
          send([
            {
              ...msg,
              payload: storedResult,
              taskResult: storedResult,
              taskId,
            },
            null,
          ]);
          done();
        } catch (error) {
          this.status({ fill: 'red', shape: 'ring', text: 'task failed' });
          done(asError(error));
        }
      });
    }
  }

  class WorkflowTransitionNode implements RedNode {
    declare on: RedNode['on'];
    declare status: RedNode['status'];
    declare error: RedNode['error'];
    constructor(config: Record<string, unknown>) {
      RED.nodes.createNode(this, config);
      this.on('input', (msg, send, done) => {
        try {
          const workflow = workflowStore().transitionWorkflow(
            String(msg.workflowId),
            String(config.state) as WorkflowState,
            String(config.currentStep),
            String(config.eventType),
            msg.eventPayload ?? {},
          );
          if (workflow.state === 'released') {
            const snapshot = workflowStore().getWorkflowSnapshot(workflow.id);
            const release = snapshot.approvals.find(
              (item) => item.decision === 'work-order-release',
            );
            workflowStore().closeSupportRequest(
              snapshot.request.id,
              `Work order released with technician approval${release ? ` (${release.signingRequestId})` : ''}.`,
            );
          }
          send({ ...msg, workflow });
          done();
        } catch (error) {
          done(asError(error));
        }
      });
    }
  }

  class JourneyViewNode implements RedNode {
    declare on: RedNode['on'];
    declare status: RedNode['status'];
    declare error: RedNode['error'];
    constructor(config: Record<string, unknown>) {
      RED.nodes.createNode(this, config);
      this.on('input', async (msg, send, done) => {
        try {
          const agent = requireAgent(RED, String(config.agent));
          const workflowId = String(msg.workflowId || '');
          const payload = await buildJourneyView(workflowId, agent);
          send({
            ...msg,
            payload,
            headers: { 'cache-control': 'no-store' },
          });
          done();
        } catch (error) {
          done(asError(error));
        }
      });
    }
  }

  RED.nodes.registerType('human-checkpoint-agent', AgentNode as never, {
    credentials: {
      clientSecret: { type: 'password' },
      exaApiKey: { type: 'password' },
    },
  });
  RED.nodes.registerType('human-checkpoint-create', CreateNode as never);
  RED.nodes.registerType('human-checkpoint-get', GetNode as never);
  RED.nodes.registerType('human-checkpoint-research', ResearchNode as never);
  RED.nodes.registerType('human-checkpoint-release', ReleaseNode as never);
  RED.nodes.registerType('human-checkpoint-proof', ProofNode as never);
  RED.nodes.registerType(
    'human-checkpoint-verify-proof',
    VerifyProofNode as never,
  );
  RED.nodes.registerType(
    'human-checkpoint-request-list',
    RequestListNode as never,
  );
  RED.nodes.registerType(
    'human-checkpoint-request-start',
    RequestStartNode as never,
  );
  RED.nodes.registerType(
    'human-checkpoint-workflow-load',
    WorkflowLoadNode as never,
  );
  RED.nodes.registerType('human-checkpoint-task-run', TaskRunNode as never);
  RED.nodes.registerType(
    'human-checkpoint-workflow-transition',
    WorkflowTransitionNode as never,
  );
  RED.nodes.registerType(
    'human-checkpoint-journey-view',
    JourneyViewNode as never,
  );
}

interface TaskSpec {
  brief: string;
  title?: string;
  tags?: string[];
  contexts?: Array<{ slug: string; binding: ContextBinding; value: unknown }>;
  reference?: { taskId: string | null; outputCid: string; role?: 'context' };
}

function buildTaskBody(
  value: unknown,
  options: {
    workflowId: string;
    teamId: string;
    diaryId: string;
    runtimeProfileId: string;
  },
): CreateTaskBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Task specification is required');
  }
  const spec = value as TaskSpec;
  if (typeof spec.brief !== 'string' || !spec.brief.trim()) {
    throw new Error('Task brief is required');
  }
  const builder = buildFreeform({ brief: spec.brief })
    .team(options.teamId)
    .diary(options.diaryId)
    .correlationId(options.workflowId)
    .title(spec.title ?? 'Human Checkpoint service-request task')
    .maxAttempts(2)
    .expiresInSec(900)
    .requireSubmitOutput();
  for (const context of spec.contexts ?? []) {
    builder.context(
      context.slug,
      context.binding,
      typeof context.value === 'string'
        ? context.value
        : JSON.stringify(context.value),
    );
  }
  if (spec.reference) builder.references(spec.reference, 'context');
  if (spec.tags?.length) builder.tags(...spec.tags);
  if (options.runtimeProfileId) {
    builder.allowProfiles({ profileId: options.runtimeProfileId });
  }
  return builder.build().body;
}

async function buildJourneyView(
  workflowId: string,
  agent: MoltNetAgentClient,
): Promise<Record<string, unknown>> {
  const store = workflowStore();
  let snapshot = store.getWorkflowSnapshot(workflowId);
  const approval = async (
    decision: 'public-source-check' | 'work-order-release',
  ) => {
    const link = snapshot.approvals.find((item) => item.decision === decision);
    if (!link) return { status: 'not-requested' };
    const request = await agent.getSigningRequest(link.signingRequestId);
    if (request.status !== link.status) {
      store.updateSigningRequestStatus(workflowId, decision, request.status);
    }
    let envelope: ReturnType<typeof parseCheckpointEnvelope> | null = null;
    try {
      envelope = parseCheckpointEnvelope(request.message);
    } catch {
      envelope = null;
    }
    return {
      status: request.status,
      requestId: request.id,
      canonicalMessage: request.message,
      purpose: request.purpose,
      teamId: request.teamId,
      verificationMethod: request.verificationMethod,
      expiresAt: request.expiresAt,
      completedAt: request.completedAt,
      valid: request.valid,
      claimantId: request.claimedByHumanId,
      credentialId: request.signingCredentialId,
      derivedPublicKey: request.receipt?.value?.derivedPublicKey ?? null,
      ...(decision === 'public-source-check'
        ? { scope: envelope?.payload ?? null }
        : {
            fieldAmendment:
              typeof envelope?.payload.fieldAmendment === 'string'
                ? envelope.payload.fieldAmendment
                : null,
          }),
    };
  };
  const [research, release] = await Promise.all([
    approval('public-source-check'),
    approval('work-order-release'),
  ]);
  snapshot = store.getWorkflowSnapshot(workflowId);
  const recoverableStep = snapshot.steps.find(
    (item) => item.stepKey === 'prepare-brief' && item.status === 'completed',
  );
  if (
    recoverableStep &&
    ['waiting-for-public-source-approval', 'researching'].includes(
      snapshot.workflow.state,
    )
  ) {
    const normalized = normalizeTaskResult(
      'technician-brief',
      recoverableStep.result,
    );
    if (normalized.changed) {
      store.replaceCompletedStepResult(
        workflowId,
        'prepare-brief',
        normalized.result,
      );
    }
    const recoveredResult = recordValue(normalized.result);
    if (
      isBriefRecoveryEligible({
        brief: recordValue(recoveredResult?.artifactBody),
        requestId: snapshot.request.id,
        approval: recordValue(research),
      })
    ) {
      store.transitionWorkflow(
        workflowId,
        'brief-ready',
        'approve-work-order',
        'workflow.technician_brief_recovered',
        { taskId: recoveredResult?.taskId ?? null },
      );
    }
    snapshot = store.getWorkflowSnapshot(workflowId);
  }
  const review = stepResult(snapshot.steps, 'review-request');
  const preparedBrief = stepResult(snapshot.steps, 'prepare-brief');
  const briefBody = recordValue(recordValue(preparedBrief)?.artifactBody);
  const immutable = Boolean(
    briefBody &&
    ['brief-ready', 'waiting-for-release-approval', 'released'].includes(
      snapshot.workflow.state,
    ),
  );
  const findings = stringArray(
    briefBody?.findings ?? briefBody?.questionsToCheck,
  );
  const sources = arrayValue(briefBody?.sources)
    .map((value) => recordValue(value))
    .filter((value): value is Record<string, unknown> => Boolean(value))
    .map((value) => ({
      title: String(value.title ?? value.label ?? value.url ?? 'Public source'),
      url: String(value.url ?? ''),
    }))
    .filter((value) => value.url.startsWith('https://'));
  return {
    workflowId,
    serviceRequestId: snapshot.request.id,
    supportRequest: snapshot.request,
    workflow: snapshot.workflow,
    tasks: snapshot.tasks,
    review: recordValue(recordValue(review)?.artifactBody),
    research,
    release,
    brief: {
      ...(briefBody ?? {}),
      immutable,
      validatedAt:
        snapshot.steps.find((item) => item.stepKey === 'prepare-brief')
          ?.completedAt ?? null,
      findings,
      sources,
    },
    releasedAt:
      snapshot.workflow.state === 'released'
        ? snapshot.workflow.updatedAt
        : null,
  };
}

function stepResult(
  steps: Array<{ stepKey: string; status: string; result: unknown }>,
  stepKey: string,
): unknown {
  const step = steps.find((item) => item.stepKey === stepKey);
  return step?.status === 'completed' ? step.result : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return arrayValue(value).filter(
    (item): item is string => typeof item === 'string',
  );
}

function taskProgressMessage(
  _msg: Record<string, unknown>,
  task: {
    taskId: string;
    taskRole: string;
    attempt: number;
    status: string;
  },
): Record<string, unknown> {
  return {
    payload: { kind: 'human-checkpoint:task-status', task },
  };
}

export function normalizeTaskResult(
  taskRole: string,
  value: unknown,
): { changed: boolean; result: unknown } {
  if (taskRole !== 'technician-brief') return { changed: false, result: value };
  const result = recordValue(value);
  const body = recordValue(result?.artifactBody);
  if (!result || !body) return { changed: false, result: value };

  const normalizedBody = { ...body };
  let changed = false;
  for (const field of ['findings', 'questionsToCheck', 'unknowns'] as const) {
    const current = normalizedBody[field];
    if (typeof current === 'string' && current.trim()) {
      normalizedBody[field] = [current.trim()];
      changed = true;
    }
  }
  if (!changed) return { changed: false, result: value };
  return {
    changed: true,
    result: {
      ...result,
      artifactBodyRaw: result.artifactBodyRaw ?? body,
      artifactBody: normalizedBody,
    },
  };
}

export function isBriefRecoveryEligible(input: {
  brief: Record<string, unknown> | null;
  requestId: string;
  approval: Record<string, unknown> | null;
}): boolean {
  const { brief, requestId, approval } = input;
  if (
    approval?.status !== 'completed' ||
    !brief?.grounded ||
    brief.requestId !== requestId ||
    brief.approvalRequestId !== approval.requestId ||
    brief.rootCause ||
    brief.causes ||
    brief.diagnosis ||
    stringArray(brief.findings).length < 1 ||
    stringArray(brief.questionsToCheck).length < 2 ||
    stringArray(brief.unknowns).length < 1
  ) {
    return false;
  }
  const scope = recordValue(approval.scope);
  const allowedDomains = stringArray(scope?.allowedDomains);
  const sources = arrayValue(brief.sources)
    .map((value) => recordValue(value))
    .filter((value): value is Record<string, unknown> => Boolean(value));
  if (!allowedDomains.length || !sources.length) return false;
  return sources.every((source) => {
    try {
      const url = new URL(String(source.url ?? ''));
      return (
        url.protocol === 'https:' &&
        allowedDomains.some(
          (domain) =>
            url.hostname === domain || url.hostname.endsWith(`.${domain}`),
        )
      );
    } catch {
      return false;
    }
  });
}

function requireAgent(RED: RedApi, id: string): MoltNetAgentClient {
  const node = RED.nodes.getNode(id);
  if (!node?.client)
    throw new Error('Human Checkpoint agent credentials are not configured');
  return node.client;
}

function demoCustomerIds(): Set<string> {
  const configured =
    process.env.HUMAN_CHECKPOINT_DEMO_CUSTOMER_IDS ??
    process.env.HUMAN_CHECKPOINT_DEMO_CUSTOMER_ID ??
    'CUST-NORTH-WATER,CUST-ASTER-COMPONENTS';
  return new Set(
    configured
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
function resolveEnv(value: string): string {
  const match = /^\$\{([A-Z0-9_]+)\}$/.exec(value);
  return match ? (process.env[match[1]!] ?? '') : value;
}
