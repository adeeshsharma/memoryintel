## Decisions Log

- **Skill-triggered, not slash-command-triggered.** A person never types a memory-intel-specific
  command; the skill matches natural-language intent ("set up persistent memory"), following the
  same pattern as `graphify`. A `/memory-intel init` slash command was considered and dropped —
  see `docs/superpowers/specs/2026-08-21-skill-and-readme-design.md`.

- **Plugin-level hooks (`hooks/hooks.json`), never per-project `.claude/settings.json`
  mutation.** `init` never writes into a project's own Claude Code config. Automation comes from
  installing the memory-intel plugin once, which then applies to every project with a
  `.memoryintel/` — see `docs/superpowers/specs/2026-08-21-plugin-level-hooks-design.md`.

- **TOON (Token-Oriented Object Notation) as the LLM↔CLI boundary** for `update`'s plan rows;
  plain JSON/JSONL for on-disk storage (`memory-index.json`, `memory-events.jsonl`).

- **Deterministic, heading-addressed markdown writing** (append/replace/create-section) instead
  of an LLM-mediated writer — rejects an unrecognized heading with a fuzzy suggestion rather than
  guessing, to keep drift near zero.

- **Agent-owned classification.** Whether a change is "worth remembering" is the same reasoning
  already producing the response, not a second extraction-model call (unlike Mem0's/claude-mem's
  background summarization).

- **Live-diff Stop-hook nudge, not a session-end-only reminder.** Blocks once per genuinely new
  unresolved git diff; never re-nags on a diff it already flagged and the agent chose not to act
  on. See `docs/superpowers/specs/2026-08-21-check-stop-live-diff-design.md`.

- **Self-compression is agent-judgment-gated, not automatic.** `load()` surfaces `status: over`
  per file against a configurable char ceiling (line-count until 2026-09-06 — see the char-based
  ceiling entry below); the agent decides whether to compact, via `kind: compress` update rows
  gated on the target file being git-clean first. Git is the sole archive — no second archive file
  inside `.memoryintel/`. See `docs/superpowers/specs/2026-08-21-memory-self-compression-design.md`.

- **V2 (semantic retrieval) / V3 (knowledge graph) / V4 (MCP server) roadmap items dropped
  entirely, not deferred.** None are needed for the tool's actual purpose (agents not restarting
  from scratch each session) — see `prd.md`'s "Future roadmap" section.

- **The web dashboard is read-only and a single global switch** — one shared dashboard for every
  Memory-Intel project on the machine, not a per-project toggle.
