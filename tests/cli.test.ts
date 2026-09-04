import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatch } from '../src/cli.js';
import { runInit } from '../src/commands/init.js';

describe('cli dispatch', () => {
  it('returns a usage message and exit code 1 for an unknown command', () => {
    const result = dispatch(['unknown-command']);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('Usage: memoryintel');
  });

  it('returns exit code 0 and usage for no command', () => {
    const result = dispatch([]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: memoryintel');
  });

  it('documents every implemented command in the usage text', () => {
    const usage = dispatch([]).stdout;
    for (const command of ['init', 'scan', 'import', 'load', 'update', 'status', 'check-stop', 'doctor']) {
      expect(usage).toContain(command);
    }
  });

  it('doctor errors cleanly when no .memoryintel/ exists', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'mi-cli-doctor-empty-'));
    const originalCwd = process.cwd();
    process.chdir(emptyDir);
    try {
      const result = dispatch(['doctor']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('No .memoryintel/ found');
    } finally {
      process.chdir(originalCwd);
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('doctor reports up to date right after init, and applies --force when passed', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'mi-cli-doctor-'));
    const originalCwd = process.cwd();
    try {
      runInit(projectDir);
      process.chdir(projectDir);
      const result = dispatch(['doctor']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('instructions.md: up to date');

      const forced = dispatch(['doctor', '--force']);
      expect(forced.exitCode).toBe(0);
      expect(forced.stdout).toContain('instructions.md');
    } finally {
      process.chdir(originalCwd);
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('--root targets an explicit project directory regardless of cwd', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'mi-cli-root-flag-'));
    const unrelatedDir = mkdtempSync(join(tmpdir(), 'mi-cli-root-flag-elsewhere-'));
    const originalCwd = process.cwd();
    try {
      runInit(projectDir);
      process.chdir(unrelatedDir); // deliberately NOT projectDir - this is the whole point
      const result = dispatch(['status', '--root', projectDir]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(join(projectDir, '.memoryintel'));
    } finally {
      process.chdir(originalCwd);
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(unrelatedDir, { recursive: true, force: true });
    }
  });

  it('MEMORYINTEL_ROOT env var works the same way as --root, for a session-start hook that can\'t easily pass CLI flags', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'mi-cli-root-env-'));
    const unrelatedDir = mkdtempSync(join(tmpdir(), 'mi-cli-root-env-elsewhere-'));
    const originalCwd = process.cwd();
    process.env.MEMORYINTEL_ROOT = projectDir;
    try {
      runInit(projectDir);
      process.chdir(unrelatedDir);
      const result = dispatch(['status']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(join(projectDir, '.memoryintel'));
    } finally {
      delete process.env.MEMORYINTEL_ROOT;
      process.chdir(originalCwd);
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(unrelatedDir, { recursive: true, force: true });
    }
  });

  it('--root takes precedence over MEMORYINTEL_ROOT when both are given', () => {
    const flagDir = mkdtempSync(join(tmpdir(), 'mi-cli-root-precedence-flag-'));
    const envDir = mkdtempSync(join(tmpdir(), 'mi-cli-root-precedence-env-'));
    const originalCwd = process.cwd();
    process.env.MEMORYINTEL_ROOT = envDir;
    try {
      runInit(flagDir);
      runInit(envDir);
      process.chdir(tmpdir());
      const result = dispatch(['status', '--root', flagDir]);
      expect(result.stdout).toContain(join(flagDir, '.memoryintel'));
      expect(result.stdout).not.toContain(join(envDir, '.memoryintel'));
    } finally {
      delete process.env.MEMORYINTEL_ROOT;
      process.chdir(originalCwd);
      rmSync(flagDir, { recursive: true, force: true });
      rmSync(envDir, { recursive: true, force: true });
    }
  });
});
