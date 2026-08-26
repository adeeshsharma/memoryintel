import { describe, it, expect } from 'vitest';
import { dispatch } from '../src/cli.js';

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
    for (const command of ['init', 'scan', 'import', 'load', 'update', 'status', 'check-stop']) {
      expect(usage).toContain(command);
    }
  });
});
