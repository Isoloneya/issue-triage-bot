'use strict';

const MAX_PAGES = 20;

class ApiError extends Error {
  constructor(status, method, path, detail) {
    super(`${method} ${path} failed with status ${status}${detail ? `: ${detail}` : ''}`);
    this.name = 'ApiError';
    this.status = status;
  }
}

function createClient({
  token,
  owner,
  repo,
  apiUrl = 'https://api.github.com',
  dryRun = false,
  log = () => {},
  fetchImpl = globalThis.fetch
}) {
  const repoPath = `/repos/${owner}/${repo}`;

  async function request(method, path, body) {
    const response = await fetchImpl(`${apiUrl}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'issue-triage-bot',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!response.ok) {
      throw new ApiError(response.status, method, path, data && data.message);
    }
    return { data, response };
  }

  async function paginate(path) {
    const items = [];
    let next = `${path}${path.includes('?') ? '&' : '?'}per_page=100`;
    for (let page = 0; next && page < MAX_PAGES; page++) {
      const { data, response } = await request('GET', next);
      items.push(...data);
      const link = (response.headers && response.headers.get('link')) || '';
      const match = /<([^>]+)>;\s*rel="next"/.exec(link);
      next = match ? match[1].replace(apiUrl, '') : null;
    }
    return items;
  }

  async function ignoreStatus(statuses, action) {
    try {
      return await action();
    } catch (error) {
      if (error instanceof ApiError && statuses.includes(error.status)) return null;
      throw error;
    }
  }

  async function mutate(description, action) {
    if (dryRun) {
      log(`[dry-run] ${description}`);
      return null;
    }
    return action();
  }

  async function getContents(path) {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const result = await ignoreStatus([404], () => request('GET', `${repoPath}/contents/${encoded}`));
    return result ? result.data : null;
  }

  return {
    async getFileContent(path) {
      const data = await getContents(path);
      if (!data || Array.isArray(data) || data.encoding !== 'base64') return null;
      return Buffer.from(data.content, 'base64').toString('utf8');
    },

    async findContributingUrl() {
      for (const path of ['CONTRIBUTING.md', '.github/CONTRIBUTING.md', 'docs/CONTRIBUTING.md']) {
        const data = await getContents(path);
        if (data && !Array.isArray(data) && data.html_url) return data.html_url;
      }
      return null;
    },

    async isFirstContribution(login) {
      const query = encodeURIComponent(`repo:${owner}/${repo} author:${login}`);
      const { data } = await request('GET', `/search/issues?q=${query}&per_page=1`);
      return data.total_count <= 1;
    },

    async listOpenIssuesWithLabel(label) {
      const items = await paginate(
        `${repoPath}/issues?state=open&labels=${encodeURIComponent(label)}`
      );
      return items.filter((item) => !item.pull_request);
    },

    listIssueEvents(number) {
      return paginate(`${repoPath}/issues/${number}/events`);
    },

    addLabels(number, labels) {
      return mutate(`add labels [${labels.join(', ')}] to #${number}`, () =>
        request('POST', `${repoPath}/issues/${number}/labels`, { labels })
      );
    },

    removeLabel(number, label) {
      return mutate(`remove label "${label}" from #${number}`, () =>
        ignoreStatus([404], () =>
          request('DELETE', `${repoPath}/issues/${number}/labels/${encodeURIComponent(label)}`)
        )
      );
    },

    createComment(number, body) {
      return mutate(`comment on #${number}: ${body.replace(/\s+/g, ' ').slice(0, 120)}`, () =>
        request('POST', `${repoPath}/issues/${number}/comments`, { body })
      );
    },

    closeIssue(number, reason) {
      return mutate(`close #${number} as ${reason}`, () =>
        request('PATCH', `${repoPath}/issues/${number}`, { state: 'closed', state_reason: reason })
      );
    },

    ensureLabel(name, color, description) {
      return mutate(`ensure label "${name}" exists`, () =>
        ignoreStatus([422], () => request('POST', `${repoPath}/labels`, { name, color, description }))
      );
    }
  };
}

module.exports = { createClient, ApiError };
