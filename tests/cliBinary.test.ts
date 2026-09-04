import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInit } from '../src/commands/init.js';
import { encodeToonTable } from '../src/core/toon.js';

// These tests drive the REAL built binary as a child process, the way Claude Code's hooks and a
// human shell invoke it. Every other CLI test calls dispatch() in-process, which cannot observe
// main()'s process-level behavior: stdout flushing on exit, exit codes, or top-level error
// handling. dist/ is rebuilt by tests/globalSetup.ts before this file runs.
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

const BIG = 64 * 1024 * 1024;

let projectDir: string;

beforeEach(() => { projectDir = mkdtempSync(join(tmpdir(), 'mi-bin-')); });
afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

function run(args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: projectDir,
    encoding: 'utf-8',
    maxBuffer: BIG
  });
}

describe('built binary: piped stdout is never truncated', () => {
  it.skipIf(process.platform === 'win32')(
    'writes the full ~400KB of load output through a real pipe (regression: process.exit truncated at 64KB)',
    () => {
      runInit(projectDir);

      // ~400KB of context, well past a 64KB pipe buffer, with a sentinel at the very end so a
      // truncated stream is detectable by content as well as by byte count.
      const filler = Array.from({ length: 4000 }, (_, i) => `line ${i} ${'x'.repeat(90)}`).join('\n');
      const activeContext = `## Current Focus\n${filler}\nEND-OF-CONTEXT-SENTINEL\n`;
      writeFileSync(join(projectDir, '.memoryintel', 'context', 'activeContext.md'), activeContext);

      // Baseline: capture the output where truncation cannot happen (child writes to a file).
      const outFile = join(projectDir, 'out.txt');
      const redirected = spawnSync(
        '/bin/sh',
        ['-c', `"${process.execPath}" "${CLI}" load > "${outFile}"`],
        { cwd: projectDir, encoding: 'utf-8', maxBuffer: BIG }
      );
      expect(redirected.status).toBe(0);
      const expectedBytes = Buffer.byteLength(readFileSync(outFile, 'utf-8'));
      expect(expectedBytes).toBeGreaterThan(300_000);

      // The real thing: stdout is a pipe, exactly as when Claude Code runs the SessionStart hook.
      const piped = spawnSync(
        '/bin/sh',
        ['-c', `"${process.execPath}" "${CLI}" load | wc -c`],
        { cwd: projectDir, encoding: 'utf-8', maxBuffer: BIG }
      );
      expect(piped.status).toBe(0);
      const pipedBytes = Number(piped.stdout.trim());

      expect(pipedBytes).not.toBe(65536);
      expect(pipedBytes).toBe(expectedBytes);

      // And the same via a directly-piped (non-shell) child, which is how spawn() consumers see it.
      const direct = run(['load']);
      expect(direct.status).toBe(0);
      expect(Buffer.byteLength(direct.stdout)).toBe(expectedBytes);
      expect(direct.stdout).toContain('END-OF-CONTEXT-SENTINEL');
    }
  );
});

