import type { NodeId, Packet, PacketType } from '../../../shared/types.js';
import { crc16OfString } from './crc16.js';

/** The exact bytes covered by the CRC: every header field plus the payload. */
export function packetCrcInput(p: Pick<Packet, 'source' | 'destination' | 'type' | 'seq' | 'createdAt' | 'payload'>): string {
  return `${p.source}|${p.destination}|${p.type}|${p.seq}|${p.createdAt}|${p.payload}`;
}

export function createPacket(fields: {
  id: number;
  seq: number;
  type: PacketType;
  source: NodeId;
  destination: NodeId;
  payload: string;
  createdAt: number;
  path: NodeId[];
}): Packet {
  return { ...fields, crc: crc16OfString(packetCrcInput(fields)) };
}

export interface CrcCheck {
  valid: boolean;
  expected: number;
  computed: number;
}

/** Receiver side: recompute the CRC and compare it with the one carried in the packet. */
export function validatePacket(p: Packet): CrcCheck {
  const computed = crc16OfString(packetCrcInput(p));
  return { valid: computed === p.crc, expected: p.crc, computed };
}

/**
 * Simulate a transmission bit error: flip one bit of the first payload byte.
 * The stored CRC is left untouched, so the receiver will detect the mismatch.
 */
export function corruptPacket(p: Packet): Packet {
  if (p.payload.length === 0) return { ...p, payload: '\u0001' };
  const flipped = String.fromCharCode(p.payload.charCodeAt(0) ^ 0x01);
  return { ...p, payload: flipped + p.payload.slice(1) };
}
