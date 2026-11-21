'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient, ApiError } = require('../src/github');

function json(status, data, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers });
}

function stub(responses) {
  const requests = [];
  const queue = [...responses];
  const fetchImpl = async (url, options) => {
    requests.push({ url, method: options.method, body: options.body });
    return queue.shift();
  };
  return { fetchImpl, requests };
}

function clientWith(responses, extra = {}) {
  const { fetchImpl, requests } = stub(responses);
  const client = createClient({ token: 't', owner: 'o', repo: 'r', fetchImpl, ...extra });
  return { client, requests };
}

test('decodes file contents and returns null for missing files', async () => {
  const content = Buffer.from('labels:\n  bug: [crash]\n').toString('base64');
  const { client, requests } = clientWith([
    json(200, { encoding: 'base64', content }),
    json(404, { message: 'Not Found' })
  ]);

  assert.equal(await client.getFileContent('.github/triage-bot.yml'), 'labels:\n  bug: [crash]\n');
  assert.equal(await client.getFileContent('missing.yml'), null);
  assert.equal(requests[0].url, 'https://api.github.com/repos/o/r/contents/.github/triage-bot.yml');
});

test('finds the contributing guide', async () => {
  const { client } = clientWith([
    json(404, { message: 'Not Found' }),
    json(200, { html_url: 'https://github.com/o/r/blob/main/.github/CONTRIBUTING.md' })
  ]);
  assert.equal(
    await client.findContributingUrl(),
    'https://github.com/o/r/blob/main/.github/CONTRIBUTING.md'
  );
});

test('follows pagination links', async () => {
  const next = 'https://api.github.com/repos/o/r/issues/5/events?per_page=100&page=2';
  const { client, requests } = clientWith([
    json(200, [{ id: 1 }, { id: 2 }], { link: `<${next}>; rel="next"` }),
    json(200, [{ id: 3 }])
  ]);

  assert.deepEqual(await client.listIssueEvents(5), [{ id: 1 }, { id: 2 }, { id: 3 }]);
  assert.equal(requests[1].url, next);
});

test('excludes pull requests from issue listings', async () => {
  const { client, requests } = clientWith([json(200, [{ number: 1 }, { number: 2, pull_request: {} }])]);
  assert.deepEqual(await client.listOpenIssuesWithLabel('needs-info'), [{ number: 1 }]);
  assert.match(requests[0].url, /labels=needs-info/);
});

test('detects first contributions through the search count', async () => {
  const { client } = clientWith([json(200, { total_count: 1 }), json(200, { total_count: 4 })]);
  assert.equal(await client.isFirstContribution('alice'), true);
  assert.equal(await client.isFirstContribution('bob'), false);
});

test('ignores a missing label on removal and an existing label on creation', async () => {
  const { client } = clientWith([json(404, { message: 'Label does not exist' }), json(422, { message: 'exists' })]);
  await client.removeLabel(1, 'needs-info');
  await client.ensureLabel('needs-info', 'fbca04', 'desc');
});

test('throws API errors with the status code', async () => {
  const { client } = clientWith([json(500, { message: 'Server Error' })]);
  await assert.rejects(client.addLabels(1, ['bug']), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 500);
    return true;
  });
});

test('sends mutations with the expected payloads', async () => {
  const { client, requests } = clientWith([json(200, {}), json(201, {}), json(200, {})]);
  await client.addLabels(3, ['bug']);
  await client.createComment(3, 'hello');
  await client.closeIssue(3, 'not_planned');

  assert.deepEqual(
    requests.map((request) => [request.method, request.url.replace('https://api.github.com', '')]),
    [
      ['POST', '/repos/o/r/issues/3/labels'],
      ['POST', '/repos/o/r/issues/3/comments'],
      ['PATCH', '/repos/o/r/issues/3']
    ]
  );
  assert.deepEqual(JSON.parse(requests[0].body), { labels: ['bug'] });
  assert.deepEqual(JSON.parse(requests[2].body), { state: 'closed', state_reason: 'not_planned' });
});

test('dry run performs no mutating requests', async () => {
  const logs = [];
  const { client, requests } = clientWith([], { dryRun: true, log: (line) => logs.push(line) });
  await client.addLabels(1, ['bug']);
  await client.removeLabel(1, 'bug');
  await client.createComment(1, 'hello');
  await client.closeIssue(1, 'completed');
  await client.ensureLabel('x', 'ffffff', 'y');

  assert.equal(requests.length, 0);
  assert.equal(logs.length, 5);
  assert.ok(logs.every((line) => line.startsWith('[dry-run]')));
});
