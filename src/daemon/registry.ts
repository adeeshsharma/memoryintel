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

// Registered projects accumulate forever otherwise - a moved/deleted project, a one-off temp
// test fixture, or an untouched-since worktree all stay listed with no signal they're dead.
// `.memoryintel` (not just the bare project path) is the actual existence check, since the
// project directory can survive even after someone deletes just its memory.
export function pruneRegistry(registry: Record<string, RegistryEntry>): Record<string, RegistryEntry> {
  const pruned: Record<string, RegistryEntry> = {};
  for (const [path, entry] of Object.entries(registry)) {
    if (existsSync(join(path, '.memoryintel'))) pruned[path] = entry;
  }
  return pruned;
}

// The disk-level counterpart of pruneRegistry() - used both as doctor --all's own cleanup step
// (see commands/doctor.ts) and, via upsertRegistryEntry() below, self-healing on every ordinary
// load/update/doctor call, so the registry never needs a dedicated "clean it up" reminder.
export function pruneRegistryFile(): string[] {
  const registry = readRegistry();
  const kept = pruneRegistry(registry);
  const removed = Object.keys(registry).filter((path) => !(path in kept));
  if (removed.length > 0) writeRegistry(kept);
  return removed;
}

export function upsertRegistryEntry(projectRoot: string): void {
  if (!readGlobalSettings().dashboardEnabled) return;

  const registry = pruneRegistry(readRegistry());
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
