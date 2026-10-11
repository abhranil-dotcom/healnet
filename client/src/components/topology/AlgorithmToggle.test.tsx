import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SimulationEngine } from '../../../../server/src/sim/engine';
import { AlgorithmToggle } from './AlgorithmToggle';

describe('AlgorithmToggle', () => {
  it('shows the current algorithm and reports a switch', () => {
    const onChange = vi.fn();
    render(<AlgorithmToggle value="BFS" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'BFS' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'BFS' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: 'Dijkstra' }));
    expect(onChange).toHaveBeenCalledWith('DIJKSTRA');
  });

  it('is disabled during the demo', () => {
    const onChange = vi.fn();
    render(<AlgorithmToggle value="BFS" disabled onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Dijkstra' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('the command it triggers changes the real route on the BFS-vs-Dijkstra preset', () => {
    const e = new SimulationEngine({ trafficIntervalMs: 0 });
    e.loadPreset('trap');
    let snap = e.snapshot();
    expect([snap.routing.algorithm, snap.activeRoute, snap.routing.activeRouteCost]).toEqual(['BFS', ['A', 'B', 'C'], 1000]);
    const onChange = vi.fn((routingAlgorithm) => e.execute({ type: 'setConfig', config: { routingAlgorithm } }));
    render(<AlgorithmToggle value={snap.routing.algorithm} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Dijkstra' }));
    snap = e.snapshot();
    expect([snap.routing.algorithm, snap.activeRoute, snap.routing.activeRouteCost]).toEqual(['DIJKSTRA', ['A', 'D', 'E', 'C'], 300]);
  });
});
