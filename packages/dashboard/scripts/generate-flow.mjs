import { writeFile } from 'node:fs/promises';

const z = 'human-checkpoint-flow';
const response = 'journey-response';
const nodes = [
  {
    id: z,
    type: 'tab',
    label: 'Human Checkpoint — service request workflow',
    disabled: false,
    info: 'Durable support-request orchestration with MoltNet agent tasks and two technician approvals.',
  },
  {
    id: 'agent-config',
    type: 'human-checkpoint-agent',
    name: 'MoltNet field-service agent',
    moltNetUrl: '${HUMAN_CHECKPOINT_MOLTNET_URL}',
    tokenUrl: '${HUMAN_CHECKPOINT_AGENT_TOKEN_URL}',
    clientId: '${HUMAN_CHECKPOINT_AGENT_CLIENT_ID}',
    teamId: '${HUMAN_CHECKPOINT_TEAM_ID}',
  },
  httpIn(
    'journey-in',
    'Load assigned request',
    '/dashboard/api/journey',
    'get',
    80,
    ['journey-load'],
  ),
  workflowLoad('journey-load', 80, ['journey-view']),
  journeyView('journey-view', 80, [response]),
  {
    id: response,
    type: 'http response',
    z,
    name: 'Protected JSON response',
    statusCode: '',
    headers: {},
    x: 1260,
    y: 80,
    wires: [],
  },

  httpIn(
    'source-prepare-in',
    'Prepare public-source decision',
    '/dashboard/api/journey/research/prepare',
    'post',
    180,
    ['source-prepare-load'],
  ),
  workflowLoad('source-prepare-load', 180, ['build-review-task']),
  functionNode(
    'build-review-task',
    'Build request-review task',
    `const request = msg.supportRequest;
const history = msg.reusableHistory;
const priorApproval = msg.workflowSnapshot.approvals.find((item) => item.decision === 'public-source-check');
if (priorApproval && !['expired', 'rejected'].includes(priorApproval.status)) throw new Error('A public-source decision already exists for this request. Refresh its status.');
msg.payload = {
  title: 'Review ' + request.id + ' before public source check',
  tags: ['human-checkpoint', 'service-request', 'request-review'],
  brief: 'Review the active support request, the approved same-customer history, and the manual record supplied as task context. Return a FreeformOutput whose first artifact has kind "public-source-proposal" and a JSON body with grounded=true, requestId, historySummary, queries, reason, questionsToCheck, and unknowns. Supply 1 to 3 concise public-equipment queries. Queries may use the public asset model and symptom class, but must not contain the customer name, site, support-request ID, or asset ID. Do not call any public-source tool in this task. Treat past resolutions as comparison points, never as a diagnosis. After submit_freeform_output succeeds, stop.',
  contexts: [
    { slug: 'active-request', binding: 'user_inline', value: request },
    { slug: 'approved-customer-history', binding: 'context_inline', value: history },
    { slug: 'manual-record', binding: 'context_inline', value: { id: request.manualId, revision: request.manualRevision, currentControl: 'Keep the pump isolated until coupling alignment is checked.', sourceBoundary: 'Metadata and operator-approved control only; do not invent manual content.' } }
  ]
};
return msg;`,
    180,
    ['run-review-task'],
  ),
  taskRun(
    'run-review-task',
    'Run MoltNet request review',
    'request-review',
    'review-request',
    'public-source-proposal',
    180,
    ['validate-source-proposal'],
  ),
  functionNode(
    'validate-source-proposal',
    'Validate and lock proposed scope',
    `const proposal = msg.taskResult?.artifactBody;
const request = msg.supportRequest;
if (!proposal?.grounded || proposal.requestId !== request.id) throw new Error('The assistant review was not grounded in the assigned request.');
if (!Array.isArray(proposal.queries) || proposal.queries.length < 1 || proposal.queries.length > 3 || proposal.queries.some((query) => typeof query !== 'string' || !query.trim() || query.length > 180)) throw new Error('The assistant did not return a safe public-source query set.');
const forbidden = [request.customerName, request.siteName, request.id, request.assetId].map((value) => String(value).toLowerCase());
if (proposal.queries.some((query) => forbidden.some((value) => value && query.toLowerCase().includes(value)))) throw new Error('The proposed public-source query contains customer or request data.');
if (!Array.isArray(proposal.questionsToCheck) || proposal.questionsToCheck.length < 2 || !Array.isArray(proposal.unknowns) || !proposal.unknowns.length) throw new Error('The request review omitted field questions or unknowns.');
msg.teamId = env.get('HUMAN_CHECKPOINT_TEAM_ID');
msg.payload = {
  externalTool: 'exa',
  queries: proposal.queries.map((query) => query.trim()),
  allowedDomains: ['skf.com', 'fluke.com', 'pumps.org'],
  maxResults: 4,
  reason: typeof proposal.reason === 'string' && proposal.reason.trim() ? proposal.reason.trim() : 'Check public manufacturer and maintenance guidance before preparing the technician brief.',
  authorizationExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
};
return msg;`,
    180,
    ['create-source-approval'],
  ),
  checkpointCreate(
    'create-source-approval',
    'Ask technician to approve source check',
    'research-authorization',
    180,
    ['source-waiting'],
  ),
  transition(
    'source-waiting',
    'Wait for technician source approval',
    'waiting-for-public-source-approval',
    'approve-public-source-check',
    'workflow.waiting_for_public_source_approval',
    180,
    ['source-view'],
  ),
  journeyView('source-view', 180, [response]),

  httpIn(
    'approval-refresh-in',
    'Refresh technician decision',
    '/dashboard/api/journey/request/:kind',
    'get',
    280,
    ['approval-refresh-load'],
  ),
  workflowLoad('approval-refresh-load', 280, ['approval-select']),
  functionNode(
    'approval-select',
    'Select linked approval request',
    `const decision = msg.req.params.kind === 'research' ? 'public-source-check' : msg.req.params.kind === 'release' ? 'work-order-release' : null;
if (!decision) throw new Error('Unknown technician decision.');
const link = msg.workflowSnapshot.approvals.find((item) => item.decision === decision);
if (!link) throw new Error('This technician decision has not been prepared.');
msg.signingRequestId = link.signingRequestId;
msg.decision = decision;
return msg;`,
    280,
    ['approval-get'],
  ),
  {
    id: 'approval-get',
    type: 'human-checkpoint-get',
    z,
    name: 'Re-fetch MoltNet approval state',
    agent: 'agent-config',
    requestId: '',
    x: 980,
    y: 280,
    wires: [[response]],
  },

  httpIn(
    'brief-run-in',
    'Continue after source approval',
    '/dashboard/api/journey/research/run',
    'post',
    380,
    ['brief-run-load'],
  ),
  workflowLoad('brief-run-load', 380, ['build-brief-task']),
  functionNode(
    'build-brief-task',
    'Build approved research task',
    `const request = msg.supportRequest;
const reviewStep = msg.workflowSnapshot.steps.find((item) => item.stepKey === 'review-request' && item.status === 'completed');
const review = reviewStep?.result?.artifactBody;
const reviewRef = reviewStep?.result?.outputRef;
const approval = msg.workflowSnapshot.approvals.find((item) => item.decision === 'public-source-check');
if (!review || !reviewRef || !approval) throw new Error('Complete the request review and technician source approval first.');
msg.payload = {
  title: 'Prepare technician brief for ' + request.id,
  tags: ['human-checkpoint', 'service-request', 'technician-brief'],
  brief: 'Prepare a concise pre-visit technician brief for the active request. First call approved_public_source_check exactly once with only the signingRequestId supplied in context. If the tool denies the request or fails, do not substitute web research and do not submit a brief. Return a FreeformOutput whose first artifact has kind "technician-brief" and a JSON body with grounded=true, requestId, approvalRequestId, title, requestSummary, findings, questionsToCheck, unknowns, and sources. Sources must be HTTPS results returned by the approved tool and contain title and url. Preserve the reviewed questions and unknowns without inventing a diagnosis, root cause, or repair instruction. Past resolutions are comparisons only. After submit_freeform_output succeeds, stop.',
  contexts: [
    { slug: 'active-request', binding: 'user_inline', value: request },
    { slug: 'validated-request-review', binding: 'context_inline', value: review },
    { slug: 'technician-approved-source-check', binding: 'user_inline', value: { signingRequestId: approval.signingRequestId, instruction: 'Pass this ID unchanged to approved_public_source_check. No query or domain is accepted by that tool.' } }
  ],
  reference: reviewRef
};
return msg;`,
    380,
    ['run-brief-task'],
  ),
  taskRun(
    'run-brief-task',
    'Run MoltNet technician-brief task',
    'technician-brief',
    'prepare-brief',
    'technician-brief',
    380,
    ['validate-brief'],
  ),
  functionNode(
    'validate-brief',
    'Validate generated technician brief',
    `const brief = msg.taskResult?.artifactBody;
const request = msg.supportRequest;
const approval = msg.workflowSnapshot.approvals.find((item) => item.decision === 'public-source-check');
if (!brief?.grounded || brief.requestId !== request.id || brief.approvalRequestId !== approval?.signingRequestId) throw new Error('The generated brief is not bound to this request and approved source check.');
if (brief.rootCause || brief.causes || brief.diagnosis) throw new Error('The generated pre-visit brief asserted a diagnosis.');
if (!Array.isArray(brief.findings) || !brief.findings.length || !Array.isArray(brief.questionsToCheck) || brief.questionsToCheck.length < 2 || !Array.isArray(brief.unknowns) || !brief.unknowns.length) throw new Error('The generated brief omitted findings, field questions, or unknowns.');
if (!Array.isArray(brief.sources) || !brief.sources.length) throw new Error('The generated brief has no approved public sources.');
const allowed = ['skf.com', 'fluke.com', 'pumps.org'];
for (const source of brief.sources) {
  let url;
  try { url = new URL(source.url); } catch { throw new Error('The generated brief contains an invalid source URL.'); }
  if (url.protocol !== 'https:' || !allowed.some((domain) => url.hostname === domain || url.hostname.endsWith('.' + domain))) throw new Error('The generated brief contains a source outside the approved domains.');
}
msg.eventPayload = { taskId: msg.taskId, approvalRequestId: approval.signingRequestId };
return msg;`,
    380,
    ['brief-ready'],
  ),
  transition(
    'brief-ready',
    'Brief ready for technician',
    'brief-ready',
    'approve-work-order',
    'workflow.technician_brief_ready',
    380,
    ['brief-view'],
  ),
  journeyView('brief-view', 380, [response]),

  httpIn(
    'release-prepare-in',
    'Prepare work-order approval',
    '/dashboard/api/journey/release/prepare',
    'post',
    500,
    ['release-prepare-load'],
  ),
  workflowLoad('release-prepare-load', 500, ['build-release-payload']),
  functionNode(
    'build-release-payload',
    'Bind brief and field amendment',
    `const step = msg.workflowSnapshot.steps.find((item) => item.stepKey === 'prepare-brief' && item.status === 'completed');
const brief = step?.result?.artifactBody;
if (!brief || msg.workflowSnapshot.workflow.state !== 'brief-ready') throw new Error('The assistant brief must be complete before work-order approval.');
const priorApproval = msg.workflowSnapshot.approvals.find((item) => item.decision === 'work-order-release');
if (priorApproval && !['expired', 'rejected'].includes(priorApproval.status)) throw new Error('A work-order approval already exists. Refresh it instead of changing the field note.');
const amendment = String(msg.req.body?.fieldAmendment || '').trim();
if (!amendment) throw new Error('Add the required field amendment before requesting approval.');
msg.teamId = env.get('HUMAN_CHECKPOINT_TEAM_ID');
msg.fieldAmendment = amendment;
msg.payload = {
  brief,
  fieldAmendment: amendment,
  disposition: 'accepted-with-field-amendment',
  role: String(msg.req.body?.role || msg.supportRequest.assignedRole || 'Field technician'),
  shift: String(msg.req.body?.shift || msg.supportRequest.assignedShift || 'Day / A')
};
return msg;`,
    500,
    ['create-release-approval'],
  ),
  checkpointCreate(
    'create-release-approval',
    'Ask technician to approve work order',
    'field-release',
    500,
    ['release-waiting'],
  ),
  transition(
    'release-waiting',
    'Wait for work-order approval',
    'waiting-for-release-approval',
    'approve-work-order',
    'workflow.waiting_for_work_order_approval',
    500,
    ['release-view'],
  ),
  journeyView('release-view', 500, [response]),

  httpIn(
    'release-finalize-in',
    'Release approved work order',
    '/dashboard/api/journey/release/finalize',
    'post',
    600,
    ['release-finalize-load'],
  ),
  workflowLoad('release-finalize-load', 600, ['load-release-link']),
  functionNode(
    'load-release-link',
    'Load work-order approval link',
    `const link = msg.workflowSnapshot.approvals.find((item) => item.decision === 'work-order-release');
if (!link) throw new Error('Prepare work-order approval first.');
msg.signingRequestId = link.signingRequestId;
msg.teamId = env.get('HUMAN_CHECKPOINT_TEAM_ID');
return msg;`,
    600,
    ['release-authoritative-get'],
  ),
  {
    id: 'release-authoritative-get',
    type: 'human-checkpoint-get',
    z,
    name: 'Re-fetch approved work order',
    agent: 'agent-config',
    requestId: '',
    x: 730,
    y: 600,
    wires: [['bind-release-message']],
  },
  functionNode(
    'bind-release-message',
    'Re-bind exact approved bytes',
    `msg.canonicalMessage = msg.payload.message;
return msg;`,
    600,
    ['release-authoritative'],
  ),
  {
    id: 'release-authoritative',
    type: 'human-checkpoint-release',
    z,
    name: 'Verify technician approval',
    agent: 'agent-config',
    x: 1030,
    y: 600,
    wires: [['release-complete']],
  },
  transition(
    'release-complete',
    'Close support request',
    'released',
    'complete',
    'workflow.work_order_released',
    600,
    ['released-view'],
  ),
  journeyView('released-view', 600, [response]),

  httpIn(
    'proof-in',
    'Download approval record',
    '/dashboard/api/journey/proof',
    'post',
    700,
    ['proof-load'],
  ),
  workflowLoad('proof-load', 700, ['proof-links']),
  functionNode(
    'proof-links',
    'Load both approval links',
    `const source = msg.workflowSnapshot.approvals.find((item) => item.decision === 'public-source-check');
const release = msg.workflowSnapshot.approvals.find((item) => item.decision === 'work-order-release');
if (msg.workflowSnapshot.workflow.state !== 'released' || !source || !release) throw new Error('Release the approved work order before downloading its approval record.');
msg.teamId = env.get('HUMAN_CHECKPOINT_TEAM_ID');
msg.researchRequestId = source.signingRequestId;
msg.releaseRequestId = release.signingRequestId;
return msg;`,
    700,
    ['proof-create'],
  ),
  {
    id: 'proof-create',
    type: 'human-checkpoint-proof',
    z,
    name: 'Build offline approval record',
    agent: 'agent-config',
    x: 760,
    y: 700,
    wires: [[response]],
  },
  httpIn(
    'verify-in',
    'Check approval record offline',
    '/dashboard/api/journey/proof/verify',
    'post',
    780,
    ['proof-verify'],
  ),
  {
    id: 'proof-verify',
    type: 'human-checkpoint-verify-proof',
    z,
    name: 'Offline proof verifier',
    x: 500,
    y: 780,
    wires: [[response]],
  },
  {
    id: 'flow-errors',
    type: 'catch',
    z,
    name: 'Return actionable workflow errors',
    scope: null,
    uncaught: false,
    x: 200,
    y: 860,
    wires: [['error-response']],
  },
  functionNode(
    'error-response',
    'Safe workflow error response',
    `msg.statusCode = 400;
msg.headers = { 'cache-control': 'no-store' };
msg.payload = { error: 'workflow_action_failed', detail: msg.error?.message || 'The workflow action failed.', recovery: 'Refresh the assigned request. Expired technician decisions require a fresh approval request.' };
return msg;`,
    860,
    [response],
  ),
];

