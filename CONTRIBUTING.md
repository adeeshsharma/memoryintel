# Contributing

Thanks for considering a contribution to Memory Intel. This is a small, single-maintainer
project, but issues and pull requests are genuinely welcome.

## Before you start

For anything beyond a small fix (a typo, a one-line bug fix), open an issue first describing what
you want to change and why — it's much easier to agree on an approach before code exists than to
rework a finished PR.

## Development setup

```bash
git clone https://github.com/adeeshsharma/memoryintel.git
cd memoryintel
npm install
npm run build   # compiles dist/, regenerates skills/memoryintel/SKILL.md from src/skill.ts
npm test        # 207 tests, vitest
```

See `README.md`'s "Get started locally" section for linking the CLI and pointing a Claude Code
session at the plugin locally via `--plugin-dir`.

## Making a change

- Never hand-edit `skills/memoryintel/SKILL.md` — it's generated from `src/skill.ts`. Run
  `npm run build:skill` after changing the source, and `npm run build:skill:check` to verify
  there's no drift before committing (CI enforces this).
- Add or update tests for any behavior change — `npm test` must pass before opening a PR. CI runs
  the full suite on Ubuntu, Windows, and macOS.
- Keep changes focused. A bug fix doesn't need an accompanying refactor; a new feature doesn't
  need to solve problems outside its scope.

## Submitting a PR

Open the PR against `master`. CI must pass. Describe what changed and why — the "why" matters more
than a restatement of the diff.

## Reporting a bug

Open an issue with: what you expected, what actually happened, and how to reproduce it (a `git
status`/`memoryintel status` snippet if it's dashboard- or state-related is usually more useful
than a description alone).
