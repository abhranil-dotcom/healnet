import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Command, CommandResult, SimSnapshot } from '../../../../shared/types';
import { SimulationEngine } from '../../../../server/src/sim/engine';
import { listPresets } from '../../../../server/src/sim/presets';
import { TOPOLOGY_LIMITS } from '../../../../server/src/sim/validateTopology';
import { NetworkBuilder } from './NetworkBuilder';

// The preset list comes from the real server module (what GET /api/presets serves).
vi.mock('../../hooks/usePresets', () => ({
  usePresets: () => ({ status: 'ready', presets: listPresets(), limits: TOPOLOGY_LIMITS, retry: () => undefined }),
}));

// React Flow needs a real browser layout engine; replace the canvas with clickable stand-ins.
vi.mock('./DraftCanvas', () => ({
  DraftCanvas: (p: { draft: { nodes: { key: string; id: string }[]; links: { key: string }[] }; onNodeClick: (k: string) => void; onLinkClick: (k: string) => void }) => (
    <div data-testid="canvas">
      {p.draft.nodes.map((n) => (
        <button key={n.key} onClick={() => p.onNodeClick(n.key)}>{`canvas-node-${n.id}`}</button>
      ))}
      {p.draft.links.map((l) => (
        <button key={l.key} onClick={() => p.onLinkClick(l.key)}>{`canvas-link-${l.key}`}</button>
      ))}
    </div>
  ),
}));

/** Render the builder against a real engine: commands run on the engine, the UI re-renders from its snapshot. */
function setup(opts: { engine?: SimulationEngine; reply?: (cmd: Command) => CommandResult | undefined } = {}) {
  const engine = opts.engine ?? new SimulationEngine({ trafficIntervalMs: 0 });
  const sent: Command[] = [];
  let push: (s: SimSnapshot) => void = () => undefined;

  function Harness() {
    const [snap, setSnap] = useState(engine.snapshot());
    push = setSnap;
    const send = async (cmd: Command): Promise<CommandResult> => {
      sent.push(cmd);
      const override = opts.reply?.(cmd);
      if (override) return override;
      const res = engine.execute(cmd);
      setSnap(engine.snapshot());
      return res;
    };
    return <NetworkBuilder snapshot={snap} send={send} connected />;
  }

  render(<Harness />);
  const refresh = () => act(() => push(engine.snapshot()));
  return { engine, sent, refresh };
}

const openEditor = () => fireEvent.click(screen.getByRole('tab', { name: /Custom editor/ }));
const openPresets = () => fireEvent.click(screen.getByRole('tab', { name: /Presets/ }));
const applyButton = () => screen.getByRole('button', { name: 'Apply topology' }) as HTMLButtonElement;
const summary = () => screen.getByTestId('live-summary').textContent;
const nodeIds = () => screen.getAllByLabelText(/^Node id/).map((i) => (i as HTMLInputElement).value);

