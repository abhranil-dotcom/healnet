/**
 * Minimal discrete-event scheduler. Events are callbacks keyed by simulated
 * time; ties are broken by insertion order so runs are fully deterministic.
 * It owns no real timers — the caller decides how fast simulated time advances.
 */
interface ScheduledEvent {
  time: number;
  order: number;
  run: () => void;
}

export class Scheduler {
  private queue: ScheduledEvent[] = [];
  private counter = 0;

  schedule(time: number, run: () => void): void {
    const ev = { time, order: this.counter++, run };
    // Keep the queue sorted (it stays small, so linear insertion is fine).
    let i = this.queue.length;
    while (i > 0 && (this.queue[i - 1].time > time || (this.queue[i - 1].time === time && this.queue[i - 1].order > ev.order))) i--;
    this.queue.splice(i, 0, ev);
  }

  /** Remove and return the earliest event if it is due at or before `time`. */
  popDue(time: number): ScheduledEvent | undefined {
    if (this.queue.length > 0 && this.queue[0].time <= time) return this.queue.shift();
    return undefined;
  }

  get size(): number {
    return this.queue.length;
  }
}
