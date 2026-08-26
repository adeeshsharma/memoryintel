import { existsSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { escapeHtml, pageShell, freshnessTier, daysSince } from './layout.js';
import type { RegistryEntry } from '../registry.js';

function mentalModelPreview(projectPath: string): string {
  const path = join(projectPath, '.memoryintel', 'context', 'currentMentalModel.md');
  if (!existsSync(path)) return '(no mental model yet)';
  return readFileSync(path, 'utf-8').trim().split('\n')[0] ?? '(empty)';
}

const DASHBOARD_CONTROLS = `
<div class="dashboard-controls">
  <form method="POST" action="/stop">
    <button type="submit" class="btn-stop">Stop dashboard</button>
  </form>
  <p class="muted">Stops the daemon and disables the dashboard for every Memory Intel project on this machine. <code>memoryintel dashboard enable</code> turns it back on, or it starts itself again the next time any project needs it.</p>
</div>
`;

export function renderRegistryPage(entries: Record<string, RegistryEntry>): string {
  const projectPaths = Object.keys(entries);

  if (projectPaths.length === 0) {
    return pageShell('Memory Intel', `
<div class="eyebrow">Memory Intel</div>
<h1>Project registry</h1>
<p class="empty-state">No projects registered yet. Run <code>memoryintel init</code> in a project to see it here.</p>
${DASHBOARD_CONTROLS}
`);
  }

  const cards = projectPaths.map((path) => {
    const entry = entries[path];
    if (!existsSync(path)) {
      return `<div class="card missing stale">
  <strong>${escapeHtml(basename(path))}</strong>
  <div class="path">${escapeHtml(path)}</div>
  <p>(missing — this project's directory no longer exists)</p>
</div>`;
    }

    const preview = mentalModelPreview(path);
    const tier = freshnessTier(daysSince(entry.lastSessionAt));
    const tools = entry.toolsWired.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('') || '<span class="muted">no tools wired</span>';

    return `<div class="card ${tier}">
  <h3><a href="/project?path=${encodeURIComponent(path)}">${escapeHtml(basename(path))}</a></h3>
  <div class="path">${escapeHtml(path)}</div>
  <p class="mental-model" style="font-size: 1rem; margin-top: 0.6rem;">${escapeHtml(preview)}</p>
  <p class="muted">Last session: ${escapeHtml(entry.lastSessionAt)}</p>
  <p>${tools}</p>
</div>`;
  });

  return pageShell('Memory Intel', `
<div class="eyebrow">Memory Intel</div>
<h1>Project registry</h1>
${cards.join('\n')}
${DASHBOARD_CONTROLS}
`);
}
