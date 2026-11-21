'use strict';

const fs = require('node:fs');
const { createClient } = require('./github');
const { loadConfig } = require('./config');
const handlers = require('./handlers');

function input(name, fallback = '') {
  const value = process.env[`INPUT_${name.toUpperCase().replace(/ /g, '_')}`];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

function readPayload() {
  const file = process.env.GITHUB_EVENT_PATH;
  if (!file || !fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function route(ctx, eventName) {
  const { action } = ctx.payload;
  switch (eventName) {
    case 'issues':
      if (action === 'opened') return handlers.onIssueOpened(ctx);
      if (action === 'edited') return handlers.onIssueEdited(ctx);
      return null;
    case 'issue_comment':
      return action === 'created' ? handlers.onIssueComment(ctx) : null;
    case 'pull_request':
    case 'pull_request_target':
      return action === 'opened' ? handlers.onPullRequestOpened(ctx) : null;
    case 'schedule':
    case 'workflow_dispatch':
      return handlers.sweepStale(ctx);
    default:
      return null;
  }
}

async function main() {
  const token = input('token');
  if (!token) throw new Error('The "token" input is required');

  const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/');
  if (!owner || !repo) throw new Error('GITHUB_REPOSITORY is not set');

  const log = (message) => console.log(message);
  const client = createClient({
    token,
    owner,
    repo,
    apiUrl: process.env.GITHUB_API_URL || 'https://api.github.com',
    dryRun: input('dry-run', 'false').toLowerCase() === 'true',
    log
  });

  const config = await loadConfig(client, input('config-path', '.github/triage-bot.yml'));
  const payload = readPayload();
  const eventName = process.env.GITHUB_EVENT_NAME;
  const result = await route({ client, config, payload, log }, eventName);

  if (result === null) {
    log(`Nothing to do for event "${eventName}" with action "${payload.action}"`);
    return;
  }

  log(JSON.stringify(result));
  if (Array.isArray(result.failed) && result.failed.length > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { input, route };
