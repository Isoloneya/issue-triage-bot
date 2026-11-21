'use strict';

const MS_PER_DAY = 86400000;

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileMatcher(keyword) {
  const value = String(keyword).trim();
  if (value === '' || value === 're:') return () => false;
  if (value.startsWith('re:')) {
    const regex = new RegExp(value.slice(3), 'im');
    return (text) => regex.test(text);
  }
  const regex = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(value)}`, 'iu');
  return (text) => regex.test(text);
}

function anyMatch(text, keywords) {
  return toArray(keywords).some((keyword) => compileMatcher(keyword)(text));
}

function normalizeText(...parts) {
  return parts
    .filter((part) => typeof part === 'string')
    .join('\n')
    .toLowerCase()
    .replace(/^#{1,6}[^\n]*\n+_no response_\s*$/gm, '');
}

function suggestLabels(item, labelRules, existingLabels) {
  const text = normalizeText(item.title, item.body);
  const existing = new Set(existingLabels.map((label) => label.toLowerCase()));
  return Object.keys(labelRules).filter(
    (label) => !existing.has(label.toLowerCase()) && anyMatch(text, labelRules[label])
  );
}

function findMissingRequirements(item, requirements) {
  const text = normalizeText(item.title, item.body);
  return Object.entries(requirements)
    .filter(([, requirement]) => requirement && toArray(requirement.match).length > 0)
    .filter(([, requirement]) => !anyMatch(text, requirement.match))
    .map(([name, requirement]) => requirement.description || name);
}

function formatList(items) {
  return items.map((item) => `- ${item}`).join('\n');
}

function renderTemplate(template, variables) {
  return String(template)
    .replace(/\{(\w+)\}/g, (whole, key) => (key in variables ? String(variables[key]) : whole))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function daysBetween(from, to) {
  return (new Date(to).getTime() - new Date(from).getTime()) / MS_PER_DAY;
}

function staleDecision({ days, hasStaleLabel, remindAfterDays, closeAfterDays }) {
  if (days >= closeAfterDays) return 'close';
  if (days >= remindAfterDays && !hasStaleLabel) return 'remind';
  return 'wait';
}

function isBot(user) {
  if (!user) return false;
  return user.type === 'Bot' || String(user.login || '').endsWith('[bot]');
}

module.exports = {
  toArray,
  compileMatcher,
  anyMatch,
  normalizeText,
  suggestLabels,
  findMissingRequirements,
  formatList,
  renderTemplate,
  daysBetween,
  staleDecision,
  isBot
};
