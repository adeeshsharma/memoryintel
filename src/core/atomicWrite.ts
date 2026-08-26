import { writeFileSync, renameSync } from 'node:fs';

export function atomicWriteFile(path: string, content: string): void {
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, content);
  renameSync(tempPath, path);
}
