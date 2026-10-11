import type { ReactElement, ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { SimSnapshot } from '../../../shared/types';
import { fmtMs, fmtPct, fmtRoute } from '../lib/format';
import { Panel } from './ui';

// Categorical slots validated against the dark panel surface (#0d1218).
const SERIES_1 = '#3987e5';
const SERIES_2 = '#d95926';
const GRID = '#1c2633';
const AXIS = { fontSize: 10, fill: '#64748b' };

const tooltipProps = {
  contentStyle: { background: '#0d1218', border: '1px solid #243041', borderRadius: 8, fontSize: 11 },
  labelStyle: { color: '#94a3b8' },
  itemStyle: { color: '#e2e8f0' },
  cursor: { stroke: '#344257' },
};

export function Analytics({ snapshot }: { snapshot: SimSnapshot }) {
  const { series, delaySamples, metrics: m } = snapshot;
  const data = series.map((s) => ({ ...s, tSec: +(s.t / 1000).toFixed(1) }));
  const rec = m.lastRecovery;
  const primary = snapshot.primaryRoute.join('-');

  return (
    <Panel title="Analytics" subtitle="All values are simulation measurements computed from the running model">
      <div className="grid gap-4 p-4 lg:grid-cols-3">
        <Stat label="Delivery ratio" value={fmtPct(m.deliveryRatio)} />
        <Stat label="Avg end-to-end delay" value={fmtMs(m.avgDelayMs, 1)} />
        <Stat label="Throughput (5 s window)" value={`${m.throughputPps.toFixed(2)} pkt/s · ${(m.throughputBps / 1000).toFixed(2)} kbit/s`} />

        <Chart title="Throughput (delivered pkt/s)" empty={data.length < 2}>
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="tSec" type="number" domain={['dataMin', 'dataMax']} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} unit="s" />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals />
            <Tooltip {...tooltipProps} labelFormatter={(v) => `t = ${v} s`} formatter={(v) => [Number(v).toFixed(2), 'pkt/s']} />
            {rec && <ReferenceLine x={+(rec.failedAt / 1000).toFixed(1)} stroke="#64748b" strokeDasharray="3 3" label={{ value: 'fault', fill: '#94a3b8', fontSize: 10, position: 'insideTopLeft' }} />}
            {rec && <ReferenceLine x={+(rec.recoveredAt / 1000).toFixed(1)} stroke="#94a3b8" strokeDasharray="3 3" label={{ value: 'rerouted', fill: '#94a3b8', fontSize: 10, position: 'insideTopRight' }} />}
            <Line type="monotone" dataKey="throughputPps" stroke={SERIES_1} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </Chart>

        <Chart
          title="Cumulative delivered vs lost"
          empty={data.length < 2}
          legend={[{ color: SERIES_1, label: 'Delivered' }, { color: SERIES_2, label: 'Lost / rejected' }]}
        >
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="tSec" type="number" domain={['dataMin', 'dataMax']} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} unit="s" />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip {...tooltipProps} labelFormatter={(v) => `t = ${v} s`} />
            <Line type="stepAfter" dataKey="delivered" name="Delivered" stroke={SERIES_1} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="stepAfter" dataKey="lost" name="Lost / rejected" stroke={SERIES_2} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </Chart>

        <Chart
          title="End-to-end delay per packet"
          empty={delaySamples.length === 0}
          legend={[{ color: SERIES_1, label: 'Primary A→B→C' }, { color: SERIES_2, label: 'Backup / other route' }]}
        >
          <BarChart data={delaySamples} margin={{ top: 8, right: 8, bottom: 0, left: -18 }} barCategoryGap={2}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="seq" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} unit="ms" width={60} />
            <Tooltip
              {...tooltipProps}
              cursor={{ fill: '#17202b' }}
              labelFormatter={(v) => `Packet #${v}`}
              formatter={(v, _n, item) => [`${v} ms via ${(item.payload as { route: string }).route.split('-').join('→')}`, 'Delay']}
            />
            <Bar dataKey="delayMs" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {delaySamples.map((d) => (
                <Cell key={d.seq} fill={d.route === primary ? SERIES_1 : SERIES_2} />
              ))}
            </Bar>
          </BarChart>
        </Chart>

        <div className="lg:col-span-3">
          <h3 className="mb-2 text-[11px] font-semibold tracking-[0.1em] text-slate-500 uppercase">Recovery history</h3>
          {m.recoveries.length === 0 ? (
            <p className="text-xs text-slate-500">No route recovery has happened yet. Fail a node or link on the active route to trigger one.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-xs">
                <thead>
                  <tr className="text-left text-[10px] tracking-wider text-slate-600 uppercase">
                    <th className="pb-1.5 font-medium">Cause</th>
                    <th className="pb-1.5 font-medium">Failed at</th>
                    <th className="pb-1.5 font-medium">Detection</th>
                    <th className="pb-1.5 font-medium">Recovery</th>
                    <th className="pb-1.5 font-medium">BFS (real)</th>
                    <th className="pb-1.5 font-medium">Route change</th>
                  </tr>
                </thead>
                <tbody>
                  {m.recoveries.map((r, i) => (
                    <tr key={i} className="border-t border-ink-800 text-slate-300">
                      <td className="py-1.5">{r.cause}</td>
                      <td>{(r.failedAt / 1000).toFixed(2)} s</td>
                      <td>{fmtMs(r.detectionMs)}</td>
                      <td className="text-emerald-300">{fmtMs(r.recoveryMs)}</td>
                      <td>{r.bfsMicros} µs</td>
                      <td>{fmtRoute(r.oldRoute)} ⇒ {fmtRoute(r.newRoute)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-ink-700/60 bg-ink-950/50 px-3 py-2">
      <div className="text-[10px] tracking-wider text-slate-500 uppercase">{label}</div>
      <div className="mt-0.5 font-mono text-sm text-slate-100">{value}</div>
    </div>
  );
}

function Chart({ title, empty, legend, children }: { title: string; empty: boolean; legend?: { color: string; label: string }[]; children: ReactNode }) {
  return (
    <figure className="rounded-lg border border-ink-700/60 bg-ink-950/40 p-3">
      <figcaption className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-slate-300">{title}</span>
        {legend && (
          <span className="flex gap-3 text-[10px] text-slate-400">
            {legend.map((l) => (
              <span key={l.label} className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm" style={{ background: l.color }} />
                {l.label}
              </span>
            ))}
          </span>
        )}
      </figcaption>
      <div className="h-44">
        {empty ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-600">Waiting for simulation data…</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {children as ReactElement}
          </ResponsiveContainer>
        )}
      </div>
    </figure>
  );
}
