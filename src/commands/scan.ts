import { relative } from 'node:path';
import { walkFiles, detectStack, buildImportGraph, findDocs, IGNORED_DIRS } from '../core/repoScan.js';
import { runGitChurn } from '../core/gitPorcelain.js';

// git log's own history knows nothing about walkFiles' ignore list - filter separately so
// memoryintel's own bookkeeping (or a checked-in node_modules/vendor dir) doesn't drown out
// real churn signal.
function isIgnoredPath(relPath: string): boolean {
  return relPath.split(/[/\\]/).some((segment) => IGNORED_DIRS.has(segment));
}

// A quick, deterministic, no-LLM digest of an existing codebase - the brownfield equivalent of
// `load`. Never writes anything; the agent reads this once and uses its own judgment to decide
// what belongs in architecture.md/patterns.md/etc; the point is to make that read cheap by
// pointing at the files most likely to matter, instead of the agent reading the tree cold.
export function runScan(targetDir: string): string {
  const lines: string[] = [];
  const files = walkFiles(targetDir);

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

  lines.push('', '=== Most-Changed Files (git churn, last 1000 commits) ===');
  const churn = runGitChurn(targetDir).filter((c) => !isIgnoredPath(c.path)).slice(0, 10);
  if (churn.length === 0) {
    lines.push('(not a git repository, or no commit history)');
  } else {
    for (const c of churn) lines.push(`${c.path} (${c.changes} commits)`);
  }

  lines.push('', '=== Most-Imported Files (hub files, JS/TS/Python only) ===');
  const hubs = buildImportGraph(targetDir, files);
  if (hubs.length === 0) {
    lines.push('(no local import graph detected)');
  } else {
    for (const h of hubs) lines.push(`${relative(targetDir, h.path)} (imported by ${h.importedByCount} file(s))`);
  }

  lines.push('', '=== Documentation Found (excluding README.md / ARCHITECTURE.md, already covered by `import`) ===');
  const docs = findDocs(targetDir, files);
  if (docs.length === 0) {
    lines.push('(none found)');
  } else {
    for (const d of docs) lines.push(`${d.path}: ${d.title}`);
  }

  return lines.join('\n') + '\n';
}
