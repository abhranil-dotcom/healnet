import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../src/sim/engine.js';

/**
 * Golden regression test for the Classic HEALNET scenario (A-B-C primary,
 * A-D-C backup, default config, BFS). These values were produced by the
 * original implementation; any refactor of routing, topology or the engine
 * must reproduce them exactly.
 */
function runClassicDemo() {
  const e = new SimulationEngine();
  e.runDemo();
  for (let i = 0; i < 2000 && e.demo!.running; i++) e.advance(50);
  return e;
}

describe('Classic HEALNET demo regression', () => {
  it('reproduces the baseline result: 2400 ms recovery, 11/16 packets delivered', () => {
    const e = runClassicDemo();
    const m = e.getMetrics();

    expect(e.demo!.view().finished).toBe(true);
    expect(m.sent).toBe(16);
    expect(m.delivered).toBe(11);
    expect(m.lost).toBe(5);
    expect(m.crcRejected).toBe(0);

    const r = m.lastRecovery!;
    expect(r.cause).toBe('Node B');
    expect(r.recoveryMs).toBe(2400);
    expect(r.detectionMs).toBe(2400);
    expect(r.oldRoute).toEqual(['A', 'B', 'C']);
    expect(r.newRoute).toEqual(['A', 'D', 'C']);
    expect(m.recoveries).toHaveLength(1);

    expect(e.activeRoute).toEqual(['A', 'D', 'C']);
    expect(e.demo!.view().summary).toMatch(/^Recovered from Node B failure in 2400 ms \(detection 2400 ms, BFS [\d.]+ µs\)\. Delivered 11\/16 packets — loss 31\.3%/);
  });
});
