import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ensureGlobalDir, settingsPath } from './globalPaths.js';

export interface GlobalSettings {
  dashboardEnabled: boolean;
}

const DEFAULT_SETTINGS: GlobalSettings = { dashboardEnabled: true };

export function readGlobalSettings(): GlobalSettings {
  const path = settingsPath();
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS };
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function writeGlobalSettings(settings: GlobalSettings): void {
  ensureGlobalDir();
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2) + '\n');
}
