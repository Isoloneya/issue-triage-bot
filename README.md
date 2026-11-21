# Issue Triage Bot

A GitHub Action with zero dependencies that keeps an issue tracker tidy.

- **Auto-labeling.** New issues get `bug`, `enhancement` or `question` based on keywords in the title and body.
- **Bug report checks.** Bug reports without reproduction steps or environment details get a polite request and the `needs-info` label.
- **Welcome messages.** First-time issue and pull request authors get a short greeting with a link to `CONTRIBUTING.md`.
- **Stale cleanup.** Issues waiting for information get a reminder after 14 days and are closed after 30.
- **Self-clearing.** When the author replies or edits the issue with the missing details, `needs-info` is removed automatically.

## Quick start

Create `.github/workflows/triage.yml`:

```yaml
name: Issue triage

on:
  issues:
    types: [opened, edited]
  issue_comment:
    types: [created]
  pull_request_target:
    types: [opened]
  schedule:
    - cron: '17 6 * * *'
  workflow_dispatch:

permissions:
  contents: read
  issues: write
  pull-requests: write

jobs:
  triage:
    runs-on: ubuntu-latest
    steps:
      - uses: your-username/issue-triage-bot@v1
```

That is all. The defaults work out of the box. To customize behavior, add `.github/triage-bot.yml`. A complete example lives in [`examples/triage-bot.yml`](examples/triage-bot.yml).

## What runs on which event

| Event | Behavior |
| --- | --- |
| `issues` opened | Applies labels, checks bug reports for missing details, welcomes first-time authors |
| `issues` edited | Removes `needs-info` once a bug report contains the required details |
| `issue_comment` created | Removes `needs-info` and `stale` when the issue author replies |
| `pull_request_target` opened | Welcomes first-time contributors |
| `schedule`, `workflow_dispatch` | Reminds and closes issues that stay labeled `needs-info` |

The action never checks out or executes pull request code. It reads the configuration through the API from the default branch.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `token` | `${{ github.token }}` | Token with issues and pull-requests write access |
| `config-path` | `.github/triage-bot.yml` | Location of the configuration file |
| `dry-run` | `false` | Log planned actions instead of performing them |

## Configuration

Every key is optional. Maps are merged with the defaults, lists replace them.

| Key | Default | Description |
| --- | --- | --- |
| `needsInfoLabel` | `needs-info` | Label for issues waiting on the author |
| `staleLabel` | `stale` | Label added with the reminder |
| `labels` | `bug`, `enhancement`, `question` | Map of label name to keyword list. An empty list disables a rule |
| `autoLabel.enabled` | `true` | Turn keyword labeling on or off |
| `autoLabel.onlyIfUnlabeled` | `true` | Skip labeling when the issue already has labels, for example from an issue form |
| `bugReport.enabled` | `true` | Turn bug report checks on or off |
| `bugReport.label` | `bug` | Issues with this label are checked |
| `bugReport.clearOnAuthorReply` | `true` | Remove `needs-info` when the author comments |
| `bugReport.requirements` | `steps`, `environment` | Map of requirement name to `description` and `match` keywords. An empty `match` disables a requirement |
| `bugReport.message` | see defaults | Template. Variables: `{author}`, `{missing}`, `{needsInfoLabel}` |
| `welcome.enabled` | `true` | Turn welcome messages on or off |
| `welcome.issueMessage` | see defaults | Template. Variables: `{author}`, `{contributing}` |
| `welcome.pullRequestMessage` | see defaults | Template. Variables: `{author}`, `{contributing}` |
| `welcome.contributingText` | see defaults | Sentence used for `{contributing}`. Variable: `{url}` |
| `stale.enabled` | `true` | Turn the stale sweep on or off |
| `stale.remindAfterDays` | `14` | Days after `needs-info` was applied before the reminder |
| `stale.closeAfterDays` | `30` | Days after `needs-info` was applied before the issue is closed |
| `stale.closeReason` | `not_planned` | `completed` or `not_planned` |
| `stale.remindMessage` | see defaults | Template. Variables: `{author}`, `{days}`, `{daysLeft}`, `{label}` |
| `stale.closeMessage` | see defaults | Template. Variables: `{author}`, `{days}`, `{label}` |

### Keyword matching

- Plain keywords are case-insensitive and match from the start of a word, so `crash` matches `crashes` but `error` does not match `terror`.
- A keyword starting with `re:` is a regular expression, for example `'re:\bv?\d+\.\d+'`. Quote it in YAML.
- Sections of issue forms that contain `_No response_` are ignored.

### Supported YAML

The built-in parser supports maps, block lists, inline lists, quoted strings, numbers, booleans, comments and `|` block scalars. Anchors, tags and lists of maps are not supported.

## How the stale clock works

The clock starts when `needs-info` was last applied. After `remindAfterDays` the bot comments once and adds `stale`. After `closeAfterDays` it comments and closes the issue. If the author replies or fixes the report, both labels are removed and the clock is gone.

## Dry run

```yaml
- uses: your-username/issue-triage-bot@v1
  with:
    dry-run: true
```

The job log lists every label, comment and close the bot would have performed.

## Development

```
npm test
```

Requires Node.js 20 or newer. There are no dependencies to install.

## Support

Questions and bug reports: open an issue in this repository.

## License

MIT
