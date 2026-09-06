#!/usr/bin/env node
// Regenerates the visual assets embedded in README.md:
//   assets/architecture-flow.svg    - animated architecture diagram (pure SVG+CSS, no browser)
//   assets/dashboard-demo.{gif,mp4} - real dashboard UI walkthrough (headless Chromium + ffmpeg)
//   assets/cli-walkthrough.{gif,mp4} - real CLI session in a lightweight custom terminal UI
//                                      (headless Chromium + ffmpeg) - every command shown is an
//                                      actual invocation of the built CLI, not a typed transcript
//
// Not run in CI and not a project dependency - playwright is heavy and this only needs to run
// when the dashboard UI, the CLI's output shape, or the diagram's narrative actually changes.
// Prerequisites, once:
//   npm install --no-save playwright && npx playwright install chromium
//   ffmpeg on PATH (brew install ffmpeg)
//
// Usage: node scripts/generate-readme-assets.mjs [--diagram-only|--dashboard-only|--cli-only]

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const ASSETS_DIR = join(REPO_ROOT, 'assets');
mkdirSync(ASSETS_DIR, { recursive: true });

// Shared by both video assets: a headless-captured PNG frame sequence becomes a full MP4 (linked
// from the README - smaller and higher quality than an equivalent-length GIF) plus a short,
// autoplaying GIF trimmed to just the first `shortFrameCount` frames (the "hook"). GitHub only
// autoplays a GIF referenced from a repo-relative path, never an MP4, which is the whole reason
// both formats exist rather than just picking one.
function encodeFrames(framesDir, outBase, { fps = 10, scaleWidth = 900, shortFrameCount } = {}) {
  const totalFrames = readdirSync(framesDir).filter((f) => f.endsWith('.png')).length;
  console.log(`Captured ${totalFrames} frames for ${outBase}, encoding...`);

  execFileSync('ffmpeg', ['-y', '-framerate', String(fps), '-i', join(framesDir, 'frame-%03d.png'),
    '-vf', `scale=${scaleWidth}:-2:flags=lanczos,format=yuv420p`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    join(ASSETS_DIR, `${outBase}.mp4`)]);
  console.log(`Wrote assets/${outBase}.mp4`);

  const gifFrameCount = shortFrameCount ?? totalFrames;
  const palettePath = join(framesDir, 'palette.png');
  execFileSync('ffmpeg', ['-y', '-start_number', '0', '-framerate', String(fps), '-i', join(framesDir, 'frame-%03d.png'),
    '-frames:v', String(gifFrameCount),
    '-vf', `fps=${fps},scale=${scaleWidth}:-1:flags=lanczos,palettegen=stats_mode=diff`, palettePath]);
  execFileSync('ffmpeg', ['-y', '-start_number', '0', '-framerate', String(fps), '-i', join(framesDir, 'frame-%03d.png'), '-i', palettePath,
    '-frames:v', String(gifFrameCount),
    '-lavfi', `fps=${fps},scale=${scaleWidth}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer`, '-loop', '0',
    join(ASSETS_DIR, `${outBase}.gif`)]);
  console.log(`Wrote assets/${outBase}.gif`);
}

function makeShotter(page, framesDir, fps) {
  let frame = 0;
  return async (holdSeconds = 0.15) => {
    const path = join(framesDir, `frame-${String(frame).padStart(3, '0')}.png`);
    await page.screenshot({ path });
    frame++;
    const holdFrames = Math.round(holdSeconds * fps);
    for (let i = 0; i < holdFrames; i++) {
      execFileSync('cp', [path, join(framesDir, `frame-${String(frame).padStart(3, '0')}.png`)]);
      frame++;
    }
    return frame;
  };
}

// ---------------------------------------------------------------------------
// Architecture diagram
// ---------------------------------------------------------------------------

