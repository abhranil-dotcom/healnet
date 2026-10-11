import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Command, CommandResult, PresetId, SimSnapshot } from '../../../../shared/types';
import { usePresets } from '../../hooks/usePresets';
import { cx } from '../../lib/format';
import { draftFromSnapshot, draftReducer, onlyFlowDiffers, toSpec, topologyKey, type Draft, type DraftAction } from '../../lib/topologyDraft';
import { errorCount, hasErrors, validateDraft } from '../../lib/validateDraft';
import { Button, Panel } from '../ui';
import { DraftCanvas } from './DraftCanvas';
import { DraftEditor } from './DraftEditor';
import { PresetPicker } from './PresetPicker';

type Tab = 'presets' | 'editor';
type Status = { kind: 'idle' } | { kind: 'working'; message: string } | { kind: 'success'; message: string } | { kind: 'error'; message: string };

/**
 * Network builder: load presets or edit a local draft of the topology.
 *
 * The draft lives only in this component until "Apply topology" sends it to
 * the server (loadTopology, or setFlow when only the flow changed). The live
 * topology always comes from the server snapshot; `draft === null` means
 * "no local edits — mirror the live topology".
 */
export function NetworkBuilder({ snapshot, send, connected }: {
  snapshot: SimSnapshot;
  send: (cmd: Command) => Promise<CommandResult>;
  connected: boolean;
}) {
  const presets = usePresets(connected);
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<Tab>('presets');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedLink, setSelectedLink] = useState<string | null>(null);
  const [pendingPreset, setPendingPreset] = useState<PresetId | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [liveChangedNotice, setLiveChangedNotice] = useState(false);

  const liveDraftNow = draftFromSnapshot(snapshot);
  const liveKey = topologyKey(toSpec(liveDraftNow));
  // Only rebuild the live draft when the topology itself changes, not on every snapshot.
  const live = useMemo(() => liveDraftNow, [liveKey]);

  const current = draft ?? live;
  const draftKey = draft ? topologyKey(toSpec(draft)) : liveKey;
  const dirty = draftKey !== liveKey;
  const errors = useMemo(() => validateDraft(current, presets.limits), [current, presets.limits]);
  const invalid = hasErrors(errors);

  // When the live topology changes (apply, preset, demo): drop a draft that had no edits; keep real edits.
  const prevLiveKey = useRef(liveKey);
  useEffect(() => {
    if (prevLiveKey.current === liveKey) return;
    const before = prevLiveKey.current;
    prevLiveKey.current = liveKey;
    if (!draft) return;
    if (topologyKey(toSpec(draft)) === before) {
      setDraft(null);
    } else {
      setLiveChangedNotice(true);
    }
  }, [liveKey, draft]);

  // Forget selections that point at removed nodes/links.
  useEffect(() => {
    if (selectedNode && !current.nodes.some((n) => n.key === selectedNode)) setSelectedNode(null);
    if (selectedLink && !current.links.some((l) => l.key === selectedLink)) setSelectedLink(null);
  }, [current, selectedNode, selectedLink]);

  const dispatch = (a: DraftAction) => {
    setDraft((d) => draftReducer(d ?? live, a));
    if (status.kind !== 'working') setStatus({ kind: 'idle' });
  };

  const demoRunning = snapshot.demo.running;
  const blockedReason = !connected
    ? 'Not connected to the simulation server.'
    : demoRunning
      ? 'The guided demo is running — stop it to load or apply a topology.'
      : null;
  const working = status.kind === 'working';

  const runCommand = async (cmd: Command, workingMsg: string, successMsg: string) => {
    setStatus({ kind: 'working', message: workingMsg });
    const res = await send(cmd);
    if (res.ok) {
      setDraft(null);
      setSelectedNode(null);
      setSelectedLink(null);
      setLiveChangedNotice(false);
      setStatus({ kind: 'success', message: successMsg });
    } else {
      setStatus({ kind: 'error', message: res.error ?? 'The server rejected the request' });
    }
    return res.ok;
  };

  const presetName = (id: PresetId) => presets.presets.find((p) => p.id === id)?.name ?? id;

  const requestPreset = (id: PresetId) => {
    if (dirty) setPendingPreset(id);
    else void runCommand({ type: 'loadPreset', presetId: id }, `Loading ${presetName(id)}…`, `Loaded ${presetName(id)} — simulation reset`);
  };

  const confirmPreset = () => {
    const id = pendingPreset!;
    setPendingPreset(null);
    void runCommand({ type: 'loadPreset', presetId: id }, `Loading ${presetName(id)}…`, `Loaded ${presetName(id)} — draft discarded, simulation reset`);
  };

  const apply = () => {
    if (invalid) {
      setStatus({ kind: 'error', message: `Fix ${errorCount(errors)} problem(s) before applying` });
      return;
    }
    const spec = toSpec(current);
    if (onlyFlowDiffers(spec, toSpec(live))) {
      void runCommand({ type: 'setFlow', source: spec.source, destination: spec.destination }, 'Applying flow…',
        `Flow set to ${spec.source} → ${spec.destination} — simulation reset`);
    } else {
      void runCommand({ type: 'loadTopology', topology: spec }, 'Applying topology…', `Applied “${spec.name}” — simulation reset`);
    }
  };

  const discard = () => {
    setDraft(null);
    setSelectedNode(null);
    setSelectedLink(null);
    setLiveChangedNotice(false);
    setStatus({ kind: 'idle' });
  };

  const onCanvasNodeClick = (key: string) => {
    setSelectedLink(null);
    if (!selectedNode) return setSelectedNode(key);
    if (selectedNode === key) return setSelectedNode(null);
    const existing = current.links.find((l) => (l.a === selectedNode && l.b === key) || (l.a === key && l.b === selectedNode));
    if (existing) {
      setSelectedLink(existing.key);
    } else {
      setSelectedLink(`l${current.seq}`); // key the reducer will give the new link
      dispatch({ type: 'addLink', a: selectedNode, b: key });
    }
    setSelectedNode(null);
  };

  if (!snapshot.topology) {
    return (
      <Panel title="Network builder" subtitle="Presets and custom topologies">
        <p className="p-4 text-xs text-amber-300/80">
          The connected simulation server does not support custom topologies yet. Deploy the updated backend to use the builder.
        </p>
      </Panel>
    );
  }

  const loaded = snapshot.topology;

  return (
    <Panel
      title="Network builder"
      subtitle={
        <span data-testid="live-summary">
          Live: <span className="text-slate-300">{loaded.name}</span> ({loaded.presetId ? 'preset' : 'custom'}) · {snapshot.nodes.length} nodes ·{' '}
          {snapshot.links.length} links · {snapshot.flow.source} → {snapshot.flow.destination}
        </span>
      }
      actions={
        <div className="flex items-center gap-2">
          {dirty ? (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-200" data-testid="draft-badge">
              Unsaved draft
            </span>
          ) : (
            <span className="text-[11px] text-slate-500">No unsaved changes</span>
          )}
          <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? 'Hide' : 'Show'}
          </Button>
        </div>
      }
    >
      {open && (
        <div>
          <div className="flex flex-wrap items-center gap-1 border-b border-ink-700/60 px-4 pt-2" role="tablist">
            <TabButton active={tab === 'presets'} onClick={() => setTab('presets')}>Presets</TabButton>
            <TabButton active={tab === 'editor'} onClick={() => setTab('editor')}>
              Custom editor{dirty && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-400" aria-label="unsaved changes" />}
            </TabButton>
          </div>

          {pendingPreset && (
            <div role="alertdialog" aria-label="Discard unsaved changes?" className="m-4 mb-0 flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-100">
              <span className="flex-1">
                You have unsaved draft changes. Loading <b>{presetName(pendingPreset)}</b> will discard them and reset the simulation.
              </span>
              <Button size="sm" variant="danger" onClick={confirmPreset} disabled={!!blockedReason || working}>Discard draft &amp; load</Button>
              <Button size="sm" onClick={() => setPendingPreset(null)}>Keep editing</Button>
            </div>
          )}

          {liveChangedNotice && dirty && (
            <p className="m-4 mb-0 rounded-lg border border-sky-500/30 bg-sky-500/5 p-2.5 text-xs text-sky-200">
              The simulation's topology changed while you were editing (for example, the demo loaded Classic). Your draft was kept — apply it
              again or discard it.
            </p>
          )}

          {tab === 'presets' ? (
            <PresetPicker
              presets={presets}
              loadedId={loaded.presetId}
              disabled={!!blockedReason || working}
              disabledReason={blockedReason ?? undefined}
              onLoad={requestPreset}
              onRetry={presets.retry}
            />
          ) : (
            <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="relative h-[380px] min-w-0 rounded-lg border border-dashed border-amber-500/30 bg-ink-950/40">
                <span className="pointer-events-none absolute top-2 left-3 z-10 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-amber-200 uppercase">
                  {dirty ? 'Draft — not applied' : 'Draft (same as live)'}
                </span>
                <span className="pointer-events-none absolute bottom-2 left-3 z-10 text-[10px] text-slate-500">
                  Drag to move · click two nodes to link · click a link to edit
                </span>
                <DraftCanvas
                  draft={current}
                  errors={errors}
                  selectedNode={selectedNode}
                  selectedLink={selectedLink}
                  onNodeClick={onCanvasNodeClick}
                  onLinkClick={(key) => { setSelectedNode(null); setSelectedLink(key); }}
                  onPaneClick={() => { setSelectedNode(null); setSelectedLink(null); }}
                  dispatch={dispatch}
                />
              </div>
              <div className="scroll-thin max-h-[560px] min-w-0 overflow-y-auto pr-1">
                <DraftEditor
                  draft={current}
                  errors={errors}
                  limits={presets.limits}
                  selectedNode={selectedNode}
                  selectedLink={selectedLink}
                  dispatch={dispatch}
                  onSelectNode={(k) => { setSelectedLink(null); setSelectedNode(k); }}
                  onSelectLink={(k) => { setSelectedNode(null); setSelectedLink(k); }}
                />
              </div>
            </div>
          )}

          <footer className="flex flex-wrap items-center gap-3 border-t border-ink-700/60 px-4 py-2.5">
            <StatusLine status={status} />
            {tab === 'editor' && (
              <>
                {errors.general.map((g) => (
                  <span key={g} className="text-xs text-rose-300">{g}</span>
                ))}
                {invalid && dirty && <span className="text-xs text-rose-300">{errorCount(errors)} problem(s) to fix</span>}
                {blockedReason && <span className="text-xs text-amber-300/80">{blockedReason}</span>}
              </>
            )}
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="ghost" onClick={discard} disabled={!draft || working}>Discard draft</Button>
              <Button
                size="sm"
                variant="primary"
                onClick={apply}
                disabled={!dirty || invalid || !!blockedReason || working}
                title={invalid ? 'Fix the highlighted problems first' : blockedReason ?? (dirty ? 'Send this topology to the simulation (resets it)' : 'No changes to apply')}
              >
                Apply topology
              </Button>
            </div>
          </footer>
        </div>
      )}
    </Panel>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cx(
        '-mb-px flex items-center border-b-2 px-3 py-1.5 text-xs font-medium transition-colors',
        active ? 'border-cyan-400 text-cyan-200' : 'border-transparent text-slate-500 hover:text-slate-300',
      )}
    >
      {children}
    </button>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (status.kind === 'idle') return null;
  const cls = { working: 'text-slate-400', success: 'text-emerald-300', error: 'text-rose-300' }[status.kind];
  return (
    <span role="status" className={cx('text-xs', cls)} data-testid="builder-status">
      {status.kind === 'working' && <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-cyan-400" />}
      {status.message}
    </span>
  );
}
