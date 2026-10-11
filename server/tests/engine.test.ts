import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../src/sim/engine.js';

/** Engine with auto-traffic off so each test controls exactly which packets exist. */
function makeEngine() {
  const e = new SimulationEngine({ heartbeatIntervalMs: 1000, missedThreshold: 3, trafficIntervalMs: 0 });
  e.start();
  return e;
}

const route = (e: SimulationEngine) => e.activeRoute?.join('-') ?? null;

describe('simulation engine', () => {
  it('starts with the primary route and delivers packets over it', () => {
    const e = makeEngine();
    expect(route(e)).toBe('A-B-C');
    e.sendPacket('TEST');
    e.advance(1000);
    const m = e.getMetrics();
    expect(m.delivered).toBe(1);
    expect(m.avgDelayMs).toBe(600); // A-B 300 ms + B-C 300 ms
    expect(e.packets[0].path).toEqual(['A', 'B', 'C']);
  });

  it('does not mark a node failed before the heartbeat threshold is reached', () => {
    const e = makeEngine();
    e.advance(500);
    e.failNode('B');
    e.advance(2000); // rounds at t=1000 and t=2000 → 2 misses
    expect(e.nodes.get('B')!.status).toBe('SUSPECT');
    expect(e.nodes.get('B')!.missed).toBe(2);
    expect(route(e)).toBe('A-B-C');
  });

  it('detects node B failure via heartbeats and recovers to A → D → C with BFS', () => {
    const e = makeEngine();
    e.advance(500);
    e.failNode('B');
    e.advance(2500); // third missed heartbeat at t=3000
    expect(e.nodes.get('B')!.status).toBe('FAILED');
    expect(route(e)).toBe('A-D-C');

    const rec = e.getMetrics().lastRecovery!;
    expect(rec.cause).toBe('Node B');
    expect(rec.failedAt).toBe(500);
    expect(rec.detectedAt).toBe(3000);
    expect(rec.recoveryMs).toBe(2500);
    expect(rec.newRoute).toEqual(['A', 'D', 'C']);
    expect(e.events.some((ev) => ev.kind === 'BFS')).toBe(true);
    expect(e.events.some((ev) => ev.kind === 'RECOVERY')).toBe(true);

    e.sendPacket('TEST');
    e.advance(1000);
    const last = e.packets.at(-1)!;
    expect(last.state).toBe('DELIVERED');
    expect(last.path).toEqual(['A', 'D', 'C']);
    expect(last.delayMs).toBe(800);
  });

  it('loses packets sent into a failed node before detection', () => {
    const e = makeEngine();
    e.failNode('B');
    e.sendPacket('TEST');
    e.advance(500);
    expect(e.packets[0].state).toBe('LOST');
    expect(e.getMetrics().lost).toBe(1);
  });

  it('reports communication unavailable when no route exists', () => {
    const e = makeEngine();
    e.failNode('B');
    e.failNode('D');
    e.advance(3000);
    expect(e.activeRoute).toBeNull();
    expect(e.systemStatus()).toBe('UNAVAILABLE');
    e.sendPacket('TEST');
    expect(e.packets.at(-1)!.state).toBe('LOST');
    expect(e.events.some((ev) => ev.kind === 'NO_ROUTE')).toBe(true);
  });

  it('only reuses a restored node after it acknowledges a heartbeat', () => {
    const e = makeEngine();
    e.failNode('B');
    e.advance(3000);
    expect(route(e)).toBe('A-D-C');
    e.advance(200);
    e.restoreNode('B');
    expect(e.nodes.get('B')!.status).toBe('FAILED'); // not trusted yet
    expect(route(e)).toBe('A-D-C');
    e.advance(800); // heartbeat at t=4000
    expect(e.nodes.get('B')!.status).toBe('ACTIVE');
    expect(route(e)).toBe('A-B-C');
  });

  it('does not route over a link that was disconnected while its node was down', () => {
    const e = makeEngine();
    e.failNode('B');
    e.advance(3000);
    e.disconnectLink('B-C');
    e.restoreNode('B');
    e.advance(1000);
    expect(e.nodes.get('B')!.status).toBe('ACTIVE');
    expect(e.links.get('B-C')!.status).toBe('DOWN');
    expect(route(e)).toBe('A-D-C');
  });

  it('detects a link failure and reroutes', () => {
    const e = makeEngine();
    e.disconnectLink('A-B');
    e.advance(3000);
    expect(e.links.get('A-B')!.status).toBe('DOWN');
    expect(route(e)).toBe('A-D-C');
    expect(e.getMetrics().lastRecovery!.cause).toBe('Link A-B');
  });

  it('rejects corrupted packets with a CRC error', () => {
    const e = makeEngine();
    e.sendPacket('TEST', true);
    e.advance(1000);
    const m = e.getMetrics();
    expect(e.packets[0].state).toBe('REJECTED');
    expect(m.crcRejected).toBe(1);
    expect(m.delivered).toBe(0);
    expect(e.events.some((ev) => ev.kind === 'CRC_FAILED')).toBe(true);
  });

  it('handles invalid operations gracefully', () => {
    const e = makeEngine();
    expect(e.failNode('Z').ok).toBe(false);
    expect(e.restoreNode('B').ok).toBe(false);
    expect(e.failNode('B').ok).toBe(true);
    expect(e.failNode('B').ok).toBe(false);
    expect(e.reconnectLink('A-B').ok).toBe(false);
    expect(e.execute({ type: 'sendPackets', count: 0 }).ok).toBe(false);
    expect(e.setConfig({ missedThreshold: 0 }).ok).toBe(false);
  });

  it('does not advance time while paused', () => {
    const e = makeEngine();
    e.pause();
    e.advance(5000);
    expect(e.now).toBe(0);
  });
});

describe('one-click demo', () => {
  const runDemo = () => {
    const e = new SimulationEngine();
    e.runDemo();
    for (let i = 0; i < 2000 && e.demo!.running; i++) e.advance(50);
    return e;
  };

  it('runs end to end and records a real recovery', () => {
    const e = runDemo();
    const demo = e.demo!.view();
    expect(demo.finished).toBe(true);
    expect(demo.steps.every((s) => s.status === 'done')).toBe(true);
    expect(e.running).toBe(false);
    expect(route(e)).toBe('A-D-C');
    const m = e.getMetrics();
    expect(m.lastRecovery?.cause).toBe('Node B');
    expect(m.delivered).toBeGreaterThanOrEqual(10);
    expect(m.inFlight).toBe(0);
    expect(e.config.trafficIntervalMs).toBe(1000); // user config restored
  });

  it('is repeatable', () => {
    const summary = (e: SimulationEngine) => {
      const m = e.getMetrics();
      return [m.sent, m.delivered, m.lost, m.lastRecovery?.recoveryMs, m.lastRecovery?.detectionMs];
    };
    expect(summary(runDemo())).toEqual(summary(runDemo()));
  });
});
