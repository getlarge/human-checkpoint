import type { SigningRequestView } from '@human-checkpoint/core';
import {
  connect,
  createResultReader,
  type Agent,
  type CreateTaskBody,
} from '@themoltnet/sdk';

export interface MoltNetClientOptions {
  baseUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  teamId: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

export interface CreateSigningRequestInput {
  message: string;
  purpose: string;
}

export class MoltNetAgentClient {
  private token: { value: string; expiresAt: number } | null = null;
  private agentPromise: Promise<Agent> | null = null;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly now: () => number;

  constructor(private readonly options: MoltNetClientOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }

  async createSigningRequest(
    input: CreateSigningRequestInput,
  ): Promise<SigningRequestView> {
    return this.request('/crypto/signing-requests', {
      method: 'POST',
      body: JSON.stringify({
        message: input.message,
        purpose: input.purpose,
        teamId: this.options.teamId,
        signerConstraint: { type: 'team-role', id: 'owner' },
        verificationMethod: 'human-hardware-previewsign',
      }),
    });
  }

  async getSigningRequest(id: string): Promise<SigningRequestView> {
    if (!/^[0-9a-f-]{36}$/i.test(id))
      throw new Error('Invalid signing request id');
    return this.request(`/crypto/signing-requests/${id}`, { method: 'GET' });
  }

  async createTask(
    body: CreateTaskBody,
  ): Promise<Awaited<ReturnType<Agent['tasks']['create']>>> {
    const agent = await this.taskAgent();
    return agent.tasks.create(body, { teamId: this.options.teamId });
  }

  async waitForTask(
    taskId: string,
    options: {
      pollMs?: number;
      timeoutMs?: number;
      artifactKind?: string;
    } = {},
  ): Promise<{
    accepted: boolean;
    task: Awaited<ReturnType<Agent['tasks']['get']>>;
    attempt:
      | Awaited<ReturnType<Agent['tasks']['listAttempts']>>[number]
      | undefined;
    summary: string;
    output: unknown;
    outputRef: unknown;
    artifact: unknown;
    artifactBody: unknown;
  }> {
    const agent = await this.taskAgent();
    const startedAt = this.now();
    const pollMs = options.pollMs ?? 2_000;
    const timeoutMs = options.timeoutMs ?? 420_000;
    for (;;) {
      const task = await agent.tasks.get(taskId);
      if (
        ['completed', 'failed', 'cancelled', 'expired'].includes(task.status)
      ) {
        const attempts = await agent.tasks.listAttempts(taskId);
        const attempt =
          task.acceptedAttemptN === null
            ? attempts.toSorted(
                (left, right) => right.attemptN - left.attemptN,
              )[0]
            : attempts.find(
                (candidate) => candidate.attemptN === task.acceptedAttemptN,
              );
        if (
          task.status !== 'completed' ||
          task.acceptedAttemptN === null ||
          !attempt
        ) {
          return {
            accepted: false,
            task,
            attempt,
            summary:
              task.cancelReason ?? `Task ended with status ${task.status}`,
            output: null,
            outputRef: null,
            artifact: null,
            artifactBody: null,
          };
        }
        const reader = createResultReader(task, attempt);
        const artifact = options.artifactKind
          ? reader.artifact(options.artifactKind)
          : undefined;
        return {
          accepted: true,
          task,
          attempt,
          summary: reader.summary ?? '',
          output: reader.output,
          outputRef: reader.outputRef('context'),
          artifact,
          artifactBody:
            options.artifactKind && artifact?.body
              ? reader.artifactBody(options.artifactKind)
              : undefined,
        };
      }
      if (this.now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out waiting for MoltNet task ${taskId}`);
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const accessToken = await this.accessToken();
    const response = await this.fetchImpl(new URL(path, this.options.baseUrl), {
      ...init,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        'x-moltnet-team-id': this.options.teamId,
      },
    });
    const body = (await response.json()) as unknown;
    if (!response.ok) throw new Error(problemMessage(body, response.status));
    return body as T;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 30_000 > this.now())
      return this.token.value;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      scope: 'crypto:sign',
    });
    const response = await this.fetchImpl(this.options.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const result = (await response.json()) as Record<string, unknown>;
    if (!response.ok || typeof result.access_token !== 'string') {
      throw new Error(problemMessage(result, response.status));
    }
    const expiresIn =
      typeof result.expires_in === 'number' ? result.expires_in : 300;
    this.token = {
      value: result.access_token,
      expiresAt: this.now() + expiresIn * 1000,
    };
    return this.token.value;
  }

  private taskAgent(): Promise<Agent> {
    if (!this.agentPromise) {
      this.agentPromise = connect({
        apiUrl: this.options.baseUrl,
        clientId: this.options.clientId,
        clientSecret: this.options.clientSecret,
      }).catch((error) => {
        this.agentPromise = null;
        throw error;
      });
    }
    return this.agentPromise;
  }
}

function problemMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    if (typeof record.detail === 'string') return record.detail;
    if (typeof record.error_description === 'string')
      return record.error_description;
  }
  return `MoltNet request failed with HTTP ${status}`;
}
