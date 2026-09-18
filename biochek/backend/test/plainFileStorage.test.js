import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import 'dotenv/config';
import { savePlainFile, readPlainFile } from '../src/utils/plainFileStorage.js';

const TEST_UPLOADS_DIR = join(process.cwd(), 'test-uploads-plain-tmp');

test.before(() => {
  process.env.UPLOADS_DIR = TEST_UPLOADS_DIR;
});

test('savePlainFile writes a file and returns a relative path under the given subdir', () => {
  const relativePath = savePlainFile('codigo_noi,fecha\nE001,2026-09-18', 'exportaciones_noi');
  assert.ok(relativePath.startsWith('exportaciones_noi/'));
  assert.ok(existsSync(join(TEST_UPLOADS_DIR, relativePath)));
});

test('readPlainFile reads back the exact content written', () => {
  const content = 'codigo_noi,fecha\nE002,2026-09-19';
  const relativePath = savePlainFile(content, 'exportaciones_noi');
  assert.equal(readPlainFile(relativePath), content);
});

test('savePlainFile uses the given extension', () => {
  const relativePath = savePlainFile('hello', 'exportaciones_noi', 'txt');
  assert.ok(relativePath.endsWith('.txt'));
});

test.after(() => {
  rmSync(TEST_UPLOADS_DIR, { recursive: true, force: true });
});
