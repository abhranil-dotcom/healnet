import { useCallback, useEffect, useState } from 'react';
import type { Command } from '../../shared/types';
import { Analytics } from './components/Analytics';
import { ControlPanel } from './components/ControlPanel';
import { DemoPanel } from './components/DemoPanel';
import { EventFeed } from './components/EventFeed';
import { Header } from './components/Header';
import { HealthPanel } from './components/HealthPanel';
import { SummaryCards } from './components/SummaryCards';
import { Topology } from './components/topology/Topology';
import { useSimulation } from './hooks/useSimulation';
import { SOCKET_URL } from './lib/config';

export default function App() {
  const { snapshot, connection, send, clockRef } = useSimulation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  /** Send a command and surface any validation error the server returns. */
  const run = useCallback(
    async (cmd: Command) => {
      setBusy(true);
      const res = await send(cmd);
      setBusy(false);
      if (!res.ok) setError(res.error ?? 'Command failed');
    },
    [send],
  );

  const toggleNode = (id: string) => {
    if (!snapshot || snapshot.demo.running) return;
    const n = snapshot.nodes.find((x) => x.id === id);
    if (n) run({ type: n.actualUp ? 'failNode' : 'restoreNode', nodeId: id });
  };
  const toggleLink = (id: string) => {
    if (!snapshot || snapshot.demo.running) return;
    const l = snapshot.links.find((x) => x.id === id);
    if (l) run({ type: l.actualUp ? 'disconnectLink' : 'reconnectLink', linkId: id });
  };

  return (
    <div className="min-h-screen">
      <Header
        snapshot={snapshot}
        connection={connection}
        busy={busy}
        onStart={() => run({ type: 'start' })}
        onPause={() => run({ type: 'pause' })}
        onReset={() => run({ type: 'reset' })}
        onRunDemo={() => run({ type: 'runDemo' })}
        onStopDemo={() => run({ type: 'stopDemo' })}
      />

      {error && (
        <div role="alert" className="animate-fade-in fixed top-20 right-6 z-50 max-w-sm rounded-lg border border-rose-500/40 bg-ink-900 px-4 py-3 text-sm text-rose-200 shadow-xl">
          {error}
        </div>
      )}

      {!snapshot ? (
        <div className="flex h-[70vh] flex-col items-center justify-center gap-2 text-slate-500">
          <span className="text-sm">
            {connection === 'disconnected' ? 'Cannot reach the simulation server yet — retrying automatically…' : 'Connecting to the simulation server…'}
          </span>
          <span className="font-mono text-xs">{SOCKET_URL}</span>
          {connection === 'disconnected' && (
            <span className="max-w-md text-center text-xs text-slate-600">
              Running locally? Start it with <span className="font-mono">npm run dev</span>. A sleeping hosted server can take up to a
              minute to wake up.
            </span>
          )}
        </div>
      ) : (
        <main className="mx-auto max-w-[1600px] space-y-4 p-4 lg:p-6">
          <SummaryCards snapshot={snapshot} />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
            <div className="min-w-0 space-y-4">
              <Topology snapshot={snapshot} clockRef={clockRef} onToggleNode={toggleNode} onToggleLink={toggleLink} />
              <ControlPanel snapshot={snapshot} send={run} />
              <Analytics snapshot={snapshot} />
            </div>
            <aside className="min-w-0 space-y-4">
              <DemoPanel demo={snapshot.demo} />
              <HealthPanel snapshot={snapshot} />
              <EventFeed events={snapshot.events} />
            </aside>
          </div>

          <footer className="pb-2 text-center text-[11px] text-slate-600">
            HEALNET · software-only simulation · heartbeat failure detection · BFS route recovery · CRC-16/CCITT-FALSE
          </footer>
        </main>
      )}
    </div>
  );
}
