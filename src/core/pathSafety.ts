import { join, resolve, relative, isAbsolute } from 'node:path';

export const WRITABLE_FILES = [
  'context/projectBrief.md',
  'context/objectives.md',
  'context/activeContext.md',
  'context/decisions.md',
  'context/progress.md',
  'context/learnings.md',
  'context/currentMentalModel.md',
  'technical/architecture.md',
  'technical/techContext.md',
  'technical/patterns.md',
  'technical/integrations.md',
  'technical/infrastructure.md',
  'business/productContext.md',
  'business/roadmap.md',
  'business/stakeholders.md',
  'business/marketContext.md',
  'research/findings.md',
  'research/references.md',
  'research/hypotheses.md'
] as const;

export class UnsafePathError extends Error {
  constructor(relFile: string) {
    super(`"${relFile}" is not a recognized Memory Intel file and cannot be written.`);
  }
}

export function assertSafePath(root: string, relFile: string): string {
  if (isAbsolute(relFile) || !(WRITABLE_FILES as readonly string[]).includes(relFile)) {
    throw new UnsafePathError(relFile);
  }

  // Containment check via path.relative(), not a hardcoded '/' string prefix - resolve() on
  // Windows returns backslash-separated paths, so `resolved.startsWith(resolvedRoot + '/')`
  // fails unconditionally on every call there, rejecting every legitimate write. Caught live by
  // CI's Windows matrix job the first time it ran - the whole write path was broken on Windows.
  const resolved = resolve(root, relFile);
  const resolvedRoot = resolve(root);
  const rel = relative(resolvedRoot, resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new UnsafePathError(relFile);
  }

  return join(root, relFile);
}
