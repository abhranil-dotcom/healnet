import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../../../server/src/sim/engine';
import { draftFromSnapshot, draftReducer, freePosition, nextNodeId, onlyFlowDiffers, toSpec, topologyKey, type Draft } from './topologyDraft';

const classic = () => draftFromSnapshot(new SimulationEngine().snapshot());

describe('draftFromSnapshot / toSpec', () => {
  it('turns the live Classic snapshot into a draft and back into the same spec', () => {
    const d = classic();
    expect(d.nodes.map((n) => [n.id, n.x, n.y])).toEqual([['A', 0, 170], ['B', 300, 0], ['C', 600, 170], ['D', 300, 340]]);
    expect(toSpec(d)).toEqual({
      name: 'Classic HEALNET',
      nodes: [{ id: 'A', x: 0, y: 170 }, { id: 'B', x: 300, y: 0 }, { id: 'C', x: 600, y: 170 }, { id: 'D', x: 300, y: 340 }],
      links: [
        { a: 'A', b: 'B', latencyMs: 300 },
        { a: 'B', b: 'C', latencyMs: 300 },
        { a: 'A', b: 'D', latencyMs: 400 },
        { a: 'D', b: 'C', latencyMs: 400 },
      ],
      source: 'A',
      destination: 'C',
    });
  });

  it('falls back to a computed layout when the server sends no positions (older backend)', () => {
    const snap = new SimulationEngine().snapshot();
    const { topology: _omit, ...legacy } = snap;
    const d = draftFromSnapshot(legacy as typeof snap);
    expect(d.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
    expect(d.name).toBe('Custom topology');
  });
});

describe('topologyKey / dirty detection', () => {
  it('ignores link and node order but sees latency, flow, position and name changes', () => {
    const spec = toSpec(classic());
    const shuffled = { ...spec, nodes: [...spec.nodes].reverse(), links: [...spec.links].reverse().map((l) => ({ ...l, a: l.b, b: l.a })) };
    expect(topologyKey(shuffled)).toBe(topologyKey(spec));
    expect(topologyKey({ ...spec, links: spec.links.map((l, i) => (i === 0 ? { ...l, latencyMs: 1 } : l)) })).not.toBe(topologyKey(spec));
    expect(topologyKey({ ...spec, destination: 'D' })).not.toBe(topologyKey(spec));
    expect(topologyKey({ ...spec, name: 'Other' })).not.toBe(topologyKey(spec));
    expect(topologyKey({ ...spec, nodes: spec.nodes.map((n, i) => (i === 0 ? { ...n, x: 999 } : n)) })).not.toBe(topologyKey(spec));
  });

  it('onlyFlowDiffers is true for a source/destination change only', () => {
    const spec = toSpec(classic());
    expect(onlyFlowDiffers({ ...spec, destination: 'D' }, spec)).toBe(true);
    expect(onlyFlowDiffers({ ...spec, destination: 'D', name: 'X' }, spec)).toBe(false);
  });
});

describe('draftReducer', () => {
  it('adds nodes with the next free id at a free position', () => {
    let d = classic();
    d = draftReducer(d, { type: 'addNode' });
    d = draftReducer(d, { type: 'addNode' });
    expect(d.nodes.map((n) => n.id)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    const [e, f] = d.nodes.slice(4);
    expect(e.key).not.toBe(f.key);
    for (const n of d.nodes.slice(0, 4)) expect(Math.hypot(n.x - e.x, n.y - e.y)).toBeGreaterThan(100);
    expect([e.x, e.y]).not.toEqual([f.x, f.y]);
  });

  it('nextNodeId continues with N1, N2… after Z', () => {
    const nodes = Array.from({ length: 26 }, (_, i) => ({ key: `k${i}`, id: String.fromCharCode(65 + i), x: 0, y: 0 }));
    expect(nextNodeId(nodes)).toBe('N1');
    expect(nextNodeId([...nodes, { key: 'x', id: 'N1', x: 0, y: 0 }])).toBe('N2');
  });

  it('freePosition never overlaps existing nodes', () => {
    let d: Draft = { name: 'x', nodes: [], links: [], source: '', destination: '', seq: 1 };
    for (let i = 0; i < 12; i++) d = draftReducer(d, { type: 'addNode' });
    const p = freePosition(d.nodes);
    expect(d.nodes.every((n) => Math.hypot(n.x - p.x, n.y - p.y) >= 135)).toBe(true);
  });

  it('removing a node removes its links and clears it as source/destination', () => {
    let d = draftReducer(classic(), { type: 'removeNode', key: 'A' });
    expect(d.nodes.map((n) => n.id)).toEqual(['B', 'C', 'D']);
    expect(toSpec(d).links.map((l) => `${l.a}-${l.b}`)).toEqual(['B-C', 'D-C']);
    expect(d.source).toBe('');
    d = draftReducer(d, { type: 'removeNode', key: 'C' });
    expect(d.links).toEqual([]);
    expect(d.destination).toBe('');
  });

  it('renaming a node keeps its links and flow role', () => {
    const d = draftReducer(classic(), { type: 'renameNode', key: 'B', id: 'Hub' });
    const spec = toSpec(d);
    expect(spec.links[0]).toEqual({ a: 'A', b: 'Hub', latencyMs: 300 });
    expect(draftReducer(d, { type: 'renameNode', key: 'A', id: 'S' }).source).toBe('A'); // key, not id
    expect(toSpec(draftReducer(d, { type: 'renameNode', key: 'A', id: 'S' })).source).toBe('S');
  });

  it('adds links between two distinct, unlinked nodes only', () => {
    const d = classic();
    const withLink = draftReducer(d, { type: 'addLink', a: 'B', b: 'D', latency: '50' });
    expect(withLink.links.at(-1)).toMatchObject({ a: 'B', b: 'D', latency: '50' });
    expect(draftReducer(d, { type: 'addLink', a: 'A', b: 'A' })).toBe(d); // self-loop
    expect(draftReducer(d, { type: 'addLink', a: 'B', b: 'A' })).toBe(d); // already linked
    expect(draftReducer(d, { type: 'addLink', a: 'A', b: 'zz' })).toBe(d); // unknown node
  });

  it('edits latency, removes links, sets flow and name, and clamps moved positions', () => {
    let d = draftReducer(classic(), { type: 'setLatency', key: 'A-B', latency: '0' });
    expect(toSpec(d).links[0].latencyMs).toBe(0);
    d = draftReducer(d, { type: 'removeLink', key: 'B-C' });
    expect(d.links.map((l) => l.key)).toEqual(['A-B', 'A-D', 'C-D']);
    d = draftReducer(draftReducer(d, { type: 'setSource', key: 'B' }), { type: 'setDestination', key: 'D' });
    expect([toSpec(d).source, toSpec(d).destination]).toEqual(['B', 'D']);
    d = draftReducer(d, { type: 'setName', name: 'Lab' });
    expect(toSpec(d).name).toBe('Lab');
    d = draftReducer(d, { type: 'moveNode', key: 'A', x: 1e9, y: -12.6 });
    expect(d.nodes[0]).toMatchObject({ x: 10_000, y: -13 });
  });
});
