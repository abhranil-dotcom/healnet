import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Command, CommandResult, SimSnapshot } from '../../../shared/types';
import { API_URL, SOCKET_URL } from '../lib/config';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export interface SimClockRef {
  simTime: number;
  receivedAt: number;
  running: boolean;
}

/**
 * Connects to the simulation server. Exactly one socket exists per mounted
 * hook; it is closed on unmount so React StrictMode / HMR never leaves a
 * duplicate connection behind.
 */
export function useSimulation() {
  const [snapshot, setSnapshot] = useState<SimSnapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const socketRef = useRef<Socket | null>(null);
  // Latest server clock, used to interpolate packet animation between snapshots.
  const clockRef = useRef<SimClockRef>({ simTime: 0, receivedAt: performance.now(), running: false });

  useEffect(() => {
    // A plain HTTP request wakes a sleeping host (e.g. Render free tier) while the socket retries.
    fetch(`${API_URL}/health`).catch(() => undefined);

    const socket = io(SOCKET_URL, {
      // WebSocket first (wss:// automatically when SOCKET_URL is https), HTTP long-polling as fallback.
      transports: ['websocket', 'polling'],
      tryAllTransports: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 20000, // generous, so a cold-starting server is not given up on too early
    });
    socketRef.current = socket;
    socket.on('connect', () => setConnection('connected'));
    socket.on('disconnect', (reason) => {
      setConnection('disconnected');
      // Socket.IO only auto-reconnects for transport errors; a server-initiated disconnect
      // (e.g. during a redeploy) needs an explicit reconnect.
      if (reason === 'io server disconnect') socket.connect();
    });
    socket.on('connect_error', () => setConnection('disconnected'));
    // The server sends a full snapshot on every (re)connection, so state resynchronises automatically.
    socket.on('state', (s: SimSnapshot) => {
      clockRef.current = { simTime: s.simTime, receivedAt: performance.now(), running: s.running };
      setSnapshot(s);
    });
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const send = useCallback((cmd: Command): Promise<CommandResult> => {
    const socket = socketRef.current;
    if (!socket?.connected) return Promise.resolve({ ok: false, error: 'Not connected to the simulation server' });
    return new Promise((resolve) => {
      socket.timeout(5000).emit('command', cmd, (err: Error | null, res: CommandResult) => {
        resolve(err ? { ok: false, error: 'Server did not respond' } : res);
      });
    });
  }, []);

  return { snapshot, connection, send, clockRef };
}

/** Estimated current simulated time (server time + time since the last snapshot). */
export function estimateSimTime(clock: SimClockRef): number {
  if (!clock.running) return clock.simTime;
  // Never extrapolate far beyond the last snapshot (e.g. if the connection stalls).
  return clock.simTime + Math.min(performance.now() - clock.receivedAt, 250);
}