function generateArchitectureSvg() {
  // Colors are the dataviz skill's validated categorical slots (blue/violet/aqua, plus orange
  // as a distinct "write" accent) - `node scripts/validate_palette.js` on these four passes both
  // light and dark. Kept as CSS custom properties so the two @media blocks are the only place
  // light/dark actually differs.
  const folder = (x, y, name) => `
<rect class="subfolder" x="${x}" y="${y}" width="150" height="60" rx="8"/>
<text class="mono ink" x="${x + 75}" y="${y + 35}" text-anchor="middle">${name}</text>`;

  const svg = `<svg viewBox="0 0 1180 520" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif">
<style>
  :root { color-scheme: light dark; }
  .surface { fill: #fcfcfb; }
  .ink { fill: #0b0b0b; }
  .ink2 { fill: #52514e; }
  .node-a { fill: #2a78d6; }
  .node-c { fill: #1baf7a; }
  .storage-border { stroke: #4a3aa7; fill: none; }
  .subfolder { fill: color-mix(in srgb, #4a3aa7 10%, transparent); stroke: #4a3aa7; stroke-opacity: 0.35; }
  .accent-read { stroke: #4a3aa7; }
  .accent-write { stroke: #eb6834; }
  .loop { stroke: #898781; }
  @media (prefers-color-scheme: dark) {
    .surface { fill: #1a1a19; }
    .ink { fill: #ffffff; }
    .ink2 { fill: #c3c2b7; }
    .node-a { fill: #3987e5; }
    .node-c { fill: #199e70; }
    .storage-border { stroke: #9085e9; }
    .subfolder { fill: color-mix(in srgb, #9085e9 14%, transparent); stroke: #9085e9; stroke-opacity: 0.4; }
    .accent-read { stroke: #9085e9; }
    .accent-write { stroke: #d95926; }
    .loop { stroke: #6b6a63; }
  }
  .label { font-size: 16px; font-weight: 600; }
  .sublabel { font-size: 11px; }
  .mono { font-family: 'SF Mono', 'Cascadia Code', 'JetBrains Mono', Consolas, monospace; font-size: 13px; }
  .cmd { font-family: 'SF Mono', 'Cascadia Code', 'JetBrains Mono', Consolas, monospace; font-size: 14px; font-weight: 700; }
  .detail { font-size: 11.5px; }
  .hook-tag { font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
  path.edge { fill: none; stroke-width: 2.5; }
  path.loop-edge { fill: none; stroke-width: 2; stroke-dasharray: 4 5; }
  circle.pulse { r: 5.5; }
  .pulse-read { fill: #4a3aa7; }
  .pulse-write { fill: #eb6834; }
  @media (prefers-color-scheme: dark) {
    .pulse-read { fill: #9085e9; }
    .pulse-write { fill: #d95926; }
  }
  @keyframes travel { from { offset-distance: 0%; opacity: 0; } 8% { opacity: 1; } 92% { opacity: 1; } to { offset-distance: 100%; opacity: 0; } }
  #pulse-load { offset-path: path("M 158,345 C 260,275 350,235 420,213"); animation: travel 2s ease-in-out infinite; animation-delay: 0s; }
  #pulse-context { offset-path: path("M 745,213 C 850,250 950,285 1022,345"); animation: travel 2s ease-in-out infinite; animation-delay: 2s; }
  #pulse-update { offset-path: path("M 1015,418 C 880,495 340,495 430,236"); animation: travel 2.4s ease-in-out infinite; animation-delay: 4s; }
  @media (prefers-reduced-motion: reduce) {
    #pulse-load, #pulse-context, #pulse-update { animation: none; opacity: 0; }
  }
</style>

<rect class="surface" width="1180" height="520" rx="10"/>

<!-- A: new session -->
<circle class="node-a" cx="120" cy="380" r="50"/>
<text class="label" x="120" y="376" text-anchor="middle" fill="white">New</text>
<text class="label" x="120" y="396" text-anchor="middle" fill="white">session</text>

<!-- storage: .memoryintel/ with real subfolders -->
<rect class="storage-border" x="420" y="40" width="340" height="200" rx="14" stroke-width="2"/>
<text class="label ink" x="590" y="65" text-anchor="middle">.memoryintel/</text>
${folder(435, 78, 'context/')}
${folder(595, 78, 'technical/')}
${folder(435, 148, 'business/')}
${folder(595, 148, 'research/')}

<!-- C: agent works -->
<circle class="node-c" cx="1060" cy="380" r="50"/>
<text class="label" x="1060" y="376" text-anchor="middle" fill="white">Agent</text>
<text class="label" x="1060" y="396" text-anchor="middle" fill="white">works</text>
<text class="sublabel ink2" x="1060" y="450" text-anchor="middle">reads/writes code,</text>
<text class="sublabel ink2" x="1060" y="464" text-anchor="middle">drafts an update-plan</text>

<!-- edges -->
<path class="edge accent-read" d="M 158,345 C 260,275 350,235 420,213"/>
<path class="edge accent-read" d="M 745,213 C 850,250 950,285 1022,345"/>
<path class="edge accent-write" d="M 1015,418 C 880,495 340,495 430,236"/>
<path class="loop-edge loop" d="M 425,50 C 320,10 210,42 150,330"/>

<text class="hook-tag ink2" x="235" y="300">SessionStart hook</text>
<text class="cmd ink" x="235" y="319">$ memoryintel load</text>
<text class="detail ink2" x="235" y="336">always: currentMentalModel.md</text>
<text class="detail ink2" x="235" y="349">+ activeContext.md</text>
<text class="detail ink2" x="235" y="365">+ domain auto-carried from</text>
<text class="detail ink2" x="235" y="378">the last update()</text>

<text class="detail ink2" x="860" y="290" text-anchor="middle">context injected</text>
<text class="detail ink2" x="860" y="304" text-anchor="middle">into the session</text>

<text class="hook-tag ink2" x="720" y="454" text-anchor="middle">Stop hook</text>
<text class="cmd ink" x="720" y="474" text-anchor="middle">$ memoryintel update</text>
<text class="detail ink2" x="720" y="491" text-anchor="middle">validates plan → atomic write → per-file lock → logs event</text>

<text class="detail ink2" x="250" y="30" text-anchor="middle">next session — sees everything just written</text>

<circle id="pulse-load" class="pulse pulse-read"/>
<circle id="pulse-context" class="pulse pulse-read"/>
<circle id="pulse-update" class="pulse pulse-write"/>
</svg>
`;
  writeFileSync(join(ASSETS_DIR, 'architecture-flow.svg'), svg);
  console.log('Wrote assets/architecture-flow.svg');
}

