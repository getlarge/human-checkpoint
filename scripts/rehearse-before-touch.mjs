#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dashboard = JSON.parse(
  readFileSync(
    join(
      repositoryRoot,
      '.moltnet',
      'human-checkpoint-field-agent',
      'dashboard.json',
    ),
    'utf8',
  ),
);
const origin = 'http://localhost:1880';
const hydraAdmin = 'http://127.0.0.1:4445';

const loginStart = await redirect(
  `${origin}/dashboard/auth/login?return_to=${encodeURIComponent('/dashboard/requests/')}`,
);
const transactionCookie = cookieFrom(loginStart, 'hc_oidc_tx');
const authorization = await redirect(location(loginStart));
const hydraCookies = new Map();
addCookies(hydraCookies, authorization);
const loginChallenge = new URL(location(authorization)).searchParams.get(
  'login_challenge',
);
if (!loginChallenge) throw new Error('Hydra did not issue a login challenge.');

const loginRequest = await json(
  `${hydraAdmin}/admin/oauth2/auth/requests/login?login_challenge=${encodeURIComponent(loginChallenge)}`,
);
if (loginRequest.client?.client_id !== dashboard.clientId) {
  throw new Error('The login challenge belongs to an unexpected client.');
}
const acceptedLogin = await json(
  `${hydraAdmin}/admin/oauth2/auth/requests/login/accept?login_challenge=${encodeURIComponent(loginChallenge)}`,
  {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      subject: dashboard.technician.id,
      remember: false,
    }),
  },
);

const consentRedirect = await redirect(acceptedLogin.redirect_to, {
  headers: { cookie: cookieHeader(hydraCookies) },
});
addCookies(hydraCookies, consentRedirect);
const acceptedConsent = await redirect(location(consentRedirect));
const callbackRedirect = await redirect(location(acceptedConsent), {
  headers: { cookie: cookieHeader(hydraCookies) },
});
const callback = await redirect(location(callbackRedirect), {
  headers: { cookie: transactionCookie },
});
const sessionCookie = cookieFrom(callback, 'hc_session');

const queue = await json(`${origin}/dashboard/api/requests`, {
  headers: { cookie: sessionCookie },
});
const started = await json(
  `${origin}/dashboard/api/requests/SR-2048/workflow`,
  {
    method: 'POST',
    headers: {
      cookie: sessionCookie,
      origin,
      'content-type': 'application/json',
    },
    body: '{}',
  },
);
const workflowId = started.workflow.id;
const prepared = await json(
  `${origin}/dashboard/api/journey/research/prepare`,
  {
    method: 'POST',
    headers: {
      cookie: sessionCookie,
      origin,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ workflowId }),
  },
);

process.stdout.write(
  `${JSON.stringify(
    {
      authenticatedHuman: dashboard.technician.username,
      queueCounts: {
        open: queue.requests.filter((item) => item.status === 'open').length,
        pendingReview: queue.requests.filter(
          (item) => item.status === 'pending-review',
        ).length,
        closed: queue.requests.filter((item) => item.status === 'closed')
          .length,
      },
      workflowId,
      workflowState: prepared.workflow?.state,
      assistantTasks: prepared.tasks?.map((task) => ({
        taskId: task.taskId,
        taskRole: task.taskRole,
        status: task.status,
      })),
      sourceDecision: {
        requestId: prepared.research?.requestId,
        status: prepared.research?.status,
        expiresAt: prepared.research?.expiresAt,
      },
      stoppedBeforeHardwareTouch: true,
    },
    null,
    2,
  )}\n`,
);

async function redirect(url, init = {}) {
  const response = await fetch(url, { ...init, redirect: 'manual' });
  if (![302, 303].includes(response.status)) {
    throw new Error(
      `${init.method || 'GET'} ${url} returned ${response.status}: ${await response.text()}`,
    );
  }
  return response;
}

function location(response) {
  const value = response.headers.get('location');
  if (!value) throw new Error('Expected a redirect location.');
  return new URL(value, origin).toString();
}

function cookieFrom(response, name) {
  const header = response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${name}=`));
  if (!header) throw new Error(`Expected ${name} cookie.`);
  return header.split(';', 1)[0];
}

function addCookies(jar, response) {
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(';', 1)[0];
    const index = pair.indexOf('=');
    if (index > 0) jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
}

function cookieHeader(jar) {
  if (!jar.size) throw new Error('Expected an OIDC session cookie.');
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function json(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new Error(
      `${init.method || 'GET'} ${url} returned ${response.status}: ${text}`,
    );
  }
  return body;
}
