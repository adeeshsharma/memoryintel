import { readGlobalSettings, writeGlobalSettings } from '../daemon/settings.js';
import { readDaemonHandle, clearDaemonHandle, isProcessAlive } from '../daemon/daemonHandle.js';

export function runDashboardEnable(): void {
  writeGlobalSettings({ ...readGlobalSettings(), dashboardEnabled: true });
}

export function runDashboardDisable(): { stopped: boolean } {
  writeGlobalSettings({ ...readGlobalSettings(), dashboardEnabled: false });

  const handle = readDaemonHandle();
  if (handle && isProcessAlive(handle.pid)) {
    process.kill(handle.pid, 'SIGTERM');
    clearDaemonHandle();
    return { stopped: true };
  }

  if (handle) clearDaemonHandle();
  return { stopped: false };
}
