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
