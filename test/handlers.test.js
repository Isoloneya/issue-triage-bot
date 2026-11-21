'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const handlers = require('../src/handlers');
const { NOW, daysAgo, createFakeClient, callsOf, makeIssue, makeContext } = require('./support');

const COMPLETE_BODY = 'Steps to reproduce:\n1. Open the app\n\nVersion: 1.4.2 on Ubuntu';

test('labels a bug and asks for missing details', async () => {
  const client = createFakeClient();
  const issue = makeIssue({ title: 'App crashes on start', body: 'It just crashes.' });
  const result = await handlers.onIssueOpened(await makeContext(client, { action: 'opened', issue }));

  assert.deepEqual(result.labels, ['bug', 'needs-info']);
  assert.deepEqual(callsOf(client, 'addLabels'), [['addLabels', 1, ['bug', 'needs-info']]]);
  assert.deepEqual(callsOf(client, 'ensureLabel'), [['ensureLabel', 'needs-info']]);
  const [comment] = callsOf(client, 'createComment');
  assert.match(comment[2], /@alice/);
  assert.match(comment[2], /Steps to reproduce the problem/);
  assert.match(comment[2], /version and environment/i);
});

test('labels a complete bug report without commenting', async () => {
  const client = createFakeClient();
  const issue = makeIssue({ title: 'Crash when saving', body: COMPLETE_BODY });
  const result = await handlers.onIssueOpened(await makeContext(client, { action: 'opened', issue }));

  assert.deepEqual(result, { labels: ['bug'], commented: false });
  assert.equal(callsOf(client, 'createComment').length, 0);
});

test('merges the welcome message and the bug request into one comment', async () => {
  const client = createFakeClient({
    firstContribution: true,
    contributingUrl: 'https://github.com/o/r/blob/main/CONTRIBUTING.md'
  });
  const issue = makeIssue({ title: 'It crashes', body: '' });
  await handlers.onIssueOpened(await makeContext(client, { action: 'opened', issue }));

  const comments = callsOf(client, 'createComment');
  assert.equal(comments.length, 1);
  assert.match(comments[0][2], /Welcome, @alice/);
  assert.match(comments[0][2], /CONTRIBUTING\.md/);
  assert.match(comments[0][2], /missing details/);
});

test('welcomes first-time authors without a contributing guide', async () => {
  const client = createFakeClient({ firstContribution: true });
  const issue = makeIssue({ title: 'How to configure the bot?' });
  const result = await handlers.onIssueOpened(await makeContext(client, { action: 'opened', issue }));

  assert.deepEqual(result.labels, ['question']);
  const [comment] = callsOf(client, 'createComment');
  assert.equal(comment[2], 'Welcome, @alice, and thanks for opening your first issue here!');
});

test('does not welcome team members or bots', async () => {
  for (const overrides of [
    { author_association: 'MEMBER' },
    { author_association: 'OWNER' },
    { user: { login: 'dependabot[bot]', type: 'Bot' } }
  ]) {
    const client = createFakeClient({ firstContribution: true });
    const issue = makeIssue({ title: 'Hello', ...overrides });
    await handlers.onIssueOpened(await makeContext(client, { action: 'opened', issue }));
    assert.equal(client.calls.length, 0);
  }
});

test('respects onlyIfUnlabeled', async () => {
  const client = createFakeClient();
  const issue = makeIssue({ title: 'App crashes', labels: [{ name: 'triage' }] });
  const result = await handlers.onIssueOpened(await makeContext(client, { action: 'opened', issue }));

  assert.deepEqual(result, { labels: [], commented: false });
  assert.equal(client.calls.length, 0);
});

test('checks issues that already carry the bug label', async () => {
  const client = createFakeClient();
  const issue = makeIssue({ title: 'Problem', labels: [{ name: 'bug' }] });
  const result = await handlers.onIssueOpened(await makeContext(client, { action: 'opened', issue }));

  assert.deepEqual(result.labels, ['needs-info']);
  assert.equal(callsOf(client, 'createComment').length, 1);
});

test('does nothing when everything is disabled', async () => {
  const configText = [
    'autoLabel:',
    '  enabled: false',
    'bugReport:',
    '  enabled: false',
    'welcome:',
    '  enabled: false'
  ].join('\n');
  const client = createFakeClient({ configText, firstContribution: true });
  const issue = makeIssue({ title: 'App crashes' });
  await handlers.onIssueOpened(await makeContext(client, { action: 'opened', issue }));
  assert.equal(client.calls.length, 0);
});

test('clears waiting labels when an edit completes the report', async () => {
  const client = createFakeClient();
  const issue = makeIssue({
    title: 'Crash',
    body: COMPLETE_BODY,
    labels: [{ name: 'bug' }, { name: 'needs-info' }, { name: 'stale' }]
  });
  const payload = { action: 'edited', issue, sender: { login: 'alice', type: 'User' } };
  const result = await handlers.onIssueEdited(await makeContext(client, payload));

  assert.deepEqual(result.removed, ['needs-info', 'stale']);
  assert.deepEqual(callsOf(client, 'removeLabel'), [
    ['removeLabel', 1, 'needs-info'],
    ['removeLabel', 1, 'stale']
  ]);
});

test('keeps waiting labels when an edit is still incomplete or made by a bot', async () => {
  const labels = [{ name: 'bug' }, { name: 'needs-info' }];
  const incomplete = makeIssue({ title: 'Crash', body: 'still nothing', labels });
  const complete = makeIssue({ title: 'Crash', body: COMPLETE_BODY, labels });

  const first = createFakeClient();
  await handlers.onIssueEdited(
    await makeContext(first, { issue: incomplete, sender: { login: 'alice', type: 'User' } })
  );
  assert.equal(first.calls.length, 0);

  const second = createFakeClient();
  await handlers.onIssueEdited(
    await makeContext(second, { issue: complete, sender: { login: 'x[bot]', type: 'Bot' } })
  );
  assert.equal(second.calls.length, 0);
});