// ---------------------------------------------------------------------------
// Dashboard GIF
// ---------------------------------------------------------------------------

function isoDaysAgo(days, hours = 0) {
  return new Date(Date.now() - (days * 24 + hours) * 60 * 60 * 1000).toISOString();
}

function seedProject(root, { mentalModel, activeFocus, architecture, roadmap, events }) {
  mkdirSync(join(root, 'context'), { recursive: true });
  mkdirSync(join(root, 'technical'), { recursive: true });
  mkdirSync(join(root, 'business'), { recursive: true });
  writeFileSync(join(root, 'context', 'currentMentalModel.md'), mentalModel);
  writeFileSync(join(root, 'context', 'activeContext.md'), `## Current Focus\n${activeFocus}\n`);
  writeFileSync(join(root, 'technical', 'architecture.md'), architecture);
  writeFileSync(join(root, 'business', 'roadmap.md'), roadmap);
  // computeFileHealth (the "Memory files" browser's staleness/char-count labels) reads this
  // index, not the files' actual content - every file seeded with real content above needs a
  // matching entry here, or it reads as "(never updated) 0/12000 chars" despite having text.
  writeFileSync(join(root, 'memory-index.json'), JSON.stringify({
    'context/currentMentalModel.md': { lastUpdated: isoDaysAgo(0, 3), summary: 'Enterprise-tier cutover is the last piece before retiring the sync path' },
    'context/activeContext.md': { lastUpdated: isoDaysAgo(0, 3), summary: 'Focused on the enterprise tier cutover' },
    'technical/architecture.md': { lastUpdated: isoDaysAgo(0, 2), summary: 'Documented the async PDF pipeline cutover' },
    'business/roadmap.md': { lastUpdated: isoDaysAgo(1), summary: 'Reprioritized after enterprise cutover slipped a week' }
  }, null, 2));
  writeFileSync(join(root, 'memory-events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  // detectToolsWired() recomputes live from these on-disk signals (not from registry.json's
  // own toolsWired field, which only backs the registry list) - creating them for real is what
  // makes the project page's "Automation status" agree with what the registry list claims.
  writeFileSync(join(root, '.session-marker.json'), JSON.stringify({ lastFlaggedDiffSignature: null }));
}

async function generateDashboardAssets() {
  const { chromium } = await import('playwright');

  const globalDir = mkdtempSync(join(tmpdir(), 'mi-demo-global-'));
  const projectsDir = mkdtempSync(join(tmpdir(), 'mi-demo-projects-'));
  const framesDir = mkdtempSync(join(tmpdir(), 'mi-demo-frames-'));

  const mainProject = join(projectsDir, 'acme-invoicing');
  const otherProjects = [join(projectsDir, 'customer-portal'), join(projectsDir, 'analytics-dashboard')];

  try {
    mkdirSync(join(mainProject, '.memoryintel'), { recursive: true });
    seedProject(join(mainProject, '.memoryintel'), {
      mentalModel: 'Migrating PDF invoice generation off the synchronous request handler onto a queue-based worker (BullMQ + Redis). The worker path is stable and handling ~60% of traffic behind a feature flag; the sync path is still live as a fallback. Remaining work is cutting over the last customer segment (enterprise tier, which has custom PDF templates) and retiring the old code path.\n',
      activeFocus: 'Cutting the enterprise tier over to the async PDF pipeline — its custom templates were the reason it was held back from the first rollout wave.',
      architecture: '## Overview\nRails monolith (`InvoiceService`) enqueues PDF jobs; a separate Node worker (`pdf-worker`) renders and uploads them.\n\n## Components\n- `InvoiceService` (Rails) — creates invoices, enqueues render jobs\n- `pdf-worker` (Node + BullMQ) — renders via Puppeteer, uploads to S3, webhooks back on completion\n- Feature flag `async_pdf_pipeline` — gates which tenants use the worker vs. the old sync path\n\n## Data Flow\nInvoice created → job enqueued → worker renders → uploads to S3 → webhook notifies Rails → tenant notified\n',
      roadmap: '## Now\nFinish the enterprise-tier cutover to the async PDF pipeline.\n\n## Next\nAdd multi-currency support to generated invoices.\n\n## Later\nSelf-serve invoice template customization for enterprise tenants.\n',
      events: [
        { timestamp: isoDaysAgo(6), type: 'decision', summary: 'Chose BullMQ over SQS for the render queue — needed local dev parity without a real AWS account', affectedFiles: ['technical/architecture.md'] },
        { timestamp: isoDaysAgo(4), type: 'feature', summary: 'Added automatic retry with backoff to pdf-worker for transient S3 upload failures', affectedFiles: ['technical/architecture.md'] },
        { timestamp: isoDaysAgo(2), type: 'bugfix', summary: 'Fixed a race where two webhook deliveries for the same job could both mark the invoice paid', affectedFiles: ['context/decisions.md'] },
        { timestamp: isoDaysAgo(1), type: 'decision', summary: 'Held enterprise tier back from the first rollout wave — their custom PDF templates need a separate rendering path', affectedFiles: ['business/roadmap.md'] },
        { timestamp: isoDaysAgo(0, 3), type: 'memory-update', summary: 'Enterprise template rendering path now shares the same worker, just a different template resolver', affectedFiles: ['technical/architecture.md'] }
      ]
    });
    mkdirSync(join(mainProject, '.cursor', 'rules'), { recursive: true });
    writeFileSync(join(mainProject, '.cursor', 'rules', 'memoryintel.mdc'), '---\nalwaysApply: true\n---\n');

    for (const [i, p] of otherProjects.entries()) {
      mkdirSync(join(p, '.memoryintel', 'context'), { recursive: true });
      writeFileSync(join(p, '.memoryintel', 'context', 'currentMentalModel.md'), i === 0
        ? 'Rebuilding the customer-facing billing portal on the new design system. Auth and account settings pages are done; invoice history view is next.\n'
        : 'Internal analytics dashboard — instrumenting funnel drop-off for the new onboarding flow. Event pipeline is in place, dashboards are still placeholder charts.\n');
      writeFileSync(join(p, '.memoryintel', 'memory-index.json'), '{}');
      writeFileSync(join(p, '.memoryintel', 'memory-events.jsonl'), '');
    }

    const registry = {};
    const registryEntries = [
      { path: mainProject, initializedAt: isoDaysAgo(20), lastSessionAt: isoDaysAgo(0, 3), toolsWired: ['claude-code', 'cursor'] },
      { path: otherProjects[0], initializedAt: isoDaysAgo(30), lastSessionAt: isoDaysAgo(2), toolsWired: ['claude-code'] },
      { path: otherProjects[1], initializedAt: isoDaysAgo(45), lastSessionAt: isoDaysAgo(9), toolsWired: ['cursor'] }
    ];
    for (const e of registryEntries) registry[e.path] = e;
    writeFileSync(join(globalDir, 'registry.json'), JSON.stringify(registry, null, 2));
    writeFileSync(join(globalDir, 'settings.json'), JSON.stringify({ dashboardEnabled: true }));

    process.env.MEMORYINTEL_GLOBAL_DIR = globalDir;
    const { startDaemon } = await import(join(REPO_ROOT, 'dist', 'daemon', 'server.js'));
    const { port, server } = await startDaemon(0);

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    const fps = 10;
    const shot = makeShotter(page, framesDir, fps);

    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForTimeout(200);
    await shot(1.0);

    await page.click('h3 a:has-text("acme-invoicing")');
    await page.waitForTimeout(150);
    await shot(1.2);

    // Short-GIF cutoff: registry -> project -> mental model is the "hook", everything after
    // (automation status, session activity, both files, full timeline) is full-tour depth that
    // only the linked MP4 needs to carry.
    const shortFrameCount = await shot(0.4);

    await page.locator('h2', { hasText: 'Automation status' }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    await shot(1.4);

    await page.locator('h2', { hasText: 'Session activity' }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    await shot(1.4);

    const architectureSummary = page.locator('summary', { hasText: 'technical/architecture.md' });
    await architectureSummary.scrollIntoViewIfNeeded();
    await shot(0.6);
    await architectureSummary.click();
    await page.waitForTimeout(150);
    await shot(1.4);

    const roadmapSummary = page.locator('summary', { hasText: 'business/roadmap.md' });
    await roadmapSummary.scrollIntoViewIfNeeded();
    await shot(0.6);
    await roadmapSummary.click();
    await page.waitForTimeout(150);
    await shot(1.4);

    await page.locator('h2', { hasText: 'Event timeline' }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    await shot(1.6);

    await browser.close();
    await new Promise((resolve) => server.close(resolve));

    encodeFrames(framesDir, 'dashboard-demo', { fps, scaleWidth: 900, shortFrameCount });
  } finally {
    rmSync(globalDir, { recursive: true, force: true });
    rmSync(projectsDir, { recursive: true, force: true });
    rmSync(framesDir, { recursive: true, force: true });
    delete process.env.MEMORYINTEL_GLOBAL_DIR;
  }
}

// ---------------------------------------------------------------------------
// CLI walkthrough - a fake terminal window, real commands
// ---------------------------------------------------------------------------
//
// No dedicated terminal recorder was available here (vhs needs a newer Xcode than this machine
// has; asciinema/agg aren't installed) - this renders its own minimal terminal chrome instead.
// The chrome is cosmetic; every command shown actually runs against a real, freshly-init'd
// project via the built CLI, and every line of output is that command's real stdout, not typed
// out by hand.

const PROMPT = 'acme-invoicing $ ';

const TERM_STYLE = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #0d0d0d; display: flex; justify-content: center; padding-top: 24px; }
  .term { width: 960px; }
  .term-bar { background: #2b2b2b; height: 34px; border-radius: 8px 8px 0 0; display: flex; align-items: center; padding: 0 14px; gap: 8px; }
  .dot { width: 12px; height: 12px; border-radius: 50%; }
  .dot.red { background: #ff5f56; } .dot.yellow { background: #ffbd2e; } .dot.green { background: #27c93f; }
  .term-title { flex: 1; text-align: center; color: #9a9a9a; font: 12px -apple-system, sans-serif; margin-right: 60px; }
  .term-body { background: #1a1a1a; height: 620px; overflow-y: auto; padding: 18px 22px; border-radius: 0 0 8px 8px; }
  pre { margin: 0; color: #e8e8e6; font: 14px/1.6 'SF Mono', Menlo, monospace; white-space: pre-wrap; word-break: break-word; }
  .prompt { color: #6fcf70; }
  .cmd { color: #ffffff; }
  .out { color: #b8b6ad; }
  .comment { color: #6a6a68; font-style: italic; }
  .cursor { display: inline-block; width: 8px; height: 16px; background: #e8e8e6; vertical-align: text-bottom; animation: blink 1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
`;

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function termShell() {
  return `<!doctype html><html><head><style>${TERM_STYLE}</style></head><body>
<div class="term">
  <div class="term-bar"><span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span><span class="term-title">acme-invoicing — zsh</span></div>
  <div class="term-body" id="term-body"><pre id="term-pre"></pre></div>
</div>
</body></html>`;
}

async function generateCliWalkthroughAssets() {
  const { chromium } = await import('playwright');
  const CLI = join(REPO_ROOT, 'dist', 'cli.js');
  const projectDir = mkdtempSync(join(tmpdir(), 'mi-term-demo-'));
  const framesDir = mkdtempSync(join(tmpdir(), 'mi-term-frames-'));

  try {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1008, height: 700 } });
    const fps = 12;
    const shot = makeShotter(page, framesDir, fps);
    await page.setContent(termShell());

    let history = ''; // committed HTML: already-typed commands plus their real output

    const render = async (typedSoFar, showCursor) => {
      const html = `${history}<span class="prompt">${escapeHtml(PROMPT)}</span><span class="cmd">${escapeHtml(typedSoFar)}</span>${showCursor ? '<span class="cursor"></span>' : ''}`;
      await page.evaluate(({ html }) => {
        document.getElementById('term-pre').innerHTML = html;
        document.getElementById('term-body').scrollTop = 999999;
      }, { html });
    };

    const typeCommand = async (cmdText, charsPerFrame = 3) => {
      for (let i = 0; i <= cmdText.length; i += charsPerFrame) {
        await render(cmdText.slice(0, i), true);
        await shot(0);
      }
      await render(cmdText, true);
      await shot(0.3);
    };

    const commit = async (cmdText, outputText) => {
      history += `<span class="prompt">${escapeHtml(PROMPT)}</span><span class="cmd">${escapeHtml(cmdText)}</span>\n`;
      if (outputText) history += `<span class="out">${escapeHtml(outputText)}</span>\n`;
      history += '\n';
      await render('', false);
    };

    const comment = async (text) => {
      history += `<span class="comment">${escapeHtml(text)}</span>\n\n`;
      await render('', false);
      await shot(1.2);
    };

    // Every real invocation below runs the actual built CLI against a real, initially-empty
    // project directory - nothing here is a canned transcript.
    const runReal = (argv) => {
      try {
        return execFileSync(process.execPath, [CLI, ...argv], { cwd: projectDir, encoding: 'utf-8' });
      } catch (err) {
        return (err.stdout ?? '') + (err.stderr ?? '');
      }
    };

    await typeCommand('memoryintel init');
    await commit('memoryintel init', runReal(['init']).trimEnd());
    await shot(0.8);

    await typeCommand('memoryintel load');
    await commit('memoryintel load', runReal(['load']).trimEnd());
    // Short-GIF cutoff: init + the first (mostly-empty) load is the "hook" - everything past
    // this point (drafting a plan, applying it, the auto-carry-domain payoff) is full-length
    // depth that only the linked MP4 needs to carry.
    const shortFrameCount = await shot(1.4);

    const planPath = join(projectDir, 'plan.toon');
    const planText = [
      'items[2]{file,action,section,content,reason}:',
      '  "context/currentMentalModel.md","replace","","Migrating PDF invoice generation onto a queue-based worker (BullMQ + Redis). Sync path stays live as a fallback until the cutover finishes.","initial session summary"',
      '  "technical/architecture.md","append","Overview","Rails monolith enqueues jobs; a Node worker (BullMQ) renders PDFs via Puppeteer and uploads to S3.","documented initial architecture"'
    ].join('\n') + '\n';
    writeFileSync(planPath, planText);
    await typeCommand('cat plan.toon');
    await commit('cat plan.toon', planText.trimEnd());
    await shot(0.8);

    await typeCommand('memoryintel update plan.toon');
    await commit('memoryintel update plan.toon', runReal(['update', planPath]).trimEnd());
    await shot(0.8);

    // Not a scripted claim: load() genuinely auto-carries whichever domain the update above
    // touched, with no --domain flag given here.
    await comment('# no --domain given — load() auto-carries the domain the update above touched');
    await typeCommand('memoryintel load');
    await commit('memoryintel load', runReal(['load']).trimEnd());
    await shot(2.2);

    await browser.close();

    encodeFrames(framesDir, 'cli-walkthrough', { fps, scaleWidth: 1000, shortFrameCount });
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(framesDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Dispatch - after every function/const above is declared (top-level await earlier in module
// evaluation order would otherwise hit the TDZ for consts declared further down the file).
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const only = ['diagram', 'dashboard', 'cli'].find((name) => args.includes(`--${name}-only`));

if (!only || only === 'diagram') generateArchitectureSvg();
if (!only || only === 'dashboard') await generateDashboardAssets();
if (!only || only === 'cli') await generateCliWalkthroughAssets();
