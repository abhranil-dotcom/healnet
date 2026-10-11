import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../../../../server/src/sim/engine';
import { hopProgress, NODE_POSITIONS, nodeCenter, snapshotPositions } from './layout';

describe('hopProgress', () => {
  it('interpolates within a hop', () => {
    expect(hopProgress(150, 100, 300)).toBe(0.25);
    expect(hopProgress(50, 100, 300)).toBe(0);
    expect(hopProgress(400, 100, 300)).toBe(1);
  });

  it('treats a zero-latency hop as arrived instead of dividing by zero', () => {
    expect(hopProgress(100, 100, 100)).toBe(1);
    expect(hopProgress(99, 100, 100)).toBe(1);
    expect(Number.isFinite(hopProgress(0, 0, 0))).toBe(true);
  });
});

describe('snapshotPositions', () => {
  it('uses the server positions for the loaded topology', () => {
    const e = new SimulationEngine();
    e.loadPreset('mesh');
    const p = snapshotPositions(e.snapshot());
    expect(Object.keys(p)).toHaveLength(9);
    expect(p.I).toEqual({ x: 600, y: 500 });
    expect(nodeCenter(p, 'A')).toEqual({ x: 52, y: 52 });
  });

  it('falls back to the legacy layout, then a circle, without server positions', () => {
    const snap = new SimulationEngine().snapshot();
    const legacy = { ...snap, topology: undefined, nodes: [...snap.nodes, { ...snap.nodes[0], id: 'Z' }] } as unknown as typeof snap;
    const p = snapshotPositions(legacy);
    expect(p.B).toEqual(NODE_POSITIONS.B);
    expect(Number.isFinite(p.Z.x)).toBe(true);
  });
});
