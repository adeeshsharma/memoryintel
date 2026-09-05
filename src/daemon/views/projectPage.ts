import { existsSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { WRITABLE_FILES } from '../../core/pathSafety.js';
import { computeFileHealth } from '../health.js';
import { detectToolsWired } from '../registry.js';
import { getCeilingChars } from '../../core/compressionConfig.js';
import { escapeHtml, pageShell, freshnessTier, formatAge } from './layout.js';

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
      const lastUpdated = healthByFile[file]?.lastUpdated;
      const tier = freshnessTier(staleness ?? null);
      const stalenessLabel = lastUpdated ? formatAge(Date.now() - new Date(lastUpdated).getTime()) : 'never updated';
      const ceiling = getCeilingChars(memoryRoot, file);
      const sizeClass = content.length > ceiling ? 'stale' : 'muted';
      const sizeLabel = `${content.length}/${ceiling} chars`;
      return `<details><summary>${escapeHtml(file)} <span class="muted stale-label ${tier}">(${stalenessLabel})</span> <span class="${sizeClass}">${escapeHtml(sizeLabel)}</span></summary><pre>${escapeHtml(content || '(empty)')}</pre></details>`;
    }).join('\n');
    return `<h3>${escapeHtml(domain)}</h3>\n${items}`;
  });

  return sections.join('\n');
}

function readEvents(memoryRoot: string): any[] {
  const eventsPath = join(memoryRoot, 'memory-events.jsonl');
  if (!existsSync(eventsPath)) return [];
  return readFileSync(eventsPath, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// `session-load` events exist for KPI analysis (how often is this project's memory actually
// read, how many tokens does a session bootstrap cost), not to narrate "what changed" - the
// question this timeline exists to answer. A `load` fires every session start, so mixing it in
// unfiltered would bury real content changes under routine reads. Still fully inspectable via
// ?type=session-load - this only affects the unfiltered default view.
const TELEMETRY_ONLY_TYPES = new Set(['session-load']);

function renderEventTimeline(memoryRoot: string, typeFilter?: string): string {
  const events = readEvents(memoryRoot);
  if (events.length === 0) return '<p class="muted">No events yet.</p>';

  const filtered = typeFilter
    ? events.filter((e) => e.type === typeFilter)
    : events.filter((e) => !TELEMETRY_ONLY_TYPES.has(e.type));

  if (filtered.length === 0) return '<p class="muted">No events match this filter.</p>';

  // update() logs one event per file it writes, not one per `update` call - a single logical
  // checkpoint spanning N files (e.g. currentMentalModel.md + progress.md for the same change)
  // produces N events with the identical, agent-written `summary` text. Without the affected
  // file shown, two such events render as indistinguishable back-to-back lines - reads as a
  // duplicate even though they're two real, distinct writes. See business/roadmap.md "Next".
  return filtered.slice().reverse().map((e) => {
    const files = Array.isArray(e.affectedFiles) ? e.affectedFiles : [];
    const filesLabel = files.length > 0 ? `<span class="muted timeline-files">${escapeHtml(files.join(', '))}</span>` : '';
    return `<div class="timeline-entry"><span class="tag">${escapeHtml(e.type)}</span>${escapeHtml(e.summary)} ${filesLabel}<div class="muted">${escapeHtml(e.timestamp)}</div></div>`;
  }).join('\n');
}

// KPI summary for `session-load` events: how often this project's memory is actually read, and
// roughly how much it costs per read. `totalChars` on each event is what was actually loaded at
// that moment - avgTokens is a ~4-chars/token estimate (a standard approximation, not a real
// tokenizer count; load time has no access to one).
function renderSessionActivity(memoryRoot: string, projectRoot: string): string {
  const loads = readEvents(memoryRoot).filter((e) => e.type === 'session-load');
  if (loads.length === 0) return '<p class="muted">No session loads recorded yet.</p>';

  const totalChars = loads.reduce((sum, e) => sum + (typeof e.totalChars === 'number' ? e.totalChars : 0), 0);
  const avgTokens = Math.round(totalChars / loads.length / 4);
  const last = loads[loads.length - 1];
  const filterHref = `/project?path=${encodeURIComponent(projectRoot)}&type=session-load`;

  return `<p><strong>${loads.length}</strong> session load(s) recorded &middot; avg ~${avgTokens} tokens/load (est.) &middot; last: ${formatAge(Date.now() - new Date(last.timestamp).getTime())}</p>
<p class="muted"><a href="${escapeHtml(filterHref)}">view raw load events</a></p>`;
}

export function renderProjectPage(projectRoot: string, options: { typeFilter?: string } = {}): string {
  const memoryRoot = join(projectRoot, '.memoryintel');
  const mentalModelPath = join(memoryRoot, 'context', 'currentMentalModel.md');
  const mentalModel = existsSync(mentalModelPath) ? readFileSync(mentalModelPath, 'utf-8').trim() : '(no mental model yet)';

  const tools = detectToolsWired(projectRoot);
  const toolsHtml = tools.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('') || '<span class="muted">no tools wired</span>';

  const body = `
<a href="/">&larr; All projects</a>
<div class="eyebrow" style="margin-top: 1rem;">${escapeHtml(basename(projectRoot))}</div>
<h1>${escapeHtml(basename(projectRoot))}</h1>
<div class="path">${escapeHtml(projectRoot)}</div>

<h2>Current understanding</h2>
<div class="mental-model">${escapeHtml(mentalModel)}</div>

<h2>Automation status</h2>
<p>${toolsHtml}</p>

<h2>Session activity</h2>
${renderSessionActivity(memoryRoot, projectRoot)}

<h2>Memory files</h2>
${renderFileBrowser(memoryRoot)}

<h2>Event timeline</h2>
${renderEventTimeline(memoryRoot, options.typeFilter)}
`;

  return pageShell(projectRoot, body);
}
