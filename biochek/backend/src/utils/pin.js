import crypto from 'node:crypto';

export function generatePin() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}
