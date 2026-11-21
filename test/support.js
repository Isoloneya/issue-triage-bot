'use strict';

const { loadConfig } = require('../src/config');

const NOW = new Date('2026-11-21T12:00:00Z');

function daysAgo(days) {
  return new Date(NOW.getTime() - days * 86400000).toISOString();
}

function createFakeClient(state = {}) {
  const calls = [];
  return {
    calls,
    async getFileContent() {
      return state.configText === undefined ? null : state.configText;
    },
    async isFirstContribution() {
      return Boolean(state.firstContribution);
    },
    async findContributingUrl() {
      return state.contributingUrl || null;
    },
    async listOpenIssuesWithLabel() {
      return state.issues || [];
    },
    async listIssueEvents(number) {
      return (state.events || {})[number] || [];
    },
    async addLabels(number, labels) {
      calls.push(['addLabels', number, labels]);
    },
    async removeLabel(number, label) {
      calls.push(['removeLabel', number, label]);
    },
    async createComment(number, body) {
      calls.push(['createComment', number, body]);
    },
    async closeIssue(number, reason) {
      calls.push(['closeIssue', number, reason]);
    },
    async ensureLabel(name) {
      calls.push(['ensureLabel', name]);
    }
  };
}

function callsOf(client, name) {
  return client.calls.filter((call) => call[0] === name);
}

function makeIssue(overrides = {}) {
  return {
    number: 1,
    title: 'Something',
    body: '',
    state: 'open',
    labels: [],
    user: { login: 'alice', type: 'User' },
    author_association: 'NONE',
    updated_at: daysAgo(1),
    ...overrides
  };
}

async function makeContext(client, payload) {
  const config = await loadConfig(client, '.github/triage-bot.yml');
  return { client, config, payload, log() {} };
}

module.exports = { NOW, daysAgo, createFakeClient, callsOf, makeIssue, makeContext };
