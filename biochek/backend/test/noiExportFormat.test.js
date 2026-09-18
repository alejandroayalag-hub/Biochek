import test from 'node:test';
import assert from 'node:assert/strict';
import { formatChecadasForNoi } from '../src/utils/noiExportFormat.js';

test('formats header and one row, converting UTC timestamp to Mexico City local time', () => {
  const csv = formatChecadasForNoi([
    { codigo_noi: 'E001', timestamp: '2026-09-18T14:02:00.000Z', tipo: 'entrada' },
  ]);
  const lines = csv.split('\n');
  assert.equal(lines[0], '"codigo_noi","fecha","hora","tipo"');
  assert.equal(lines[1], '"E001","2026-09-18","08:02","entrada"');
});

test('preserves the order rows are given in (caller is responsible for sorting)', () => {
  const csv = formatChecadasForNoi([
    { codigo_noi: 'E002', timestamp: '2026-09-18T15:00:00.000Z', tipo: 'salida' },
    { codigo_noi: 'E001', timestamp: '2026-09-18T14:00:00.000Z', tipo: 'entrada' },
  ]);
  const lines = csv.split('\n').slice(1);
  assert.match(lines[0], /^"E002"/);
  assert.match(lines[1], /^"E001"/);
});

test('escapes commas and quotes in every field, unconditionally', () => {
  const csv = formatChecadasForNoi([
    { codigo_noi: 'E,00"1', timestamp: '2026-09-18T14:00:00.000Z', tipo: 'entrada' },
  ]);
  const lines = csv.split('\n');
  assert.equal(lines[1], '"E,00""1","2026-09-18","08:00","entrada"');
});

test('empty input produces only the header row', () => {
  const csv = formatChecadasForNoi([]);
  assert.equal(csv, '"codigo_noi","fecha","hora","tipo"');
});