await writeFile(
  new URL('../flows/flows.json', import.meta.url),
  `${JSON.stringify(nodes, null, 2)}\n`,
);

function httpIn(id, name, url, method, y, wires) {
  return {
    id,
    type: 'http in',
    z,
    name,
    url,
    method,
    upload: false,
    swaggerDoc: '',
    x: 130,
    y,
    wires: [wires],
  };
}

function workflowLoad(id, y, wires) {
  return {
    id,
    type: 'human-checkpoint-workflow-load',
    z,
    name: 'Load durable workflow',
    x: 350,
    y,
    wires: [wires],
  };
}

function journeyView(id, y, wires) {
  return {
    id,
    type: 'human-checkpoint-journey-view',
    z,
    name: 'Rebuild current request view',
    agent: 'agent-config',
    x: 1050,
    y,
    wires: [wires],
  };
}

function functionNode(id, name, func, y, wires) {
  return {
    id,
    type: 'function',
    z,
    name,
    func,
    outputs: 1,
    noerr: 0,
    initialize: '',
    finalize: '',
    libs: [],
    x: 560,
    y,
    wires: [wires],
  };
}

function taskRun(id, name, taskRole, stepKey, artifactKind, y, wires) {
  return {
    id,
    type: 'human-checkpoint-task-run',
    z,
    name,
    agent: 'agent-config',
    teamId: '${HUMAN_CHECKPOINT_TEAM_ID}',
    diaryId: '${HUMAN_CHECKPOINT_DIARY_ID}',
    runtimeProfileId: '${HUMAN_CHECKPOINT_RUNTIME_PROFILE_ID}',
    taskRole,
    stepKey,
    artifactKind,
    x: 760,
    y,
    wires: [wires],
  };
}

function checkpointCreate(id, name, checkpoint, y, wires) {
  return {
    id,
    type: 'human-checkpoint-create',
    z,
    name,
    agent: 'agent-config',
    checkpoint,
    teamId: '${HUMAN_CHECKPOINT_TEAM_ID}',
    x: 810,
    y,
    wires: [wires],
  };
}

function transition(id, name, state, currentStep, eventType, y, wires) {
  return {
    id,
    type: 'human-checkpoint-workflow-transition',
    z,
    name,
    state,
    currentStep,
    eventType,
    x: 960,
    y,
    wires: [wires],
  };
}
