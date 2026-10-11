import { useState, type ReactNode } from 'react';
import type { TopologyLimits } from '../../../../shared/types';
import { cx } from '../../lib/format';
import { DEFAULT_LATENCY, linkBetween, type Draft, type DraftAction } from '../../lib/topologyDraft';
import type { DraftErrors } from '../../lib/validateDraft';
import { Button } from '../ui';

const input =
  'rounded-md border bg-ink-950 px-2 py-1 font-mono text-xs text-slate-200 focus:border-cyan-500 focus:outline-none disabled:opacity-40';
const inputBorder = (bad: boolean) => (bad ? 'border-rose-500/70' : 'border-ink-600');

/** Form side of the builder: name, flow, nodes and links of the draft. */
export function DraftEditor({ draft, errors, limits, selectedNode, selectedLink, dispatch, onSelectNode, onSelectLink }: {
  draft: Draft;
  errors: DraftErrors;
  limits: TopologyLimits;
  selectedNode: string | null;
  selectedLink: string | null;
  dispatch: (a: DraftAction) => void;
  onSelectNode: (key: string | null) => void;
  onSelectLink: (key: string | null) => void;
}) {
  const idOf = (key: string) => draft.nodes.find((n) => n.key === key)?.id.trim() || '?';
  const selNode = draft.nodes.find((n) => n.key === selectedNode);
  const selLink = draft.links.find((l) => l.key === selectedLink);

  return (
    <div className="space-y-4">
      {(selNode || selLink) && (
        <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 text-xs" data-testid="selection">
          {selNode && (
            <div className="space-y-2">
              <p className="text-slate-300">
                Node <span className="font-mono text-cyan-200">{selNode.id.trim() || '?'}</span> selected — click another node on the canvas to
                link them.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => dispatch({ type: 'setSource', key: selNode.key })}>Make source</Button>
                <Button size="sm" onClick={() => dispatch({ type: 'setDestination', key: selNode.key })}>Make destination</Button>
                <Button size="sm" variant="danger" onClick={() => { dispatch({ type: 'removeNode', key: selNode.key }); onSelectNode(null); }}>
                  Remove node
                </Button>
              </div>
            </div>
          )}
          {selLink && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-300">
                Link <span className="font-mono text-cyan-200">{idOf(selLink.a)} ↔ {idOf(selLink.b)}</span>
              </span>
              <LatencyInput value={selLink.latency} bad={!!errors.links[selLink.key]} limits={limits} label="Selected link latency"
                onChange={(v) => dispatch({ type: 'setLatency', key: selLink.key, latency: v })} autoFocus />
              <Button size="sm" variant="danger" onClick={() => { dispatch({ type: 'removeLink', key: selLink.key }); onSelectLink(null); }}>
                Remove link
              </Button>
              {errors.links[selLink.key] && <FieldError>{errors.links[selLink.key]}</FieldError>}
            </div>
          )}
        </div>
      )}

      <Section title="Topology">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Name
          <input
            className={cx(input, inputBorder(!!errors.name), 'w-full font-sans')}
            value={draft.name}
            maxLength={limits.maxNameLength + 10}
            onChange={(e) => dispatch({ type: 'setName', name: e.target.value })}
            aria-invalid={!!errors.name}
          />
        </label>
        {errors.name && <FieldError>{errors.name}</FieldError>}
        <div className="grid grid-cols-2 gap-2">
          <NodeSelect label="Source" value={draft.source} draft={draft} error={errors.source} onChange={(key) => dispatch({ type: 'setSource', key })} />
          <NodeSelect label="Destination" value={draft.destination} draft={draft} error={errors.destination} onChange={(key) => dispatch({ type: 'setDestination', key })} />
        </div>
      </Section>

      <Section
        title={`Nodes (${draft.nodes.length}/${limits.maxNodes})`}
        action={
          <Button size="sm" onClick={() => dispatch({ type: 'addNode' })} disabled={draft.nodes.length >= limits.maxNodes}>
            + Add node
          </Button>
        }
      >
        <ul className="space-y-1.5">
          {draft.nodes.map((n) => {
            const role = n.key === draft.source ? 'source' : n.key === draft.destination ? 'destination' : 'relay';
            return (
              <li key={n.key}>
                <div className={cx('flex items-center gap-2 rounded-md px-1', n.key === selectedNode && 'bg-cyan-500/5 ring-1 ring-cyan-500/30')}>
                  <input
                    className={cx(input, inputBorder(!!errors.nodes[n.key]), 'w-24')}
                    value={n.id}
                    onChange={(e) => dispatch({ type: 'renameNode', key: n.key, id: e.target.value })}
                    onFocus={() => onSelectNode(n.key)}
                    aria-label={`Node id ${n.id}`}
                    aria-invalid={!!errors.nodes[n.key]}
                  />
                  <span className={cx('w-20 text-[10px] tracking-wide uppercase', role === 'relay' ? 'text-slate-600' : 'text-cyan-300/80')}>{role}</span>
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={() => dispatch({ type: 'removeNode', key: n.key })} aria-label={`Remove node ${n.id}`}>
                    Remove
                  </Button>
                </div>
                {errors.nodes[n.key] && <FieldError>{errors.nodes[n.key]}</FieldError>}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title={`Links (${draft.links.length}/${limits.maxLinks})`}>
        {draft.links.length === 0 && <p className="text-xs text-slate-500">No links yet.</p>}
        <ul className="space-y-1.5">
          {draft.links.map((l) => (
            <li key={l.key}>
              <div className={cx('flex items-center gap-2 rounded-md px-1', l.key === selectedLink && 'bg-cyan-500/5 ring-1 ring-cyan-500/30')}>
                <button type="button" className="w-24 text-left font-mono text-xs text-slate-300 hover:text-cyan-200" onClick={() => onSelectLink(l.key)}>
                  {idOf(l.a)} ↔ {idOf(l.b)}
                </button>
                <LatencyInput value={l.latency} bad={!!errors.links[l.key]} limits={limits} label={`Latency ${idOf(l.a)}-${idOf(l.b)}`}
                  onChange={(v) => dispatch({ type: 'setLatency', key: l.key, latency: v })} />
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => dispatch({ type: 'removeLink', key: l.key })}
                  aria-label={`Remove link ${idOf(l.a)}-${idOf(l.b)}`}>
                  Remove
                </Button>
              </div>
              {errors.links[l.key] && <FieldError>{errors.links[l.key]}</FieldError>}
            </li>
          ))}
        </ul>
        <AddLinkForm draft={draft} limits={limits} dispatch={dispatch} />
      </Section>
    </div>
  );
}

function AddLinkForm({ draft, limits, dispatch }: { draft: Draft; limits: TopologyLimits; dispatch: (a: DraftAction) => void }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [latency, setLatency] = useState(DEFAULT_LATENCY);
  const valid = (k: string) => draft.nodes.some((n) => n.key === k);
  const problem = !valid(a) || !valid(b)
    ? 'Choose two nodes'
    : a === b
      ? 'Choose two different nodes'
      : linkBetween(draft, a, b)
        ? 'These nodes are already linked'
        : draft.links.length >= limits.maxLinks
          ? `At most ${limits.maxLinks} links`
          : null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-ink-700/60 bg-ink-950/40 p-2" aria-label="Add link">
      <select className={cx(input, 'border-ink-600')} value={a} onChange={(e) => setA(e.target.value)} aria-label="New link from">
        <option value="">from…</option>
        {draft.nodes.map((n) => <option key={n.key} value={n.key}>{n.id.trim() || '?'}</option>)}
      </select>
      <select className={cx(input, 'border-ink-600')} value={b} onChange={(e) => setB(e.target.value)} aria-label="New link to">
        <option value="">to…</option>
        {draft.nodes.map((n) => <option key={n.key} value={n.key}>{n.id.trim() || '?'}</option>)}
      </select>
      <LatencyInput value={latency} bad={false} limits={limits} label="New link latency" onChange={setLatency} />
      <Button size="sm" variant="primary" disabled={!!problem} title={problem ?? undefined}
        onClick={() => { dispatch({ type: 'addLink', a, b, latency }); setA(''); setB(''); }}>
        + Add link
      </Button>
      {problem && (a || b) && <span className="text-[11px] text-slate-500">{problem}</span>}
    </div>
  );
}

function LatencyInput({ value, bad, limits, label, onChange, autoFocus }: {
  value: string;
  bad: boolean;
  limits: TopologyLimits;
  label: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <span className="flex items-center gap-1">
      <input
        type="number"
        inputMode="numeric"
        min={limits.minLatencyMs}
        max={limits.maxLatencyMs}
        step={1}
        className={cx(input, inputBorder(bad), 'w-20 text-right')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        aria-invalid={bad}
        autoFocus={autoFocus}
      />
      <span className="text-[11px] text-slate-600">ms</span>
    </span>
  );
}

function NodeSelect({ label, value, draft, error, onChange }: {
  label: string;
  value: string;
  draft: Draft;
  error?: string;
  onChange: (key: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-400">
      {label}
      <select className={cx(input, inputBorder(!!error))} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error}>
        <option value="">—</option>
        {draft.nodes.map((n) => <option key={n.key} value={n.key}>{n.id.trim() || '?'}</option>)}
      </select>
      {error && <FieldError>{error}</FieldError>}
    </label>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold tracking-[0.1em] text-slate-500 uppercase">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function FieldError({ children }: { children: ReactNode }) {
  return <p className="field-error mt-0.5 px-1 text-[11px] text-rose-300">{children}</p>;
}
