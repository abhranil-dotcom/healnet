import type { SimSnapshot } from '../../shared/types.js';
import { SimulationEngine } from './sim/engine.js';

const BROADCAST_MS = 100; // how often clients receive a snapshot
const MAX_STEP_MS = 250; // cap a single step so a stalled event loop does not jump the simulation forward

/**
 * Drives one simulation engine in real time. It owns no timer: the
 * SessionManager's single interval calls `tick()` for every active session,
 * so loops can never be duplicated.
 */
export class SimulationRunner {
  private lastTick: number;
  private lastBroadcast = 0;
  private dirty = true;

  constructor(
    private readonly broadcast: (snapshot: SimSnapshot) => void,
    readonly engine = new SimulationEngine(),
    now = Date.now(),
  ) {
    this.lastTick = now;
  }

  /** Restart the real-time clock (e.g. when a viewer reconnects), so paused wall time is not simulated. */
  resume(now = Date.now()): void {
    this.lastTick = now;
  }

  tick(now = Date.now()): void {
    const elapsed = Math.min(Math.max(now - this.lastTick, 0), MAX_STEP_MS);
    this.lastTick = now;
    if (this.engine.running) {
      this.engine.advance(elapsed);
      this.dirty = true;
    }
    this.flush(false, now);
  }

  /** Mark state changed (after a command) and push it out immediately. */
  changed(now = Date.now()): void {
    this.dirty = true;
    this.flush(true, now);
  }

  private flush(force: boolean, now: number): void {
    if (!this.dirty || (!force && now - this.lastBroadcast < BROADCAST_MS)) return;
    this.lastBroadcast = now;
    this.dirty = false;
    this.broadcast(this.engine.snapshot());
  }
}
