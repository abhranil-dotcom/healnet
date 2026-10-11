/**
 * CRC-16/CCITT-FALSE
 *
 *   width   = 16
 *   poly    = 0x1021   (x^16 + x^12 + x^5 + 1)
 *   init    = 0xFFFF
 *   refin   = false, refout = false
 *   xorout  = 0x0000
 *   check   = 0x29B1   (CRC of the ASCII string "123456789")
 *
 * Bitwise (table-free) implementation so every step is easy to follow:
 * for each byte, XOR it into the top 8 bits of the register, then shift
 * left 8 times; whenever the bit shifted out is 1, XOR in the polynomial.
 */
export function crc16CcittFalse(data: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

const encoder = new TextEncoder();

export function crc16OfString(text: string): number {
  return crc16CcittFalse(encoder.encode(text));
}

export function formatCrc(crc: number): string {
  return '0x' + crc.toString(16).toUpperCase().padStart(4, '0');
}
