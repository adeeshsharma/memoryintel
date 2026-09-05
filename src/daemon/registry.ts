import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureGlobalDir, registryPath } from './globalPaths.js';
import { readGlobalSettings } from './settings.js';

export interface RegistryEntry {
  path: string;
  initializedAt: string;
  lastSessionAt: string;
  toolsWired: string[];
}

const MARKER = 'memoryintel:managed:start';

export function detectToolsWired(projectRoot: string): string[] {
  const tools: string[] = [];

  // Claude Code automation comes entirely from this package's bundled plugin
  // (hooks/hooks.json), never from writing to the project's own .claude/settings.json - init has
  // never touched that file. The Stop-hook's `.session-marker.json` (written by check-stop /
  // resolveCheckStopMarker, see src/adapters/claudeCode.ts) only ever exists once the plugin's
  // Stop hook has actually fired for this project - real evidence of Claude Code automation
  // running, not just installed. A prior version of this check also looked for a hand-wired
  // .claude/settings.json; dropped after confirming on a real project (distilled-docs) that
  // nothing ever writes that file, so the check could never fire in practice.
  const sessionMarkerPath = join(projectRoot, '.memoryintel', '.session-marker.json');
  if (existsSync(sessionMarkerPath)) {
    tools.push('claude-code');
  }

  if (existsSync(join(projectRoot, '.cursor', 'rules', 'memoryintel.mdc'))) {
    tools.push('cursor');
  }

  const agentsPath = join(projectRoot, 'AGENTS.md');
  if (existsSync(agentsPath) && readFileSync(agentsPath, 'utf-8').includes(MARKER)) {
    tools.push('agents-md');
  }

  const geminiPath = join(projectRoot, 'GEMINI.md');
  if (existsSync(geminiPath) && readFileSync(geminiPath, 'utf-8').includes(MARKER)) {
    tools.push('gemini');
  }

  return tools;
}

export function readRegistry(): Record<string, RegistryEntry> {
  const path = registryPath();
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf-8').trim();
  return raw.length === 0 ? {} : JSON.parse(raw);
}

function writeRegistry(registry: Record<string, RegistryEntry>): void {
  ensureGlobalDir();
  writeFileSync(registryPath(), JSON.stringify(registry, null, 2) + '\n');
}

export function upsertRegistryEntry(projectRoot: string): void {
  if (!readGlobalSettings().dashboardEnabled) return;

  const registry = readRegistry();
  const now = new Date().toISOString();
  const existing = registry[projectRoot];

  registry[projectRoot] = {
    path: projectRoot,
    initializedAt: existing?.initializedAt ?? now,
    lastSessionAt: now,
    toolsWired: detectToolsWired(projectRoot)
  };

  writeRegistry(registry);
}
