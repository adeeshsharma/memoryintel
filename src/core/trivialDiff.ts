import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Mirrors compressionConfig.ts's DEFAULT_CEILING_CHARS pattern: a small, stable default most
// projects never need to override.
export const DEFAULT_LINE_CEILING = 20;
export const DEFAULT_CONSECUTIVE_SKIP_CAP = 3;

export interface TrivialDiffConfig {
  lineCeiling: number;
  consecutiveSkipCap: number;
}

interface RawTrivialDiffConfig {
  lineCeiling?: number;
  consecutiveSkipCap?: number;
}

// Reads memory-config.json's optional `trivialDiff` block, following the exact same
// missing-file/missing-key/corrupt-JSON-all-fall-back-silently pattern compressionConfig.ts
// already uses for `compression` — this is a read-time convenience for check-stop, never a
// place that should throw and interrupt the Stop hook.
function readRawConfig(memoryRoot: string): RawTrivialDiffConfig {
  const configPath = join(memoryRoot, 'memory-config.json');
  if (!existsSync(configPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (parsed && typeof parsed === 'object' && parsed.trivialDiff && typeof parsed.trivialDiff === 'object') {
      return parsed.trivialDiff as RawTrivialDiffConfig;
    }
    return {};
  } catch {
    return {};
  }
}

export function readTrivialDiffConfig(memoryRoot: string): TrivialDiffConfig {
  const raw = readRawConfig(memoryRoot);
  return {
    lineCeiling: typeof raw.lineCeiling === 'number' ? raw.lineCeiling : DEFAULT_LINE_CEILING,
    consecutiveSkipCap: typeof raw.consecutiveSkipCap === 'number' ? raw.consecutiveSkipCap : DEFAULT_CONSECUTIVE_SKIP_CAP
  };
}
