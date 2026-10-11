import type { SimSnapshot } from '../../../shared/types';
import { fmtSimTime } from '../lib/format';
import { Badge, linkStatusStyle, nodeStatusStyle, Panel } from './ui';

export function HealthPanel({ snapshot }: { snapshot: SimSnapshot }) {
  const { nodes, links, config, lastBfs } = snapshot;
  const last = snapshot.routing?.lastResult;
  const algorithm = last?.algorithm === 'DIJKSTRA' ? 'Dijkstra' : 'BFS';

  return (
    <Panel title="Network health" subtitle={`Heartbeat every ${config.heartbeatIntervalMs} ms · fail after ${config.missedThreshold} misses`}>
      <div className="space-y-4 p-4">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] tracking-wider text-slate-600 uppercase">
              <th className="pb-1.5 font-medium">Node</th>
              <th className="pb-1.5 font-medium">Detected</th>
              <th className="pb-1.5 font-medium">Missed</th>
              <th className="pb-1.5 text-right font-medium">Last ack</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {nodes.map((n) => (
              <tr key={n.id} className="border-t border-ink-800">
                <td className="py-1.5 text-slate-200">{n.id}{!n.actualUp && <span className="ml-1.5 text-[10px] text-rose-400">off</span>}</td>
                <td><Badge className={nodeStatusStyle[n.status]}>{n.status}</Badge></td>
                <td className={n.missedHeartbeats ? 'text-amber-300' : 'text-slate-500'}>{n.missedHeartbeats}/{config.missedThreshold}</td>
                <td className="text-right text-slate-500">{n.lastAckAt == null ? '—' : fmtSimTime(n.lastAckAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] tracking-wider text-slate-600 uppercase">
              <th className="pb-1.5 font-medium">Link</th>
              <th className="pb-1.5 font-medium">Hello</th>
              <th className="pb-1.5 font-medium">Latency</th>
              <th className="pb-1.5 text-right font-medium">Routable</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {links.map((l) => (
              <tr key={l.id} className="border-t border-ink-800">
                <td className="py-1.5 text-slate-200">{l.id}{!l.actualUp && <span className="ml-1.5 text-[10px] text-rose-400">cut</span>}</td>
                <td><Badge className={linkStatusStyle[l.status]}>{l.status}</Badge></td>
                <td className="text-slate-500">{l.latencyMs} ms</td>
                <td className={`text-right ${l.usable ? 'text-emerald-400' : 'text-rose-400'}`}>{l.usable ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="rounded-lg border border-ink-700/70 bg-ink-950/60 p-3">
          <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
            Last {algorithm} run
            {lastBfs && <span className="font-mono font-normal normal-case">t = {fmtSimTime(lastBfs.at)}</span>}
          </div>
          {lastBfs ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs">
              <dt className="text-slate-500">excluded</dt>
              <dd className="text-rose-300">{[...lastBfs.excludedNodes, ...lastBfs.excludedLinks].join(', ') || 'none'}</dd>
              <dt className="text-slate-500">{algorithm === 'Dijkstra' ? 'settled' : 'visited'}</dt>
              <dd className="text-slate-300">{lastBfs.visitOrder.join(' → ') || '—'}</dd>
              <dt className="text-slate-500">path</dt>
              <dd className={lastBfs.path ? 'text-cyan-300' : 'text-rose-300'}>{lastBfs.path?.join(' → ') ?? 'unreachable'}</dd>
              {last?.path && last.cost != null && (
                <>
                  <dt className="text-slate-500">cost</dt>
                  <dd className="text-slate-300">{last.cost} ms · {last.hops} hop(s)</dd>
                </>
              )}
            </dl>
          ) : (
            <p className="text-xs text-slate-500">Not run yet.</p>
          )}
        </div>
      </div>
    </Panel>
  );
}
