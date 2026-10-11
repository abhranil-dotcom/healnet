import { describe, expect, it } from 'vitest';
import { crc16CcittFalse, crc16OfString, formatCrc } from '../src/sim/crc16.js';
import { corruptPacket, createPacket, validatePacket } from '../src/sim/packet.js';

describe('CRC-16/CCITT-FALSE', () => {
  it('matches the standard check value for "123456789"', () => {
    expect(crc16OfString('123456789')).toBe(0x29b1);
  });

  it('returns the init value for empty input', () => {
    expect(crc16CcittFalse(new Uint8Array())).toBe(0xffff);
  });

  it('formats as 4 hex digits', () => {
    expect(formatCrc(0x29b1)).toBe('0x29B1');
    expect(formatCrc(0x00a)).toBe('0x000A');
  });
});

describe('packet CRC validation', () => {
  const packet = createPacket({
    id: 1, seq: 1, type: 'DATA', source: 'A', destination: 'C', payload: 'hello', createdAt: 42, path: ['A', 'B', 'C'],
  });

  it('accepts an untouched packet', () => {
    expect(validatePacket(packet).valid).toBe(true);
  });

  it('rejects a packet with a flipped payload bit', () => {
    const bad = corruptPacket(packet);
    expect(bad.payload).not.toBe(packet.payload);
    const check = validatePacket(bad);
    expect(check.valid).toBe(false);
    expect(check.expected).toBe(packet.crc);
    expect(check.computed).not.toBe(packet.crc);
  });

  it('rejects a packet whose header was altered', () => {
    expect(validatePacket({ ...packet, seq: 2 }).valid).toBe(false);
  });
});
