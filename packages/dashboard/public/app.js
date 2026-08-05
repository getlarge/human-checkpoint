const $ = (id) => document.getElementById(id);
const page = document.body.dataset.page;
let config;
let companion;
let activeCredential;
let journey;
let lastProof;
let requestQueue = [];
let workflowId;

class CompanionClient {
  constructor(baseUrl) {
    const url = new URL(baseUrl);
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    ) {
      throw new Error('Signer companion must use a loopback HTTP URL');
    }
    this.baseUrl = url;
    this.token = null;
  }

  async connect() {
    const session = await this.request(
      '/v1/sessions',
      { method: 'POST' },
      false,
    );
    this.token = session.token;
    return session;
  }

  async completeCeremony(body, popup) {
    if (!this.token) await this.connect();
    const ceremony = await this.request('/v1/ceremonies', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!popup || popup.closed)
      throw new Error('Allow the signer approval popup, then retry');
    popup.location.replace(ceremony.approvalUrl);
    popup.focus();
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      const result = await this.request(
        `/v1/ceremonies/${ceremony.id}/result`,
        { method: 'GET' },
      );
      if (result.status === 'completed') return result;
      if (result.status === 'failed')
        throw new Error(`${result.message} (${result.code})`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(
      'The five-minute signer ceremony expired. Start a fresh request.',
    );
  }

  async request(path, init, authenticated = true) {
    const response = await fetch(new URL(path, this.baseUrl), {
      ...init,
      credentials: 'omit',
      redirect: 'error',
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(authenticated && this.token
          ? { 'x-moltnet-signer-session': this.token }
          : {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        body.message || `Signer companion returned HTTP ${response.status}`,
      );
    return body;
  }
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      body.detail ||
        body.error ||
        `Request failed with HTTP ${response.status}`,
    );
  return body;
}

function signing(path, init) {
  return requestJson(`/dashboard/api/signing${path}`, init);
}

function setStatus(id, text, state) {
  const element = $(id);
  if (!element) return;
  element.textContent = text;
  if (state) element.dataset.state = state;
  else delete element.dataset.state;
}

function setNotice(id, message, kind = '') {
  const notice = $(id);
  if (!notice) return;
  notice.hidden = false;
  notice.className = `notice${kind ? ` ${kind}` : ''}`;
  notice.replaceChildren(
    Object.assign(document.createElement('p'), { textContent: message }),
  );
}

function showError(error) {
  const message = error instanceof Error ? error.message : String(error);
  setNotice(
    'global-status',
    `${message} Review the current state and retry with a fresh request if it expired.`,
    'error',
  );
  $('global-status')?.scrollIntoView({ block: 'nearest' });
}

function clearError() {
  if ($('global-status')) $('global-status').hidden = true;
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.dataset.wasDisabled = String(button.disabled);
    button.textContent = label;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = button.dataset.wasDisabled === 'true';
    delete button.dataset.wasDisabled;
    button.removeAttribute('aria-busy');
  }
}

async function checkSession() {
  const response = await fetch('/dashboard/api/session', {
    credentials: 'same-origin',
  });
  const authenticated = response.ok;
  setStatus(
    'session-status',
    authenticated ? 'Team member signed in' : 'Sign-in required',
    authenticated ? 'ready' : 'attention',
  );
  setStatus(
    'session-label',
    authenticated ? 'Signed in' : 'Required',
    authenticated ? 'active' : 'pending',
  );
  if ($('sign-in-action')) $('sign-in-action').hidden = authenticated;
  if ($('sign-out-action')) $('sign-out-action').hidden = !authenticated;
  if ($('sign-in-notice')) {
    setNotice(
      'sign-in-notice',
      authenticated
        ? 'The human session is active. OAuth tokens remain sealed in an HttpOnly cookie.'
        : 'Sign in before registering credentials or completing signing requests.',
      authenticated ? 'success' : 'hardware',
    );
  }
  if (authenticated) $('trace-session')?.setAttribute('data-state', 'complete');
  return authenticated;
}

async function checkCompanion() {
  try {
    if (!config) config = await requestJson('/dashboard/api/config');
    companion = new CompanionClient(config.signerUrl);
    await companion.connect();
    setStatus('companion-status', 'Companion connected', 'ready');
    setStatus('companion-label', 'Connected', 'active');
    setNotice(
      'companion-notice',
      'Companion connected at loopback. Browser credentials are omitted.',
      'success',
    );
    $('trace-companion')?.setAttribute('data-state', 'complete');
    return true;
  } catch (error) {
    setStatus('companion-status', 'Companion unavailable', 'attention');
    setStatus('companion-label', 'Unavailable', 'error');
    setNotice(
      'companion-notice',
      `Start @themoltnet/signer and connect exactly one compatible YubiKey. ${error instanceof Error ? error.message : ''}`,
      'error',
    );
    return false;
  }
}

async function loadCredentials() {
  const list = await signing('/crypto/signing-credentials?limit=100', {
    method: 'GET',
  });
  const credentials = Array.isArray(list.items) ? list.items : [];
  activeCredential =
    credentials.find((item) => item.status === 'active') || null;
  const credential =
    activeCredential ||
    credentials.find((item) => item.status === 'pending_approval') ||
    credentials[0];
  if (page === 'hardware-setup') renderCredential(credential);
  return credential;
}

function renderCredential(credential) {
  if (!credential) {
    setStatus('credential-label', 'Not enrolled');
    setNotice(
      'credential-notice',
      'No YubiKey signing credential exists for this team.',
    );
    $('credential-record').hidden = true;
    $('activate-action').hidden = true;
    $('briefing-action').hidden = true;
    return;
  }
  $('credential-record').hidden = false;
  $('credential-name').textContent = credential.label;
  $('credential-state').textContent = statusText(credential.status);
  $('credential-method').textContent = credential.verificationMethod;
  $('credential-id').textContent = credential.id;
  setStatus(
    'credential-label',
    credential.status === 'active'
      ? 'Ready'
      : credential.status === 'pending_approval'
        ? 'Waiting for manager'
        : statusText(credential.status),
    credential.status,
  );
  setNotice(
    'credential-notice',
    credential.status === 'active'
      ? 'YubiKey ready. You can use it for both required approvals.'
      : 'Enrollment proof is complete. A team credential manager must activate it.',
    credential.status === 'active' ? 'success' : 'hardware',
  );
  $('activate-action').hidden = credential.status !== 'pending_approval';
  $('activate-action').dataset.credentialId = credential.id;
  $('briefing-action').hidden = credential.status !== 'active';
  $('trace-enrollment')?.setAttribute('data-state', 'complete');
  if (credential.status === 'active')
    $('trace-activation')?.setAttribute('data-state', 'complete');
}

async function enrollCredential() {
  clearError();
  const button = $('enroll-action');
  const popup = window.open(
    'about:blank',
    'human-checkpoint-signer',
    'popup,width=600,height=760',
  );
  setBusy(button, true, 'Waiting for enrollment touch…');
  try {
    if (!companion) await checkCompanion();
    const enrollment = await companion.completeCeremony(
      {
        version: 1,
        operation: 'credential-enrollment',
        label: 'SR-2048 technician YubiKey',
        teamId: config.teamId,
      },
      popup,
    );
    const registration = await signing(
      '/crypto/signing-credentials/registrations',
      {
        method: 'POST',
        body: JSON.stringify({
          verificationMethod: 'human-hardware-previewsign',
          credentialType: 'preview-sign-arkg',
          algorithm: 'arkg-p256-esp256',
          label: 'SR-2048 technician YubiKey',
          publicMaterial: enrollment.publicMaterial,
        }),
      },
    );
    const proof = await companion.completeCeremony(
      {
        version: 1,
        operation: 'credential-registration',
        resourceId: registration.id,
        challenge: registration.challenge,
      },
      popup,
    );
    await signing(
      `/crypto/signing-credentials/registrations/${registration.id}/complete`,
      {
        method: 'POST',
        body: JSON.stringify({
          publicMaterial: enrollment.publicMaterial,
          receipt: proof.receipt,
        }),
      },
    );
    popup?.close();
    await loadCredentials();
    setNotice(
      'credential-notice',
      'Enrollment completed. A different team credential manager must sign in once to activate this key.',
      'success',
    );
  } finally {
    popup?.close();
    setBusy(button, false);
  }
}

async function activateCredential() {
  const button = $('activate-action');
  setBusy(button, true, 'Activating…');
  try {
    try {
      await signing(
        `/crypto/signing-credentials/${button.dataset.credentialId}/approve`,
        {
          method: 'POST',
          body: JSON.stringify({
            reason: 'Human Checkpoint local demo activation',
          }),
        },
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'Credential cannot transition to active'
      ) {
        throw new Error(
          'The person who enrolled this YubiKey cannot activate it. Sign out and ask the seeded credential manager to complete this one-time step.',
        );
      }
      throw error;
    }
    await loadCredentials();
  } finally {
    setBusy(button, false);
  }
}

async function signCheckpoint(kind) {
  clearError();
  if (!activeCredential) await loadCredentials();
  if (!activeCredential)
    throw new Error('Activate a YubiKey credential before signing');
  const checkpoint = journey[kind];
  if (!checkpoint?.requestId)
    throw new Error('Prepare the approval request before using the YubiKey');
  const button = $(kind === 'research' ? 'sign-research' : 'sign-release');
  const popup = window.open(
    'about:blank',
    'human-checkpoint-signer',
    'popup,width=600,height=760',
  );
  setBusy(button, true, 'Waiting for YubiKey touch…');
  try {
    if (!companion) await checkCompanion();
    const claimed = await signing(
      `/crypto/signing-requests/${checkpoint.requestId}/claim`,
      {
        method: 'POST',
        body: JSON.stringify({ credentialId: activeCredential.id }),
      },
    );
    const result = await companion.completeCeremony(
      {
        version: 1,
        operation: 'signing-request',
        resourceId: claimed.id,
        challenge: claimed.challenge,
      },
      popup,
    );
    await signing(`/crypto/signing-requests/${checkpoint.requestId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ receipt: result.receipt }),
    });
    popup?.close();
    const completed = await refreshCheckpoint(kind);
    if (kind === 'research' && completed.status === 'completed') {
      journey = await requestJson('/dashboard/api/journey/research/run', {
        method: 'POST',
        body: workflowBody(),
      });
    }
  } finally {
    popup?.close();
    setBusy(button, false);
    renderJourney();
  }
}

async function loadJourney() {
  journey = await requestJson(
    `/dashboard/api/journey?workflow=${encodeURIComponent(workflowId)}`,
  );
  renderJourney();
}

async function refreshCheckpoint(kind) {
  const request = await requestJson(
    `/dashboard/api/journey/request/${kind}?workflow=${encodeURIComponent(workflowId)}`,
  );
  journey[kind] = {
    ...journey[kind],
    status: request.status,
    expiresAt: request.expiresAt,
    completedAt: request.completedAt,
    derivedPublicKey: request.receipt?.value?.derivedPublicKey || null,
  };
  renderJourney();
  return request;
}

function renderJourney() {
  if (!journey || page !== 'technician-briefing') return;
  const request = journey.supportRequest;
  const reviewComplete = journey.tasks?.some(
    (task) => task.taskRole === 'request-review' && task.status === 'completed',
  );
  const immutable = Boolean(journey.brief?.immutable);
  const researchComplete = journey.research?.status === 'completed';
  const releaseComplete = journey.release?.status === 'completed';
  const released = Boolean(journey.releasedAt);
  if (request) {
    $('brand-request').textContent = `Service request ${request.id}`;
    $('request-nav-label').textContent = `${request.id} · ${request.assetId}`;
    $('brief-asset').textContent = request.assetName;
    $('brief-symptom').textContent = request.summary;
    $('page-title').textContent = released
      ? `${request.id} work order released`
      : immutable
        ? 'Review and approve this work order'
        : `Prepare the ${request.id} work order`;
    $('page-lead').textContent = released
      ? 'MoltNet revalidated both approvals before closing the request. The approval record is ready for offline checking.'
      : immutable
        ? 'The assistant brief is locked. Add the required field note, then approve and release the exact work order shown.'
        : `The assistant is preparing ${request.id}. It cannot check public sources or release the work order without your YubiKey approval.`;
  }
  renderCheckpoint('research', journey.research);
  renderCheckpoint('release', journey.release);
  renderTasks(journey.tasks || []);
  $('nav-source-label').textContent = checkpointNavigationText(
    'research',
    journey.research,
    { reviewComplete, immutable, released },
  );
  $('nav-release-label').textContent = checkpointNavigationText(
    'release',
    journey.release,
    { reviewComplete, immutable, released },
  );
  setCurrentStep(
    immutable || journey.release?.requestId
      ? 'nav-release'
      : reviewComplete || journey.research?.requestId
        ? 'nav-source'
        : 'nav-assigned',
  );
  setStatus(
    'brief-state',
    immutable ? 'Immutable' : 'Draft',
    immutable ? 'completed' : undefined,
  );
  $('brief-subtitle').textContent = immutable
    ? `Prepared ${formatDate(journey.brief.validatedAt)}. The source check and brief are now locked.`
    : 'The assistant has not completed the brief yet.';
  $('findings').hidden = !immutable;
  replaceList('finding-list', journey.brief?.findings || [], (item) => item);
  replaceList('source-list', journey.brief?.sources || [], (item, li) => {
    const link = document.createElement('a');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = item.title;
    li.append(link);
  });
  $('prepare-release').disabled =
    !immutable || isLocked(journey.release?.status);
  const releaseLocked = isLocked(journey.release?.status);
  $('field-amendment').disabled = releaseLocked;
  $('technician-role').disabled = releaseLocked;
  $('shift').disabled = releaseLocked;
  if (journey.release?.fieldAmendment)
    $('field-amendment').value = journey.release.fieldAmendment;
  if (researchComplete) $('trace-research').dataset.state = 'complete';
  if (reviewComplete) {
    $('trace-draft').dataset.state = 'complete';
  }
  if (immutable) $('trace-brief').dataset.state = 'complete';
  if (releaseComplete) $('trace-release').dataset.state = 'complete';
  $('export-proof').disabled = !releaseComplete;
  if (releaseComplete && !lastProof) {
    setStatus('proof-state', 'Ready to download', 'pending');
    setNotice(
      'proof-notice',
      'Both approvals are complete. Download the record to verify both signatures without MoltNet or the YubiKey.',
      'success',
    );
  }
  if (researchComplete && releaseComplete) {
    const left = JSON.stringify(journey.research.derivedPublicKey);
    const right = JSON.stringify(journey.release.derivedPublicKey);
    const differ = left && right && left !== right;
    setNotice(
      'key-comparison',
      differ
        ? 'Approval record ready: each decision used a different request-specific key.'
        : 'The approval keys could not be distinguished. Do not release this work order.',
      differ ? 'success' : 'error',
    );
  }
}

function renderCheckpoint(kind, value = {}) {
  const title = checkpointStatusText(value.status);
  setStatus(`${kind}-state`, title, value.status);
  $(`${kind}-request-id`).textContent = value.requestId || '—';
  $(`${kind}-expiry`).textContent = value.expiresAt
    ? formatDate(value.expiresAt)
    : 'Set when the approval request is prepared';
  $(`${kind}-message`).textContent =
    value.canonicalMessage || 'No approval request prepared.';
  $(`${kind}-key`).textContent = value.derivedPublicKey
    ? JSON.stringify(value.derivedPublicKey, null, 2)
    : 'The request-specific public key appears after approval.';
  const requested = Boolean(value.requestId);
  const pending = value.status === 'pending' || value.status === 'claimed';
  if (kind === 'research') {
    $('research-heading').textContent =
      value.status === 'completed'
        ? 'Approved public-source check'
        : ['expired', 'rejected'].includes(value.status)
          ? 'Prepare a fresh public-source approval'
          : 'Approve a check of public sources';
    $('research-lead').textContent =
      value.status === 'completed'
        ? 'The assistant checked only the approved manufacturer and maintenance sources shown below.'
        : value.status === 'expired'
          ? 'The previous approval expired before use. Prepare a fresh source check before the assistant can continue.'
          : value.status === 'rejected'
            ? 'The previous source check was rejected. Prepare a new scope only if the work still requires it.'
            : 'The assistant wants to check up to four results from the listed manufacturer and maintenance sources.';
    const scope = value.scope;
    if (scope) {
      $('research-queries').textContent = Array.isArray(scope.queries)
        ? scope.queries.join(' · ')
        : 'No public-source query is available.';
      $('research-domains').textContent = Array.isArray(scope.allowedDomains)
        ? scope.allowedDomains.join(', ')
        : 'No public domains are available.';
      $('research-limit').textContent = String(scope.maxResults ?? '—');
    }
    $('prepare-research').disabled =
      pending ||
      value.status === 'completed' ||
      Boolean(journey.brief?.immutable);
    $('sign-research').disabled = !pending;
    $('refresh-research').disabled = !requested;
    $('run-research').disabled =
      value.status !== 'completed' || Boolean(journey.brief?.immutable);
    setNotice(
      'research-notice',
      value.status === 'completed'
        ? 'Approved. The assistant can now check only the public sources shown above.'
        : pending
          ? 'The source list is locked. Touch your enrolled YubiKey before this approval expires.'
          : 'The assistant is waiting for your approval before it contacts a public search service.',
      value.status === 'completed' ? 'success' : 'hardware',
    );
  } else {
    $('release-heading').textContent = journey.releasedAt
      ? 'Released work order'
      : value.status === 'completed'
        ? 'Approved work order'
        : ['expired', 'rejected'].includes(value.status)
          ? 'Prepare a fresh work-order approval'
          : 'Review and approve this work order';
    $('release-lead').textContent = journey.releasedAt
      ? 'MoltNet revalidated the locked brief, field note, role, and shift before release.'
      : value.status === 'completed'
        ? 'Hardware approval is complete. Release the exact locked work order when ready.'
        : value.status === 'expired'
          ? 'The previous approval expired. Review the work order again and prepare a fresh request.'
          : value.status === 'rejected'
            ? 'The previous work-order approval was rejected. Review the brief and field note before trying again.'
            : 'Your field note and the assistant’s completed brief will be locked together in the approval record.';
    $('sign-release').disabled = !pending;
    $('refresh-release').disabled = !requested;
    $('finalize-release').disabled =
      value.status !== 'completed' || Boolean(journey.releasedAt);
  }
}

function checkpointStatusText(status) {
  if (status === 'completed') return 'Approved';
  if (status === 'pending') return 'Awaiting approval';
  if (status === 'claimed') return 'Approval in progress';
  if (status === 'expired') return 'Expired';
  if (status === 'rejected') return 'Rejected';
  return 'Not requested';
}

function checkpointNavigationText(kind, checkpoint = {}, state) {
  if (kind === 'research') {
    if (checkpoint.status === 'completed')
      return 'Approved · source check complete';
    if (['pending', 'claimed'].includes(checkpoint.status))
      return 'Your YubiKey approval is required';
    if (['expired', 'rejected'].includes(checkpoint.status))
      return 'Prepare a fresh approval';
    return state.reviewComplete
      ? 'Ready for your review'
      : 'Waiting for assistant review';
  }
  if (state.released) return 'Released · approval record ready';
  if (checkpoint.status === 'completed') return 'Approved · ready to release';
  if (['pending', 'claimed'].includes(checkpoint.status))
    return 'Your YubiKey approval is required';
  if (['expired', 'rejected'].includes(checkpoint.status))
    return 'Prepare a fresh approval';
  return state.immutable
    ? 'Add field note and review'
    : 'Waiting for technician brief';
}

function setCurrentStep(activeId) {
  ['nav-assigned', 'nav-source', 'nav-release'].forEach((id) => {
    const link = $(id);
    if (!link) return;
    if (id === activeId) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function renderTasks(tasks) {
  const list = $('task-list');
  if (!list) return;
  list.replaceChildren();
  if (!tasks.length) {
    const item = document.createElement('li');
    item.textContent = 'No assistant task has started.';
    list.append(item);
    return;
  }
  tasks.forEach((task) => {
    const item = document.createElement('li');
    const label = document.createElement('strong');
    label.textContent =
      task.taskRole === 'request-review'
        ? 'Review request and approved service history'
        : 'Prepare technician work-order brief';
    const details = document.createElement('small');
    details.textContent = `${statusText(task.status)} · MoltNet task ${task.taskId}`;
    item.append(label, details);
    list.append(item);
  });
}

function replaceList(id, values, render) {
  const list = $(id);
  if (!list) return;
  list.replaceChildren();
  values.forEach((value) => {
    const li = document.createElement('li');
    const rendered = render(value, li);
    if (typeof rendered === 'string') li.textContent = rendered;
    list.append(li);
  });
}

function isLocked(status) {
  return ['pending', 'claimed', 'completed'].includes(status);
}
function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

async function action(buttonId, busyLabel, task) {
  const button = $(buttonId);
  clearError();
  setBusy(button, true, busyLabel);
  try {
    await task();
  } catch (error) {
    showError(error);
  } finally {
    setBusy(button, false);
    renderJourney();
  }
}

async function initHardware() {
  config = await requestJson('/dashboard/api/config');
  const [authenticated] = await Promise.all([checkSession(), checkCompanion()]);
  if (authenticated) await loadCredentials().catch(showError);
  $('companion-retry').addEventListener('click', () => checkCompanion());
  $('enroll-action').addEventListener('click', () =>
    enrollCredential().catch(showError),
  );
  $('activate-action').addEventListener('click', () =>
    activateCredential().catch(showError),
  );
}

async function initRequests() {
  await checkSession();
  const result = await requestJson('/dashboard/api/requests');
  requestQueue = Array.isArray(result.requests) ? result.requests : [];
  updateRequestCounts();
  renderRequestQueue('open');
  document.querySelectorAll('[data-request-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      const status = button.dataset.requestFilter;
      document.querySelectorAll('[data-request-filter]').forEach((item) => {
        item.setAttribute('aria-pressed', String(item === button));
      });
      renderRequestQueue(status);
    });
  });
}

function updateRequestCounts() {
  $('open-count').textContent = String(
    requestQueue.filter((item) => item.status === 'open').length,
  );
  $('pending-count').textContent = String(
    requestQueue.filter((item) => item.status === 'pending-review').length,
  );
  $('closed-count').textContent = String(
    requestQueue.filter((item) => item.status === 'closed').length,
  );
}

function renderRequestQueue(status) {
  const list = $('request-list');
  const requests = requestQueue.filter((item) => item.status === status);
  $('request-count').textContent =
    `${requests.length} ${requestLabel(status, requests.length)}`;
  list.replaceChildren();
  if (!requests.length) {
    const empty = document.createElement('p');
    empty.className = 'queue-empty';
    empty.textContent =
      status === 'open'
        ? 'No service requests are currently assigned to this team.'
        : `No ${requestLabel(status, 2)} are available.`;
    list.append(empty);
    return;
  }
  requests.forEach((supportRequest) => {
    const article = document.createElement('article');
    article.className = 'request-row';
    const top = document.createElement('div');
    top.className = 'request-row-top';
    const id = document.createElement('strong');
    id.textContent = supportRequest.id;
    const state = document.createElement('span');
    state.className = 'state-label';
    state.dataset.state = supportRequest.status;
    state.textContent = statusText(supportRequest.status);
    top.append(id, state);
    const title = document.createElement('h3');
    title.textContent = supportRequest.assetName;
    const summary = document.createElement('p');
    summary.textContent = supportRequest.summary;
    const meta = document.createElement('p');
    meta.className = 'request-meta-line';
    meta.textContent = `${supportRequest.siteName} · Opened ${formatDate(supportRequest.openedAt)}`;
    article.append(top, title, summary, meta);
    if (supportRequest.confirmedResolution) {
      const resolution = document.createElement('p');
      resolution.className = 'request-resolution';
      resolution.textContent = `Recorded outcome: ${supportRequest.confirmedResolution}`;
      article.append(resolution);
    }
    if (supportRequest.status === 'open') {
      const action = document.createElement('button');
      action.type = 'button';
      action.textContent = 'Open assigned request';
      action.addEventListener('click', () =>
        actionForRequest(action, supportRequest.id),
      );
      article.append(action);
    }
    list.append(article);
  });
}

async function actionForRequest(button, requestId) {
  setBusy(button, true, 'Opening request…');
  try {
    const snapshot = await requestJson(
      `/dashboard/api/requests/${encodeURIComponent(requestId)}/workflow`,
      {
        method: 'POST',
        body: '{}',
      },
    );
    window.location.assign(
      `/dashboard/technician-briefing/?request=${encodeURIComponent(requestId)}&workflow=${encodeURIComponent(snapshot.workflow.id)}`,
    );
  } catch (error) {
    showError(error);
    setBusy(button, false);
  }
}

function requestLabel(status, count) {
  const singular =
    status === 'pending-review'
      ? 'request pending review'
      : `${status} request`;
  return count === 1 ? singular : `${singular}s`;
}

function statusText(status) {
  if (status === 'pending-review') return 'Pending review';
  if (status === 'pending_approval') return 'Pending approval';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

async function initBriefing() {
  const parameters = new URLSearchParams(window.location.search);
  workflowId = parameters.get('workflow');
  if (!workflowId)
    throw new Error('Open a request from the assigned-request queue.');
  config = await requestJson('/dashboard/api/config');
  await Promise.all([
    checkSession(),
    checkCompanion(),
    loadCredentials().catch(() => null),
    loadJourney(),
  ]);
  $('prepare-research').addEventListener('click', () =>
    action('prepare-research', 'Preparing approval…', async () => {
      journey = await requestJson('/dashboard/api/journey/research/prepare', {
        method: 'POST',
        body: workflowBody(),
      });
    }),
  );
  $('sign-research').addEventListener('click', () =>
    signCheckpoint('research').catch(showError),
  );
  $('refresh-research').addEventListener('click', () =>
    action('refresh-research', 'Refreshing…', () =>
      refreshCheckpoint('research'),
    ),
  );
  $('run-research').addEventListener('click', () =>
    action('run-research', 'Checking approved sources…', async () => {
      journey = await requestJson('/dashboard/api/journey/research/run', {
        method: 'POST',
        body: workflowBody(),
      });
    }),
  );
  $('prepare-release').addEventListener('click', () =>
    action('prepare-release', 'Preparing final approval…', async () => {
      journey = await requestJson('/dashboard/api/journey/release/prepare', {
        method: 'POST',
        body: workflowBody({
          fieldAmendment: $('field-amendment').value,
          role: $('technician-role').value,
          shift: $('shift').value,
        }),
      });
    }),
  );
  $('sign-release').addEventListener('click', () =>
    signCheckpoint('release').catch(showError),
  );
  $('refresh-release').addEventListener('click', () =>
    action('refresh-release', 'Refreshing…', () =>
      refreshCheckpoint('release'),
    ),
  );
  $('finalize-release').addEventListener('click', () =>
    action('finalize-release', 'Confirming approval…', async () => {
      journey = await requestJson('/dashboard/api/journey/release/finalize', {
        method: 'POST',
        body: workflowBody(),
      });
    }),
  );
  $('export-proof').addEventListener('click', () =>
    action('export-proof', 'Exporting proof…', async () => {
      lastProof = await requestJson('/dashboard/api/journey/proof', {
        method: 'POST',
        body: workflowBody(),
      });
      const blob = new Blob([JSON.stringify(lastProof, null, 2)], {
        type: 'application/json',
      });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'human-checkpoint-proof.json';
      link.click();
      URL.revokeObjectURL(link.href);
      $('verify-proof').disabled = false;
      $('tamper-proof').disabled = false;
      setStatus('proof-state', 'Downloaded', 'completed');
      setNotice(
        'proof-notice',
        'Approval record downloaded. Verify it locally, then try the one-character change to see the signature check fail.',
        'success',
      );
    }),
  );
  $('verify-proof').addEventListener('click', () =>
    verifyLoadedProof(lastProof, false),
  );
  $('tamper-proof').addEventListener('click', () => {
    const tampered = structuredClone(lastProof);
    const message = tampered.checkpoints[1].canonicalMessage;
    const marker = 'Install';
    tampered.checkpoints[1].canonicalMessage = message.includes(marker)
      ? message.replace(marker, 'install')
      : `${message} `;
    verifyLoadedProof(tampered, true);
  });
}

function workflowBody(value = {}) {
  return JSON.stringify({ workflowId, ...value });
}

async function verifyLoadedProof(proof, tampered) {
  await action(
    tampered ? 'tamper-proof' : 'verify-proof',
    'Verifying…',
    async () => {
      const report = await requestJson('/dashboard/api/journey/proof/verify', {
        method: 'POST',
        body: JSON.stringify(proof),
      });
      $('verification-report').textContent = JSON.stringify(report, null, 2);
      setStatus(
        'proof-state',
        report.valid
          ? 'Valid offline proof'
          : tampered
            ? 'Tamper detected'
            : 'Invalid proof',
        report.valid ? 'completed' : 'error',
      );
      setNotice(
        'proof-notice',
        report.valid
          ? 'Both ESP256 signatures verify offline and the request-scoped public keys differ.'
          : tampered
            ? 'Expected failure: one amendment character no longer matches the signed payload.'
            : 'Proof verification failed. Do not release or submit this artifact.',
        report.valid ? 'success' : 'error',
      );
      if (report.valid) $('trace-proof').dataset.state = 'complete';
    },
  );
}

try {
  if (page === 'requests') await initRequests();
  else if (page === 'hardware-setup') await initHardware();
  else if (page === 'technician-briefing') await initBriefing();
} catch (error) {
  showError(error);
}
