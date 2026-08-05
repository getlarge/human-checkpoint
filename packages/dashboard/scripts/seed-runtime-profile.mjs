import { connect } from '@themoltnet/sdk';

const teamId = required('HUMAN_CHECKPOINT_TEAM_ID');
const provider = required('HUMAN_CHECKPOINT_MODEL_PROVIDER');
const model = required('HUMAN_CHECKPOINT_MODEL');
const providerKey = required('HUMAN_CHECKPOINT_MODEL_API_ENV');
const agent = await connect({
  apiUrl: required('HUMAN_CHECKPOINT_MOLTNET_URL'),
  clientId: required('HUMAN_CHECKPOINT_AGENT_CLIENT_ID'),
  clientSecret: required('HUMAN_CHECKPOINT_AGENT_CLIENT_SECRET'),
});

const policySpec = {
  name: 'human-checkpoint-field-service-tools-v1',
  description:
    'Only the technician-approved public-source tool and freeform submission are visible.',
  tools: ['approved_public_source_check', 'submit_freeform_output'],
};
const policies = await agent.runtimePolicies.list({ teamId });
let policy = (policies.items ?? []).find(
  (item) => item.name === policySpec.name,
);
if (!policy) {
  policy = await agent.runtimePolicies.create(policySpec, { teamId });
} else {
  const current = await agent.runtimePolicies.get(policy.id, { teamId });
  const expected = new Set(policySpec.tools);
  const actual = new Set(current.tools ?? []);
  const addTools = policySpec.tools.filter((tool) => !actual.has(tool));
  const removeTools = [...actual].filter((tool) => !expected.has(tool));
  if (addTools.length || removeTools.length) {
    policy = await agent.runtimePolicies.update(
      policy.id,
      { addTools, removeTools, description: policySpec.description },
      { teamId },
    );
  }
}

const profileName = `human-checkpoint-field-service-${slug(provider)}-${slug(model)}`;
const profileSpec = {
  name: profileName,
  description: `Human Checkpoint field-service agent (${provider}/${model}).`,
  runtimeKind: 'human_checkpoint_pi',
  provider,
  model,
  requiredEnv: [providerKey, 'HUMAN_CHECKPOINT_EXA_API_KEY'],
  requiredTools: ['approved_public_source_check'],
  toolEnforcement: 'enforce',
  leaseTtlSec: 900,
  heartbeatIntervalMs: 15_000,
  maxBatchSize: 4,
  maxTurns: 8,
  maxOutputTokens: 4096,
  sandbox: {
    network: { allowedHosts: ['api.exa.ai'] },
    hostExec: { autoApprove: false },
  },
};
const profiles = await agent.runtimeProfiles.list({ teamId });
let profile = (profiles.items ?? []).find((item) => item.name === profileName);
if (!profile)
  profile = await agent.runtimeProfiles.create(profileSpec, { teamId });
await agent.runtimeProfiles.setPolicies(profile.id, [policy.id], { teamId });

process.stdout.write(
  `${JSON.stringify(
    {
      runtimeProfileId: profile.id,
      runtimeKind: profile.runtimeKind,
      policyId: policy.id,
      next: 'Set HUMAN_CHECKPOINT_RUNTIME_PROFILE_ID to runtimeProfileId, then start pnpm run agent.',
    },
    null,
    2,
  )}\n`,
);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
