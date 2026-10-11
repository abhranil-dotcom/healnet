import type { RoutingAlgorithm } from '../../../../shared/types';
import { cx } from '../../lib/format';

const OPTIONS: { value: RoutingAlgorithm; label: string; title: string }[] = [
  { value: 'BFS', label: 'BFS', title: 'Breadth-First Search: fewest hops, ignores link latency' },
  { value: 'DIJKSTRA', label: 'Dijkstra', title: "Dijkstra's algorithm: lowest total link latency" },
];

/** Segmented BFS / Dijkstra switch. The change applies live (no reset). */
export function AlgorithmToggle({ value, disabled, onChange }: {
  value: RoutingAlgorithm;
  disabled?: boolean;
  onChange: (algorithm: RoutingAlgorithm) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Routing algorithm" className="inline-flex rounded-lg border border-ink-600 bg-ink-950 p-0.5">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          disabled={disabled}
          onClick={() => value !== o.value && onChange(o.value)}
          className={cx(
            'rounded-md px-2.5 py-0.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
            value === o.value ? 'bg-cyan-500/15 text-cyan-200' : 'text-slate-400 hover:text-slate-200',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