describe('built binary: update end-to-end', () => {
  it('applies a plan file and exits 0 (this path bypasses dispatch() entirely)', () => {
    runInit(projectDir);
    const archPath = join(projectDir, '.memoryintel', 'technical', 'architecture.md');
    const before = readFileSync(archPath, 'utf-8');

    const planPath = join(projectDir, 'plan.toon');
    writeFileSync(planPath, encodeToonTable([
      {
        file: 'technical/architecture.md',
        action: 'append',
        section: 'Overview',
        content: 'JWT refresh token architecture introduced',
        reason: 'new auth flow'
      }
    ]));

    const result = run(['update', planPath]);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Applied: technical/architecture.md');

    const after = readFileSync(archPath, 'utf-8');
    expect(after).not.toBe(before);
    expect(after).toContain('JWT refresh token architecture introduced');

    const events = readFileSync(join(projectDir, '.memoryintel', 'memory-events.jsonl'), 'utf-8').trim();
    expect(JSON.parse(events).type).toBe('memory-update');
  });

  // update's plan-file argument lives in main(), not dispatch() - the only path that spawns the
  // real binary and can observe --root's positional-stripping logic (argv.filter over --root and
  // its value) actually working end to end, not just in isolation.
  it('applies a plan given via --root while cwd is a different, unrelated directory', () => {
    runInit(projectDir);
    const unrelatedDir = mkdtempSync(join(tmpdir(), 'mi-bin-root-elsewhere-'));
    try {
      const archPath = join(projectDir, '.memoryintel', 'technical', 'architecture.md');
      const planPath = join(projectDir, 'plan.toon');
      writeFileSync(planPath, encodeToonTable([
        {
          file: 'technical/architecture.md',
          action: 'append',
          section: 'Overview',
          content: 'Applied via --root from an unrelated cwd',
          reason: '--root regression test'
        }
      ]));

      const result = spawnSync(process.execPath, [CLI, 'update', '--root', projectDir, planPath], {
        cwd: unrelatedDir,
        encoding: 'utf-8',
        maxBuffer: BIG
      });
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`root: ${projectDir}`);
      expect(result.stdout).toContain('Applied: technical/architecture.md');
      expect(readFileSync(archPath, 'utf-8')).toContain('Applied via --root from an unrelated cwd');
    } finally {
      rmSync(unrelatedDir, { recursive: true, force: true });
    }
  });

  it('reports a missing plan file as a one-line error, not a stack trace', () => {
    runInit(projectDir);
    const result = run(['update', join(projectDir, 'does-not-exist.toon')]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ENOENT');
    expect(result.stderr.trim().split('\n')).toHaveLength(1);
    expect(result.stderr).not.toContain('    at ');
  });

  // Caught live via a real claude -p --plugin-dir session: an agent ran bare `memoryintel
  // update` as a one-shot Bash tool call - no plan-file argument, no stdin piped in. spawnSync
  // with no `input` gives the child an immediately-EOF stdin, exactly like a Bash-tool
  // invocation, so `source` fell back to '-' (read stdin) and got empty content. That used to
  // fall through to decodeToonTable's generic "Malformed TOON table header" error, which gave
  // the agent no way to tell "you forgot the plan file" from "the file itself is corrupt".
  it('reports a clear, actionable error for bare `memoryintel update` with no plan file and no piped stdin', () => {
    runInit(projectDir);
    const result = run(['update']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('No update-plan given');
    expect(result.stderr).toContain('memoryintel update <path>');
    expect(result.stderr).not.toContain('Malformed TOON table header');
    expect(result.stderr).not.toContain('    at ');
  });

  it('still accepts a plan piped over stdin (the documented `-` behavior)', () => {
    runInit(projectDir);
    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'append', section: 'Overview', content: 'Piped plan applied', reason: 'stdin path' }
    ]);
    // spawnSync's own `input` option pipes directly to the child's stdin, with no shell
    // involved - shelling out to /bin/sh for `echo ... | cli` doesn't exist on windows-latest
    // (spawnSync fails to find it, status comes back null, not a real exit code). Caught by CI.
    const piped = spawnSync(process.execPath, [CLI, 'update'], { cwd: projectDir, input: plan, encoding: 'utf-8', maxBuffer: BIG });
    expect(piped.status).toBe(0);
    expect(piped.stdout).toContain('Applied: technical/architecture.md');
  });
});

describe('built binary: top-level error handling', () => {
  it('reports an unknown --domain clearly instead of crashing with a stack trace', () => {
    runInit(projectDir);
    const result = run(['load', '--domain', 'bogus']);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Unknown domain "bogus"');
    expect(result.stderr).not.toContain('    at ');
    expect(result.stderr.trim().split('\n')).toHaveLength(1);
  });

  it('reports a corrupt memory-index.json under status clearly instead of a raw JSON parse crash', () => {
    runInit(projectDir);
    writeFileSync(join(projectDir, '.memoryintel', 'memory-index.json'), '{ this is not json');

    const result = run(['status']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Corrupt memory index');
    expect(result.stderr).not.toContain('    at ');
    expect(result.stderr.trim().split('\n')).toHaveLength(1);
  });

  it('exits 0 and prints usage listing every command when run with no arguments', () => {
    const result = run([]);
    expect(result.status).toBe(0);
    for (const command of ['init', 'load', 'update', 'status', 'check-stop']) {
      expect(result.stdout).toContain(command);
    }
  });
});

describe('built binary: real bin-symlink invocation, not `node dist/cli.js`', () => {
  // Every other test in this file spawns `node dist/cli.js`, which never needs dist/cli.js's
  // own executable bit - Node reads and runs the file's contents directly. `npm link` /
  // `npm install -g` instead symlink the `memoryintel` command straight at dist/cli.js and rely
  // on its shebang plus the executable bit to run it. `tsc` doesn't preserve that bit, so a
  // real build (tsc, then nothing else) produced a dist/cli.js real users hit "permission
  // denied" on, invisible to every test here since none of them invoke it this way. Caught live,
  // not by this test suite - this test exists so a repeat wouldn't be invisible again.
  //
  // Windows-skipped: this is a POSIX permission-bit and shebang concept specifically. Windows
  // has no equivalent direct-execution mechanism for a .js file at all - npm link / npm install
  // -g create a .cmd shim there instead, a genuinely different mechanism this test doesn't
  // cover. Spawning a .js file directly on Windows fails for that unrelated, expected platform
  // reason, not the bug this test exists to catch - skipping avoids a false-positive failure.
  it.skipIf(process.platform === 'win32')('runs when executed directly, the way a real bin symlink invokes it', () => {
    const result = spawnSync(CLI, [], { encoding: 'utf-8' });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: memoryintel');
  });
});
