## Status
**Built and tested — 177/177 tests passing:** `init`, `load`, `update`, `status`, `check-stop`,
`dashboard enable`/`disable`; the deterministic section writer with dedup/anti-drift safeguards;
the live-diff Stop-hook nudge; cross-tool pointer files (Cursor, Codex/Gemini via `AGENTS.md`/
`GEMINI.md`); the read-only local dashboard; agent-driven self-compression; and, as of this
update, a real GitHub remote (https://github.com/adeeshsharma/memory-intel, public).

**Not yet done — see `business/roadmap.md` for specifics:** never published to npm, no LICENSE
file, and no live verification inside a real Claude Code session — only fixture-based automated
tests and the built binary invoked directly so far.
