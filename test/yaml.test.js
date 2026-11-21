'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseYaml } = require('../src/yaml');

test('parses nested maps, scalars and lists', () => {
  const text = [
    'needsInfoLabel: needs-info',
    'stale:',
    '  enabled: true',
    '  remindAfterDays: 7',
    '  note: ~',
    'labels:',
    '  bug: [crash, "doesn\'t work", error]',
    '  question:',
    '    - how to',
    '    - is it possible',
    '  empty: []'
  ].join('\n');

  assert.deepEqual(parseYaml(text), {
    needsInfoLabel: 'needs-info',
    stale: { enabled: true, remindAfterDays: 7, note: null },
    labels: {
      bug: ['crash', "doesn't work", 'error'],
      question: ['how to', 'is it possible'],
      empty: []
    }
  });
});

test('supports lists at the same indent as their key', () => {
  assert.deepEqual(parseYaml('labels:\n  bug:\n  - crash\n  - error\n'), {
    labels: { bug: ['crash', 'error'] }
  });
});

test('strips comments but keeps hashes inside quotes', () => {
  const text = 'a: value # trailing\nb: "issue #12"\n# full line\nc: \'x # y\'\n';
  assert.deepEqual(parseYaml(text), { a: 'value', b: 'issue #12', c: 'x # y' });
});

test('handles quoted strings with escapes', () => {
  assert.deepEqual(parseYaml('m: "line one\\nline two"\nn: \'it\'\'s\''), {
    m: 'line one\nline two',
    n: "it's"
  });
});

test('handles block scalars', () => {
  const text = ['message: |', '  Hello @{author}', '', '  Please add details.', 'next: 1'].join('\n');
  assert.deepEqual(parseYaml(text), {
    message: 'Hello @{author}\n\nPlease add details.',
    next: 1
  });
});

test('keeps regular expressions in plain scalars intact', () => {
  assert.deepEqual(parseYaml("match: ['re:^\\s*1[.)]\\s', 're:\\bv?\\d+']"), {
    match: ['re:^\\s*1[.)]\\s', 're:\\bv?\\d+']
  });
});

test('returns an empty object for empty input', () => {
  assert.deepEqual(parseYaml(''), {});
  assert.deepEqual(parseYaml('# only a comment\n'), {});
});

test('throws on malformed input', () => {
  assert.throws(() => parseYaml('just a line'), /Expected "key: value"/);
  assert.throws(() => parseYaml('a: 1\n  b: 2'), /Unexpected content/);
});