**Reaffirmed: semantic retrieval / knowledge graph (old V2/V3) stays permanently dropped, not just deferred.** Deleted the dead `.memoryintel/intelligence/{entities,metadata,relationships}.json` scaffolding from this repo itself — confirmed nothing in the codebase writes or reads them (`update`'s WRITABLE_FILES never included that path) and they sat at literal `{}` for this project's entire build. User explicitly ruled this direction out during a brownfield-vs-greenfield roadmap discussion, alongside SQLite-for-core-memory and chasing broad agent-tool coverage before the flagship experience is solid — see git history around the `memoryintel import` feature for what got prioritized instead.
**Added `memoryintel import` for brownfield onboarding.** New command, `src/commands/import.ts` + CLI wiring in `cli.ts`'s async `main()` (same special-case pattern as `update`, since it's async and root-dependent — not a plain `dispatch()` case). Pulls `memory-bank/` (Cline/Roo/Kilo-Code convention), `ARCHITECTURE.md`, and `README.md`'s lede verbatim into mapped `.memoryintel/` sections via the existing `runUpdate` pipeline (reused wholesale — locking, dedup, event log, registry, all for free). Deliberately does zero summarizing or re-splitting: each import is tagged as raw, unfiled source material for the next real judgment-driven update, not finished memory. This was an explicit product decision after a roadmap brainstorm: greenfield `init` was solved, brownfield onboarding was the actual open gap, prioritized above SQLite-for-core-memory and semantic-retrieval ideas, both of which were explicitly ruled out in the same conversation.
**Added `memoryintel scan` - read-only, no-LLM codebase digest for the real brownfield case.** User's own correction to `import`: someone with `memory-bank/` already has organized memory and wouldn't need memoryintel as much - the actual common case is a project with neither `memory-bank/` nor `ARCHITECTURE.md`, just code, where reading a README isn't a real solution. `scan` (`src/core/repoScan.ts` + `src/commands/scan.ts`) never writes anything, just prints: detected stack (package.json/pyproject.toml/go.mod/Cargo.toml, regex-based, no new parser dependency added), git churn ranking (`runGitChurn` in gitPorcelain.ts, capped at last 1000 commits), a local import-graph in-degree ranking for JS/TS/Python only (files imported by the most other files = cheap proxy for architecturally central, no file content is actually read for meaning), and other markdown/HTML docs found in the tree (excluding README.md/ARCHITECTURE.md, already covered by `import`). Found and fixed two real bugs by dogfooding on this repo before shipping: the JS/TS import resolver initially missed TypeScript's own NodeNext/ESM convention of a `.js` specifier pointing at a real `.ts` file (would have returned zero hits on this project's own codebase); `.memoryintel/` itself was leaking into doc-discovery and churn output as if it were source material, now excluded via `IGNORED_DIRS`. Considered and explicitly rejected: shelling out to the user's own `graphify` CLI (real no-LLM code-graph extractor) instead of writing this - would make memoryintel depend on an external tool almost none of its actual users have installed, wrong tradeoff for what's meant to stay a self-contained, quick, dependency-free scan.
Reworked scan and import after two rounds of user feedback, landing on a much narrower and more honest split than the first cut shipped this cycle.

Round 1 objection: scan's import-graph/git-churn ranking only covered JS/TS/Python and depended on git history existing at all - neither holds for a local research project with no git and no code, just notes/data. Considered generalizing via git co-change coupling (fully language-agnostic, no per-language grammar needed) but that still assumes git history exists.

Round 2 objection, the one that actually resolved this: trying to mechanically infer architecture at all - via import graphs, churn, co-change, or cross-file keyword frequency - was fighting the fact that real understanding is a judgment task. This project already has a mechanism for judgment: the agent's own accumulated update calls as it actually works in the repo, exactly like it already works for a greenfield project. scan and import don't need to solve "understand this codebase" - that's not their job. Their only job is to stop session one from flailing.

Landed design: scan is now stack + a one-level-deep directory listing, nothing else - no import graph, no git churn, no keyword extraction, no doc discovery. import walks the whole repo for any real .md/.html document (not a fixed memory-bank/-style filename table) and routes each one to a .memoryintel/ section by keyword-matching its filename/title against an ordered table - a strict generalization of the old hardcoded mapping, since memory-bank's own filenames (productContext.md, systemPatterns.md, etc.) match the same keywords for free. An HTML file only counts as a document if it has real prose and no SPA-shell markers (mount div + bundle script) - index.html for a real app must never be mistaken for documentation. memoryintel's own AGENTS.md/GEMINI.md pointer-block boilerplate is stripped before a file is judged a document, and a file reduced to nothing but a heading after that strip is correctly treated as empty, not imported as if it described the project.

Deleted rather than kept as a fallback: buildImportGraph, resolveJsImport, resolvePyImport, runGitChurn, and their tests - all real working code from earlier this cycle, removed because it no longer has a caller, not because it was buggy. Consistent with this project's own stated aversion to dead scaffolding (the intelligence/*.json precedent from earlier this cycle).

- **`load()` auto-carries the last-touched domain forward, instead of only surfacing it as an
  index.** A heading-only "Other memory available" index (added first) turned out to be a nudge,
  not a guarantee — real usage on `docmanager-axi` showed 0 of 4 real `session-load` events ever
  requested a domain, despite domain files having been written to. `load()` now reads
  `memory-events.jsonl` for the most recent `memory-update` and auto-includes whichever domain it
  touched when no explicit `--domain` is given (which is all the `SessionStart` hook ever passes);
  an explicit `--domain` still overrides. Verified end-to-end against the built CLI, not just unit
  tests: writing to a domain file then running the exact bare `load` the hook runs surfaces the
  real new content and logs `domainSource: "auto"`. See PR #12.

- **Compression ceiling measured in chars, not lines.** Two files of equal line count can cost
  very different amounts of real context; `totalChars` was already being computed anyway.
  `update()` also now flags a file that crosses its ceiling in the same call that pushed it over
  (`overCeiling`, printed by the CLI as "Over ceiling: ..."), instead of only surfacing it
  passively on the next `load()`. See PR #12.

- **`isNearDuplicate` gained a token-overlap check on top of its literal-substring check.** Catches
  a reworded or reordered restatement of a fact already in memory, not just a verbatim repeat —
  the previous check would let the same fact re-enter memory in slightly different words each
  session. Has a length floor (fewer than 3 meaningful words skips the fuzzy check) so short
  additions don't false-positive. See PR #12.

- **`update()` locks only the files a given plan actually touches, not the whole project.**
  Replaced the single project-wide `.lock` with `withLocks()` (sorted acquisition order across
  every caller, to rule out deadlock) — two `update()` calls on disjoint files now run
  concurrently instead of serializing on each other. The now-fully-delegating single-lock
  `withLock` wrapper was deleted afterward (zero production callers left) via a ponytail-audit
  pass. See PR #12.

- **Ponytail-audit: dropped the `.claude/settings.json` fallback in `detectToolsWired`.** The
  function's own prior comment already admitted this path could never fire for any project using
  the documented plugin-based setup (confirmed on `distilled-docs`); `.session-marker.json`
  (real evidence the Stop hook has fired) was already the only signal that ever actually mattered.
  See PR #12.
