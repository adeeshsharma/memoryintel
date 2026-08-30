import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const START_MARKER = '<!-- memoryintel:managed:start -->';
const END_MARKER = '<!-- memoryintel:managed:end -->';

const POINTER_BLOCK = `${START_MARKER}
This project uses Memory Intel (\`.memoryintel/\`) for persistent, cross-session project memory.
Read \`.memoryintel/instructions.md\` for the full mechanism. Two hard requirements, not optional
background context:

1. **Session start:** run \`memoryintel load\` before doing anything else and treat its output as
   real project context, not a formality to skip past.
2. **Before ending any task that changed project understanding** (new architecture, feature,
   decision, integration, or roadmap item — not formatting/typos): draft an update-plan and run
   \`memoryintel update <plan-file>\`. This applies even in a long session covering many sub-tasks —
   that is exactly when it is easiest to reach the end and have forgotten this step was ever
   pending. If nothing meaningful changed, skip it; do not skip it just because the task grew long.

Tell the user when you do this — do not do it silently.
${END_MARKER}`;

function upsertPointerBlock(filePath: string, existingContentIfNew: string): void {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `${existingContentIfNew}${POINTER_BLOCK}\n`);
    return;
  }

  const content = readFileSync(filePath, 'utf-8');
  if (content.includes(START_MARKER)) return; // already installed, idempotent no-op

  const separator = content.endsWith('\n') ? '\n' : '\n\n';
  writeFileSync(filePath, `${content}${separator}${POINTER_BLOCK}\n`);
}

const NATIVE_FILES = ['AGENTS.md', 'GEMINI.md'];

export function installPointerAdapters(projectRoot: string): void {
  const existingNativeFiles = NATIVE_FILES.filter((f) => existsSync(join(projectRoot, f)));

  if (existingNativeFiles.length > 0) {
    for (const file of existingNativeFiles) {
      upsertPointerBlock(join(projectRoot, file), '');
    }
  } else {
    upsertPointerBlock(join(projectRoot, 'AGENTS.md'), '# Project Instructions\n\n');
  }

  const cursorRulesDir = join(projectRoot, '.cursor', 'rules');
  mkdirSync(cursorRulesDir, { recursive: true });
  const cursorRulePath = join(cursorRulesDir, 'memoryintel.mdc');
  if (!existsSync(cursorRulePath)) {
    writeFileSync(cursorRulePath, `---\nalwaysApply: true\n---\n\n${POINTER_BLOCK}\n`);
  }
}
