const path = require('node:path');
const { createHumanCheckpointAuth } = require('./auth-middleware.cjs');

const repositoryRoot = path.resolve(__dirname, '../..');
const port = Number(process.env.HUMAN_CHECKPOINT_PORT || 1880);
const expectedOrigin =
  process.env.HUMAN_CHECKPOINT_ORIGIN || `http://localhost:${port}`;

process.env.HUMAN_CHECKPOINT_DASHBOARD_PUBLIC_DIR ||= path.join(
  __dirname,
  'public',
);
process.env.HUMAN_CHECKPOINT_DATABASE_PATH ||= path.join(
  repositoryRoot,
  '.moltnet/human-checkpoint-demo/human-checkpoint.sqlite',
);

const auth = createHumanCheckpointAuth({
  cookieSecret: process.env.HUMAN_CHECKPOINT_COOKIE_SECRET || '',
  expectedOrigin,
  moltNetUrl: process.env.HUMAN_CHECKPOINT_MOLTNET_URL || '',
  teamId: process.env.HUMAN_CHECKPOINT_TEAM_ID || '',
});

module.exports = {
  uiPort: port,
  uiHost: '127.0.0.1',
  credentialSecret:
    process.env.HUMAN_CHECKPOINT_NODE_RED_CREDENTIAL_SECRET ||
    process.env.HUMAN_CHECKPOINT_COOKIE_SECRET,
  httpAdminRoot: false,
  disableEditor: true,
  httpNodeMiddleware: auth.middleware,
  contextStorage: {
    default: {
      module: 'localfilesystem',
      config: {
        dir: path.join(
          repositoryRoot,
          '.moltnet/human-checkpoint-demo/context',
        ),
        flushInterval: 2,
      },
    },
  },
  functionExternalModules: false,
  logging: { console: { level: 'info', metrics: false, audit: false } },
};
