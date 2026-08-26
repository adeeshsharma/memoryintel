Memory Intel is a persistent, cross-session project-memory tool for AI coding agents (Claude
Code, Cursor, Codex, Gemini CLI). A person sets it up once per project by asking an agent to
("set up persistent memory here" - the memory-intel skill runs `memoryintel init`); after that,
agents load `.memoryintel/` context automatically at session start and update it on their own
judgment when something meaningful changes.

The CLI core (init/load/update/status/check-stop/dashboard) is fully built and tested (207 tests
passing). Real usage has gone through five passes on distilled-docs plus a genuine live-hook
verification and, now, a full `git-to-release` audit that finally ran this project's own test
suite on Windows for the first time ever - and found three real, previously-invisible bugs on
the very first run, all now fixed: `assertSafePath`'s containment check hardcoded a forward
slash (`resolved.startsWith(resolvedRoot + '/')`), which fails unconditionally on Windows since
`path.resolve()` returns backslash paths there - `memoryintel update` was completely broken on
Windows, rejecting every legitimate write; the compression git-clean check built its comparison
path with the OS-native `path.join` and compared it against git's always-forward-slash porcelain
output, so every file looked permanently clean on Windows, silently accepting compression on
dirty files (the inverse failure mode of the first bug); and a test added this session hardcoded
`/bin/sh`, which doesn't exist on `windows-latest`. All three fixed with cross-platform-safe
patterns (`path.relative`, `path.posix.join`, `spawnSync`'s own `input` option), verified by the
same CI matrix that caught them - all three OS jobs (ubuntu/windows/macos) are green.

Repo is now public with: LICENSE (MIT), a real CONTRIBUTING.md (explicitly open to outside
contributions, not the "not accepting PRs" default - the user's explicit choice), CI required via
branch protection on `master` (0 required reviewers, single-maintainer project), `.editorconfig`/
`.gitattributes`, and `author`/`keywords` filled in `package.json`. README documents a real,
working `npx skills add adeeshsharma/memory-intel --skill memory-intel` install path (verified
live - pulls from GitHub directly, independent of npm publish status), clearly distinguished from
the still-blocked `npm install -g` path.

What's still genuinely not done: never published to the npm registry - not logged into npm on
this machine, and publishing is treated as an explicit, in-the-moment decision, not something to
do unprompted, same discipline as `docmanager reset`/SSH key generation in sibling projects. The
dashboard has no real file-hierarchy view, `research/*`/`objectives.md` scaffolding doesn't flex
to project type, pointer-file tools (cursor/agents-md/gemini) show as 'wired' with no equivalent
'actually used' signal claude-code now has, and a devDependency-only npm audit finding
(esbuild/vite/vitest chain) is deferred - dev-server-only, never ships to consumers. See
`context/activeContext.md` for the immediate focus and `business/roadmap.md` for next steps.