import { detectStack, listTopLevel } from '../core/repoScan.js';

// A quick, deterministic, no-LLM digest of an existing codebase's stack and setup - the
// brownfield equivalent of `load`'s first orientation, nothing more. Deliberately does not try
// to infer architecture (no import graphs, no git-churn ranking, no keyword extraction): that's
// real judgment, and this project already has a mechanism for judgment - the agent's own
// accumulated `update` calls as it actually works in the repo, same as it already works for a
// greenfield project. scan's only job is to stop session one from flailing on "how do I even run
// this", not to front-load understanding a scan can't actually derive honestly.
export function runScan(targetDir: string): string {
  const lines: string[] = [];

  const stack = detectStack(targetDir);
  lines.push('=== Detected Stack ===');
  lines.push(stack.manifests.length > 0 ? `Manifests: ${stack.manifests.join(', ')}` : '(no recognized manifest found)');
  if (stack.dependencies.length > 0) {
    const shown = stack.dependencies.slice(0, 30);
    const suffix = stack.dependencies.length > 30 ? ` (+${stack.dependencies.length - 30} more)` : '';
    lines.push(`Dependencies: ${shown.join(', ')}${suffix}`);
  }
  if (Object.keys(stack.scripts).length > 0) {
    lines.push(`Scripts: ${Object.entries(stack.scripts).map(([k, v]) => `${k}="${v}"`).join(', ')}`);
  }
  if (stack.entryPoints.length > 0) lines.push(`Entry points: ${stack.entryPoints.join(', ')}`);

  lines.push('', '=== Top-Level Layout ===');
  const topLevel = listTopLevel(targetDir);
  lines.push(topLevel.length > 0 ? topLevel.join(', ') : '(empty directory)');

  return lines.join('\n') + '\n';
}
