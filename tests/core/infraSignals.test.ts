import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectInfraSignals } from '../../src/core/infraSignals.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mi-infra-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('detectInfraSignals', () => {
  it('returns an empty array when no known deploy config exists', () => {
    expect(detectInfraSignals(dir)).toEqual([]);
  });

  it('detects vercel.json', () => {
    writeFileSync(join(dir, 'vercel.json'), '{}');
    expect(detectInfraSignals(dir).some((f) => f.includes('Vercel') && f.includes('vercel.json'))).toBe(true);
  });

  it('detects a .vercel/ directory', () => {
    mkdirSync(join(dir, '.vercel'));
    expect(detectInfraSignals(dir).some((f) => f.includes('Vercel'))).toBe(true);
  });

  it('detects netlify.toml', () => {
    writeFileSync(join(dir, 'netlify.toml'), '');
    expect(detectInfraSignals(dir).some((f) => f.includes('Netlify'))).toBe(true);
  });

  it('detects a Dockerfile', () => {
    writeFileSync(join(dir, 'Dockerfile'), 'FROM node:20');
    expect(detectInfraSignals(dir).some((f) => f.includes('Docker'))).toBe(true);
  });

  it('detects a GitHub Actions workflow referencing a known deploy action', () => {
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    writeFileSync(
      join(dir, '.github', 'workflows', 'deploy.yml'),
      'jobs:\n  deploy:\n    steps:\n      - uses: amondnet/vercel-action@v25\n'
    );
    expect(detectInfraSignals(dir).some((f) => f.includes('Vercel') && f.includes('workflow'))).toBe(true);
  });

  it('does not report a workflow file with no recognized deploy action', () => {
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'jobs:\n  test:\n    steps:\n      - run: npm test\n');
    expect(detectInfraSignals(dir)).toEqual([]);
  });

  it('reports multiple independent signals together', () => {
    writeFileSync(join(dir, 'vercel.json'), '{}');
    writeFileSync(join(dir, 'Dockerfile'), 'FROM node:20');
    const result = detectInfraSignals(dir);
    expect(result.some((f) => f.includes('Vercel'))).toBe(true);
    expect(result.some((f) => f.includes('Docker'))).toBe(true);
  });
});
