import { createPiDaemonAdapter } from '@themoltnet/agent-daemon/pi';
import {
  defineGondolinTemplate,
  definePiRuntime,
  definePiTool,
} from '@themoltnet/pi-runtime';
import { runAuthorizedResearch } from '@human-checkpoint/core';
import { Type } from 'typebox';

const descriptor = {
  name: 'approved_public_source_check',
  label: 'Check technician-approved public sources',
  description:
    'Run the exact public-source check already approved by the technician. ' +
    'Pass only the MoltNet signing-request ID from the task context. The tool ' +
    're-fetches and verifies the hardware approval and takes every query, domain, ' +
    'and result limit from the signed message; those values cannot be supplied or changed here.',
  parameters: Type.Object(
    {
      signingRequestId: Type.String({
        format: 'uuid',
        description:
          'The approved signing-request ID supplied in the task context.',
      }),
    },
    { additionalProperties: false },
  ),
};

const publicSourceTool = definePiTool({
  descriptor,
  scope: 'parent',
  create: async ({ agent, claimedTask }) => {
    return {
      ...descriptor,
      async execute(_toolCallId, { signingRequestId }, signal) {
        const expectedRequestId = approvalIdFromTask(claimedTask.task);
        if (signingRequestId !== expectedRequestId) {
          throw new Error(
            'The requested approval ID does not match the durable MoltNet task.',
          );
        }
        const teamId = requiredEnv('HUMAN_CHECKPOINT_TEAM_ID');
        if (claimedTask.task.teamId !== teamId) {
          throw new Error(
            'The claimed task belongs to a different service team.',
          );
        }
        // Trusted host-only credential. Never add it to profile requiredEnv.
        const apiKey = requiredEnv('EXA_API_KEY');
        const request =
          await agent.crypto.signingRequests.get(signingRequestId);
        const results = await runAuthorizedResearch({
          request,
          expected: {
            requestId: signingRequestId,
            teamId,
            checkpoint: 'research-authorization',
            purpose: 'human-checkpoint:research-authorization',
            canonicalMessage: request.message,
          },
          async invoke(scope) {
            const response = await fetch('https://api.exa.ai/search', {
              method: 'POST',
              signal,
              headers: {
                'content-type': 'application/json',
                'x-api-key': apiKey,
              },
              body: JSON.stringify({
                query: scope.queries.join(' OR '),
                numResults: scope.maxResults,
                includeDomains: scope.allowedDomains,
                contents: { text: { maxCharacters: 1200 } },
              }),
            });
            const body = await response.json();
            if (!response.ok || !Array.isArray(body.results)) {
              throw new Error(
                body.error || `Exa returned HTTP ${response.status}`,
              );
            }
            return validateResults(
              body.results,
              scope.allowedDomains,
              scope.maxResults,
            );
          },
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  approvalRequestId: signingRequestId,
                  use: 'supplementary-public-context',
                  results,
                },
                null,
                2,
              ),
            },
          ],
          details: {
            approvalRequestId: signingRequestId,
            resultCount: results.length,
          },
        };
      },
    };
  },
});

const runtime = definePiRuntime({
  id: 'human-checkpoint-field-service',
  version: '1.0.0',
  runtimeKind: 'human_checkpoint_pi',
  vm: defineGondolinTemplate({
    id: 'human-checkpoint-field-service-vm',
    version: '1.0.0',
    executables: ['node'],
  }),
  tools: [publicSourceTool],
});

export default createPiDaemonAdapter(runtime);

function validateResults(results, allowedDomains, maxResults) {
  return results.slice(0, maxResults).map((result) => {
    if (
      !result ||
      typeof result.title !== 'string' ||
      typeof result.url !== 'string'
    ) {
      throw new Error('Exa returned an incomplete public-source result.');
    }
    const url = new URL(result.url);
    const allowed = allowedDomains.some(
      (domain) =>
        url.hostname === domain || url.hostname.endsWith(`.${domain}`),
    );
    if (url.protocol !== 'https:' || !allowed) {
      throw new Error(
        `Exa returned a source outside the approved domains: ${url.hostname}`,
      );
    }
    return {
      title: result.title,
      url: url.toString(),
      text: typeof result.text === 'string' ? result.text.slice(0, 1200) : '',
      publishedDate:
        typeof result.publishedDate === 'string' ? result.publishedDate : null,
    };
  });
}

function approvalIdFromTask(task) {
  const contexts = Array.isArray(task.input?.context) ? task.input.context : [];
  const context = contexts.find(
    (item) => item?.slug === 'signed-request-claim',
  );
  if (!context || typeof context.content !== 'string') {
    throw new Error('The task does not contain the signed request claim.');
  }
  let value;
  try {
    value = JSON.parse(context.content);
  } catch {
    throw new Error('The signed request claim context is not valid JSON.');
  }
  if (
    !value ||
    typeof value.signingRequestId !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(value.signingRequestId)
  ) {
    throw new Error(
      'The signed request claim has no valid signing-request ID.',
    );
  }
  return value.signingRequestId;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not configured for the agent runtime.`);
  return value;
}
