'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../src/rules');
const { DEFAULTS } = require('../src/config');

test('suggests labels by keyword', () => {
  const labels = (title, body = '') => rules.suggestLabels({ title, body }, DEFAULTS.labels, []);
  assert.deepEqual(labels('App crashes on start'), ['bug']);
  assert.deepEqual(labels('How to configure the bot?'), ['question']);
  assert.deepEqual(labels('Feature request: dark mode'), ['enhancement']);
  assert.deepEqual(labels('Hello', null), []);
});

test('matches keywords from the start of a word only', () => {
  assert.deepEqual(rules.suggestLabels({ title: 'Terror of the seas', body: '' }, DEFAULTS.labels, []), []);
});

test('skips labels the item already has', () => {
  assert.deepEqual(
    rules.suggestLabels({ title: 'It crashes', body: '' }, DEFAULTS.labels, ['Bug']),
    []
  );
});

test('supports regular expression keywords', () => {
  const labelRules = { docs: ['re:\\btypos?\\b'] };
  assert.deepEqual(rules.suggestLabels({ title: 'Fix a typo in README', body: '' }, labelRules, []), ['docs']);
  assert.deepEqual(rules.suggestLabels({ title: 'Prototype', body: '' }, labelRules, []), []);
});

test('ignores empty keywords and empty lists', () => {
  const labelRules = { a: [''], b: [], c: 're:' };
  assert.deepEqual(rules.suggestLabels({ title: 'anything', body: 'at all' }, labelRules, []), []);
});

test('reports missing requirements', () => {
  const requirements = DEFAULTS.bugReport.requirements;
  assert.equal(rules.findMissingRequirements({ title: 'Crash', body: '' }, requirements).length, 2);
  assert.deepEqual(
    rules.findMissingRequirements(
      { title: 'Crash when saving', body: 'Steps to reproduce:\n1. Open the app\n\nVersion: 1.4.2 on Ubuntu' },
      requirements
    ),
    []
  );
});

test('treats empty issue form sections as missing', () => {
  const body = '### Steps to reproduce\n\n_No response_\n\n### Version\n\nv2.1.0';
  assert.deepEqual(
    rules.findMissingRequirements({ title: 'Crash', body }, DEFAULTS.bugReport.requirements),
    ['Steps to reproduce the problem']
  );
});

test('disables a requirement with an empty match list', () => {
  const requirements = { steps: { description: 'Steps', match: [] } };
  assert.deepEqual(rules.findMissingRequirements({ title: 'x', body: 'y' }, requirements), []);
});

test('renders templates', () => {
  assert.equal(
    rules.renderTemplate('Hi {name}!\n\n\n\n{x}\n{unknown}', { name: 'Bob', x: '' }),
    'Hi Bob!\n\n{unknown}'
  );
  assert.equal(rules.formatList(['a', 'b']), '- a\n- b');
});

test('computes day differences', () => {
  assert.equal(rules.daysBetween('2026-11-01T00:00:00Z', '2026-11-11T12:00:00Z'), 10.5);
});

test('decides what to do with stale issues', () => {
  const base = { remindAfterDays: 14, closeAfterDays: 30 };
  assert.equal(rules.staleDecision({ ...base, days: 5, hasStaleLabel: false }), 'wait');
  assert.equal(rules.staleDecision({ ...base, days: 14, hasStaleLabel: false }), 'remind');
  assert.equal(rules.staleDecision({ ...base, days: 20, hasStaleLabel: true }), 'wait');
  assert.equal(rules.staleDecision({ ...base, days: 30, hasStaleLabel: true }), 'close');
  assert.equal(rules.staleDecision({ ...base, days: 45, hasStaleLabel: false }), 'close');
});

test('detects bots', () => {
  assert.equal(rules.isBot({ login: 'dependabot[bot]', type: 'Bot' }), true);
  assert.equal(rules.isBot({ login: 'some-app[bot]', type: 'User' }), true);
  assert.equal(rules.isBot({ login: 'alice', type: 'User' }), false);
  assert.equal(rules.isBot(null), false);
});
