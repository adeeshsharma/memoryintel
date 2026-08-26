import { existsSync } from 'node:fs';
import { join, dirname, parse } from 'node:path';

export function findMemoryIntelRoot(startDir: string): string | null {
  let dir = startDir;
  const { root } = parse(dir);

  while (true) {
    const candidate = join(dir, '.memoryintel');
    if (existsSync(candidate)) return candidate;
    if (dir === root) return null;
    dir = dirname(dir);
  }
}
