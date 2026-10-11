import { describe, expect, it } from 'vitest';
import type { PresetId, TopologySpec } from '../../shared/types.js';
import { listPresets, loadPresetTopology, presetSpec } from '../src/sim/presets.js';
import { defaultTopology } from '../src/sim/topology.js';
import { TOPOLOGY_LIMITS, validateTopology } from '../src/sim/validateTopology.js';

const valid = (): TopologySpec => ({
  name: 'Test',
  nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
  links: [{ a: 'A', b: 'B', latencyMs: 10 }, { a: 'B', b: 'C', latencyMs: 0 }],
  source: 'A',
  destination: 'C',
});

const errorOf = (spec: unknown) => {
  const r = validateTopology(spec);
  return r.ok ? null : r.error;
};

describe('validateTopology', () => {
  it('accepts a valid topology and normalises link ids', () => {
    const r = validateTopology(valid());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.name).toBe('Test');
    expect(r.topo.nodes).toEqual(['A', 'B', 'C']);
    expect(r.topo.links).toEqual([
      { id: 'A-B', a: 'A', b: 'B', latencyMs: 10 },
      { id: 'B-C', a: 'B', b: 'C', latencyMs: 0 },
    ]);
    expect(r.flow).toEqual({ source: 'A', destination: 'C' });
  });

  it('keeps given positions and lays out the missing ones automatically', () => {
    const spec = valid();
    spec.nodes[0] = { id: 'A', x: 5, y: 7 };
    const r = validateTopology(spec);
    if (!r.ok) throw new Error(r.error);
    expect(r.topo.positions!.A).toEqual({ x: 5, y: 7 });
    for (const n of ['B', 'C']) expect(Number.isFinite(r.topo.positions![n].x)).toBe(true);
  });

  it('allows a valid topology where the destination is unreachable', () => {
    expect(errorOf({ ...valid(), links: [] })).toBeNull();
  });

  describe('rejects', () => {
    const cases: [string, unknown, RegExp][] = [
      ['a non-object', 'graph', /must be an object/],
      ['an array', [], /must be an object/],
      ['a bad name', { ...valid(), name: '' }, /name must be/],
      ['a long name', { ...valid(), name: 'x'.repeat(41) }, /name must be/],
      ['missing nodes', { ...valid(), nodes: undefined }, /"nodes" array/],
      ['too few nodes', { ...valid(), nodes: [{ id: 'A' }], links: [] }, /at least 2 nodes/],
      ['too many nodes', { ...valid(), nodes: Array.from({ length: 21 }, (_, i) => ({ id: `N${i}` })) }, /At most 20 nodes/],
      ['a non-string node id', { ...valid(), nodes: [{ id: 1 }, { id: 'B' }] }, /Invalid node id 1/],
      ['a node id with "-"', { ...valid(), nodes: [{ id: 'A-1' }, { id: 'B' }] }, /Invalid node id "A-1"/],
      ['a node id with ":"', { ...valid(), nodes: [{ id: 'A:1' }, { id: 'B' }] }, /Invalid node id/],
      ['an empty node id', { ...valid(), nodes: [{ id: '' }, { id: 'B' }] }, /Invalid node id/],
      ['a 13-character node id', { ...valid(), nodes: [{ id: 'ABCDEFGHIJKLM' }, { id: 'B' }] }, /Invalid node id/],
      ['a duplicate node', { ...valid(), nodes: [{ id: 'A' }, { id: 'A' }, { id: 'C' }] }, /Duplicate node "A"/],
      ['a non-numeric position', { ...valid(), nodes: [{ id: 'A', x: '1', y: 2 }, { id: 'B' }, { id: 'C' }] }, /invalid position/],
      ['a half position', { ...valid(), nodes: [{ id: 'A', x: 1 }, { id: 'B' }, { id: 'C' }] }, /invalid position/],
      ['an out-of-range position', { ...valid(), nodes: [{ id: 'A', x: 1e9, y: 0 }, { id: 'B' }, { id: 'C' }] }, /invalid position/],
      ['missing links', { ...valid(), links: 'none' }, /"links" array/],
      ['too many links', { ...valid(), links: Array.from({ length: 61 }, () => ({ a: 'A', b: 'B', latencyMs: 1 })) }, /At most 60 links/],
      ['a link without endpoints', { ...valid(), links: [{ latencyMs: 1 }] }, /string endpoints/],
      ['a link to an unknown node', { ...valid(), links: [{ a: 'A', b: 'Z', latencyMs: 1 }] }, /unknown node "Z"/],
      ['a self-loop', { ...valid(), links: [{ a: 'A', b: 'A', latencyMs: 1 }] }, /to itself/],
      ['a duplicate link', { ...valid(), links: [{ a: 'A', b: 'B', latencyMs: 1 }, { a: 'B', b: 'A', latencyMs: 2 }] }, /Duplicate link A-B/],
      ['a negative latency', { ...valid(), links: [{ a: 'A', b: 'B', latencyMs: -1 }] }, /latency must be an integer from 0 to 5000/],
      ['a latency above the limit', { ...valid(), links: [{ a: 'A', b: 'B', latencyMs: 5001 }] }, /latency must be/],
      ['a fractional latency', { ...valid(), links: [{ a: 'A', b: 'B', latencyMs: 1.5 }] }, /latency must be/],
      ['a NaN latency', { ...valid(), links: [{ a: 'A', b: 'B', latencyMs: NaN }] }, /latency must be/],
      ['a string latency', { ...valid(), links: [{ a: 'A', b: 'B', latencyMs: '10' }] }, /latency must be/],
      ['an unknown source', { ...valid(), source: 'Z' }, /Source node "Z" does not exist/],
      ['an unknown destination', { ...valid(), destination: 'Z' }, /Destination node "Z" does not exist/],
      ['source equal to destination', { ...valid(), destination: 'A' }, /must be different/],
    ];
    for (const [label, spec, msg] of cases) {
      it(label, () => expect(errorOf(spec)).toMatch(msg));
    }
  });

  it('exposes limits that match the rules', () => {
    expect(TOPOLOGY_LIMITS).toMatchObject({ minNodes: 2, maxNodes: 20, maxLinks: 60, minLatencyMs: 0, maxLatencyMs: 5000 });
  });
});

describe('presets', () => {
  const ids = listPresets().map((p) => p.id);

  it('lists the five presets with correct counts', () => {
    expect(ids).toEqual(['classic', 'ring', 'star', 'mesh', 'trap']);
    for (const p of listPresets()) {
      const spec = presetSpec(p.id);
      expect([p.nodeCount, p.linkCount]).toEqual([spec.nodes.length, spec.links.length]);
    }
  });

  it.each(ids)('preset "%s" passes validation and gives every node a position', (id) => {
    const r = validateTopology(presetSpec(id as PresetId));
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.topo.positions!).sort()).toEqual([...r.topo.nodes].sort());
  });

  it('Classic is identical to the original topology', () => {
    const { topo, flow } = loadPresetTopology('classic');
    const { positions, ...structure } = topo;
    expect(structure).toEqual(defaultTopology());
    expect(flow).toEqual({ source: 'A', destination: 'C' });
    // Same coordinates as the dashboard's fixed layout.
    expect(positions).toEqual({ A: { x: 0, y: 170 }, B: { x: 300, y: 0 }, C: { x: 600, y: 170 }, D: { x: 300, y: 340 } });
  });

  it('presetSpec returns a copy that cannot modify the preset', () => {
    presetSpec('classic').links[0].latencyMs = 1;
    expect(presetSpec('classic').links[0].latencyMs).toBe(300);
  });
});
