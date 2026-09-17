import test from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';
import { encryptBuffer, decryptBuffer, encryptEmbedding, decryptEmbedding } from '../src/utils/cipher.js';

test('encryptBuffer/decryptBuffer round-trip', () => {
  const plain = Buffer.from('dato biométrico sensible', 'utf8');
  const encrypted = encryptBuffer(plain);
  assert.notDeepEqual(encrypted, plain);
  assert.deepEqual(decryptBuffer(encrypted), plain);
});

test('encryptEmbedding/decryptEmbedding round-trip preserves float precision', () => {
  const vector = [0.123456, -0.987654, 0.5];
  const encrypted = encryptEmbedding(vector);
  assert.deepEqual(decryptEmbedding(encrypted), vector);
});

test('decryptBuffer fails on tampered ciphertext', () => {
  const encrypted = encryptBuffer(Buffer.from('test'));
  encrypted[encrypted.length - 1] ^= 0xff; // flip last byte
  assert.throws(() => decryptBuffer(encrypted));
});
