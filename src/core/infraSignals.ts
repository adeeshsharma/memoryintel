import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface FileSignal {
  relPath: string; // relative to targetDir; a directory path is checked with existsSync too
  fact: string;
}

// Presence-only, no version/config parsing. Vercel gets two independent signals
// (vercel.json and .vercel/) since either alone is common depending on whether the project was
// ever linked locally via `vercel link` vs. only ever deployed through the dashboard/CI.
const FILE_SIGNALS: FileSignal[] = [
  { relPath: 'vercel.json', fact: 'Vercel' },
  { relPath: '.vercel', fact: 'Vercel' },
  { relPath: 'netlify.toml', fact: 'Netlify' },
  { relPath: 'Dockerfile', fact: 'Docker' },
  { relPath: 'docker-compose.yml', fact: 'Docker Compose' },
  { relPath: 'fly.toml', fact: 'Fly.io' },
  { relPath: 'render.yaml', fact: 'Render' },
  { relPath: 'wrangler.toml', fact: 'Cloudflare Workers (via Wrangler)' },
  { relPath: 'Procfile', fact: 'Heroku (or Heroku-compatible, via Procfile)' }
];

// Known deploy-action name fragments to grep for inside .github/workflows/*.yml - deliberately
// substring matches (not parsing the `uses:` field structurally), since a real YAML parser is
// more machinery than a best-effort signal needs and every real deploy-action reference contains
// one of these fragments regardless of version pin or org fork.
const WORKFLOW_DEPLOY_ACTIONS: { fragment: string; fact: string }[] = [
  { fragment: 'vercel-action', fact: 'Vercel' },
  { fragment: 'amondnet/vercel', fact: 'Vercel' },
  { fragment: 'netlify/actions', fact: 'Netlify' },
  { fragment: 'nwtgck/actions-netlify', fact: 'Netlify' },
  { fragment: 'superfly/flyctl-actions', fact: 'Fly.io' },
  { fragment: 'aws-actions/', fact: 'AWS (via GitHub Actions)' },
  { fragment: 'google-github-actions/', fact: 'Google Cloud (via GitHub Actions)' },
  { fragment: 'azure/webapps-deploy', fact: 'Azure' }
];

function detectWorkflowSignals(targetDir: string): string[] {
  const workflowsDir = join(targetDir, '.github', 'workflows');
  if (!existsSync(workflowsDir)) return [];

  let files: string[];
  try {
    files = readdirSync(workflowsDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  } catch {
    return [];
  }

  const found = new Set<string>();
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(join(workflowsDir, file), 'utf-8');
    } catch {
      continue;
    }
    for (const { fragment, fact } of WORKFLOW_DEPLOY_ACTIONS) {
      if (content.includes(fragment)) {
        found.add(`${fact} — via \`${file}\` GitHub Actions workflow`);
      }
    }
  }
  return [...found];
}

// Best-effort only, by design: no dependency-based signal exists for "where is this deployed"
// (a project deployed via a hosting platform's dashboard, connected straight to its git remote,
// can leave zero trace in the repo itself - confirmed on a real project during this feature's own
// design). Returns an empty array when nothing is found; the caller decides how to render that
// as an explicit "no signal" statement rather than silence (see factSync.ts).
export function detectInfraSignals(targetDir: string): string[] {
  const found = new Set<string>();

  for (const { relPath, fact } of FILE_SIGNALS) {
    if (existsSync(join(targetDir, relPath))) {
      found.add(`${fact} — via \`${relPath}\``);
    }
  }

  for (const line of detectWorkflowSignals(targetDir)) {
    found.add(line);
  }

  return [...found];
}
