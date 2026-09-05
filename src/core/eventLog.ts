import { appendFileSync } from 'node:fs';

export interface MemoryEvent {
  timestamp: string;
  type: string;
  summary: string;
  affectedFiles: string[];
  // Only set on 'session-load' events - lets KPI-style analysis (tokens loaded per session,
  // session frequency) be computed straight from the event log instead of reconstructed after
  // the fact from file sizes and guesswork, which is how the first KPI pass on this tool had to
  // be done (see business/roadmap.md).
  domain?: string | null;
  // Only set on 'session-load' events - distinguishes a domain the agent explicitly asked for
  // via --domain from one auto-carried forward because the previous update() touched it, so a
  // dashboard or timeline read can tell which mechanism actually put a domain in context.
  domainSource?: 'explicit' | 'auto' | null;
  totalChars?: number;
  totalLines?: number;
}

export function appendEvent(eventsPath: string, event: MemoryEvent): void {
  appendFileSync(eventsPath, JSON.stringify(event) + '\n');
}
