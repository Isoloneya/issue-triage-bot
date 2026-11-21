'use strict';

const rules = require('./rules');

const NEEDS_INFO_STYLE = {
  color: 'fbca04',
  description: 'Waiting for more information from the author'
};

const STALE_STYLE = {
  color: 'cfd3d7',
  description: 'No response to the information request'
};

function labelNames(item) {
  return (item.labels || []).map((label) => (typeof label === 'string' ? label : label.name));
}

function hasLabel(names, label) {
  return names.some((name) => name.toLowerCase() === label.toLowerCase());
}

function isTeamMember(association) {
  return ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(association);
}

async function buildWelcome(ctx, item, template) {
  const { client, config } = ctx;
  if (!config.welcome.enabled) return null;
  if (!item.user || rules.isBot(item.user) || isTeamMember(item.author_association)) return null;
  if (!(await client.isFirstContribution(item.user.login))) return null;
  const url = await client.findContributingUrl();
  const contributing = url ? rules.renderTemplate(config.welcome.contributingText, { url }) : '';
  return rules.renderTemplate(template, { author: item.user.login, contributing });
}

async function clearWaitingLabels(ctx, number, names) {
  const { client, config } = ctx;
  const removed = [];
  for (const label of [config.needsInfoLabel, config.staleLabel]) {
    if (hasLabel(names, label)) {
      await client.removeLabel(number, label);
      removed.push(label);
    }
  }
  return removed;
}

async function onIssueOpened(ctx) {
  const { client, config, payload } = ctx;
  const issue = payload.issue;
  const empty = { labels: [], commented: false };
  if (!issue || !issue.user || rules.isBot(issue.user)) return empty;

  const existing = labelNames(issue);
  const additions = [];
  const parts = [];

  const { autoLabel, bugReport } = config;
  if (autoLabel.enabled && !(autoLabel.onlyIfUnlabeled && existing.length > 0)) {
    additions.push(...rules.suggestLabels(issue, config.labels, existing));
  }

  const known = [...existing, ...additions];
  if (bugReport.enabled && hasLabel(known, bugReport.label)) {
    const missing = rules.findMissingRequirements(issue, bugReport.requirements);
    if (missing.length > 0) {
      if (!hasLabel(known, config.needsInfoLabel)) additions.push(config.needsInfoLabel);
      parts.push(
        rules.renderTemplate(bugReport.message, {
          author: issue.user.login,
          missing: rules.formatList(missing),
          needsInfoLabel: config.needsInfoLabel
        })
      );
    }
  }

  const welcome = await buildWelcome(ctx, issue, config.welcome.issueMessage);
  if (welcome) parts.unshift(welcome);

  if (hasLabel(additions, config.needsInfoLabel)) {
    await client.ensureLabel(config.needsInfoLabel, NEEDS_INFO_STYLE.color, NEEDS_INFO_STYLE.description);
  }
  if (additions.length > 0) await client.addLabels(issue.number, additions);
  if (parts.length > 0) await client.createComment(issue.number, parts.join('\n\n'));

  return { labels: additions, commented: parts.length > 0 };
}

async function onIssueEdited(ctx) {
  const { config, payload } = ctx;
  const issue = payload.issue;
  const none = { removed: [] };
  if (!issue || !config.bugReport.enabled || rules.isBot(payload.sender)) return none;

  const names = labelNames(issue);
  if (!hasLabel(names, config.needsInfoLabel) || !hasLabel(names, config.bugReport.label)) return none;
  if (rules.findMissingRequirements(issue, config.bugReport.requirements).length > 0) return none;

  return { removed: await clearWaitingLabels(ctx, issue.number, names) };
}

async function onIssueComment(ctx) {
  const { config, payload } = ctx;
  const { issue, comment } = payload;
  const none = { removed: [] };
  if (!issue || !comment || !config.bugReport.clearOnAuthorReply) return none;
  if (issue.pull_request || issue.state !== 'open') return none;
  if (!comment.user || !issue.user || rules.isBot(comment.user)) return none;
  if (comment.user.login !== issue.user.login) return none;

  const names = labelNames(issue);
  if (!hasLabel(names, config.needsInfoLabel)) return none;

  return { removed: await clearWaitingLabels(ctx, issue.number, names) };
}

async function onPullRequestOpened(ctx) {
  const { client, config, payload } = ctx;
  const pullRequest = payload.pull_request;
  if (!pullRequest) return { commented: false };

  const message = await buildWelcome(ctx, pullRequest, config.welcome.pullRequestMessage);
  if (!message) return { commented: false };

  await client.createComment(pullRequest.number, message);
  return { commented: true };
}

function lastLabeledAt(events, label) {
  const times = events
    .filter(
      (event) =>
        event.event === 'labeled' && event.label && event.label.name.toLowerCase() === label.toLowerCase()
    )
    .map((event) => event.created_at)
    .sort();
  return times.length > 0 ? times[times.length - 1] : null;
}

async function sweepStale(ctx, now = new Date()) {
  const { client, config, log } = ctx;
  const result = { reminded: [], closed: [], waiting: [], failed: [] };
  if (!config.stale.enabled) return result;

  const { remindAfterDays, closeAfterDays, closeReason } = config.stale;
  const issues = await client.listOpenIssuesWithLabel(config.needsInfoLabel);

  for (const issue of issues) {
    try {
      const events = await client.listIssueEvents(issue.number);
      const since = lastLabeledAt(events, config.needsInfoLabel) || issue.updated_at;
      const days = rules.daysBetween(since, now);
      const decision = rules.staleDecision({
        days,
        hasStaleLabel: hasLabel(labelNames(issue), config.staleLabel),
        remindAfterDays,
        closeAfterDays
      });
      const variables = {
        author: issue.user ? issue.user.login : 'there',
        days: Math.floor(days),
        daysLeft: Math.max(1, Math.ceil(closeAfterDays - days)),
        label: config.needsInfoLabel
      };

      if (decision === 'close') {
        await client.createComment(issue.number, rules.renderTemplate(config.stale.closeMessage, variables));
        await client.closeIssue(issue.number, closeReason);
        result.closed.push(issue.number);
      } else if (decision === 'remind') {
        await client.createComment(issue.number, rules.renderTemplate(config.stale.remindMessage, variables));
        await client.ensureLabel(config.staleLabel, STALE_STYLE.color, STALE_STYLE.description);
        await client.addLabels(issue.number, [config.staleLabel]);
        result.reminded.push(issue.number);
      } else {
        result.waiting.push(issue.number);
      }
    } catch (error) {
      result.failed.push(issue.number);
      log(`::warning::Issue #${issue.number}: ${error.message}`);
    }
  }

  return result;
}

module.exports = {
  onIssueOpened,
  onIssueEdited,
  onIssueComment,
  onPullRequestOpened,
  sweepStale
};
