# Memory Intel Web Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the single global, read-only web dashboard — daemon, cross-project registry, lazy self-start wired into `load`/`update`, and a global `dashboard enable/disable` switch — per spec §8.

**Architecture:** One more layer in the same `memoryintel` package. A background daemon (`memoryintel daemon start`) serves server-rendered HTML on a fixed local port, reading directly off each registered project's `.memoryintel/*` files on every request — no separate database. Global state (`registry.json`, `settings.json`, `daemon.json`) lives in `~/.memoryintel/`, distinct from any project's own `.memoryintel/`. `load` and `update` (built in the CLI Core plan) get a small addition each: opportunistically ensure the daemon is running and upsert this project into the registry, both skippable via the global disable switch.

**Tech Stack:** Same as CLI Core (TypeScript, Node >=18, Vitest). HTTP server uses Node's built-in `http` module — no Express — since the dashboard has exactly two routes. No markdown-to-HTML rendering library; file content is shown as escaped preformatted text for this plan, with a dedicated visual-design task at the end to take it further.

**Spec:** `docs/superpowers/specs/2026-08-20-memory-intel-design.md` (this plan implements §8 in full)

**Depends on:** `docs/superpowers/plans/2026-08-20-memory-intel-cli-core.md` (Plan A) — specifically `WRITABLE_FILES` from `src/core/pathSafety.ts`, `readIndex` from `src/core/memoryIndex.ts`, and the exact current contents of `src/commands/load.ts` / `src/commands/update.ts`, which Task 12 here modifies. Execute Plan A first.

## Global Constraints

- Global state lives under `getGlobalDir()` (default `~/.memoryintel`, overridable via `MEMORYINTEL_GLOBAL_DIR` env var for tests) — never inside any project's own `.memoryintel/`.
- The dashboard is strictly read-only: no task in this plan adds a write path from the HTTP layer back into any project's `.memoryintel/` files.
- Every daemon-contacting call (`ensureDaemonRunning`, `upsertRegistryEntry`) must no-op silently, never throw, when `dashboardEnabled` is `false` or when anything about the daemon fails — dashboard visibility must never break `load`/`update`.
- One daemon, one dashboard, for every project on the machine — no per-project toggle.

---

### Task 1: Global paths + global settings (enable/disable flag)

**Files:**
- Create: `src/daemon/globalPaths.ts`
- Create: `src/daemon/settings.ts`
- Test: `tests/daemon/globalPaths.test.ts`
- Test: `tests/daemon/settings.test.ts`

**Interfaces:**
- Produces: `getGlobalDir(): string`, `ensureGlobalDir(): string`, `registryPath(): string`, `settingsPath(): string`, `daemonHandlePath(): string` from `globalPaths.ts`; `interface GlobalSettings { dashboardEnabled: boolean }`, `readGlobalSettings(): GlobalSettings`, `writeGlobalSettings(settings: GlobalSettings): void` from `settings.ts`. Consumed by every other task in this plan.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/daemon/globalPaths.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getGlobalDir, ensureGlobalDir, registryPath, settingsPath, daemonHandlePath } from '../../src/daemon/globalPaths.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mi-global-'));
  process.env.MEMORYINTEL_GLOBAL_DIR = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MEMORYINTEL_GLOBAL_DIR;
});

describe('globalPaths', () => {
  it('honors MEMORYINTEL_GLOBAL_DIR', () => {
    expect(getGlobalDir()).toBe(dir);
  });

  it('ensureGlobalDir creates the directory and returns its path', () => {
    const created = ensureGlobalDir();
    expect(created).toBe(dir);
    expect(existsSync(dir)).toBe(true);
  });

  it('derives registry/settings/daemon-handle paths under the global dir', () => {
    expect(registryPath()).toBe(join(dir, 'registry.json'));
    expect(settingsPath()).toBe(join(dir, 'settings.json'));
    expect(daemonHandlePath()).toBe(join(dir, 'daemon.json'));
  });
});
```

```typescript
// tests/daemon/settings.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readGlobalSettings, writeGlobalSettings } from '../../src/daemon/settings.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mi-settings-'));
  process.env.MEMORYINTEL_GLOBAL_DIR = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MEMORYINTEL_GLOBAL_DIR;
});

