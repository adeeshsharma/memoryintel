import { startDaemon } from '../daemon/server.js';

export async function runDaemonStart(preferredPort = 4390): Promise<{ port: number; close: () => Promise<void> }> {
  const { port, server } = await startDaemon(preferredPort);
  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}
