export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Tiers a recency value (days since some event) into the tool's one signature device: a
// three-step freshness read (fresh / aging / stale) used consistently for both "when did we
// last see this project" and "when was this memory file last touched" — the two questions
// this whole dashboard exists to answer at a glance.
export function freshnessTier(daysAgo: number | null): 'fresh' | 'aging' | 'stale' {
  if (daysAgo === null || daysAgo > 7) return 'stale';
  if (daysAgo <= 1) return 'fresh';
  return 'aging';
}

export function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
}

// A day-only label ("0d ago") is indistinguishable for anything from just now up to almost 24h
// old - on an actively-worked project nearly every file lands in that bucket, making the
// dashboard's staleness read useless right when it matters most. Minutes/hours below the 24h
// mark, days once it's crossed.
export function formatAge(ms: number): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60000);
  if (totalMinutes < 1) return 'just now';
  if (totalMinutes < 60) return `${totalMinutes}m ago`;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours}h ago`;
  const totalDays = Math.floor(totalHours / 24);
  return `${totalDays}d ago`;
}

const DISPLAY_FONT = `Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', serif`;
const BODY_FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`;
const MONO_FONT = `'SF Mono', 'Cascadia Code', 'JetBrains Mono', Consolas, 'Liberation Mono', monospace`;

const BASE_STYLES = `
  :root {
    color-scheme: light dark;
    --bg: #F6F3EC;
    --surface: #FFFFFF;
    --ink: #211D17;
    --muted: #736B5C;
    --accent: #A8752C;
    --border: rgba(33, 29, 23, 0.14);
    --fresh: #3F7D52;
    --aging: #B8853A;
    --stale: #A8514A;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #16130F;
      --surface: #201C16;
      --ink: #EEE8DA;
      --muted: #A79D8C;
      --accent: #E3AE58;
      --border: rgba(238, 232, 218, 0.16);
      --fresh: #6FAE82;
      --aging: #D9A653;
      --stale: #D97C74;
    }
  }

  * { box-sizing: border-box; }
  body {
    font-family: ${BODY_FONT};
    background: var(--bg);
    color: var(--ink);
    max-width: 720px;
    margin: 3rem auto;
    padding: 0 1.25rem 4rem;
    line-height: 1.55;
  }
  h1, h2, h3 { font-family: ${DISPLAY_FONT}; line-height: 1.2; font-weight: 600; margin: 0 0 0.5rem; }
  h1 { font-size: 1.6rem; }
  h2 { font-size: 1.15rem; margin-top: 2rem; color: var(--muted); font-weight: 600; letter-spacing: 0.01em; }
  a { color: var(--accent); text-decoration: none; }
  a:hover, a:focus-visible { text-decoration: underline; }
  a:focus-visible, summary:focus-visible, button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .eyebrow {
    font-family: ${MONO_FONT};
    font-size: 0.72rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 0.35rem;
  }
  .path {
    font-family: ${MONO_FONT};
    font-size: 0.82rem;
    color: var(--muted);
    word-break: break-all;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-left: 3px solid var(--border);
    border-radius: 6px;
    padding: 1.1rem 1.2rem;
    margin-bottom: 1rem;
    animation: rise 0.25s ease-out backwards;
  }
  .card.fresh { border-left-color: var(--fresh); }
  .card.aging { border-left-color: var(--aging); }
  .card.stale { border-left-color: var(--stale); }
  .card:nth-of-type(2) { animation-delay: 0.03s; }
  .card:nth-of-type(3) { animation-delay: 0.06s; }
  .card:nth-of-type(4) { animation-delay: 0.09s; }
  @keyframes rise {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .card { animation: none; }
  }

  .muted { opacity: 0.75; color: var(--muted); font-size: 0.9em; }
  .missing { opacity: 0.6; font-style: italic; }

  .mental-model {
    font-family: ${DISPLAY_FONT};
    font-size: 1.15rem;
    font-style: italic;
    border-left: 3px solid var(--accent);
    padding-left: 1rem;
    margin: 0.5rem 0 0;
    white-space: pre-wrap;
  }

  pre {
    font-family: ${MONO_FONT};
    font-size: 0.85rem;
    white-space: pre-wrap;
    word-break: break-word;
    background: color-mix(in srgb, currentColor 6%, transparent);
    padding: 0.75rem;
    border-radius: 6px;
    margin: 0.5rem 0 0;
  }

  .tag {
    display: inline-block;
    font-family: ${MONO_FONT};
    font-size: 0.72rem;
    border-radius: 999px;
    padding: 0.15em 0.75em;
    background: color-mix(in srgb, currentColor 10%, transparent);
    margin: 0 0.4em 0.4em 0;
  }

  details {
    border-bottom: 1px solid var(--border);
    padding: 0.5rem 0;
  }
  details:last-child { border-bottom: none; }
  summary {
    cursor: pointer;
    font-family: ${MONO_FONT};
    font-size: 0.88rem;
  }
  summary .stale-label.fresh { color: var(--fresh); }
  summary .stale-label.aging { color: var(--aging); }
  summary .stale-label.stale { color: var(--stale); }

  .timeline-entry {
    position: relative;
    padding-left: 1rem;
    border-left: 2px solid var(--border);
    padding-bottom: 1rem;
    margin-bottom: 0;
  }
  .timeline-entry:last-child { padding-bottom: 0; }
  .timeline-files { display: block; font-family: var(--mono, monospace); font-size: 0.82em; }
  .timeline-entry::before {
    content: '';
    position: absolute;
    left: -5px;
    top: 0.3rem;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
  }

  .empty-state {
    font-family: ${DISPLAY_FONT};
    font-style: italic;
    color: var(--muted);
    padding: 2rem 0;
  }

  .dashboard-controls {
    margin-top: 3rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--border);
  }
  .btn-stop {
    font-family: ${BODY_FONT};
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--stale);
    background: color-mix(in srgb, var(--stale) 10%, var(--surface));
    border: 1px solid var(--stale);
    border-radius: 6px;
    padding: 0.5rem 1rem;
    cursor: pointer;
  }
  .btn-stop:hover { background: color-mix(in srgb, var(--stale) 18%, var(--surface)); }
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
