import { useMemo, useState } from 'react';
import type { EventKind, SimEvent } from '../../../shared/types';
import { cx } from '../lib/format';
import { Panel } from './ui';

const FILTERS: { key: string; label: string; kinds: EventKind[] | null }[] = [
  { key: 'all', label: 'All', kinds: null },
  { key: 'packets', label: 'Packets', kinds: ['PACKET_SENT', 'PACKET_DELIVERED', 'PACKET_LOST', 'CRC_FAILED'] },
  { key: 'faults', label: 'Faults', kinds: ['HEARTBEAT_MISSED', 'NODE_FAILED', 'NODE_RESTORED', 'LINK_DOWN', 'LINK_UP', 'CRC_FAILED', 'USER'] },
  { key: 'routing', label: 'Routing', kinds: ['INIT', 'BFS', 'ROUTE_CHANGED', 'RECOVERY', 'NO_ROUTE', 'DEMO'] },
];

const levelCls = {
  info: 'bg-slate-500',
  success: 'bg-emerald-400',
  warn: 'bg-amber-400',
  error: 'bg-rose-500',
};

const kindLabel: Record<EventKind, string> = {
  INIT: 'INIT', PACKET_SENT: 'SEND', PACKET_DELIVERED: 'RECV', PACKET_LOST: 'LOSS', CRC_FAILED: 'CRC',
  HEARTBEAT_MISSED: 'HB', NODE_FAILED: 'FAIL', NODE_RESTORED: 'UP', LINK_DOWN: 'LINK', LINK_UP: 'LINK',
  BFS: 'BFS', DIJKSTRA: 'DIJK', ROUTE_CHANGED: 'ROUTE', RECOVERY: 'HEAL', NO_ROUTE: 'ROUTE', USER: 'USER', DEMO: 'DEMO',
};

export function EventFeed({ events }: { events: SimEvent[] }) {
  const [filter, setFilter] = useState('all');
  const shown = useMemo(() => {
    const kinds = FILTERS.find((f) => f.key === filter)!.kinds;
    return events.filter((e) => !kinds || kinds.includes(e.kind)).slice().reverse();
  }, [events, filter]);

  return (
    <Panel
      title="Event log"
      subtitle="Timestamps are simulated time"
      className="min-h-0"
      actions={
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cx(
                'rounded-md px-2 py-0.5 text-[11px] transition-colors',
                filter === f.key ? 'bg-ink-700 text-slate-100' : 'text-slate-500 hover:text-slate-300',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      }
    >
      <ol className="scroll-thin h-[520px] overflow-y-auto px-2 py-2 font-mono text-[11.5px]">
        {shown.length === 0 && <li className="p-3 text-slate-500">No events.</li>}
        {shown.map((e) => (
          <li key={e.id} className="animate-fade-in flex gap-2 rounded-md px-2 py-1 hover:bg-ink-850">
            <span className="w-14 shrink-0 text-right text-slate-600 tabular-nums">{(e.simTime / 1000).toFixed(2)}s</span>
            <span className={cx('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', levelCls[e.level])} />
            <span className="w-10 shrink-0 text-slate-500">{kindLabel[e.kind]}</span>
            <span
              className={cx(
                'min-w-0 break-words',
                e.level === 'error' ? 'text-rose-300' : e.level === 'warn' ? 'text-amber-200' : e.level === 'success' ? 'text-emerald-300' : 'text-slate-300',
              )}
            >
              {e.message}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
