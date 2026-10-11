import { describe, expect, it } from 'vitest';
import type { TopologySpec } from '../../../shared/types';
import { SimulationEngine } from '../../../server/src/sim/engine';
import { listPresets } from '../../../server/src/sim/presets';
import { TOPOLOGY_LIMITS, validateTopology } from '../../../server/src/sim/validateTopology';
import { draftFromSnapshot, draftReducer, toSpec, type Draft } from './topologyDraft';
import { DEFAULT_LIMITS, errorCount, hasErrors, validateDraft } from './validateDraft';

const classic = () => draftFromSnapshot(new SimulationEngine().snapshot());

describe('validateDraft', () => {
  it('accepts every preset as loaded from the real engine', () => {
    for (const p of listPresets()) {
      const e = new SimulationEngine();
      expect(e.loadPreset(p.id).ok).toBe(true);
      expect(hasErrors(validateDraft(draftFromSnapshot(e.snapshot())))).toBe(false);
    }
  });

  it('flags a bad node id beside that node', () => {
    const errs = validateDraft(draftReducer(classic(), { type: 'renameNode', key: 'B', id: 'B-1' }));
    expect(errs.nodes).toEqual({ B: 'Use 1–12 letters, digits or _' });
  });

  it('flags both nodes of a duplicate id', () => {
    const errs = validateDraft(draftReducer(classic(), { type: 'renameNode', key: 'B', id: 'A' }));
    expect(Object.keys(errs.nodes).sort()).toEqual(['A', 'B']);
    expect(errs.nodes.A).toMatch(/Duplicate/);
  });

  it.each(['', '-1', '1.5', 'abc', '5001'])('flags latency %j beside that link', (latency) => {
    const errs = validateDraft(draftReducer(classic(), { type: 'setLatency', key: 'B-C', latency }));
    expect(errs.links['B-C']).toMatch(/whole number from 0 to 5000/);
    expect(Object.keys(errs.links)).toEqual(['B-C']);
  });

  it('accepts 0 ms and 5000 ms latencies', () => {
    let d = draftReducer(classic(), { type: 'setLatency', key: 'A-B', latency: '0' });
    d = draftReducer(d, { type: 'setLatency', key: 'B-C', latency: '5000' });
    expect(hasErrors(validateDraft(d))).toBe(false);
  });

  it('requires distinct, existing source and destination', () => {
    const same = validateDraft(draftReducer(classic(), { type: 'setDestination', key: 'A' }));
    expect(same.destination).toMatch(/differ/);
    const missing = validateDraft(draftReducer(classic(), { type: 'removeNode', key: 'A' }));
    expect(missing.source).toMatch(/Choose a source/);
  });

  it('checks the name and node/link counts', () => {
    expect(validateDraft(draftReducer(classic(), { type: 'setName', name: '  ' })).name).toBeDefined();
    let d: Draft = classic();
    for (const k of ['B', 'C', 'D']) d = draftReducer(d, { type: 'removeNode', key: k });
    expect(validateDraft(d).general).toContain('A topology needs at least 2 nodes');
    expect(validateDraft(classic(), { ...DEFAULT_LIMITS, maxLinks: 3 }).general[0]).toMatch(/At most 3 links/);
    expect(errorCount(validateDraft(d))).toBeGreaterThan(0);
  });

  it('uses the same limits as the server', () => {
    expect(DEFAULT_LIMITS).toEqual(TOPOLOGY_LIMITS);
  });

  it('agrees with the server validator on valid and invalid drafts', () => {
    const base = classic();
    const variants: Draft[] = [
      base,
      draftReducer(base, { type: 'renameNode', key: 'C', id: 'C:1' }),
      draftReducer(base, { type: 'renameNode', key: 'C', id: 'ThirteenChars' }),
      draftReducer(base, { type: 'renameNode', key: 'C', id: 'Twelve_Chars' }),
      draftReducer(base, { type: 'renameNode', key: 'C', id: 'D' }),
      draftReducer(base, { type: 'setLatency', key: 'A-B', latency: '5001' }),
      draftReducer(base, { type: 'setLatency', key: 'A-B', latency: '0' }),
      draftReducer(base, { type: 'setDestination', key: 'A' }),
      draftReducer(base, { type: 'setName', name: 'x'.repeat(41) }),
      draftReducer(base, { type: 'setName', name: 'x'.repeat(40) }),
      draftReducer(draftReducer(base, { type: 'addNode' }), { type: 'addNode' }), // isolated nodes are allowed
    ];
    for (const d of variants) {
      const spec: TopologySpec = toSpec(d);
      expect({ spec: spec.name + JSON.stringify(spec.nodes.map((n) => n.id)), client: !hasErrors(validateDraft(d)) }).toEqual({
        spec: spec.name + JSON.stringify(spec.nodes.map((n) => n.id)),
        client: validateTopology(spec).ok,
      });
    }
  });
});
