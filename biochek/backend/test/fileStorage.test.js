import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import 'dotenv/config';
import { saveEncryptedFile, readEncryptedFile } from '../src/utils/fileStorage.js';

const TEST_UPLOADS_DIR = join(process.cwd(), 'test-uploads-tmp');

test.before(() => {
  process.env.UPLOADS_DIR = TEST_UPLOADS_DIR;
});

test('saveEncryptedFile writes an encrypted file and returns a relative path', () => {
  const original = Buffer.from('foto-de-prueba-bytes');
  const relativePath = saveEncryptedFile(original.toString('base64'), 'enrolamientos');

  assert.ok(relativePath.startsWith('enrolamientos/'));
  assert.ok(existsSync(join(TEST_UPLOADS_DIR, relativePath)));
});

test('readEncryptedFile decrypts back to the original bytes', () => {
  const original = Buffer.from('otra-foto-de-prueba');
  const relativePath = saveEncryptedFile(original.toString('base64'), 'checadas');

  assert.deepEqual(readEncryptedFile(relativePath), original);
});

test.after(() => {
  rmSync(TEST_UPLOADS_DIR, { recursive: true, force: true });
});
