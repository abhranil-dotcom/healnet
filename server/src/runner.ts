import type { SimSnapshot } from '../../shared/types.js';
import { SimulationEngine } from './sim/engine.js';

const TICK_MS = 50; // how often simulated time is advanced
const BROADCAST_MS = 100; // how often clients receive a snapshot

/**
 * Owns the single real-time loop that drives the engine. `start()` is
 * idempotent, so the loop can never be duplicated (e.g. on hot reload or
 * repeated calls), and `stop()` clears it.
 */
export class SimulationRunner {
  readonly engine = new SimulationEngine();
  private timer: NodeJS.Timeout | null = null;
  private lastTick = 0;
  private lastBroadcast = 0;
  private dirty = true;

  constructor(private readonly broadcast: (snapshot: SimSnapshot) => void) {}

  start(): void {
    if (this.timer) return;
    this.lastTick = Date.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Mark state changed (after a command) and push it out immediately. */
  changed(): void {
    this.dirty = true;
    this.flush(true);
  }

  private tick(): void {
    const now = Date.now();
    // Cap a single step so a stalled event loop does not jump the simulation forward.
    const elapsed = Math.min(now - this.lastTick, 250);
    this.lastTick = now;
    if (this.engine.running) {
      this.engine.advance(elapsed);
      this.dirty = true;
    }
    this.flush(false);
  }

  private flush(force: boolean): void {
    const now = Date.now();
    if (!this.dirty || (!force && now - this.lastBroadcast < BROADCAST_MS)) return;
    this.lastBroadcast = now;
    this.dirty = false;
    this.broadcast(this.engine.snapshot());
  }
}