test('clears waiting labels when the author replies', async () => {
  const client = createFakeClient();
  const issue = makeIssue({ labels: [{ name: 'needs-info' }] });
  const payload = { action: 'created', issue, comment: { user: { login: 'alice', type: 'User' } } };
  const result = await handlers.onIssueComment(await makeContext(client, payload));

  assert.deepEqual(result.removed, ['needs-info']);
});

test('ignores comments from other people, bots and pull requests', async () => {
  const labels = [{ name: 'needs-info' }];
  const cases = [
    { issue: makeIssue({ labels }), comment: { user: { login: 'bob', type: 'User' } } },
    { issue: makeIssue({ labels }), comment: { user: { login: 'github-actions[bot]', type: 'Bot' } } },
    { issue: makeIssue({ labels, pull_request: {} }), comment: { user: { login: 'alice', type: 'User' } } },
    { issue: makeIssue({ labels, state: 'closed' }), comment: { user: { login: 'alice', type: 'User' } } }
  ];
  for (const payload of cases) {
    const client = createFakeClient();
    await handlers.onIssueComment(await makeContext(client, payload));
    assert.equal(client.calls.length, 0);
  }
});

test('welcomes first-time pull request authors', async () => {
  const client = createFakeClient({ firstContribution: true });
  const pullRequest = makeIssue({ number: 7, title: 'Fix typo' });
  const result = await handlers.onPullRequestOpened(
    await makeContext(client, { action: 'opened', pull_request: pullRequest })
  );

  assert.deepEqual(result, { commented: true });
  const [comment] = callsOf(client, 'createComment');
  assert.equal(comment[1], 7);
  assert.match(comment[2], /first pull request/);
});

test('stays quiet for returning pull request authors', async () => {
  const client = createFakeClient({ firstContribution: false });
  const result = await handlers.onPullRequestOpened(
    await makeContext(client, { action: 'opened', pull_request: makeIssue({ number: 7 }) })
  );
  assert.deepEqual(result, { commented: false });
  assert.equal(client.calls.length, 0);
});

function labeledEvent(days, label = 'needs-info') {
  return { event: 'labeled', label: { name: label }, created_at: daysAgo(days) };
}

test('reminds and closes stale issues', async () => {
  const waiting = [{ name: 'needs-info' }];
  const reminded = [{ name: 'needs-info' }, { name: 'stale' }];
  const client = createFakeClient({
    issues: [
      makeIssue({ number: 10, labels: waiting }),
      makeIssue({ number: 11, labels: waiting }),
      makeIssue({ number: 12, labels: waiting }),
      makeIssue({ number: 13, labels: reminded }),
      makeIssue({ number: 14, labels: reminded })
    ],
    events: {
      10: [labeledEvent(5)],
      11: [labeledEvent(40), { event: 'unlabeled', created_at: daysAgo(30) }, labeledEvent(15)],
      12: [labeledEvent(31)],
      13: [labeledEvent(20)],
      14: [labeledEvent(45, 'needs-info')]
    }
  });
  const result = await handlers.sweepStale(await makeContext(client, {}), NOW);

  assert.deepEqual(result, { reminded: [11], closed: [12, 14], waiting: [10, 13], failed: [] });
  assert.deepEqual(callsOf(client, 'addLabels'), [['addLabels', 11, ['stale']]]);
  assert.deepEqual(callsOf(client, 'closeIssue'), [
    ['closeIssue', 12, 'not_planned'],
    ['closeIssue', 14, 'not_planned']
  ]);
  const reminder = callsOf(client, 'createComment').find((call) => call[1] === 11);
  assert.match(reminder[2], /15 days/);
  assert.match(reminder[2], /@alice/);
});

test('falls back to the update time when no label event exists', async () => {
  const client = createFakeClient({
    issues: [makeIssue({ number: 20, labels: [{ name: 'needs-info' }], updated_at: daysAgo(35) })]
  });
  const result = await handlers.sweepStale(await makeContext(client, {}), NOW);
  assert.deepEqual(result.closed, [20]);
});

test('does nothing when the stale sweep is disabled', async () => {
  const client = createFakeClient({
    configText: 'stale:\n  enabled: false',
    issues: [makeIssue({ number: 30, labels: [{ name: 'needs-info' }] })],
    events: { 30: [labeledEvent(90)] }
  });
  const result = await handlers.sweepStale(await makeContext(client, {}), NOW);
  assert.deepEqual(result, { reminded: [], closed: [], waiting: [], failed: [] });
  assert.equal(client.calls.length, 0);
});

test('keeps sweeping when one issue fails', async () => {
  const client = createFakeClient({
    issues: [
      makeIssue({ number: 40, labels: [{ name: 'needs-info' }] }),
      makeIssue({ number: 41, labels: [{ name: 'needs-info' }] })
    ],
    events: { 40: [labeledEvent(40)], 41: [labeledEvent(40)] }
  });
  const originalClose = client.closeIssue;
  client.closeIssue = async (number, reason) => {
    if (number === 40) throw new Error('boom');
    return originalClose(number, reason);
  };
  const result = await handlers.sweepStale(await makeContext(client, {}), NOW);

  assert.deepEqual(result.failed, [40]);
  assert.deepEqual(result.closed, [41]);
});
