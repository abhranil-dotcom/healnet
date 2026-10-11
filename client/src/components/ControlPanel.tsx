import { useEffect, useState, type ReactNode } from 'react';
import type { Command, SimConfig, SimSnapshot } from '../../../shared/types';
import { Button, Panel } from './ui';

export function ControlPanel({ snapshot, send }: { snapshot: SimSnapshot; send: (cmd: Command) => void }) {
  const demoRunning = snapshot.demo.running;

  return (
    <Panel title="Fault injection & traffic" subtitle={demoRunning ? 'Manual controls are locked while the demo runs' : undefined}>
      <div className="grid gap-5 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <Group label="Nodes">
          {snapshot.nodes.map((n) => (
            <Row key={n.id} label={`Node ${n.id}`} hint={n.actualUp ? 'running' : 'powered off'}>
              {n.actualUp ? (
                <Button size="sm" variant="danger" disabled={demoRunning} onClick={() => send({ type: 'failNode', nodeId: n.id })}>Fail</Button>
              ) : (
                <Button size="sm" variant="success" disabled={demoRunning} onClick={() => send({ type: 'restoreNode', nodeId: n.id })}>Restore</Button>
              )}
            </Row>
          ))}
        </Group>

        <Group label="Links">
          {snapshot.links.map((l) => (
            <Row key={l.id} label={`Link ${l.id}`} hint={l.actualUp ? 'connected' : 'disconnected'}>
              {l.actualUp ? (
                <Button size="sm" variant="danger" disabled={demoRunning} onClick={() => send({ type: 'disconnectLink', linkId: l.id })}>Cut</Button>
              ) : (
                <Button size="sm" variant="success" disabled={demoRunning} onClick={() => send({ type: 'reconnectLink', linkId: l.id })}>Reconnect</Button>
              )}
            </Row>
          ))}
        </Group>

        <Group label={`Packets ${snapshot.flow.source} → ${snapshot.flow.destination}`}>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" disabled={demoRunning} onClick={() => send({ type: 'sendPackets', count: 1 })}>Send 1</Button>
            <Button size="sm" disabled={demoRunning} onClick={() => send({ type: 'sendPackets', count: 5 })}>Send 5</Button>
            <Button size="sm" variant="danger" className="col-span-2" disabled={demoRunning} onClick={() => send({ type: 'sendCorrupted' })}>
              Send corrupted packet
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500">
            Packets carry a CRC-16/CCITT-FALSE checksum. A corrupted packet gets one payload bit flipped on its first hop; the next
            node's CRC check rejects it.
          </p>
          {!snapshot.running && <p className="text-[11px] text-amber-300/80">Simulation paused — queued packets leave when you press Start.</p>}
        </Group>

        <ConfigForm config={snapshot.config} disabled={demoRunning} send={send} />
      </div>
    </Panel>
  );
}

function ConfigForm({ config, disabled, send }: { config: SimConfig; disabled: boolean; send: (cmd: Command) => void }) {
  const [draft, setDraft] = useState(config);
  // Keep the form in sync when the server config changes (e.g. after a demo).
  useEffect(() => setDraft(config), [config.heartbeatIntervalMs, config.missedThreshold, config.trafficIntervalMs]);

  const changed =
    draft.heartbeatIntervalMs !== config.heartbeatIntervalMs ||
    draft.missedThreshold !== config.missedThreshold ||
    draft.trafficIntervalMs !== config.trafficIntervalMs;

  const field = (key: keyof SimConfig, label: string, min: number, max: number, step: number, suffix: string) => (
    <label className="flex items-center justify-between gap-2 text-xs text-slate-400">
      {label}
      <span className="flex items-center gap-1">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={draft[key]}
          disabled={disabled}
          onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
          className="w-20 rounded-md border border-ink-600 bg-ink-950 px-2 py-1 text-right font-mono text-xs text-slate-200 focus:border-cyan-500 focus:outline-none disabled:opacity-40"
        />
        <span className="w-6 text-slate-600">{suffix}</span>
      </span>
    </label>
  );

  return (
    <Group label="Detection & traffic">
      {field('heartbeatIntervalMs', 'Heartbeat interval', 200, 5000, 100, 'ms')}
      {field('missedThreshold', 'Miss threshold', 1, 10, 1, '×')}
      {field('trafficIntervalMs', 'Auto traffic (0 = off)', 0, 10000, 100, 'ms')}
      <div className="flex gap-2 pt-1">
        <Button size="sm" variant="primary" disabled={disabled || !changed} onClick={() => send({ type: 'setConfig', config: draft })}>
          Apply
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled || !changed} onClick={() => setDraft(config)}>
          Revert
        </Button>
      </div>
      <p className="text-[11px] text-slate-500">
        Expected detection ≈ {((config.heartbeatIntervalMs * (config.missedThreshold - 1)) / 1000).toFixed(1)}–
        {((config.heartbeatIntervalMs * config.missedThreshold) / 1000).toFixed(1)} s after a failure.
      </p>
    </Group>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[11px] font-semibold tracking-[0.1em] text-slate-500 uppercase">{label}</h3>
      {children}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-slate-300">
        {label} <span className="text-xs text-slate-600">{hint}</span>
      </span>
      {children}
    </div>
  );
}
