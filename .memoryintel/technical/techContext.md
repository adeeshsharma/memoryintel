## Stack

TypeScript, compiled with `tsc` to plain ESM (`"type": "module"` in `package.json`). Node.js ≥18.
Vitest for tests. No runtime dependencies beyond Node's own built-ins — `dependencies` is empty in
`package.json`; only `typescript`/`vitest`/`@types/node` as devDependencies.

## Conventions

TDD (RED/GREEN/commit), via the `superpowers` skill set — every implementation task in
`docs/superpowers/plans/` writes a failing test first. `npm run build` compiles *and*
regenerates the skill from `src/skill.ts`; never hand-edit `skills/memory-intel/SKILL.md`
directly — it's generated, and `npm run build:skill:check` fails the build if it's out of sync
with the source. Design docs live in `docs/superpowers/specs/`; implementation plans in
`docs/superpowers/plans/`; both precede any non-trivial code change in this repo's own history.

## Environment
\`\`\`bash
npm install
npm run build   # compiles dist/, regenerates skills/memory-intel/SKILL.md
npm test        # 207 tests, vitest
\`\`\`

CI (\`.github/workflows/ci.yml\`) runs the full suite on Ubuntu, Windows, and macOS on every push/PR
to \`master\`, and is required via branch protection - \`npm test\` no longer has to be run by hand
before every commit to catch a broken one before it lands, though still worth doing locally first.
