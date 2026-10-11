import { randomUUID } from 'node:crypto';
import type { SimSnapshot } from '../../shared/types.js';
import { SimulationRunner } from './runner.js';
import { SimulationEngine } from './sim/engine.js';

const TICK_MS = 50; // how often simulated time is advanced
const SESSION_ID = /^[A-Za-z0-9_-]{8,64}$/;

export interface SessionManagerOptions {
  /** Maximum number of simulations kept in memory at once. */
  maxSessions: number;
  /** A session with no connected viewer is deleted after this long. */
  idleTtlMs: number;
  /** Clock, injectable for tests. */
  now?: () => number;
}

export interface Session {
  readonly id: string;
  readonly runner: SimulationRunner;
  viewers: number;
  lastSeen: number;
}

export type AcquireResult = { ok: true; session: Session; created: boolean } | { ok: false; error: string };

export function isValidSessionId(x: unknown): x is string {
  return typeof x === 'string' && SESSION_ID.test(x);
}

/**
 * One independent simulation per browser tab. A tab identifies itself with a
 * random session id (kept in its sessionStorage) so a reload or reconnect
 * returns to the same simulation; other tabs and users can never touch it.
 *
 * A single interval advances every session that has a connected viewer.
 * Sessions without viewers are frozen (simulated time does not advance),
 * evicted first when the limit is reached, and deleted after `idleTtlMs`.
 */
export class SessionManager {
  private sessions = new Map<string, Session>();
  private timer: NodeJS.Timeout | null = null;
  private readonly now: () => number;

  constructor(
    private readonly broadcast: (sessionId: string, snapshot: SimSnapshot) => void,
    private readonly opts: SessionManagerOptions,
  ) {
    this.now = opts.now ?? Date.now;
  }

  get size(): number {
    return this.sessions.size;
  }

  get maxSessions(): number {
    return this.opts.maxSessions;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  /**
   * Attach a viewer to the requested session, creating it if needed. A missing
   * or malformed id gets a fresh server-generated one.
   */
  acquire(requestedId?: unknown): AcquireResult {
    const now = this.now();
    const existing = isValidSessionId(requestedId) ? this.sessions.get(requestedId) : undefined;
    if (existing) {
      if (existing.viewers === 0) existing.runner.resume(now);
      existing.viewers++;
      existing.lastSeen = now;
      return { ok: true, session: existing, created: false };
    }

    if (this.sessions.size >= this.opts.maxSessions && !this.evictIdle()) {
      return { ok: false, error: `Server is busy: all ${this.opts.maxSessions} simulation sessions are in use. Please try again later.` };
    }
    const id = isValidSessionId(requestedId) ? requestedId : randomUUID();
    const runner = new SimulationRunner((s) => this.broadcast(id, s), new SimulationEngine(), now);
    const session: Session = { id, runner, viewers: 1, lastSeen: now };
    this.sessions.set(id, session);
    return { ok: true, session, created: true };
  }

  release(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.viewers = Math.max(0, s.viewers - 1);
    s.lastSeen = this.now();
  }

  /** After a command: refresh activity and push the new state right away. */
  changed(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.lastSeen = this.now();
    s.runner.changed(this.now());
  }

  /** Advance every watched session; drop sessions idle for longer than the TTL. */
  tick(): void {
    const now = this.now();
    for (const s of this.sessions.values()) {
      if (s.viewers > 0) s.runner.tick(now);
      else if (now - s.lastSeen > this.opts.idleTtlMs) this.sessions.delete(s.id);
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Remove the least recently used session without viewers. */
  private evictIdle(): boolean {
    let oldest: Session | null = null;
    for (const s of this.sessions.values()) if (s.viewers === 0 && (!oldest || s.lastSeen < oldest.lastSeen)) oldest = s;
    if (!oldest) return false;
    this.sessions.delete(oldest.id);
    return true;
  }
}
