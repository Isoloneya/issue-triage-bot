'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { route, input } = require('../src/index');
const { createFakeClient, makeIssue, makeContext } = require('./support');

test('routes events to the matching handler', async () => {
  const client = createFakeClient();
  const issue = makeIssue({ title: 'App crashes', body: '' });

  const opened = await route(await makeContext(client, { action: 'opened', issue }), 'issues');
  assert.deepEqual(opened.labels, ['bug', 'needs-info']);

  const swept = await route(await makeContext(client, {}), 'schedule');
  assert.deepEqual(swept.failed, []);

  const dispatched = await route(await makeContext(client, {}), 'workflow_dispatch');
  assert.deepEqual(dispatched.reminded, []);
});

test('ignores unrelated events and actions', async () => {
  const client = createFakeClient();
  assert.equal(await route(await makeContext(client, { action: 'closed' }), 'issues'), null);
  assert.equal(await route(await makeContext(client, { action: 'deleted' }), 'issue_comment'), null);
  assert.equal(await route(await makeContext(client, { action: 'closed' }), 'pull_request_target'), null);
  assert.equal(await route(await makeContext(client, {}), 'push'), null);
});

test('reads inputs from the environment', () => {
  process.env['INPUT_DRY-RUN'] = ' true ';
  process.env.INPUT_TOKEN = '';
  assert.equal(input('dry-run', 'false'), 'true');
  assert.equal(input('token', 'fallback'), 'fallback');
  assert.equal(input('missing-input', 'x'), 'x');
  delete process.env['INPUT_DRY-RUN'];
  delete process.env.INPUT_TOKEN;
});
