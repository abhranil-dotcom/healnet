import type { NodeId } from '../../../shared/types';

export const fmtSimTime = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
export const fmtMs = (ms: number | null | undefined, digits = 0) => (ms == null ? '—' : `${ms.toFixed(digits)} ms`);
export const fmtPct = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(1)}%`);
export const fmtRoute = (r: NodeId[] | null | undefined) => (r && r.length ? r.join(' → ') : 'No route');

export function linkIdOf(a: NodeId, b: NodeId) {
  return [a, b].sort().join('-');
}

/** Link ids traversed by a route, e.g. A-B-C → ["A-B", "B-C"]. */
export function routeLinks(route: NodeId[] | null): Set<string> {
  const set = new Set<string>();
  if (!route) return set;
  for (let i = 0; i < route.length - 1; i++) set.add(linkIdOf(route[i], route[i + 1]));
  return set;
}

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}
