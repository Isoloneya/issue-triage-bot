'use strict';

const { parseYaml } = require('./yaml');
const { compileMatcher, toArray } = require('./rules');

const DEFAULTS = {
  needsInfoLabel: 'needs-info',
  staleLabel: 'stale',
  labels: {
    bug: [
      'crash',
      'exception',
      'error',
      'broken',
      'regression',
      'stack trace',
      'not working',
      "doesn't work",
      'does not work',
      'fails'
    ],
    enhancement: [
      'feature request',
      'please add',
      'would be nice',
      'would be great',
      'enhancement',
      'support for',
      'proposal'
    ],
    question: ['how to', 'how do i', 'how can i', 'is it possible', 'question']
  },
  autoLabel: {
    enabled: true,
    onlyIfUnlabeled: true
  },
  bugReport: {
    enabled: true,
    label: 'bug',
    clearOnAuthorReply: true,
    requirements: {
      steps: {
        description: 'Steps to reproduce the problem',
        match: [
          'steps to reproduce',
          'how to reproduce',
          'reproduce',
          'repro',
          'step 1',
          're:^\\s*1[.)]\\s'
        ]
      },
      environment: {
        description: 'Your version and environment (OS, runtime, browser)',
        match: [
          'version',
          'environment',
          'operating system',
          'os:',
          'windows',
          'macos',
          'linux',
          'ubuntu',
          'android',
          'ios',
          'chrome',
          'firefox',
          'safari',
          're:\\bv?\\d+\\.\\d+'
        ]
      }
    },
    message:
      'Thanks for the report, @{author}! To help me investigate, please add the missing details:\n\n{missing}\n\nI added the `{needsInfoLabel}` label. It is removed automatically as soon as you reply.'
  },
  welcome: {
    enabled: true,
    issueMessage:
      'Welcome, @{author}, and thanks for opening your first issue here! {contributing}',
    pullRequestMessage:
      'Welcome, @{author}, and thanks for your first pull request! {contributing}\n\nA maintainer will review it soon.',
    contributingText: 'Please take a look at the [contributing guide]({url}) before you get started.'
  },
  stale: {
    enabled: true,
    remindAfterDays: 14,
    closeAfterDays: 30,
    closeReason: 'not_planned',
    remindMessage:
      'Hi @{author}, this issue has been waiting for more information for {days} days. If it is still relevant, please reply with the details and I will remove the `{label}` label. Otherwise it will be closed automatically in {daysLeft} days.',
    closeMessage:
      'Closing this issue because the requested information was not provided within {days} days. Feel free to reopen it with the missing details.'
  }
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (override === undefined || override === null) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) return override;
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] = key in base ? deepMerge(base[key], value) : value;
  }
  return result;
}

function validateConfig(config) {
  const problems = [];
  const positive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;

  for (const key of ['needsInfoLabel', 'staleLabel']) {
    if (typeof config[key] !== 'string' || config[key].trim() === '') {
      problems.push(`${key} must be a non-empty string`);
    }
  }

  const { remindAfterDays, closeAfterDays, closeReason } = config.stale;
  if (!positive(remindAfterDays)) problems.push('stale.remindAfterDays must be a positive number');
  if (!positive(closeAfterDays)) problems.push('stale.closeAfterDays must be a positive number');
  if (positive(remindAfterDays) && positive(closeAfterDays) && remindAfterDays >= closeAfterDays) {
    problems.push('stale.remindAfterDays must be lower than stale.closeAfterDays');
  }
  if (!['completed', 'not_planned'].includes(closeReason)) {
    problems.push('stale.closeReason must be "completed" or "not_planned"');
  }

  const messages = {
    'bugReport.message': config.bugReport.message,
    'welcome.issueMessage': config.welcome.issueMessage,
    'welcome.pullRequestMessage': config.welcome.pullRequestMessage,
    'welcome.contributingText': config.welcome.contributingText,
    'stale.remindMessage': config.stale.remindMessage,
    'stale.closeMessage': config.stale.closeMessage
  };
  for (const [name, value] of Object.entries(messages)) {
    if (typeof value !== 'string') problems.push(`${name} must be a string`);
  }

  const checkPatterns = (where, patterns) => {
    for (const pattern of toArray(patterns)) {
      try {
        compileMatcher(pattern);
      } catch {
        problems.push(`${where} contains an invalid pattern "${pattern}"`);
      }
    }
  };

  if (!isPlainObject(config.labels)) {
    problems.push('labels must be a map of label names to keyword lists');
  } else {
    for (const [label, keywords] of Object.entries(config.labels)) {
      checkPatterns(`labels.${label}`, keywords);
    }
  }

  if (!isPlainObject(config.bugReport.requirements)) {
    problems.push('bugReport.requirements must be a map');
  } else {
    for (const [name, requirement] of Object.entries(config.bugReport.requirements)) {
      if (!isPlainObject(requirement)) {
        problems.push(`bugReport.requirements.${name} must be a map with "description" and "match"`);
      } else {
        checkPatterns(`bugReport.requirements.${name}.match`, requirement.match);
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`Invalid configuration: ${problems.join('; ')}`);
  }
}

async function loadConfig(client, path) {
  const text = await client.getFileContent(path);
  let parsed = {};
  if (text !== null) {
    try {
      parsed = parseYaml(text);
    } catch (error) {
      throw new Error(`Cannot parse ${path}: ${error.message}`);
    }
    if (!isPlainObject(parsed)) {
      throw new Error(`Cannot parse ${path}: the top level must be a map`);
    }
  }
  const config = deepMerge(DEFAULTS, parsed);
  validateConfig(config);
  return config;
}

module.exports = { DEFAULTS, deepMerge, validateConfig, loadConfig };
