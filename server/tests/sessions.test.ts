import { describe, expect, it } from 'vitest';
import type { SimSnapshot } from '../../shared/types.js';
import { isValidSessionId, SessionManager } from '../src/sessions.js';

function setup(maxSessions = 3, idleTtlMs = 60_000) {
  let clock = 1_000_000;
  const sent: { id: string; snap: SimSnapshot }[] = [];
  const m = new SessionManager((id, snap) => sent.push({ id, snap }), { maxSessions, idleTtlMs, now: () => clock });
  return { m, sent, advance: (ms: number) => (clock += ms) };
}

const acquire = (m: SessionManager, id?: string) => {
  const r = m.acquire(id);
  if (!r.ok) throw new Error(r.error);
  return r.session;
};

describe('SessionManager', () => {
  it('gives each tab its own independent simulation', () => {
    const { m } = setup();
    const a = acquire(m, 'tab-aaaaaaaa');
    const b = acquire(m, 'tab-bbbbbbbb');
    expect(a.runner.engine).not.toBe(b.runner.engine);
    a.runner.engine.execute({ type: 'failNode', nodeId: 'B' });
    a.runner.engine.execute({ type: 'loadPreset', presetId: 'ring' });
    expect(b.runner.engine.presetId).toBe('classic');
    expect(b.runner.engine.nodes.get('B')!.actualUp).toBe(true);
  });

  it('returns the same session for the same id (reload / reconnect)', () => {
    const { m } = setup();
    const a = acquire(m, 'tab-aaaaaaaa');
    m.release(a.id);
    const again = m.acquire('tab-aaaaaaaa');
    expect(again).toMatchObject({ ok: true, created: false });
    if (again.ok) expect(again.session).toBe(a);
    expect(m.size).toBe(1);
  });

  it('generates an id when the client sends none or a malformed one', () => {
    const { m } = setup(10);
    for (const bad of [undefined, '', 'short', 'has space in it', 'x'.repeat(65), 42]) {
      const r = m.acquire(bad as string | undefined);
      expect(r.ok).toBe(true);
      if (r.ok) expect(isValidSessionId(r.session.id)).toBe(true);
      if (r.ok) expect(r.session.id).not.toBe(bad);
    }
  });

  it('enforces the session limit while every session has a viewer', () => {
    const { m } = setup(2);
    acquire(m, 'tab-aaaaaaaa');
    acquire(m, 'tab-bbbbbbbb');
    const r = m.acquire('tab-cccccccc');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/busy.*2 simulation sessions/);
    expect(m.size).toBe(2);
    // An existing session can always reconnect, even at the limit.
    expect(m.acquire('tab-aaaaaaaa').ok).toBe(true);
  });

  it('evicts the least recently used idle session to make room', () => {
    const { m, advance } = setup(2);
    const a = acquire(m, 'tab-aaaaaaaa');
    advance(10);
    const b = acquire(m, 'tab-bbbbbbbb');
    m.release(a.id);
    advance(10);
    m.release(b.id);
    acquire(m, 'tab-cccccccc');
    expect(m.get(a.id)).toBeUndefined();
    expect(m.get(b.id)).toBeDefined();
  });

  it('deletes sessions that stay without viewers longer than the idle TTL', () => {
    const { m, advance } = setup(5, 1000);
    const a = acquire(m, 'tab-aaaaaaaa');
    acquire(m, 'tab-bbbbbbbb'); // keeps a viewer
    m.release(a.id);
    advance(900);
    m.tick();
    expect(m.size).toBe(2);
    advance(200);
    m.tick();
    expect(m.size).toBe(1);
    expect(m.get('tab-bbbbbbbb')).toBeDefined();
  });

  it('advances only watched sessions and broadcasts to the right one', () => {
    const { m, sent, advance } = setup();
    const a = acquire(m, 'tab-aaaaaaaa');
    const b = acquire(m, 'tab-bbbbbbbb');
    a.runner.engine.start();
    b.runner.engine.start();
    m.release(b.id);
    for (let i = 0; i < 20; i++) {
      advance(50);
      m.tick();
    }
    expect(a.runner.engine.now).toBe(1000);
    expect(b.runner.engine.now).toBe(0); // frozen without a viewer
    expect(sent.every((s) => s.id === a.id)).toBe(true);
    // Broadcasts are throttled to one per 100 ms: 20 ticks of 50 ms → 10 snapshots (t = 50, 150, …, 950).
    expect(sent.map((s) => s.snap.simTime)).toEqual([50, 150, 250, 350, 450, 550, 650, 750, 850, 950]);
  });

  it('does not simulate the time a session spent without viewers', () => {
    const { m, advance } = setup();
    const a = acquire(m, 'tab-aaaaaaaa');
    a.runner.engine.start();
    m.release(a.id);
    advance(30_000);
    m.tick();
    acquire(m, 'tab-aaaaaaaa');
    advance(50);
    m.tick();
    expect(a.runner.engine.now).toBe(50);
  });

  it('changed() pushes a snapshot immediately', () => {
    const { m, sent } = setup();
    const a = acquire(m, 'tab-aaaaaaaa');
    a.runner.engine.execute({ type: 'loadPreset', presetId: 'star' });
    m.changed(a.id);
    expect(sent.at(-1)).toMatchObject({ id: a.id });
    expect(sent.at(-1)!.snap.topology.presetId).toBe('star');
  });
});
