import { beforeEach } from 'vitest';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Safety net: `runLoad`/`runUpdate` (and the built binary `cliBinary.test.ts` spawns) call
// `ensureDaemonRunning()`, which — unless MEMORYINTEL_GLOBAL_DIR is set — reads/writes the
// REAL `~/.memoryintel` and can spawn a REAL detached background daemon process on this
// machine. Most test files predate that side effect and never set the env var. Rather than
// track down and fix every call site individually, this runs before every single test in the
// suite and, only when a test hasn't already set its own isolated value, points
// MEMORYINTEL_GLOBAL_DIR at a disposable shared directory with the dashboard pre-disabled —
// so `shouldSpawnDaemon()` short-circuits to false and no real process or real file ever gets
// touched. Tests that need daemon behavior set their own MEMORYINTEL_GLOBAL_DIR in their own
// beforeEach, which always takes precedence (this runs regardless of hook registration order,
// since it only acts when the variable is unset at the moment it fires).
const FALLBACK_GLOBAL_DIR = mkdtempSync(join(tmpdir(), 'mi-test-default-global-'));
const FALLBACK_SETTINGS_PATH = join(FALLBACK_GLOBAL_DIR, 'settings.json');
if (!existsSync(FALLBACK_SETTINGS_PATH)) {
  writeFileSync(FALLBACK_SETTINGS_PATH, JSON.stringify({ dashboardEnabled: false }, null, 2) + '\n');
}

beforeEach(() => {
  if (!process.env.MEMORYINTEL_GLOBAL_DIR) {
    process.env.MEMORYINTEL_GLOBAL_DIR = FALLBACK_GLOBAL_DIR;
  }
});
