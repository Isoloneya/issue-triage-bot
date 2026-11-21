'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, DEFAULTS } = require('../src/config');
const { createFakeClient } = require('./support');

test('uses defaults when there is no config file', async () => {
  const config = await loadConfig(createFakeClient(), '.github/triage-bot.yml');
  assert.deepEqual(config, DEFAULTS);
});

test('merges a custom config with the defaults', async () => {
  const configText = [
    'labels:',
    '  docs: [documentation, typo]',
    '  question: []',
    'stale:',
    '  remindAfterDays: 3',
    '  closeAfterDays: 5',
    'welcome:',
    '  enabled: false'
  ].join('\n');
  const config = await loadConfig(createFakeClient({ configText }), '.github/triage-bot.yml');

  assert.deepEqual(config.labels.docs, ['documentation', 'typo']);
  assert.deepEqual(config.labels.question, []);
  assert.ok(config.labels.bug.length > 0);
  assert.equal(config.stale.remindAfterDays, 3);
  assert.equal(config.stale.closeReason, 'not_planned');
  assert.equal(config.welcome.enabled, false);
  assert.equal(typeof config.welcome.issueMessage, 'string');
});

test('rejects inconsistent stale settings', async () => {
  const configText = 'stale:\n  remindAfterDays: 10\n  closeAfterDays: 5';
  await assert.rejects(loadConfig(createFakeClient({ configText }), 'c.yml'), /remindAfterDays/);
});

test('rejects invalid regular expressions', async () => {
  const configText = "labels:\n  bug: ['re:(']";
  await assert.rejects(loadConfig(createFakeClient({ configText }), 'c.yml'), /invalid pattern/);
});

test('rejects an invalid close reason', async () => {
  const configText = 'stale:\n  closeReason: whatever';
  await assert.rejects(loadConfig(createFakeClient({ configText }), 'c.yml'), /closeReason/);
});

test('reports unparsable files with the file name', async () => {
  await assert.rejects(
    loadConfig(createFakeClient({ configText: 'not a map' }), 'broken.yml'),
    /Cannot parse broken.yml/
  );
});
