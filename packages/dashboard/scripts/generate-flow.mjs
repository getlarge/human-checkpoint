import { readFile, writeFile } from 'node:fs/promises';

const z = 'human-checkpoint-flow';
const response = 'dashboard-journey-output';
const technicianTemplate = await readFile(
  new URL('../templates/technician-workspace.html', import.meta.url),
  'utf8',
);
const requestsTemplate = await readFile(
  new URL('../templates/request-queue.html', import.meta.url),
  'utf8',
);
const hardwareTemplate = await readFile(
  new URL('../templates/hardware-setup.html', import.meta.url),
  'utf8',
);
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
  {
    id: 'hc-dashboard-base',
    type: 'ui-base',
    name: 'Human Checkpoint',
    path: '/dashboard/ui',
    includeClientData: true,
    acceptsClientConfig: ['ui-notification', 'ui-control'],
    showPathInSidebar: false,
    navigationStyle: 'default',
    titleBarStyle: 'hidden',
  },
  {
    id: 'hc-dashboard-theme',
    type: 'ui-theme',
    name: 'Verified work order',
    colors: {
      surface: '#ffffff',
      primary: '#087f78',
      bgPage: '#f3f6f5',
      groupBg: '#ffffff',
      groupOutline: '#c9d5d2',
    },
    sizes: {
      density: 'default',
      pagePadding: '0px',
      groupGap: '0px',
      groupBorderRadius: '0px',
      widgetGap: '0px',
    },
  },
  {
    id: 'hc-requests-page',
    type: 'ui-page',
    name: 'Service requests',
    ui: 'hc-dashboard-base',
    path: '/requests',
    icon: 'assignment',
    layout: 'grid',
    theme: 'hc-dashboard-theme',
    breakpoints: [
      { name: 'Default', px: 0, cols: 1 },
      { name: 'Tablet', px: 576, cols: 6 },
      { name: 'Desktop', px: 1024, cols: 12 },
    ],
    order: 1,
    className: '',
    visible: true,
    disabled: false,
  },
  {
    id: 'hc-requests-group',
    type: 'ui-group',
    name: 'Service request queue',
    page: 'hc-requests-page',
    width: 12,
    height: 1,
    order: 1,
    showTitle: false,
    className: '',
    visible: true,
    disabled: false,
    groupType: 'default',
  },
  {
    id: 'hc-requests-template',
    type: 'ui-template',
    z,
    group: 'hc-requests-group',
    name: 'Service request queue',
    order: 1,
    width: 0,
    height: 0,
    head: '',
    format: requestsTemplate,
    storeOutMessages: false,
    passthru: false,
    resendOnRefresh: false,
    templateScope: 'local',
    className: '',
    x: 250,
    y: 1060,
    wires: [['request-action-router']],
  },
  {
    id: 'request-action-router',
    type: 'switch',
    z,
    name: 'Route request queue action',
    property: 'topic',
    propertyType: 'msg',
    rules: [
      { t: 'eq', v: 'load-request-queue', vt: 'str' },
      { t: 'eq', v: 'open-request', vt: 'str' },
    ],
    checkall: 'true',
    repair: false,
    outputs: 2,
    x: 500,
    y: 1060,
    wires: [['request-list'], ['request-start']],
  },
  {
    id: 'request-list',
    type: 'human-checkpoint-request-list',
    z,
    name: 'Load durable service requests',
    x: 750,
    y: 1040,
    wires: [['hc-requests-template']],
  },
  {
    id: 'request-start',
    type: 'human-checkpoint-request-start',
    z,
    name: 'Start or resume request workflow',
    x: 760,
    y: 1090,
    wires: [['hc-requests-template']],
  },
  {
    id: 'hc-hardware-page',
    type: 'ui-page',
    name: 'YubiKey setup',
    ui: 'hc-dashboard-base',
    path: '/hardware-setup',
    icon: 'key',
    layout: 'grid',
    theme: 'hc-dashboard-theme',
    breakpoints: [
      { name: 'Default', px: 0, cols: 1 },
      { name: 'Tablet', px: 576, cols: 6 },
      { name: 'Desktop', px: 1024, cols: 12 },
    ],
    order: 2,
    className: '',
    visible: true,
    disabled: false,
  },
  {
    id: 'hc-hardware-group',
    type: 'ui-group',
    name: 'YubiKey approval setup',
    page: 'hc-hardware-page',
    width: 12,
    height: 1,
    order: 1,
    showTitle: false,
    className: '',
    visible: true,
    disabled: false,
    groupType: 'default',
  },
  {
    id: 'hc-hardware-template',
    type: 'ui-template',
    z,
    group: 'hc-hardware-group',
    name: 'YubiKey approval setup',
    order: 1,
    width: 0,
    height: 0,
    head: '',
    format: hardwareTemplate,
    storeOutMessages: false,
    passthru: false,
    resendOnRefresh: false,
    templateScope: 'local',
    className: '',
    x: 250,
    y: 1140,
    wires: [],
  },
  {
    id: 'hc-technician-page',
    type: 'ui-page',
    name: 'Technician workspace',
    ui: 'hc-dashboard-base',
    path: '/technician-briefing',
    icon: 'assignment',
    layout: 'grid',
    theme: 'hc-dashboard-theme',
    breakpoints: [
      { name: 'Default', px: 0, cols: 1 },
      { name: 'Tablet', px: 576, cols: 6 },
      { name: 'Desktop', px: 1024, cols: 12 },
    ],
    order: 3,
    className: '',
    visible: true,
    disabled: false,
  },
  {
    id: 'hc-technician-group',
    type: 'ui-group',
    name: 'Assigned service request',
    page: 'hc-technician-page',
    width: 12,
    height: 1,
    order: 1,
    showTitle: false,
    className: '',
    visible: true,
    disabled: false,
    groupType: 'default',
  },
  {
    id: 'hc-technician-template',
    type: 'ui-template',
    z,
    group: 'hc-technician-group',
    name: 'Technician request workspace',
    order: 1,
    width: 0,
    height: 0,
    head: '',
    format: technicianTemplate,
    storeOutMessages: false,
    passthru: false,
    resendOnRefresh: false,
    templateScope: 'local',
    className: '',
    x: 250,
    y: 960,
    wires: [],
  },
  {
    id: 'dashboard-api-load-in',
    type: 'http in',
    z,
    name: 'Load technician workspace state',
    url: '/dashboard/api/workflow',
    method: 'get',
    upload: false,
    swaggerDoc: '',
    x: 180,
    y: 920,
    wires: [['dashboard-api-load-input']],
  },
  functionNode(
    'dashboard-api-load-input',
    'Read workflow identifier',
    `msg.workflowId = String(msg.req?.query?.workflow || '');
return msg;`,
    920,
    ['dashboard-api-load'],
  ),
  workflowLoad('dashboard-api-load', 920, ['dashboard-api-view']),
  journeyView('dashboard-api-view', 920, [response]),
  {
    id: 'dashboard-api-action-in',
    type: 'http in',
    z,
    name: 'Advance technician workflow',
    url: '/dashboard/api/workflow/action',
    method: 'post',
    upload: false,
    swaggerDoc: '',
    x: 170,
    y: 1000,
    wires: [['dashboard-api-action-input']],
  },
  functionNode(
    'dashboard-api-action-input',
    'Validate technician action',
    `const expectedOrigin = env.get('HUMAN_CHECKPOINT_ORIGIN');
if (!expectedOrigin || msg.req?.headers?.origin !== expectedOrigin) throw new Error('Same-origin request required.');
if (!String(msg.req?.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) throw new Error('JSON request required.');
const declaredLength = Number(msg.req?.headers?.['content-length'] || 0);
if (!Number.isFinite(declaredLength) || declaredLength > 65536) throw new Error('Workflow action is too large.');
const body = msg.req?.body;
if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid workflow action.');
if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 65536) throw new Error('Workflow action is too large.');
msg.topic = String(body.action || '');
const allowedActions = new Set(['prepare-assignment', 'continue-brief', 'prepare-release', 'finalize-release', 'export-proof', 'verify-proof']);
if (!allowedActions.has(msg.topic)) throw new Error('Unknown workflow action.');
msg.workflowId = String(body.workflowId || '');
msg.payload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload) ? body.payload : {};
return msg;`,
    1000,
    ['dashboard-action-router'],
  ),
  {
    id: 'dashboard-api-response',
    type: 'http response',
    z,
    name: 'Return durable workflow state',
    statusCode: '',
    headers: {},
    x: 1500,
    y: 920,
    wires: [],
  },
  {
    id: 'dashboard-action-router',
    type: 'switch',
    z,
    name: 'Route technician action',
    property: 'topic',
    propertyType: 'msg',
    rules: [
      { t: 'eq', v: 'prepare-assignment', vt: 'str' },
      { t: 'eq', v: 'continue-brief', vt: 'str' },
      { t: 'eq', v: 'prepare-release', vt: 'str' },
      { t: 'eq', v: 'finalize-release', vt: 'str' },
      { t: 'eq', v: 'export-proof', vt: 'str' },
      { t: 'eq', v: 'verify-proof', vt: 'str' },
    ],
    checkall: 'true',
    repair: false,
    outputs: 6,
    x: 500,
    y: 960,
    wires: [
      ['source-prepare-load'],
      ['brief-run-load'],
      ['release-prepare-load'],
      ['release-finalize-load'],
      ['proof-load'],
      ['proof-verify'],
    ],
  },
  {
    id: response,
    type: 'function',
    z,
    name: 'Update technician dashboard',
    func: `msg.headers = { 'cache-control': 'no-store' };
return msg;`,
    outputs: 1,
    noerr: 0,
    initialize: '',
    finalize: '',
    libs: [],
    x: 1260,
    y: 960,
    wires: [['dashboard-api-response']],
  },
  workflowLoad('source-prepare-load', 180, ['build-request-claim']),
  functionNode(
    'build-request-claim',
    'Bind request claim and preparation scope',
    `const request = msg.supportRequest;
const sourcePolicies = {
  'SKF-CWP-200': { query: 'SKF CWP 200 pump vibration manufacturer maintenance guidance', allowedDomains: ['skf.com', 'fluke.com', 'pumps.org'] },
  'Atlas Copco GA37': { query: 'Atlas Copco GA37 high temperature manufacturer maintenance guidance', allowedDomains: ['atlascopco.com', 'cagi.org', 'fluke.com'] },
  'Trane Performance Climate Changer': { query: 'Trane Performance Climate Changer airflow manufacturer maintenance guidance', allowedDomains: ['trane.com', 'ashrae.org'] },
  'Dorner 2100 Series End Drive': { query: 'Dorner 2100 Series End Drive belt tracking manufacturer maintenance guidance', allowedDomains: ['dornerconveyors.com'] }
};
const sourcePolicy = sourcePolicies[request.assetModel];
if (!sourcePolicy) throw new Error('No public-equipment source policy is configured for this asset model.');
const priorApproval = msg.workflowSnapshot.approvals.find((item) => item.decision === 'public-source-check');
if (priorApproval && !['expired', 'rejected'].includes(priorApproval.status)) throw new Error('A request claim already exists. Refresh its status.');
msg.teamId = env.get('HUMAN_CHECKPOINT_TEAM_ID');
msg.payload = {
  externalTool: 'exa',
  queries: [sourcePolicy.query],
  allowedDomains: sourcePolicy.allowedDomains,
  maxResults: 4,
  reason: 'Claim ' + request.id + ' and authorize its preparation workflow to read approved service history and check bounded public equipment sources.',
  authorizationExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
};
return msg;`,
    180,
    ['create-source-approval'],
  ),
  checkpointCreate(
    'create-source-approval',
    'Create hardware-bound request claim',
    'research-authorization',
    180,
    ['source-waiting'],
  ),
  transition(
    'source-waiting',
    'Wait for technician request claim',
    'waiting-for-public-source-approval',
    'approve-public-source-check',
    'workflow.waiting_for_public_source_approval',
    180,
    ['source-view'],
  ),
  journeyView('source-view', 180, [response]),

  workflowLoad('brief-run-load', 380, ['load-claim-link']),
  functionNode(
    'load-claim-link',
    'Load request claim',
    `const link = msg.workflowSnapshot.approvals.find((item) => item.decision === 'public-source-check');
if (!link) throw new Error('Claim the assigned request first.');
msg.signingRequestId = link.signingRequestId;
msg.teamId = env.get('HUMAN_CHECKPOINT_TEAM_ID');
return msg;`,
    380,
    ['claim-authoritative-get'],
  ),
  {
    id: 'claim-authoritative-get',
    type: 'human-checkpoint-get',
    z,
    name: 'Re-fetch signed request claim',
    agent: 'agent-config',
    requestId: '',
    x: 730,
    y: 380,
    wires: [['verify-completed-claim']],
  },
  functionNode(
    'verify-completed-claim',
    'Verify claim before preparation',
    `const claim = msg.payload;
const teamId = env.get('HUMAN_CHECKPOINT_TEAM_ID');
if (claim?.status !== 'completed' || claim?.valid !== true) throw new Error('The request claim is not complete and valid.');
if (claim.teamId !== teamId) throw new Error('The request claim belongs to a different team.');
if (claim.verificationMethod !== 'human-hardware-previewsign') throw new Error('The request claim was not signed with the enrolled YubiKey.');
if (claim.purpose !== 'human-checkpoint:research-authorization') throw new Error('The request claim has the wrong purpose.');
msg.canonicalMessage = claim.message;
return msg;`,
    380,
    ['claim-complete'],
  ),
  transition(
    'claim-complete',
    'Begin claimed request preparation',
    'researching',
    'review-request',
    'workflow.request_claim_completed',
    380,
    ['build-review-task'],
  ),
  functionNode(
    'build-review-task',
    'Build post-claim history review',
    `const request = msg.supportRequest;
const { attachments: _reportedAttachments, ...requestContext } = request;
const history = msg.reusableHistory;
const sourcePolicies = {
  'SKF-CWP-200': { currentControl: 'Keep the pump isolated until coupling alignment is checked.' },
  'Atlas Copco GA37': { currentControl: 'Keep the compressor unloaded until the high-temperature condition is reviewed.' },
  'Trane Performance Climate Changer': { currentControl: 'Keep the unit under local observation until airflow is verified.' },
  'Dorner 2100 Series End Drive': { currentControl: 'Follow the site isolation procedure before maintenance, adjustment, guard removal, or component replacement.' }
};
const sourcePolicy = sourcePolicies[request.assetModel];
if (!sourcePolicy) throw new Error('No preparation policy is configured for this asset model.');
msg.payload = {
  title: 'Review approved history for ' + request.id,
  tags: ['human-checkpoint', 'service-request', 'request-review'],
  brief: 'The technician has signed the request claim. Review the active support request, the approved same-customer history, and the manual record supplied as task context. Return a FreeformOutput whose first artifact has kind "request-review" and a JSON body with grounded=true, requestId, historySummary, questionsToCheck, and unknowns. Separate relevant history from merely similar history. Do not call any public-source tool in this task. Treat past resolutions as comparison points, never as a diagnosis. Call submit_freeform_output with only summary and artifacts; omit proposedTaskType and verification. After submit_freeform_output succeeds, stop.',
  contexts: [
    { slug: 'signed-request-claim', binding: 'user_inline', value: { signingRequestId: msg.signingRequestId, instruction: 'Preparation is permitted only because this request claim was authoritatively completed.' } },
    { slug: 'active-request', binding: 'user_inline', value: requestContext },
    { slug: 'approved-customer-history', binding: 'context_inline', value: history },
    { slug: 'manual-record', binding: 'context_inline', value: { id: request.manualId, revision: request.manualRevision, currentControl: sourcePolicy.currentControl, sourceBoundary: 'Metadata and operator-approved control only; do not invent manual content.' } }
  ]
};
return msg;`,
    380,
    ['run-review-task'],
  ),
  taskRun(
    'run-review-task',
    'Run MoltNet history review',
    'request-review',
    'review-request',
    'request-review',
    380,
    ['validate-request-review'],
  ),
  functionNode(
    'validate-request-review',
    'Validate post-claim history review',
    `const review = msg.taskResult?.artifactBody;
const request = msg.supportRequest;
if (!review?.grounded || review.requestId !== request.id) throw new Error('The assistant review was not grounded in the claimed request.');
if (review.rootCause || review.causes || review.diagnosis) throw new Error('The request review asserted a diagnosis.');
if (typeof review.historySummary !== 'string' || !review.historySummary.trim()) throw new Error('The request review omitted its history summary.');
if (!Array.isArray(review.questionsToCheck) || review.questionsToCheck.length < 2 || !Array.isArray(review.unknowns) || !review.unknowns.length) throw new Error('The request review omitted field questions or unknowns.');
return msg;`,
    380,
    ['route-reviewed-context-out'],
  ),
  workflowLoad('brief-context-reload', 380, ['build-brief-task']),
  functionNode(
    'build-brief-task',
    'Build approved research task',
    `const request = msg.supportRequest;
const { attachments: _reportedAttachments, ...requestContext } = request;
const reviewStep = msg.workflowSnapshot.steps.find((item) => item.stepKey === 'review-request' && item.status === 'completed');
const review = reviewStep?.result?.artifactBody;
const reviewRef = reviewStep?.result?.outputRef;
const approval = msg.workflowSnapshot.approvals.find((item) => item.decision === 'public-source-check');
if (!review || !reviewRef || !approval || approval.status !== 'completed') throw new Error('Complete the signed request claim and history review first.');
msg.payload = {
  title: 'Prepare technician brief for ' + request.id,
  tags: ['human-checkpoint', 'service-request', 'technician-brief'],
  brief: 'Prepare a concise pre-visit technician brief for the claimed request. First call approved_public_source_check exactly once with only the signingRequestId supplied in context. If the tool denies the request or fails, do not substitute web research and do not submit a brief. Return a FreeformOutput whose first artifact has kind "technician-brief" and a JSON body with grounded=true, requestId, approvalRequestId, title, requestSummary, findings, questionsToCheck, unknowns, and sources. Sources must be HTTPS results returned by the approved tool and contain title and url. Preserve the post-claim history review, its questions, and its unknowns without inventing a diagnosis, root cause, or repair instruction. Past resolutions are comparisons only. Call submit_freeform_output with only summary and artifacts; omit proposedTaskType and verification. After submit_freeform_output succeeds, stop.',
  contexts: [
    { slug: 'active-request', binding: 'user_inline', value: requestContext },
    { slug: 'validated-request-review', binding: 'context_inline', value: review },
    { slug: 'signed-request-claim', binding: 'user_inline', value: { signingRequestId: approval.signingRequestId, instruction: 'Pass this ID unchanged to approved_public_source_check. The tool accepts no query or domain from the task.' } }
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
const sourcePolicies = {
  'SKF-CWP-200': ['skf.com', 'fluke.com', 'pumps.org'],
  'Atlas Copco GA37': ['atlascopco.com', 'cagi.org', 'fluke.com'],
  'Trane Performance Climate Changer': ['trane.com', 'ashrae.org'],
  'Dorner 2100 Series End Drive': ['dornerconveyors.com']
};
const allowed = sourcePolicies[request.assetModel];
if (!allowed) throw new Error('No public-equipment source policy is configured for this asset model.');
if (!brief?.grounded || brief.requestId !== request.id || brief.approvalRequestId !== approval?.signingRequestId) throw new Error('The generated brief is not bound to this request and approved source check.');
if (brief.rootCause || brief.causes || brief.diagnosis) throw new Error('The generated pre-visit brief asserted a diagnosis.');
if (!Array.isArray(brief.findings) || !brief.findings.length || !Array.isArray(brief.questionsToCheck) || brief.questionsToCheck.length < 2 || !Array.isArray(brief.unknowns) || !brief.unknowns.length) throw new Error('The generated brief omitted findings, field questions, or unknowns.');
if (!Array.isArray(brief.sources) || !brief.sources.length) throw new Error('The generated brief has no approved public sources.');
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

  workflowLoad('release-prepare-load', 500, ['build-release-payload']),
  functionNode(
    'build-release-payload',
    'Bind brief and field note',
    `const step = msg.workflowSnapshot.steps.find((item) => item.stepKey === 'prepare-brief' && item.status === 'completed');
const brief = step?.result?.artifactBody;
if (!brief || msg.workflowSnapshot.workflow.state !== 'brief-ready') throw new Error('The assistant brief must be complete before work-order approval.');
const priorApproval = msg.workflowSnapshot.approvals.find((item) => item.decision === 'work-order-release');
if (priorApproval && !['expired', 'rejected'].includes(priorApproval.status)) throw new Error('A work-order approval already exists. Refresh it instead of changing the field note.');
const action = msg.payload && typeof msg.payload === 'object' ? msg.payload : {};
const amendment = String(action.fieldAmendment || '').trim();
if (!amendment) throw new Error('Add the required field note before requesting approval.');
msg.teamId = env.get('HUMAN_CHECKPOINT_TEAM_ID');
msg.fieldAmendment = amendment;
msg.payload = {
  brief,
  fieldAmendment: amendment,
  disposition: 'accepted-with-field-amendment',
  role: String(action.role || msg.supportRequest.assignedRole || 'Field technician'),
  shift: String(action.shift || msg.supportRequest.assignedShift || 'Day / A')
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
    wires: [['proof-output']],
  },
  {
    id: 'proof-output',
    type: 'function',
    z,
    name: 'Show and download approval record',
    func: `msg.headers = { 'cache-control': 'no-store' };
msg.payload = { kind: 'proof', proof: msg.payload };
return msg;`,
    outputs: 1,
    noerr: 0,
    initialize: '',
    finalize: '',
    libs: [],
    x: 560,
    y: 700,
    wires: [['dashboard-api-response']],
  },
  {
    id: 'proof-verify',
    type: 'human-checkpoint-verify-proof',
    z,
    name: 'Offline proof verifier',
    x: 500,
    y: 780,
    wires: [['verification-output']],
  },
  {
    id: 'verification-output',
    type: 'function',
    z,
    name: 'Show offline verification result',
    func: `msg.headers = { 'cache-control': 'no-store' };
msg.payload = { kind: 'verification', report: msg.payload, tampered: Boolean(msg.tampered) };
return msg;`,
    outputs: 1,
    noerr: 0,
    initialize: '',
    finalize: '',
    libs: [],
    x: 560,
    y: 780,
    wires: [['dashboard-api-response']],
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
  {
    id: 'error-response',
    type: 'function',
    z,
    name: 'Safe workflow error response',
    func: `const payload = { error: 'workflow_action_failed', detail: msg.error?.message || 'The workflow action failed.', recovery: 'Refresh the assigned request. Expired technician decisions require a fresh approval request.' };
if (msg.res) {
  msg.statusCode = 400;
  msg.headers = { 'cache-control': 'no-store' };
  msg.payload = payload;
  return [null, msg];
}
return [{ payload: { kind: 'human-checkpoint:error', ...payload } }, null];`,
    outputs: 2,
    noerr: 0,
    initialize: '',
    finalize: '',
    libs: [],
    x: 560,
    y: 860,
    wires: [['hc-requests-template'], ['dashboard-api-response']],
  },
];

const actionRoutes = [
  ['claim-request', '1 · Claim request', 'source-prepare-load', 700],
  ['prepare-brief', '2 · Prepare technician brief', 'brief-run-load', 880],
  [
    'request-release',
    '3 · Request work-order approval',
    'release-prepare-load',
    1060,
  ],
  [
    'finalize-release',
    '4 · Verify and release work order',
    'release-finalize-load',
    1240,
  ],
  ['build-proof', '5 · Build approval record', 'proof-load', 1420],
  ['verify-proof', '6 · Verify approval record', 'proof-verify', 1500],
];

for (const [id, name, target, y] of actionRoutes) {
  nodes.push(
    linkOut(`route-${id}-out`, name, `route-${id}-in`, 1050, y - 330),
    linkIn(`route-${id}-in`, name, `route-${id}-out`, target, 120, y),
  );
}
nodes.push(
  linkOut(
    'route-reviewed-context-out',
    'Validated history → build brief',
    'route-reviewed-context-in',
  ),
  linkIn(
    'route-reviewed-context-in',
    'Validated history → build brief',
    'route-reviewed-context-out',
    'brief-context-reload',
  ),
);
node('dashboard-action-router').wires = actionRoutes.map(([id]) => [
  `route-${id}-out`,
]);

const responseSources = [
  ['state-return', 'dashboard-api-view'],
  ['claim-return', 'source-view'],
  ['brief-return', 'brief-view'],
  ['release-request-return', 'release-view'],
  ['release-final-return', 'released-view'],
  ['proof-return', 'proof-output'],
  ['verification-return', 'verification-output'],
  ['error-return', 'error-response'],
];
for (const [id, source] of responseSources) {
  nodes.push(linkOut(id, 'Return technician response', 'response-link-in'));
  const sourceNode = node(source);
  if (source === 'error-response') sourceNode.wires[1] = [id];
  else sourceNode.wires = [[id]];
}
nodes.push(
  linkIn(
    'response-link-in',
    'Return technician response',
    responseSources.map(([id]) => id),
    response,
    1510,
    420,
  ),
);

nodes.push(
  comment(
    'flow-title',
    'Human Checkpoint · durable service-request workflow',
    240,
    60,
    'The dashboard asks for work. Node-RED persists state, delegates MoltNet tasks, and stops at the two YubiKey decisions.',
  ),
  comment(
    'ui-section',
    'Dashboard surfaces',
    170,
    130,
    'The request queue, YubiKey setup, and technician workspace are FlowFuse Dashboard templates owned by this flow.',
  ),
  comment(
    'api-section',
    'Authenticated dashboard API',
    180,
    320,
    'One read route rebuilds authoritative state. One allowlisted mutation route advances the workflow.',
  ),
  comment(
    'claim-section',
    '1 — Claim the assigned request',
    210,
    640,
    'Node-RED binds the exact request and bounded preparation permissions. No history review or AI task starts before the technician signs the claim.',
  ),
  comment(
    'brief-section',
    '2 — Prepare the technician brief',
    190,
    820,
    'After the completed claim, MoltNet reviews approved history, performs the bounded public-source check, and prepares the immutable brief.',
  ),
  comment(
    'release-request-section',
    '3 — Lock the field note and request approval',
    220,
    1000,
    'The exact brief, field note, disposition, role, and shift become the second YubiKey signing request.',
  ),
  comment(
    'release-final-section',
    '4 — Verify approval and release the work order',
    230,
    1180,
    'Node-RED re-fetches the authoritative request and re-binds the exact approved bytes before closing the work order.',
  ),
  comment(
    'evidence-section',
    '5–6 — Build and verify portable evidence',
    200,
    1360,
    'The final record verifies offline. The same path demonstrates that a one-character field-note change fails.',
  ),
  comment(
    'errors-section',
    'Recovery path',
    140,
    1600,
    'Every node failure returns a safe actionable message to the originating dashboard request.',
  ),
);

place('hc-requests-template', 180, 210);
place('request-action-router', 460, 210);
place('request-list', 750, 185);
place('request-start', 760, 235);
place('hc-hardware-template', 1090, 185);
place('hc-technician-template', 1370, 185);

place('dashboard-api-load-in', 170, 380);
place('dashboard-api-load-input', 460, 380);
place('dashboard-api-load', 730, 380);
place('dashboard-api-view', 1010, 380);
place('state-return', 1250, 380);
place('dashboard-api-action-in', 170, 480);
place('dashboard-api-action-input', 460, 480);
place('dashboard-action-router', 760, 480);
place('response-link-in', 1510, 420);
place(response, 1700, 420);
place('dashboard-api-response', 1970, 420);

const laneX = [120, 360, 650, 950, 1240, 1530, 1800, 2040, 2260, 2480];
placeLane(
  700,
  [
    'route-claim-request-in',
    'source-prepare-load',
    'build-request-claim',
    'create-source-approval',
    'source-waiting',
    'source-view',
    'claim-return',
  ],
  laneX,
);
placeLane(
  880,
  [
    'route-prepare-brief-in',
    'brief-run-load',
    'load-claim-link',
    'claim-authoritative-get',
    'verify-completed-claim',
    'claim-complete',
    'build-review-task',
    'run-review-task',
    'validate-request-review',
    'route-reviewed-context-out',
  ],
  laneX,
);
placeLane(
  960,
  [
    'route-reviewed-context-in',
    'brief-context-reload',
    'build-brief-task',
    'run-brief-task',
    'validate-brief',
    'brief-ready',
    'brief-view',
    'brief-return',
  ],
  laneX,
);
placeLane(
  1060,
  [
    'route-request-release-in',
    'release-prepare-load',
    'build-release-payload',
    'create-release-approval',
    'release-waiting',
    'release-view',
    'release-request-return',
  ],
  laneX,
);
placeLane(
  1240,
  [
    'route-finalize-release-in',
    'release-finalize-load',
    'load-release-link',
    'release-authoritative-get',
    'bind-release-message',
    'release-authoritative',
    'release-complete',
    'released-view',
    'release-final-return',
  ],
  laneX,
);
placeLane(
  1420,
  [
    'route-build-proof-in',
    'proof-load',
    'proof-links',
    'proof-create',
    'proof-output',
    'proof-return',
  ],
  laneX,
);
placeLane(
  1500,
  [
    'route-verify-proof-in',
    'proof-verify',
    'verification-output',
    'verification-return',
  ],
  laneX,
);
place('flow-errors', 180, 1660);
place('error-response', 500, 1660);
place('error-return', 800, 1685);

await writeFile(
  new URL('../flows/flows.json', import.meta.url),
  `${JSON.stringify(nodes, null, 2)}\n`,
);

function node(id) {
  const value = nodes.find((candidate) => candidate.id === id);
  if (!value) throw new Error(`Unknown generated flow node: ${id}`);
  return value;
}

function place(id, x, y) {
  Object.assign(node(id), { x, y });
}

function placeLane(y, ids, positions) {
  ids.forEach((id, index) => place(id, positions[index], y));
}

function comment(id, name, x, y, info) {
  return { id, type: 'comment', z, name, info, x, y, wires: [] };
}

function linkOut(id, name, target, x = 0, y = 0) {
  return {
    id,
    type: 'link out',
    z,
    name,
    mode: 'link',
    links: [target],
    x,
    y,
    wires: [],
  };
}

function linkIn(id, name, sources, target, x = 0, y = 0) {
  return {
    id,
    type: 'link in',
    z,
    name,
    links: Array.isArray(sources) ? sources : [sources],
    x,
    y,
    wires: [[target]],
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
    wires: [wires, []],
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
    wires: [wires, []],
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
