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
  per file against a configurable line ceiling; the agent decides whether to compact, via
  `kind: compress` update rows gated on the target file being git-clean first. Git is the sole
  archive — no second archive file inside `.memoryintel/`. See
  `docs/superpowers/specs/2026-08-21-memory-self-compression-design.md`.

- **V2 (semantic retrieval) / V3 (knowledge graph) / V4 (MCP server) roadmap items dropped
  entirely, not deferred.** None are needed for the tool's actual purpose (agents not restarting
  from scratch each session) — see `prd.md`'s "Future roadmap" section.

- **The web dashboard is read-only and a single global switch** — one shared dashboard for every
  Memory-Intel project on the machine, not a per-project toggle.
