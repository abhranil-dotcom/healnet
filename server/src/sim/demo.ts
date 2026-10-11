import type { DemoView } from '../../../shared/types.js';
import type { SimulationEngine } from './engine.js';
import { ALGORITHM_LABEL } from './routing.js';

/**
 * One-click demonstration, written as a list of steps. Each step has an
 * optional action (run once when the step becomes active) and a completion
 * condition that is checked against the *real* engine state after every
 * simulated event. Nothing here fakes a result: the demo only waits for the
 * engine's heartbeat, BFS and packet logic to produce the outcome.
 */
interface DemoStep {
  label: string;
  enter?: (e: SimulationEngine, ctx: DemoContext) => void;
  done: (e: SimulationEngine, ctx: DemoContext) => boolean;
}

interface DemoContext {
  stepStartedAt: number;
}

const PACKETS_PER_PHASE = 5;
/** Safety net: abort if the demo has not finished within this much simulated time. */
const DEMO_TIMEOUT_MS = 60_000;

const deliveredVia = (e: SimulationEngine, route: string, since: number) =>
  e.packets.filter((p) => p.state === 'DELIVERED' && p.path.join('-') === route && p.createdAt >= since).length;

const STEPS: DemoStep[] = [
  {
    label: 'Initialize network',
    // The network was reset when the demo started; wait until every node has acknowledged a heartbeat.
    done: (e) => [...e.nodes.values()].every((n) => n.lastAckAt !== null),
  },
  {
    label: 'Establish primary route A → B → C',
    done: (e) => e.activeRoute?.join('-') === 'A-B-C',
  },
  {
    label: `Deliver ${PACKETS_PER_PHASE} packets on primary route`,
    done: (e, c) => deliveredVia(e, 'A-B-C', c.stepStartedAt) >= PACKETS_PER_PHASE,
  },
  {
    label: 'Fail Node B',
    enter: (e) => {
      e.log('DEMO', 'warn', 'Demo: injecting failure on Node B');
      e.failNode('B');
    },
    done: (e) => !e.nodes.get('B')!.actualUp,
  },
  {
    label: 'Heartbeat-based failure detection',
    done: (e) => e.nodes.get('B')!.status === 'FAILED',
  },
  {
    label: 'BFS recovery to A → D → C',
    done: (e) => e.activeRoute?.join('-') === 'A-D-C',
  },
  {
    label: `Resume delivery (${PACKETS_PER_PHASE} packets on backup)`,
    done: (e, c) => deliveredVia(e, 'A-D-C', c.stepStartedAt) >= PACKETS_PER_PHASE,
  },
  {
    label: 'Report recovery result and metrics',
    // Stop generating new traffic and let in-flight packets finish.
    enter: (e) => {
      e.config = { ...e.config, trafficIntervalMs: 0 };
    },
    done: (e) => e.inFlightCount === 0,
  },
];

export class DemoRunner {
  running = true;
  finished = false;
  summary: string | null = null;
  private index = -1;
  private ctx: DemoContext = { stepStartedAt: 0 };

  /** Advance through as many steps as the current engine state allows. */
  update(e: SimulationEngine): void {
    if (!this.running) return;
    if (e.now > DEMO_TIMEOUT_MS) {
      this.running = false;
      this.summary = 'Demo aborted: expected network state was not reached (was the network changed manually?).';
      e.endDemo('Demo aborted after timeout', true);
      return;
    }
    if (this.index === -1) this.enter(e, 0);
    while (this.running && STEPS[this.index].done(e, this.ctx)) {
      if (this.index === STEPS.length - 1) return this.finish(e);
      this.enter(e, this.index + 1);
    }
  }

  stop(e: SimulationEngine): void {
    this.running = false;
    this.summary = 'Demo stopped by user.';
    e.endDemo('Demo stopped by user — network left in its current state', false);
  }

  view(): DemoView {
    return {
      running: this.running,
      finished: this.finished,
      steps: STEPS.map((s, i) => ({
        label: s.label,
        status: i < this.index || (this.finished && i === this.index) ? 'done' : i === this.index && this.running ? 'active' : 'pending',
      })),
      summary: this.summary,
    };
  }

  private enter(e: SimulationEngine, i: number): void {
    this.index = i;
    this.ctx = { stepStartedAt: e.now };
    e.log('DEMO', 'info', `Demo step ${i + 1}/${STEPS.length}: ${STEPS[i].label}`);
    STEPS[i].enter?.(e, this.ctx);
  }

  private finish(e: SimulationEngine): void {
    this.running = false;
    this.finished = true;
    const m = e.getMetrics();
    const r = m.lastRecovery;
    this.summary = r
      ? `Recovered from ${r.cause} failure in ${r.recoveryMs} ms (detection ${r.detectionMs} ms, ${ALGORITHM_LABEL[r.algorithm]} ${r.computeMicros} µs). ` +
        `Delivered ${m.delivered}/${m.sent} packets — loss ${m.lossPercent?.toFixed(1) ?? '0.0'}% (packets lost during the detection window).`
      : 'Demo finished, but no recovery was recorded.';
    e.endDemo(`Demo complete — ${this.summary}`, true);
  }
}
