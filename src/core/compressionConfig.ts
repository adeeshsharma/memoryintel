import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ~40 chars/line is a reasonable prose average, so this stays roughly equivalent to the old
// 300-line default while actually measuring the thing that determines context cost: characters,
// not lines. A file of long, dense lines and one of short, sparse lines could both read "300
// lines" while costing very different amounts of context - line count was a proxy that stopped
// tracking the number it was supposed to.
export const DEFAULT_CEILING_CHARS = 12000;

interface CompressionConfig {
  defaultCeilingChars?: number;
  domainOverrides?: Record<string, number>;
}

// Reads memory-config.json's optional `compression` block. Missing file, missing key, or
// corrupt JSON all fall back to an empty config (which getCeilingChars then resolves to the
// built-in default) — this is a read-time convenience for load()/the dashboard, never a place
// that should throw and interrupt them.
function readCompressionConfig(root: string): CompressionConfig {
  const configPath = join(root, 'memory-config.json');
  if (!existsSync(configPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (parsed && typeof parsed === 'object' && parsed.compression && typeof parsed.compression === 'object') {
      return parsed.compression as CompressionConfig;
    }
    return {};
  } catch {
    return {};
  }
}

export function countLines(content: string): number {
  return content.length === 0 ? 0 : content.split('\n').length;
}

// relFile's first path segment (e.g. "technical" from "technical/architecture.md", or "context"
// from "context/activeContext.md") is the domain domainOverrides keys against.
export function getCeilingChars(root: string, relFile: string): number {
  const config = readCompressionConfig(root);
  const domain = relFile.split('/')[0];
  const override = config.domainOverrides?.[domain];
  if (typeof override === 'number') return override;
  if (typeof config.defaultCeilingChars === 'number') return config.defaultCeilingChars;
  return DEFAULT_CEILING_CHARS;
}
