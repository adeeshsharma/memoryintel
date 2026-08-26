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

  it('distinguishes two real events that share the same summary text (one update() call writing two files)', () => {
    // update() logs one event per file it writes - a single checkpoint that touches both
    // currentMentalModel.md and progress.md for the same change produces two events whose
    // `summary` is identical, since both rows in the same update-plan reused the same reason.
    // Without showing which file each event actually touched, they render as an apparent
    // duplicate. Reported directly: a user glancing at the dashboard mid-project saw what
    // looked like "the same timeline item twice."
    writeFileSync(join(memoryRoot, 'memory-events.jsonl'), [
      JSON.stringify({ timestamp: '2026-08-22T20:48:53.602Z', type: 'memory-update', summary: 'Phase 8 complete', affectedFiles: ['context/currentMentalModel.md'] }),
      JSON.stringify({ timestamp: '2026-08-22T20:48:53.603Z', type: 'memory-update', summary: 'Phase 8 complete', affectedFiles: ['context/progress.md'] })
    ].join('\n') + '\n');

    const html = renderProjectPage(projectRoot);
    expect(html).toContain('context/currentMentalModel.md');
    expect(html).toContain('context/progress.md');
  });

  it('shows per-tool automation status', () => {
    mkdirSync(join(projectRoot, '.cursor', 'rules'), { recursive: true });
    writeFileSync(join(projectRoot, '.cursor', 'rules', 'memoryintel.mdc'), '---\nalwaysApply: true\n---\n');
    expect(renderProjectPage(projectRoot)).toContain('cursor');
  });

  // Reported directly: a real project's dashboard showed "cursor"/"agents-md" but never
  // "claude-code", even though Claude drove every session - the old check looked for
  // .claude/settings.json, which init never writes (Claude automation is plugin-hook based).
  // .session-marker.json only exists once the Stop hook has actually fired for this project.
  it('reports claude-code once the Stop hook has actually run for this project', () => {
    writeFileSync(join(memoryRoot, '.session-marker.json'), JSON.stringify({ lastFlaggedDiffSignature: null }));
    expect(renderProjectPage(projectRoot)).toContain('claude-code');
  });

  it('shows a lines/ceiling size label for a memory file', () => {
    const html = renderProjectPage(projectRoot);
    expect(html).toMatch(/\d+\/\d+ lines/);
  });

  // A day-only staleness label ("0d ago") is indistinguishable for anything updated in the last
  // 24h - exactly the window an actively-worked project's files sit in most of the time.
  it('shows a minutes/hours-resolution staleness label for a file updated moments ago, not "0d ago"', () => {
    writeFileSync(join(memoryRoot, 'memory-index.json'), JSON.stringify({
      'technical/architecture.md': { lastUpdated: new Date(Date.now() - 5 * 60 * 1000).toISOString(), summary: 'x' }
    }));
    const html = renderProjectPage(projectRoot);
    expect(html).toContain('5m ago');
    expect(html).not.toContain('0d ago');
  });

  it('shows a days-resolution staleness label once a file crosses 24h old', () => {
    writeFileSync(join(memoryRoot, 'memory-index.json'), JSON.stringify({
      'technical/architecture.md': { lastUpdated: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), summary: 'x' }
    }));
    const html = renderProjectPage(projectRoot);
    expect(html).toContain('3d ago');
  });

  // session-load events fire every session start via the SessionStart hook - mixing them
  // unfiltered into the "what changed" timeline would bury real content-change events under
  // routine reads. They're KPI telemetry, surfaced in their own "Session activity" section.
  it('excludes session-load events from the default event timeline', () => {
    writeFileSync(join(memoryRoot, 'memory-events.jsonl'), [
      JSON.stringify({ timestamp: '2026-08-22T20:48:53.602Z', type: 'session-load', summary: 'Loaded 2 file(s)', affectedFiles: ['context/currentMentalModel.md'], domain: null, totalChars: 500, totalLines: 20 }),
      JSON.stringify({ timestamp: '2026-08-22T20:49:00.000Z', type: 'memory-update', summary: 'Real content change', affectedFiles: ['technical/architecture.md'] })
    ].join('\n') + '\n');

    const html = renderProjectPage(projectRoot);
    expect(html).toContain('Real content change');
    expect(html).not.toContain('Loaded 2 file(s)');
  });

  it('still shows session-load events when explicitly filtered for', () => {
    writeFileSync(join(memoryRoot, 'memory-events.jsonl'), [
      JSON.stringify({ timestamp: '2026-08-22T20:48:53.602Z', type: 'session-load', summary: 'Loaded 2 file(s)', affectedFiles: ['context/currentMentalModel.md'], domain: null, totalChars: 500, totalLines: 20 })
    ].join('\n') + '\n');

    const html = renderProjectPage(projectRoot, { typeFilter: 'session-load' });
    expect(html).toContain('Loaded 2 file(s)');
  });

  it('shows a session activity KPI summary computed from session-load events', () => {
    writeFileSync(join(memoryRoot, 'memory-events.jsonl'), [
      JSON.stringify({ timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(), type: 'session-load', summary: 'Loaded 2 file(s)', affectedFiles: ['context/currentMentalModel.md'], domain: null, totalChars: 4000, totalLines: 20 }),
      JSON.stringify({ timestamp: new Date().toISOString(), type: 'session-load', summary: 'Loaded 5 file(s)', affectedFiles: ['context/currentMentalModel.md'], domain: 'technical', totalChars: 8000, totalLines: 40 })
    ].join('\n') + '\n');

    const html = renderProjectPage(projectRoot);
    expect(html).toContain('2</strong> session load(s) recorded');
    expect(html).toContain('view raw load events');
  });

  it('shows a "no session loads recorded yet" message when there are none', () => {
    writeFileSync(join(memoryRoot, 'memory-events.jsonl'), JSON.stringify({
      timestamp: '2026-08-22T20:48:53.602Z', type: 'memory-update', summary: 'x', affectedFiles: ['technical/architecture.md']
    }) + '\n');

    const html = renderProjectPage(projectRoot);
    expect(html).toContain('No session loads recorded yet.');
  });
});
