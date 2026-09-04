import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readIndex } from '../core/memoryIndex.js';

export function runStatus(root: string): string {
  const lines: string[] = [];

  // Always first: silently reading the wrong project's (or wrong worktree/branch's) memory
  // has happened in practice - findMemoryIntelRoot() walks up from cwd with no built-in
  // visibility into which root it actually resolved.
  lines.push('=== Root ===', root);

  const mentalModelPath = join(root, 'context', 'currentMentalModel.md');
  lines.push('', '=== Current Mental Model ===');
  lines.push(existsSync(mentalModelPath) ? readFileSync(mentalModelPath, 'utf-8').trim() : '(none)');

  lines.push('', '=== Memory Index ===');
  const index = readIndex(join(root, 'memory-index.json'));
  for (const [file, entry] of Object.entries(index)) {
    lines.push(`${file}: ${entry.summary} (updated ${entry.lastUpdated})`);
  }

  lines.push('', '=== Recent Events ===');
  const eventsPath = join(root, 'memory-events.jsonl');
  if (existsSync(eventsPath)) {
    const eventLines = readFileSync(eventsPath, 'utf-8').trim().split('\n').filter(Boolean);
    for (const line of eventLines.slice(-5)) {
      const event = JSON.parse(line);
      lines.push(`[${event.timestamp}] ${event.type}: ${event.summary}`);
    }
  }

  return lines.join('\n') + '\n';
}