describe('readGlobalSettings / writeGlobalSettings', () => {
  it('defaults to dashboardEnabled: true when no settings file exists', () => {
    expect(readGlobalSettings()).toEqual({ dashboardEnabled: true });
  });

  it('round-trips a written value', () => {
    writeGlobalSettings({ dashboardEnabled: false });
    expect(readGlobalSettings()).toEqual({ dashboardEnabled: false });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/daemon/globalPaths.test.ts tests/daemon/settings.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/daemon/globalPaths.ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

export function getGlobalDir(): string {
  return process.env.MEMORYINTEL_GLOBAL_DIR ?? join(homedir(), '.memoryintel');
}

export function ensureGlobalDir(): string {
  const dir = getGlobalDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function registryPath(): string { return join(getGlobalDir(), 'registry.json'); }
export function settingsPath(): string { return join(getGlobalDir(), 'settings.json'); }
export function daemonHandlePath(): string { return join(getGlobalDir(), 'daemon.json'); }
```

```typescript
// src/daemon/settings.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ensureGlobalDir, settingsPath } from './globalPaths.js';

export interface GlobalSettings {
  dashboardEnabled: boolean;
}

const DEFAULT_SETTINGS: GlobalSettings = { dashboardEnabled: true };

export function readGlobalSettings(): GlobalSettings {
  const path = settingsPath();
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS };
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function writeGlobalSettings(settings: GlobalSettings): void {
  ensureGlobalDir();
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2) + '\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/daemon/globalPaths.test.ts tests/daemon/settings.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/daemon/globalPaths.ts src/daemon/settings.ts tests/daemon/globalPaths.test.ts tests/daemon/settings.test.ts
git commit -m "feat: add global paths and dashboard enable/disable settings"
```

---

### Task 2: Daemon handle (port/pid tracking, liveness, port picker)

**Files:**
- Create: `src/daemon/daemonHandle.ts`
- Test: `tests/daemon/daemonHandle.test.ts`

**Interfaces:**
- Produces: `interface DaemonHandle { port: number; pid: number }`, `readDaemonHandle(): DaemonHandle | null`, `writeDaemonHandle(handle: DaemonHandle): void`, `clearDaemonHandle(): void`, `isProcessAlive(pid: number): boolean`, `pickFreePort(startPort: number): Promise<number>` — consumed by `lifecycle.ts` (Task 5), `server.ts` (Task 10), `dashboardToggle.ts` (Task 6).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/daemon/daemonHandle.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { readDaemonHandle, writeDaemonHandle, clearDaemonHandle, isProcessAlive, pickFreePort } from '../../src/daemon/daemonHandle.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mi-handle-'));
  process.env.MEMORYINTEL_GLOBAL_DIR = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MEMORYINTEL_GLOBAL_DIR;
});

describe('daemon handle', () => {
  it('returns null when no handle has been written', () => {
    expect(readDaemonHandle()).toBeNull();
  });

  it('round-trips a written handle', () => {
    writeDaemonHandle({ port: 4390, pid: 12345 });
    expect(readDaemonHandle()).toEqual({ port: 4390, pid: 12345 });
  });

  it('clearDaemonHandle removes it', () => {
    writeDaemonHandle({ port: 4390, pid: 12345 });
    clearDaemonHandle();
    expect(readDaemonHandle()).toBeNull();
  });
});

describe('isProcessAlive', () => {
  it('returns true for the current process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('returns false for a pid that almost certainly does not exist', () => {
    expect(isProcessAlive(999999)).toBe(false);
  });
});

describe('pickFreePort', () => {
  it('returns the requested port when it is free', async () => {
    const port = await pickFreePort(41000);
    expect(port).toBe(41000);
  });

  it('skips a port that is already bound', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(41010, '127.0.0.1', resolve));
    try {
      const port = await pickFreePort(41010);
      expect(port).toBe(41011);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/daemon/daemonHandle.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/daemon/daemonHandle.ts
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { ensureGlobalDir, daemonHandlePath } from './globalPaths.js';

export interface DaemonHandle {
  port: number;
  pid: number;
}

export function readDaemonHandle(): DaemonHandle | null {
  const path = daemonHandlePath();
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function writeDaemonHandle(handle: DaemonHandle): void {
  ensureGlobalDir();
  writeFileSync(daemonHandlePath(), JSON.stringify(handle, null, 2) + '\n');
}

export function clearDaemonHandle(): void {
  const path = daemonHandlePath();
  if (existsSync(path)) unlinkSync(path);
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err.code === 'EPERM';
  }
}

export function pickFreePort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (port: number) => {
      const tester = createServer();
      tester.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          tester.close(() => tryPort(port + 1));
        } else {
          reject(err);
        }
      });
      tester.once('listening', () => {
        tester.close(() => resolve(port));
      });
      tester.listen(port, '127.0.0.1');
    };
    tryPort(startPort);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/daemon/daemonHandle.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/daemon/daemonHandle.ts tests/daemon/daemonHandle.test.ts
git commit -m "feat: add daemon handle tracking, liveness check, and free-port picker"
```

---

### Task 3: Registry (entries + computed toolsWired)

**Files:**
- Create: `src/daemon/registry.ts`
- Test: `tests/daemon/registry.test.ts`

**Interfaces:**
- Consumes: `readGlobalSettings` (Task 1).
- Produces: `interface RegistryEntry { path: string; initializedAt: string; lastSessionAt: string; toolsWired: string[] }`, `readRegistry(): Record<string, RegistryEntry>`, `upsertRegistryEntry(projectRoot: string): void`, `detectToolsWired(projectRoot: string): string[]` — consumed by `lifecycle.ts` (Task 5), `registryPage.ts`/`projectPage.ts` (Tasks 8–9), and Plan A's `load.ts`/`update.ts` (Task 12 here).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/daemon/registry.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRegistry, upsertRegistryEntry, detectToolsWired } from '../../src/daemon/registry.js';
import { writeGlobalSettings } from '../../src/daemon/settings.js';

let globalDir: string;
let projectRoot: string;

beforeEach(() => {
  globalDir = mkdtempSync(join(tmpdir(), 'mi-registry-global-'));
  process.env.MEMORYINTEL_GLOBAL_DIR = globalDir;
  projectRoot = mkdtempSync(join(tmpdir(), 'mi-registry-project-'));
});
afterEach(() => {
  rmSync(globalDir, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
  delete process.env.MEMORYINTEL_GLOBAL_DIR;
});

describe('detectToolsWired', () => {
  it('detects claude-code when settings.json references memoryintel load', () => {
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(join(projectRoot, '.claude', 'settings.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'memoryintel load' }] }] } }));
    expect(detectToolsWired(projectRoot)).toContain('claude-code');
  });

  it('detects cursor when the rule file exists', () => {
    mkdirSync(join(projectRoot, '.cursor', 'rules'), { recursive: true });
    writeFileSync(join(projectRoot, '.cursor', 'rules', 'memoryintel.mdc'), '---\nalwaysApply: true\n---\n');
    expect(detectToolsWired(projectRoot)).toContain('cursor');
  });

  it('detects agents-md and gemini when the pointer marker is present', () => {
    writeFileSync(join(projectRoot, 'AGENTS.md'), '<!-- memoryintel:managed:start -->\n...\n<!-- memoryintel:managed:end -->\n');
    writeFileSync(join(projectRoot, 'GEMINI.md'), '<!-- memoryintel:managed:start -->\n...\n<!-- memoryintel:managed:end -->\n');
    const tools = detectToolsWired(projectRoot);
    expect(tools).toContain('agents-md');
    expect(tools).toContain('gemini');
  });

  it('returns an empty array when nothing is wired', () => {
    expect(detectToolsWired(projectRoot)).toEqual([]);
  });
});

describe('upsertRegistryEntry / readRegistry', () => {
  it('adds a new entry with computed toolsWired', () => {
    mkdirSync(join(projectRoot, '.cursor', 'rules'), { recursive: true });
    writeFileSync(join(projectRoot, '.cursor', 'rules', 'memoryintel.mdc'), '---\nalwaysApply: true\n---\n');
    upsertRegistryEntry(projectRoot);
    const registry = readRegistry();
    expect(registry[projectRoot].toolsWired).toEqual(['cursor']);
    expect(typeof registry[projectRoot].initializedAt).toBe('string');
  });

  it('preserves initializedAt but bumps lastSessionAt and re-detects tools on a later upsert', async () => {
    upsertRegistryEntry(projectRoot);
    const first = readRegistry()[projectRoot];

    await new Promise((r) => setTimeout(r, 5));
    mkdirSync(join(projectRoot, '.cursor', 'rules'), { recursive: true });
    writeFileSync(join(projectRoot, '.cursor', 'rules', 'memoryintel.mdc'), '---\nalwaysApply: true\n---\n');
    upsertRegistryEntry(projectRoot);

    const second = readRegistry()[projectRoot];
    expect(second.initializedAt).toBe(first.initializedAt);
    expect(second.lastSessionAt).not.toBe(first.lastSessionAt);
    expect(second.toolsWired).toEqual(['cursor']);
  });

  it('does nothing when the dashboard is globally disabled', () => {
    writeGlobalSettings({ dashboardEnabled: false });
    upsertRegistryEntry(projectRoot);
    expect(readRegistry()[projectRoot]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/daemon/registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/daemon/registry.ts
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

  const claudeSettingsPath = join(projectRoot, '.claude', 'settings.json');
  if (existsSync(claudeSettingsPath) && readFileSync(claudeSettingsPath, 'utf-8').includes('memoryintel load')) {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/daemon/registry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/daemon/registry.ts tests/daemon/registry.test.ts
git commit -m "feat: add global project registry with computed per-tool wiring status"
```

---

### Task 4: File-health / staleness computation

**Files:**
- Create: `src/daemon/health.ts`
- Test: `tests/daemon/health.test.ts`

**Interfaces:**
- Consumes: `WRITABLE_FILES` from Plan A's `src/core/pathSafety.ts`, `readIndex` from Plan A's `src/core/memoryIndex.ts`.
- Produces: `interface FileHealth { file: string; lastUpdated: string | null; staleDays: number | null }`, `computeFileHealth(memoryRoot: string): FileHealth[]` — consumed by `projectPage.ts` (Task 9).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/daemon/health.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeFileHealth } from '../../src/daemon/health.js';

let memoryRoot: string;

beforeEach(() => { memoryRoot = mkdtempSync(join(tmpdir(), 'mi-health-')); });
afterEach(() => rmSync(memoryRoot, { recursive: true, force: true }));

describe('computeFileHealth', () => {
  it('reports null lastUpdated/staleDays for a file never touched by update', () => {
    writeFileSync(join(memoryRoot, 'memory-index.json'), '{}');
    const health = computeFileHealth(memoryRoot);
    const entry = health.find((h) => h.file === 'technical/architecture.md')!;
    expect(entry.lastUpdated).toBeNull();
    expect(entry.staleDays).toBeNull();
  });

  it('computes staleDays from the index lastUpdated timestamp', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    writeFileSync(join(memoryRoot, 'memory-index.json'), JSON.stringify({
      'technical/architecture.md': { lastUpdated: twoDaysAgo, summary: 'x' }
    }));
    const health = computeFileHealth(memoryRoot);
    const entry = health.find((h) => h.file === 'technical/architecture.md')!;
    expect(entry.lastUpdated).toBe(twoDaysAgo);
    expect(entry.staleDays).toBe(2);
  });

  it('covers every writable file exactly once', () => {
    writeFileSync(join(memoryRoot, 'memory-index.json'), '{}');
    const health = computeFileHealth(memoryRoot);
    const files = health.map((h) => h.file);
    expect(new Set(files).size).toBe(files.length);
    expect(files).toContain('context/decisions.md');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/daemon/health.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/daemon/health.ts
import { WRITABLE_FILES } from '../core/pathSafety.js';
import { readIndex } from '../core/memoryIndex.js';
import { join } from 'node:path';

export interface FileHealth {
  file: string;
  lastUpdated: string | null;
  staleDays: number | null;
}

export function computeFileHealth(memoryRoot: string): FileHealth[] {
  const index = readIndex(join(memoryRoot, 'memory-index.json'));
  const now = Date.now();

  return WRITABLE_FILES.map((file) => {
    const entry = index[file];
    if (!entry) return { file, lastUpdated: null, staleDays: null };

    const staleDays = Math.floor((now - new Date(entry.lastUpdated).getTime()) / (24 * 60 * 60 * 1000));
    return { file, lastUpdated: entry.lastUpdated, staleDays };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/daemon/health.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/daemon/health.ts tests/daemon/health.test.ts
git commit -m "feat: add per-file staleness computation from the memory index"
```

---

### Task 5: Lifecycle — lazy self-start

**Files:**
- Create: `src/daemon/lifecycle.ts`
- Test: `tests/daemon/lifecycle.test.ts`

**Interfaces:**
- Consumes: `readGlobalSettings` (Task 1), `readDaemonHandle`, `isProcessAlive` (Task 2).
- Produces: `shouldSpawnDaemon(): boolean` (pure), `spawnDaemonProcess(): void` (side-effecting, not deeply unit-tested), `ensureDaemonRunning(): void` — consumed by Plan A's `load.ts`/`update.ts` (Task 12).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/daemon/lifecycle.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shouldSpawnDaemon } from '../../src/daemon/lifecycle.js';
import { writeGlobalSettings } from '../../src/daemon/settings.js';
import { writeDaemonHandle } from '../../src/daemon/daemonHandle.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mi-lifecycle-'));
  process.env.MEMORYINTEL_GLOBAL_DIR = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MEMORYINTEL_GLOBAL_DIR;
});

describe('shouldSpawnDaemon', () => {
  it('is true when enabled and no handle exists', () => {
    expect(shouldSpawnDaemon()).toBe(true);
  });

  it('is false when the dashboard is globally disabled', () => {
    writeGlobalSettings({ dashboardEnabled: false });
    expect(shouldSpawnDaemon()).toBe(false);
  });

  it('is false when a handle exists for a live process (the current process)', () => {
    writeDaemonHandle({ port: 4390, pid: process.pid });
    expect(shouldSpawnDaemon()).toBe(false);
  });

  it('is true when the handle points at a dead process', () => {
    writeDaemonHandle({ port: 4390, pid: 999999 });
    expect(shouldSpawnDaemon()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/daemon/lifecycle.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/daemon/lifecycle.ts
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { readGlobalSettings } from './settings.js';
import { readDaemonHandle, isProcessAlive } from './daemonHandle.js';

export function shouldSpawnDaemon(): boolean {
  if (!readGlobalSettings().dashboardEnabled) return false;
  const handle = readDaemonHandle();
  if (!handle) return true;
  return !isProcessAlive(handle.pid);
}

// Not deeply unit tested — it starts a real detached process. Exercised by Task 13's
// e2e test only insofar as `ensureDaemonRunning` decides *whether* to call it.
export function spawnDaemonProcess(): void {
  const cliPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli.js');
  const child = spawn(process.execPath, [cliPath, 'daemon', 'start'], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
}

export function ensureDaemonRunning(): void {
  try {
    if (shouldSpawnDaemon()) spawnDaemonProcess();
  } catch {
    // Best-effort only — dashboard visibility must never break the calling command.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/daemon/lifecycle.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/daemon/lifecycle.ts tests/daemon/lifecycle.test.ts
git commit -m "feat: add lazy, self-healing daemon start-up decision and spawn"
```

---

### Task 6: `dashboard enable`/`dashboard disable` commands

**Files:**
- Create: `src/commands/dashboardToggle.ts`
- Modify: `src/cli.ts` (wire the `dashboard` case)
- Test: `tests/commands/dashboardToggle.test.ts`

**Interfaces:**
- Consumes: `writeGlobalSettings`, `readGlobalSettings` (Task 1), `readDaemonHandle`, `clearDaemonHandle`, `isProcessAlive` (Task 2).
- Produces: `runDashboardEnable(): void`, `runDashboardDisable(): { stopped: boolean }` — consumed by `src/cli.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/commands/dashboardToggle.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDashboardEnable, runDashboardDisable } from '../../src/commands/dashboardToggle.js';
import { readGlobalSettings } from '../../src/daemon/settings.js';
import { writeDaemonHandle, readDaemonHandle } from '../../src/daemon/daemonHandle.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mi-toggle-'));
  process.env.MEMORYINTEL_GLOBAL_DIR = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MEMORYINTEL_GLOBAL_DIR;
  vi.restoreAllMocks();
});

describe('runDashboardEnable', () => {
  it('sets dashboardEnabled to true', () => {
    runDashboardDisable();
    runDashboardEnable();
    expect(readGlobalSettings().dashboardEnabled).toBe(true);
  });
});

describe('runDashboardDisable', () => {
  it('sets dashboardEnabled to false', () => {
    runDashboardDisable();
    expect(readGlobalSettings().dashboardEnabled).toBe(false);
  });

  it('reports stopped: false and leaves no handle when no daemon was running', () => {
    const result = runDashboardDisable();
    expect(result.stopped).toBe(false);
    expect(readDaemonHandle()).toBeNull();
  });

  it('kills the live process and clears the handle when a daemon is running', () => {
    writeDaemonHandle({ port: 4390, pid: process.pid });
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const result = runDashboardDisable();
    expect(result.stopped).toBe(true);
    expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGTERM');
    expect(readDaemonHandle()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/dashboardToggle.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/commands/dashboardToggle.ts
import { readGlobalSettings, writeGlobalSettings } from '../daemon/settings.js';
import { readDaemonHandle, clearDaemonHandle, isProcessAlive } from '../daemon/daemonHandle.js';

export function runDashboardEnable(): void {
  writeGlobalSettings({ ...readGlobalSettings(), dashboardEnabled: true });
}

export function runDashboardDisable(): { stopped: boolean } {
  writeGlobalSettings({ ...readGlobalSettings(), dashboardEnabled: false });

  const handle = readDaemonHandle();
  if (handle && isProcessAlive(handle.pid)) {
    process.kill(handle.pid, 'SIGTERM');
    clearDaemonHandle();
    return { stopped: true };
  }

  if (handle) clearDaemonHandle();
  return { stopped: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/dashboardToggle.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into `src/cli.ts`**

```typescript
// src/cli.ts — add import:
import { runDashboardEnable, runDashboardDisable } from './commands/dashboardToggle.js';

// inside dispatch()'s switch, add:
case 'dashboard': {
  const sub = argv[1];
  if (sub === 'enable') {
    runDashboardEnable();
    return { exitCode: 0, stdout: 'Dashboard enabled. It will start on the next `load` or `update` call.\n', stderr: '' };
  }
  if (sub === 'disable') {
    const result = runDashboardDisable();
    return {
      exitCode: 0,
      stdout: `Dashboard disabled${result.stopped ? ' and stopped' : ''}. This affects the shared dashboard for every Memory Intel project on this machine.\n`,
      stderr: ''
    };
  }
  return { exitCode: 1, stdout: '', stderr: 'Usage: memoryintel dashboard <enable|disable>\n' };
}
```

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/commands/dashboardToggle.ts src/cli.ts tests/commands/dashboardToggle.test.ts
git commit -m "feat: add global dashboard enable/disable commands"
```

---

### Task 7: HTML layout shell

**Files:**
- Create: `src/daemon/views/layout.ts`
- Test: `tests/daemon/views/layout.test.ts`

**Interfaces:**
- Produces: `escapeHtml(s: string): string`, `pageShell(title: string, bodyHtml: string): string` — consumed by `registryPage.ts` (Task 8), `projectPage.ts` (Task 9).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/daemon/views/layout.test.ts
import { describe, it, expect } from 'vitest';
import { escapeHtml, pageShell } from '../../../src/daemon/views/layout.js';

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<script>&"'</script>`)).toBe('&lt;script&gt;&amp;&quot;&#39;&lt;/script&gt;');
  });
});

describe('pageShell', () => {
  it('embeds the title and body', () => {
    const html = pageShell('Memory Intel', '<p>hello</p>');
    expect(html).toContain('<title>Memory Intel</title>');
    expect(html).toContain('<p>hello</p>');
  });

  it('is a complete, valid-looking HTML document', () => {
    const html = pageShell('T', '<p>x</p>');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<style>');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/daemon/views/layout.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/daemon/views/layout.ts

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const BASE_STYLES = `
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  h1, h2, h3 { line-height: 1.2; }
  a { color: inherit; }
  .card { border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
  .muted { opacity: 0.65; font-size: 0.9em; }
  .missing { opacity: 0.5; font-style: italic; }
  pre { white-space: pre-wrap; word-break: break-word; background: color-mix(in srgb, currentColor 6%, transparent); padding: 0.75rem; border-radius: 6px; }
  .tag { display: inline-block; border-radius: 999px; padding: 0.1em 0.7em; font-size: 0.8em; background: color-mix(in srgb, currentColor 12%, transparent); margin-right: 0.4em; }
`;

export function pageShell(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${BASE_STYLES}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/daemon/views/layout.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/daemon/views/layout.ts tests/daemon/views/layout.test.ts
git commit -m "feat: add HTML page shell and escaping helper for dashboard views"
```

---

### Task 8: Registry landing page

**Files:**
- Create: `src/daemon/views/registryPage.ts`
- Test: `tests/daemon/views/registryPage.test.ts`

**Interfaces:**
- Consumes: `RegistryEntry` (Task 3), `escapeHtml`, `pageShell` (Task 7).
- Produces: `renderRegistryPage(entries: Record<string, RegistryEntry>): string` — consumed by `server.ts` (Task 10).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/daemon/views/registryPage.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderRegistryPage } from '../../../src/daemon/views/registryPage.js';

let projectRoot: string;
beforeEach(() => { projectRoot = mkdtempSync(join(tmpdir(), 'mi-regpage-')); });
afterEach(() => rmSync(projectRoot, { recursive: true, force: true }));

describe('renderRegistryPage', () => {
  it('lists a known project with its mental-model preview', () => {
    mkdirSync(join(projectRoot, '.memoryintel', 'context'), { recursive: true });
    writeFileSync(join(projectRoot, '.memoryintel', 'context', 'currentMentalModel.md'), 'Auth migration 70% complete.\n');

    const html = renderRegistryPage({
      [projectRoot]: { path: projectRoot, initializedAt: '2026-08-20T10:00:00Z', lastSessionAt: '2026-08-20T12:00:00Z', toolsWired: ['claude-code'] }
    });

    expect(html).toContain(projectRoot);
    expect(html).toContain('Auth migration 70% complete.');
    expect(html).toContain('claude-code');
  });

  it('shows a project whose path no longer exists as missing, without crashing', () => {
    const gonePath = join(projectRoot, 'no-longer-here');
    const html = renderRegistryPage({
      [gonePath]: { path: gonePath, initializedAt: '2026-08-20T10:00:00Z', lastSessionAt: '2026-08-20T12:00:00Z', toolsWired: [] }
    });
    expect(html).toContain('missing');
  });

  it('shows an empty-state message when the registry has no entries', () => {
    const html = renderRegistryPage({});
    expect(html).toContain('No projects registered yet');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/daemon/views/registryPage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/daemon/views/registryPage.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { escapeHtml, pageShell } from './layout.js';
import type { RegistryEntry } from '../registry.js';

function mentalModelPreview(projectPath: string): string {
  const path = join(projectPath, '.memoryintel', 'context', 'currentMentalModel.md');
  if (!existsSync(path)) return '(no mental model yet)';
  return readFileSync(path, 'utf-8').trim().split('\n')[0] ?? '(empty)';
}

export function renderRegistryPage(entries: Record<string, RegistryEntry>): string {
  const projectPaths = Object.keys(entries);

  if (projectPaths.length === 0) {
    return pageShell('Memory Intel', '<h1>Memory Intel</h1><p class="muted">No projects registered yet. Run `memoryintel init` in a project to see it here.</p>');
  }

  const cards = projectPaths.map((path) => {
    const entry = entries[path];
    if (!existsSync(path)) {
      return `<div class="card missing"><strong>${escapeHtml(path)}</strong><p>(missing — this project's directory no longer exists)</p></div>`;
    }

    const preview = mentalModelPreview(path);
    const tools = entry.toolsWired.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('') || '<span class="muted">no tools wired</span>';

    return `<div class="card">
  <h3><a href="/project?path=${encodeURIComponent(path)}">${escapeHtml(path)}</a></h3>
  <p>${escapeHtml(preview)}</p>
  <p class="muted">Last session: ${escapeHtml(entry.lastSessionAt)}</p>
  <p>${tools}</p>
</div>`;
  });

  return pageShell('Memory Intel', `<h1>Memory Intel</h1>\n${cards.join('\n')}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/daemon/views/registryPage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/daemon/views/registryPage.ts tests/daemon/views/registryPage.test.ts
git commit -m "feat: add registry landing page view"
```

---

### Task 9: Project view

**Files:**
- Create: `src/daemon/views/projectPage.ts`
- Test: `tests/daemon/views/projectPage.test.ts`

**Interfaces:**
- Consumes: `WRITABLE_FILES` (Plan A `pathSafety.ts`), `computeFileHealth` (Task 4), `detectToolsWired` (Task 3), `escapeHtml`, `pageShell` (Task 7).
- Produces: `renderProjectPage(projectRoot: string, options?: { typeFilter?: string }): string` — consumed by `server.ts` (Task 10).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/daemon/views/projectPage.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderProjectPage } from '../../../src/daemon/views/projectPage.js';

let projectRoot: string;
let memoryRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'mi-projpage-'));
  memoryRoot = join(projectRoot, '.memoryintel');
  mkdirSync(join(memoryRoot, 'context'), { recursive: true });
  mkdirSync(join(memoryRoot, 'technical'), { recursive: true });
  writeFileSync(join(memoryRoot, 'context', 'currentMentalModel.md'), 'Auth migration 70% complete.\n');
  writeFileSync(join(memoryRoot, 'technical', 'architecture.md'), '## Overview\nMicroservices.\n');
  writeFileSync(join(memoryRoot, 'memory-index.json'), '{}');
  writeFileSync(join(memoryRoot, 'memory-events.jsonl'), [
    JSON.stringify({ timestamp: '2026-08-20T10:00:00Z', type: 'architecture-change', summary: 'JWT refresh introduced', affectedFiles: ['technical/architecture.md'] }),
    JSON.stringify({ timestamp: '2026-08-20T11:00:00Z', type: 'progress-update', summary: 'Milestone hit', affectedFiles: ['context/progress.md'] })
  ].join('\n') + '\n');
});

afterEach(() => rmSync(projectRoot, { recursive: true, force: true }));

describe('renderProjectPage', () => {
  it('shows the mental model hero', () => {
    expect(renderProjectPage(projectRoot)).toContain('Auth migration 70% complete.');
  });

  it('shows file browser content for a technical file', () => {
    expect(renderProjectPage(projectRoot)).toContain('Microservices.');
  });

  it('shows the event timeline', () => {
    const html = renderProjectPage(projectRoot);
    expect(html).toContain('JWT refresh introduced');
    expect(html).toContain('Milestone hit');
  });

  it('filters the event timeline by type when requested', () => {
    const html = renderProjectPage(projectRoot, { typeFilter: 'architecture-change' });
    expect(html).toContain('JWT refresh introduced');
    expect(html).not.toContain('Milestone hit');
  });

  it('shows per-tool automation status', () => {
    mkdirSync(join(projectRoot, '.cursor', 'rules'), { recursive: true });
    writeFileSync(join(projectRoot, '.cursor', 'rules', 'memoryintel.mdc'), '---\nalwaysApply: true\n---\n');
    expect(renderProjectPage(projectRoot)).toContain('cursor');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/daemon/views/projectPage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/daemon/views/projectPage.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WRITABLE_FILES } from '../../core/pathSafety.js';
import { computeFileHealth } from '../health.js';
import { detectToolsWired } from '../registry.js';
import { escapeHtml, pageShell } from './layout.js';

function renderFileBrowser(memoryRoot: string): string {
  const groups: Record<string, string[]> = {};
  for (const file of WRITABLE_FILES) {
    if (file === 'context/currentMentalModel.md') continue;
    const [domain] = file.split('/');
    (groups[domain] ??= []).push(file);
  }

  const health = computeFileHealth(memoryRoot);
  const healthByFile = Object.fromEntries(health.map((h) => [h.file, h]));

  const sections = Object.entries(groups).map(([domain, files]) => {
    const items = files.map((file) => {
      const path = join(memoryRoot, file);
      const content = existsSync(path) ? readFileSync(path, 'utf-8').trim() : '';
      const staleness = healthByFile[file]?.staleDays;
      const stalenessLabel = staleness === null || staleness === undefined ? 'never updated' : `${staleness}d ago`;
      return `<details><summary>${escapeHtml(file)} <span class="muted">(${stalenessLabel})</span></summary><pre>${escapeHtml(content || '(empty)')}</pre></details>`;
    }).join('\n');
    return `<h3>${escapeHtml(domain)}</h3>\n${items}`;
  });

  return sections.join('\n');
}

function renderEventTimeline(memoryRoot: string, typeFilter?: string): string {
  const eventsPath = join(memoryRoot, 'memory-events.jsonl');
  if (!existsSync(eventsPath)) return '<p class="muted">No events yet.</p>';

  const events = readFileSync(eventsPath, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const filtered = typeFilter ? events.filter((e) => e.type === typeFilter) : events;

  if (filtered.length === 0) return '<p class="muted">No events match this filter.</p>';

  return filtered.slice().reverse().map((e) =>
    `<div class="card"><span class="tag">${escapeHtml(e.type)}</span>${escapeHtml(e.summary)}<div class="muted">${escapeHtml(e.timestamp)}</div></div>`
  ).join('\n');
}

export function renderProjectPage(projectRoot: string, options: { typeFilter?: string } = {}): string {
  const memoryRoot = join(projectRoot, '.memoryintel');
  const mentalModelPath = join(memoryRoot, 'context', 'currentMentalModel.md');
  const mentalModel = existsSync(mentalModelPath) ? readFileSync(mentalModelPath, 'utf-8').trim() : '(no mental model yet)';

  const tools = detectToolsWired(projectRoot);
  const toolsHtml = tools.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('') || '<span class="muted">no tools wired</span>';

  const body = `
<a href="/">&larr; All projects</a>
<h1>${escapeHtml(projectRoot)}</h1>
<div class="card"><h2>Current Mental Model</h2><pre>${escapeHtml(mentalModel)}</pre></div>
<h2>Automation status</h2>
<p>${toolsHtml}</p>
<h2>Memory files</h2>
${renderFileBrowser(memoryRoot)}
<h2>Event timeline</h2>
${renderEventTimeline(memoryRoot, options.typeFilter)}
`;

  return pageShell(projectRoot, body);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/daemon/views/projectPage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/daemon/views/projectPage.ts tests/daemon/views/projectPage.test.ts
git commit -m "feat: add project view with mental model, file browser, and event timeline"
```

---

### Task 10: HTTP server

**Files:**
- Create: `src/daemon/server.ts`
- Test: `tests/daemon/server.test.ts`

**Interfaces:**
- Consumes: `readRegistry` (Task 3), `renderRegistryPage` (Task 8), `renderProjectPage` (Task 9), `pickFreePort`, `writeDaemonHandle`, `clearDaemonHandle` (Task 2).
- Produces: `createRequestHandler(): (req, res) => void`, `startDaemon(preferredPort?: number): Promise<{ port: number; server: import('node:http').Server }>` — consumed by `daemonStart.ts` (Task 11).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/daemon/server.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon } from '../../src/daemon/server.js';
import type { Server } from 'node:http';

let globalDir: string;
let projectRoot: string;
let server: Server;
let port: number;

beforeEach(async () => {
  globalDir = mkdtempSync(join(tmpdir(), 'mi-server-global-'));
  process.env.MEMORYINTEL_GLOBAL_DIR = globalDir;
  projectRoot = mkdtempSync(join(tmpdir(), 'mi-server-project-'));
  mkdirSync(join(projectRoot, '.memoryintel', 'context'), { recursive: true });
  writeFileSync(join(projectRoot, '.memoryintel', 'context', 'currentMentalModel.md'), 'Hello from mental model.\n');

  writeFileSync(join(globalDir, 'registry.json'), JSON.stringify({
    [projectRoot]: { path: projectRoot, initializedAt: '2026-08-20T10:00:00Z', lastSessionAt: '2026-08-20T10:00:00Z', toolsWired: [] }
  }));

  const started = await startDaemon(0);
  server = started.server;
  port = started.port;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(globalDir, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
  delete process.env.MEMORYINTEL_GLOBAL_DIR;
});

describe('daemon HTTP server', () => {
  it('serves the registry landing page at /', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain(projectRoot);
  });

  it('serves a project page at /project?path=...', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/project?path=${encodeURIComponent(projectRoot)}`);
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain('Hello from mental model.');
  });

  it('returns 404 for an unknown route', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/nonsense`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/daemon/server.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/daemon/server.ts
import { createServer, type Server } from 'node:http';
import { readRegistry } from './registry.js';
import { renderRegistryPage } from './views/registryPage.js';
import { renderProjectPage } from './views/projectPage.js';
import { pickFreePort, writeDaemonHandle, clearDaemonHandle } from './daemonHandle.js';

export function createRequestHandler() {
  return (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/') {
      const html = renderRegistryPage(readRegistry());
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (url.pathname === '/project') {
      const path = url.searchParams.get('path');
      if (!path) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing ?path=');
        return;
      }
      const typeFilter = url.searchParams.get('type') ?? undefined;
      const html = renderProjectPage(path, { typeFilter });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  };
}

export async function startDaemon(preferredPort = 4390): Promise<{ port: number; server: Server }> {
  const port = await pickFreePort(preferredPort);
  const server = createServer(createRequestHandler());

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  writeDaemonHandle({ port, pid: process.pid });

  const cleanup = () => { clearDaemonHandle(); process.exit(0); };
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  return { port, server };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/daemon/server.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/daemon/server.ts tests/daemon/server.test.ts
git commit -m "feat: add dashboard HTTP server with registry and project routes"
```

---

### Task 11: `daemon start` command

**Files:**
- Create: `src/commands/daemonStart.ts`
- Modify: `src/cli.ts` (wire the `daemon` case)
- Test: `tests/commands/daemonStart.test.ts`

**Interfaces:**
- Consumes: `startDaemon` (Task 10).
- Produces: `runDaemonStart(preferredPort?: number): Promise<{ port: number }>` — consumed by `src/cli.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/commands/daemonStart.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDaemonStart } from '../../src/commands/daemonStart.js';
import { readDaemonHandle } from '../../src/daemon/daemonHandle.js';

let dir: string;
let cleanupServer: (() => Promise<void>) | null = null;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mi-daemonstart-'));
  process.env.MEMORYINTEL_GLOBAL_DIR = dir;
});

afterEach(async () => {
  if (cleanupServer) await cleanupServer();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MEMORYINTEL_GLOBAL_DIR;
});

describe('runDaemonStart', () => {
  it('starts the server and records a daemon handle', async () => {
    const { port, close } = await runDaemonStart(0);
    cleanupServer = close;
    expect(readDaemonHandle()).toEqual({ port, pid: process.pid });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/daemonStart.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/commands/daemonStart.ts
import { startDaemon } from '../daemon/server.js';

export async function runDaemonStart(preferredPort = 4390): Promise<{ port: number; close: () => Promise<void> }> {
  const { port, server } = await startDaemon(preferredPort);
  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/daemonStart.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into `src/cli.ts`**

```typescript
// src/cli.ts — add import:
import { runDaemonStart } from './commands/daemonStart.js';

// in main(), alongside the existing `if (command === 'update')` branch, add:
if (command === 'daemon' && argv[1] === 'start') {
  await runDaemonStart();
  // Intentionally never resolves further — this process IS the daemon, kept alive by the
  // listening HTTP server, until `memoryintel dashboard disable` sends it SIGTERM.
  return;
}
```

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/commands/daemonStart.ts src/cli.ts tests/commands/daemonStart.test.ts
git commit -m "feat: add daemon start command as the dashboard process entrypoint"
```

---

### Task 12: Wire lazy self-start + registry upsert into `load`/`update`

**Files:**
- Modify: `src/commands/load.ts` (from Plan A)
- Modify: `src/commands/update.ts` (from Plan A)
- Test: `tests/commands/load.test.ts` (extend)
- Test: `tests/commands/update.test.ts` (extend)

**Interfaces:**
- Consumes: `ensureDaemonRunning` (Task 5), `upsertRegistryEntry` (Task 3).

- [ ] **Step 1: Write the failing tests (append to existing files)**

```typescript
// tests/commands/load.test.ts — add:
import { readRegistry } from '../../src/daemon/registry.js';
import { mkdtempSync as mkdtemp2, rmSync as rm2 } from 'node:fs';
import { tmpdir as tmpdir2 } from 'node:os';

describe('runLoad daemon/registry side effects', () => {
  let globalDir: string;
  beforeEach(() => {
    globalDir = mkdtemp2(join(tmpdir2(), 'mi-load-global-'));
    process.env.MEMORYINTEL_GLOBAL_DIR = globalDir;
  });
  afterEach(() => {
    rm2(globalDir, { recursive: true, force: true });
    delete process.env.MEMORYINTEL_GLOBAL_DIR;
  });

  it('registers the project in the global registry when a root is found', () => {
    runLoad(base);
    expect(readRegistry()[base]).toBeDefined();
  });

  it('does not touch the registry when no .memoryintel/ is found', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'mi-load-empty2-'));
    runLoad(emptyDir);
    expect(readRegistry()[emptyDir]).toBeUndefined();
    rmSync(emptyDir, { recursive: true, force: true });
  });
});
```

```typescript
// tests/commands/update.test.ts — add:
import { readRegistry } from '../../src/daemon/registry.js';
import { mkdtempSync as mkdtemp3, rmSync as rm3 } from 'node:fs';
import { tmpdir as tmpdir3 } from 'node:os';

describe('runUpdate daemon/registry side effects', () => {
  let globalDir: string;
  beforeEach(() => {
    globalDir = mkdtemp3(join(tmpdir3(), 'mi-update-global-'));
    process.env.MEMORYINTEL_GLOBAL_DIR = globalDir;
  });
  afterEach(() => {
    rm3(globalDir, { recursive: true, force: true });
    delete process.env.MEMORYINTEL_GLOBAL_DIR;
  });

  it('registers the project (keyed by its parent directory) on a successful update', async () => {
    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'append', section: 'Overview', content: 'noted', reason: 'r' }
    ]);
    await runUpdate(root, plan);
    const projectRoot = join(root, '..');
    expect(readRegistry()[projectRoot]).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/commands/load.test.ts tests/commands/update.test.ts`
Expected: FAIL — `runLoad`/`runUpdate` don't touch the registry yet.

- [ ] **Step 3: Modify `src/commands/load.ts`**

```typescript
// src/commands/load.ts — change the imports at the top to add `dirname`:
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { findMemoryIntelRoot } from '../core/discovery.js';
import { extractHeadings } from '../core/headingMatch.js';
import { encodeToonTable } from '../core/toon.js';
import { ensureDaemonRunning } from '../daemon/lifecycle.js';
import { upsertRegistryEntry } from '../daemon/registry.js';

// ...ALWAYS_LOAD / DOMAIN_FILES unchanged...

// change the top of runLoad from:
//   const root = findMemoryIntelRoot(cwd);
//   if (!root) return '';
// to:
export function runLoad(cwd: string, domain?: 'technical' | 'business' | 'research'): string {
  const root = findMemoryIntelRoot(cwd);
  if (!root) return '';

  try {
    ensureDaemonRunning();
    upsertRegistryEntry(dirname(root));
  } catch {
    // Dashboard visibility is best-effort — never let it break `load`.
  }

  // ...rest of the function body is unchanged from Plan A Task 10...
```

- [ ] **Step 4: Modify `src/commands/update.ts`**

```typescript
// src/commands/update.ts — add imports:
import { dirname } from 'node:path';
import { ensureDaemonRunning } from '../daemon/lifecycle.js';
import { upsertRegistryEntry } from '../daemon/registry.js';

// at the very top of runUpdate, before decodeToonTable:
export async function runUpdate(root: string, planText: string): Promise<{ applied: string[]; skipped: string[] }> {
  try {
    ensureDaemonRunning();
    upsertRegistryEntry(dirname(root));
  } catch {
    // Dashboard visibility is best-effort — never let it break `update`.
  }

  const rows = decodeToonTable(planText) as unknown as PlanRow[];
  // ...rest of the function body is unchanged from Plan A Task 9...
```

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/commands/load.ts src/commands/update.ts tests/commands/load.test.ts tests/commands/update.test.ts
git commit -m "feat: wire lazy daemon start and registry upsert into load and update"
```

---

### Task 13: End-to-end dashboard integration test

**Files:**
- Test: `tests/daemon/e2e.test.ts`

**Interfaces:**
- Consumes: `runInit` (Plan A Task 12), `runLoad` (Plan A Task 10, as modified by Task 12 here), `startDaemon` (Task 10).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/daemon/e2e.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { runInit } from '../../src/commands/init.js';
import { runLoad } from '../../src/commands/load.js';
import { startDaemon } from '../../src/daemon/server.js';
import { readRegistry } from '../../src/daemon/registry.js';

let globalDir: string;
let projectDir: string;
let server: Server;
let port: number;

beforeEach(async () => {
  globalDir = mkdtempSync(join(tmpdir(), 'mi-e2e-dash-global-'));
  process.env.MEMORYINTEL_GLOBAL_DIR = globalDir;
  projectDir = mkdtempSync(join(tmpdir(), 'mi-e2e-dash-project-'));

  runInit(projectDir);
  runLoad(projectDir); // registers the project in the global registry

  const started = await startDaemon(0);
  server = started.server;
  port = started.port;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(globalDir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
  delete process.env.MEMORYINTEL_GLOBAL_DIR;
});

describe('dashboard end-to-end', () => {
  it('a project touched by load shows up on the registry landing page', async () => {
    expect(readRegistry()[projectDir]).toBeDefined();

    const res = await fetch(`http://127.0.0.1:${port}/`);
    const body = await res.text();
    expect(body).toContain(projectDir);
  });

  it('the project page renders the freshly initialized mental model', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/project?path=${encodeURIComponent(projectDir)}`);
    const body = await res.text();
    expect(body).toContain('No sessions yet.');
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run tests/daemon/e2e.test.ts`
Expected: PASS immediately if Tasks 1–12 are correctly implemented — this test integrates existing code only. If it fails, the failure is an integration bug in existing modules; fix that, not this test.

- [ ] **Step 3: Run the entire test suite one final time**

Run: `npx vitest run`
Expected: PASS — every test file from Tasks 1–13 green, plus all of Plan A's tests still green.

- [ ] **Step 4: Commit**

```bash
git add tests/daemon/e2e.test.ts
git commit -m "test: add end-to-end dashboard coverage from init through rendered pages"
```

---

### Task 14: Visual design pass

**Files:**
- Modify: `src/daemon/views/layout.ts`
- Modify: `src/daemon/views/registryPage.ts`
- Modify: `src/daemon/views/projectPage.ts`

**Interfaces:** none new — this task only changes markup/CSS within the existing `pageShell`/`renderRegistryPage`/`renderProjectPage` signatures from Tasks 7–9.

- [ ] **Step 1: Invoke the `frontend-design` skill**

This is a real product surface, not a debug page (per spec §8's design-quality requirement). Invoke the `frontend-design` skill against the three view files above. Bring: the rendered HTML output from Tasks 8–9's tests (or run `memoryintel daemon start` locally and view it in a browser) as the starting point, and the constraint that it must stay server-rendered HTML with no client-side framework and no new runtime dependency.

- [ ] **Step 2: Apply the resulting layout/typography/color changes**

Update `BASE_STYLES` in `layout.ts` and the markup generated by `renderRegistryPage`/`renderProjectPage` per the skill's output. Keep every existing CSS class name and HTML structural hook already asserted on by Tasks 7–9's tests unless a step below updates those tests to match intentionally.

- [ ] **Step 3: Run the full test suite to confirm no regressions**

Run: `npx vitest run`
Expected: PASS. If a genuine markup change breaks an existing assertion (e.g. a class name renamed), update that one test's expectation to match the new markup — do not weaken the assertion's intent (still asserting the same underlying content/behavior is present).

- [ ] **Step 4: Commit**

```bash
git add src/daemon/views/layout.ts src/daemon/views/registryPage.ts src/daemon/views/projectPage.ts
git commit -m "polish: apply frontend-design pass to dashboard views"
```

---

## Self-Review Notes

**Spec coverage:** daemon runtime + fixed-port-with-fallback → Tasks 2, 10, 11; lazy self-start (not init-only) → Task 5, 12; global registry upserted by `load`/`update` → Task 3, 12; global enable/disable + active stop → Task 1, 6; registry landing page + project view → Tasks 8, 9; per-tool automation status → Task 3 (`detectToolsWired`), surfaced in Task 9; staleness/health → Task 4, surfaced in Task 9; error handling (missing project path, port conflict, safe mid-update reads) → Task 8 (missing-path card), Task 2 (`pickFreePort` fallback), Plan A's atomic writes already make mid-update reads safe (no new task needed). Design-quality requirement → Task 14.

**Type consistency checked:** `RegistryEntry` shape identical across Tasks 3, 8, 9, 12. `FileHealth` shape identical across Tasks 4 and 9. `ensureDaemonRunning`/`upsertRegistryEntry` call signatures in Task 12 match their Task 5/3 definitions exactly.

**No placeholders found** on final read-through.