describe('NetworkBuilder — presets', () => {
  it('lists the server presets with descriptions and marks the loaded one', () => {
    setup();
    for (const p of listPresets()) {
      const card = screen.getByTestId(`preset-${p.id}`);
      expect(within(card).getByText(p.name)).toBeTruthy();
      expect(within(card).getByText(p.description)).toBeTruthy();
    }
    expect(within(screen.getByTestId('preset-classic')).getByText('Loaded')).toBeTruthy();
    expect(summary()).toContain('Classic HEALNET');
  });

  it('loads a preset through the backend command and shows the new server state', async () => {
    const { sent, engine } = setup();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Load Ring' })));
    expect(sent).toEqual([{ type: 'loadPreset', presetId: 'ring' }]);
    expect(engine.presetId).toBe('ring');
    expect(summary()).toMatch(/Ring.*6 nodes · 6 links · A → D/);
    expect(within(screen.getByTestId('preset-ring')).getByText('Loaded')).toBeTruthy();
    expect(screen.getByTestId('builder-status').textContent).toMatch(/Loaded Ring/);
    openEditor();
    expect(nodeIds()).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });

  it('asks for confirmation before a preset discards unsaved edits', async () => {
    const { sent } = setup();
    openEditor();
    fireEvent.click(screen.getByRole('button', { name: '+ Add node' }));
    expect(screen.getByTestId('draft-badge')).toBeTruthy();
    openPresets();

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Load Star' })));
    expect(sent).toEqual([]); // nothing sent yet
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toMatch(/unsaved draft changes.*Star/);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByTestId('draft-badge')).toBeTruthy(); // edits kept

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Load Star' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Discard draft & load' })));
    expect(sent).toEqual([{ type: 'loadPreset', presetId: 'star' }]);
    expect(screen.queryByTestId('draft-badge')).toBeNull();
    expect(summary()).toContain('Star');
  });

  it('loads without a confirmation when there are no edits', async () => {
    const { sent } = setup();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Load Mesh 3×3' })));
    expect(sent).toEqual([{ type: 'loadPreset', presetId: 'mesh' }]);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('NetworkBuilder — custom editor', () => {
  it('adds and removes nodes; removing a node removes its links', () => {
    setup();
    openEditor();
    fireEvent.click(screen.getByRole('button', { name: '+ Add node' }));
    expect(nodeIds()).toEqual(['A', 'B', 'C', 'D', 'E']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove node B' }));
    expect(nodeIds()).toEqual(['A', 'C', 'D', 'E']);
    expect(screen.queryByLabelText('Latency A-B')).toBeNull();
    expect(screen.queryByLabelText('Latency B-C')).toBeNull();
    expect(screen.getByLabelText('Latency A-D')).toBeTruthy();
  });

  it('creates a link by selecting two nodes on the canvas, then edits and removes it', () => {
    setup();
    openEditor();
    fireEvent.click(screen.getByRole('button', { name: '+ Add node' }));
    fireEvent.click(screen.getByText('canvas-node-C'));
    expect(screen.getByTestId('selection').textContent).toMatch(/Node C selected/);
    fireEvent.click(screen.getByText('canvas-node-E'));
    const latency = screen.getByLabelText('Latency C-E') as HTMLInputElement;
    expect(latency.value).toBe('100');
    expect(screen.getByTestId('selection').textContent).toMatch(/C ↔ E/);

    fireEvent.change(screen.getByLabelText('Selected link latency'), { target: { value: '25' } });
    expect((screen.getByLabelText('Latency C-E') as HTMLInputElement).value).toBe('25');
    fireEvent.click(screen.getByRole('button', { name: 'Remove link C-E' }));
    expect(screen.queryByLabelText('Latency C-E')).toBeNull();
  });

  it('creates a link with the form', () => {
    setup();
    openEditor();
    const form = screen.getByLabelText('Add link');
    fireEvent.change(within(form).getByLabelText('New link from'), { target: { value: 'B' } });
    fireEvent.change(within(form).getByLabelText('New link to'), { target: { value: 'D' } });
    fireEvent.change(within(form).getByLabelText('New link latency'), { target: { value: '0' } });
    fireEvent.click(within(form).getByRole('button', { name: '+ Add link' }));
    expect((screen.getByLabelText('Latency B-D') as HTMLInputElement).value).toBe('0');
  });

  it('shows validation errors beside the field and blocks Apply until fixed', () => {
    setup();
    openEditor();
    fireEvent.change(screen.getByLabelText('Latency A-B'), { target: { value: '9000' } });
    expect(screen.getByText('Latency must be a whole number from 0 to 5000 ms')).toBeTruthy();
    expect(applyButton().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Node id B'), { target: { value: 'B-2' } });
    expect(screen.getByText('Use 1–12 letters, digits or _')).toBeTruthy();
    expect(screen.getByText('2 problem(s) to fix')).toBeTruthy();

    // Links follow the renamed node, so the field is now labelled A-B-2.
    fireEvent.change(screen.getByLabelText('Latency A-B-2'), { target: { value: '250' } });
    fireEvent.change(screen.getByLabelText('Node id B-2'), { target: { value: 'B2' } });
    expect(screen.queryByText(/problem\(s\) to fix/)).toBeNull();
    expect(applyButton().disabled).toBe(false);
  });

  it('rejects equal source and destination', () => {
    setup();
    openEditor();
    fireEvent.change(screen.getByLabelText('Destination'), { target: { value: 'A' } });
    expect(screen.getByText('Destination must differ from the source')).toBeTruthy();
    expect(applyButton().disabled).toBe(true);
  });

  it('applies a valid custom topology with loadTopology and shows the server state', async () => {
    const { sent, engine } = setup();
    openEditor();
    fireEvent.click(screen.getByRole('button', { name: '+ Add node' }));
    fireEvent.click(screen.getByText('canvas-node-C'));
    fireEvent.click(screen.getByText('canvas-node-E'));
    fireEvent.change(screen.getByLabelText('Latency C-E'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Destination'), { target: { value: 'n1' } }); // key of the new node E
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Classic + E' } });
    await act(async () => fireEvent.click(applyButton()));

    const cmd = sent.at(-1)!;
    expect(cmd.type).toBe('loadTopology');
    if (cmd.type !== 'loadTopology') return;
    expect(cmd.topology).toMatchObject({ name: 'Classic + E', source: 'A', destination: 'E' });
    expect(cmd.topology.links).toContainEqual({ a: 'C', b: 'E', latencyMs: 50 });

    // Server state, not the draft, drives what is shown now.
    expect(engine.topo.nodes).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(engine.activeRoute).toEqual(['A', 'B', 'C', 'E']);
    expect(summary()).toMatch(/Classic \+ E.*\(custom\).*5 nodes · 5 links · A → E/);
    expect(screen.queryByTestId('draft-badge')).toBeNull();
    expect(screen.getByTestId('builder-status').textContent).toMatch(/Applied “Classic \+ E” — simulation reset/);
  });

  it('uses setFlow when only source/destination changed, keeping the preset', async () => {
    const { sent, engine } = setup();
    openEditor();
    fireEvent.change(screen.getByLabelText('Destination'), { target: { value: 'D' } });
    await act(async () => fireEvent.click(applyButton()));
    expect(sent).toEqual([{ type: 'setFlow', source: 'A', destination: 'D' }]);
    expect(engine.presetId).toBe('classic');
    expect(engine.activeRoute).toEqual(['A', 'D']);
    expect(summary()).toContain('A → D');
  });

  it('discard restores the live topology', () => {
    setup();
    openEditor();
    fireEvent.click(screen.getByRole('button', { name: '+ Add node' }));
    fireEvent.change(screen.getByLabelText('Latency A-B'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    expect(nodeIds()).toEqual(['A', 'B', 'C', 'D']);
    expect((screen.getByLabelText('Latency A-B') as HTMLInputElement).value).toBe('300');
    expect(screen.queryByTestId('draft-badge')).toBeNull();
  });

  it('keeps the draft and shows the server error when the server rejects it', async () => {
    const { sent } = setup({ reply: (c) => (c.type === 'loadTopology' ? { ok: false, error: 'Server says no' } : undefined) });
    openEditor();
    fireEvent.click(screen.getByRole('button', { name: '+ Add node' }));
    await act(async () => fireEvent.click(applyButton()));
    expect(sent.at(-1)?.type).toBe('loadTopology');
    expect(screen.getByTestId('builder-status').textContent).toBe('Server says no');
    expect(nodeIds()).toContain('E');
    expect(screen.getByTestId('draft-badge')).toBeTruthy();
  });

  it('undoing an edit by hand clears the unsaved state', () => {
    setup();
    openEditor();
    fireEvent.change(screen.getByLabelText('Latency A-B'), { target: { value: '301' } });
    expect(screen.getByTestId('draft-badge')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Latency A-B'), { target: { value: '300' } });
    expect(screen.queryByTestId('draft-badge')).toBeNull();
    expect(applyButton().disabled).toBe(true);
  });
});

describe('NetworkBuilder — live state and the demo', () => {
  it('disables loading and applying while the demo runs', async () => {
    const { engine, refresh, sent } = setup();
    openEditor();
    fireEvent.click(screen.getByRole('button', { name: '+ Add node' }));
    engine.runDemo();
    refresh();
    expect(applyButton().disabled).toBe(true);
    expect(screen.getByText(/demo is running/)).toBeTruthy();
    openPresets();
    for (const b of screen.getAllByRole('button', { name: /^Load / })) expect((b as HTMLButtonElement).disabled).toBe(true);
    expect(sent).toEqual([]);
  });

  it('keeps unsaved edits when the demo switches the simulation back to Classic', async () => {
    const { engine, refresh } = setup();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Load Ring' })));
    openEditor();
    fireEvent.click(screen.getByRole('button', { name: '+ Add node' }));
    engine.runDemo();
    refresh();
    expect(summary()).toContain('Classic HEALNET');
    expect(nodeIds()).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    expect(screen.getByText(/topology changed while you were editing/)).toBeTruthy();
  });

  it('follows the live topology when there are no edits', () => {
    const { engine, refresh } = setup();
    openEditor();
    engine.loadPreset('trap');
    refresh();
    expect(nodeIds()).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect((screen.getByLabelText('Latency A-B') as HTMLInputElement).value).toBe('500');
    expect(screen.queryByTestId('draft-badge')).toBeNull();
  });

  it('explains when the server does not support topologies (older backend)', () => {
    const snap = new SimulationEngine().snapshot();
    const { topology: _omit, ...legacy } = snap;
    render(<NetworkBuilder snapshot={legacy as SimSnapshot} send={async () => ({ ok: true })} connected />);
    expect(screen.getByText(/does not support custom topologies yet/)).toBeTruthy();
  });
});
