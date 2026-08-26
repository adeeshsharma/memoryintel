import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_CEILING_LINES = 300;

interface CompressionConfig {
  defaultCeilingLines?: number;
  domainOverrides?: Record<string, number>;
}

// Reads memory-config.json's optional `compression` block. Missing file, missing key, or
// corrupt JSON all fall back to an empty config (which getCeilingLines then resolves to the
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
export function getCeilingLines(root: string, relFile: string): number {
  const config = readCompressionConfig(root);
  const domain = relFile.split('/')[0];
  const override = config.domainOverrides?.[domain];
  if (typeof override === 'number') return override;
  if (typeof config.defaultCeilingLines === 'number') return config.defaultCeilingLines;
  return DEFAULT_CEILING_LINES;
}
