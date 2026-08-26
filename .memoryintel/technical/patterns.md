## Design Patterns

- **Deterministic heading-addressed writing.** Reject-with-fuzzy-suggestion beats guessing —
  an unrecognized heading name in an update-plan row fails loudly rather than being written
  somewhere approximate.
- **Atomic writes + file lock.** Every `update()` call is all-or-nothing: two-phase
  validate-then-write, temp-file + rename per file, a single `.lock` for the whole call.
- **Git-as-the-only-archive.** Self-compression never duplicates cut content into a second file —
  git history is the sole record of what a compacted section used to say.
- **Agent-judgment gates, not mechanical rules, wherever the decision is genuinely subjective.**
  Classification ("was this worth remembering") and compaction ("what's safe to cut") are both
  documented in `instructions.md` as guidance, not encoded as code-level heuristics.

## Anti-Patterns

- **No per-project `.claude/settings.json` mutation.** `init` never writes into a project's own
  Claude Code config — see the "Plugin-level hooks" decision in `context/decisions.md`.
- **No slash commands.** A person is never expected to remember or type a memory-intel-specific
  command — the skill matches natural language instead.
- **No LLM-mediated writer.** Letting an LLM freely rewrite memory files would reintroduce the
  drift problem the deterministic section writer exists specifically to eliminate.
- **No forced or automatic compression.** `load()`'s `status: over` is always a signal an agent
  chooses to act on, never an action taken without that judgment.
