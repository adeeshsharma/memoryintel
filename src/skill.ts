import { USAGE } from './cli.js';

export function createSkillMarkdown(): string {
  return `---
name: memoryintel
description: Give an AI coding agent persistent, cross-session project memory. Use when the user asks to set up persistent project memory, or when the current project already contains a .memoryintel/ directory.
---

# Memory Intel

Memory Intel gives an AI coding agent durable, cross-session understanding of a project —
architecture, decisions, progress, and a running "mental model" — that survives new chats, new
agent sessions, and switching tools entirely (Claude Code, Cursor, Codex, Gemini CLI).

## First time in this project? (no \`.memoryintel/\` yet)

If the user asks to set up persistent project memory, run:

    npx -y memoryintel init

This is a one-time step. It scaffolds \`.memoryintel/\` and installs pointer files for tools without
native hook support (Cursor, Codex, Gemini CLI, opencode) — safe to re-run later, it never
overwrites existing content. Claude Code automation doesn't come from this command at all: it comes
from the memoryintel plugin's own bundled hooks, active globally for every project once the plugin
itself is installed — \`init\` never touches \`.claude/settings.json\`.

## Already initialized? (\`.memoryintel/\` exists)

Read \`.memoryintel/instructions.md\` first — it is the authoritative, per-project guide. In short:

- At the start of a session: run \`memoryintel load [--domain technical|business|research]\` and
  treat the output as project context.
- At the end of a session, only if your work changed real project understanding (new architecture,
  decision, feature, integration, or roadmap item — never for formatting/typos): draft an
  update-plan and run \`memoryintel update\`.
- If the user asks to turn the dashboard on or off: \`memoryintel dashboard enable\` /
  \`memoryintel dashboard disable\`.

## Command reference

${USAGE}
## Sandboxed environments

If \`npx\`/a global \`memoryintel\` install aren't directly runnable, fall back to invoking the
package's built CLI directly: \`node "$(npm root -g)/memoryintel/dist/cli.js" <command>\`.
`;
}
