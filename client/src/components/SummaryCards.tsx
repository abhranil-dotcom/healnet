import type { ReactNode } from 'react';
import type { SimSnapshot } from '../../../shared/types';
import { cx, fmtMs, fmtPct } from '../lib/format';

function Card({ label, value, sub, tone = 'default' }: { label: string; value: ReactNode; sub: ReactNode; tone?: 'default' | 'good' | 'warn' | 'bad' }) {
  const toneCls = { default: 'text-slate-100', good: 'text-emerald-300', warn: 'text-amber-300', bad: 'text-rose-300' }[tone];
  return (
    <div className="rounded-xl border border-ink-700/70 bg-ink-900 px-4 py-3">
      <div className="text-[11px] font-medium tracking-[0.1em] text-slate-500 uppercase">{label}</div>
      <div className={cx('mt-1 font-mono text-2xl font-semibold tabular-nums', toneCls)}>{value}</div>
      <div className="mt-0.5 truncate text-xs text-slate-500">{sub}</div>
    </div>
  );
}

export function SummaryCards({ snapshot }: { snapshot: SimSnapshot }) {
  const { nodes, links, metrics: m } = snapshot;
  const activeNodes = nodes.filter((n) => n.status === 'ACTIVE').length;
  const activeLinks = links.filter((l) => l.usable && l.status === 'UP').length;
  const rec = m.lastRecovery;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <Card
        label="Active nodes"
        value={`${activeNodes}/${nodes.length}`}
        sub={nodes.filter((n) => n.status !== 'ACTIVE').map((n) => `${n.id}: ${n.status}`).join(' · ') || 'All nodes acknowledging'}
        tone={activeNodes === nodes.length ? 'good' : 'warn'}
      />
      <Card
        label="Active links"
        value={`${activeLinks}/${links.length}`}
        sub={links.filter((l) => !(l.usable && l.status === 'UP')).map((l) => l.id).join(', ') || 'All links healthy'}
        tone={activeLinks === links.length ? 'good' : 'warn'}
      />
      <Card label="Packets delivered" value={m.delivered} sub={`${m.sent} sent · ${m.inFlight} in flight`} />
      <Card
        label="Packet loss"
        value={fmtPct(m.lossPercent)}
        sub={`${m.lost} dropped · ${m.crcRejected} CRC rejected`}
        tone={m.lossPercent == null || m.lossPercent === 0 ? 'default' : m.lossPercent < 10 ? 'warn' : 'bad'}
      />
      <Card
        label="Recovery time"
        value={rec ? fmtMs(rec.recoveryMs) : '—'}
        sub={rec ? `${rec.cause} · detection ${fmtMs(rec.detectionMs)}` : 'No recovery recorded yet'}
        tone={rec ? 'good' : 'default'}
      />
    </div>
  );
}
