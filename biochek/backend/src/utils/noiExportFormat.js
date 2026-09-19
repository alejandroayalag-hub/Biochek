// Column layout is a placeholder — the real ASPEL NOI import format is
// still pending confirmation with the client/accountant (spec §2.1 of
// docs/superpowers/specs/2026-09-18-biochek-noi-export-design.md). This
// function is the single place to edit once that's confirmed; nothing
// else in the codebase depends on this output shape.

import { MEXICO_CITY_TZ as NOI_TIMEZONE } from './mexicoCityDayBounds.js';

function csvField(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function formatFecha(timestamp) {
  // en-CA locale formats as YYYY-MM-DD
  return new Date(timestamp).toLocaleDateString('en-CA', { timeZone: NOI_TIMEZONE });
}

function formatHora(timestamp) {
  // en-GB with only hour/minute gives 24h "HH:MM", no seconds
  return new Date(timestamp).toLocaleTimeString('en-GB', {
    timeZone: NOI_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * @param {Array<{codigo_noi: string, timestamp: string|Date, tipo: string}>} rows
 * @returns {string} CSV content, header included
 */
export function formatChecadasForNoi(rows) {
  const header = ['codigo_noi', 'fecha', 'hora', 'tipo'];
  const lines = rows.map((r) => [r.codigo_noi, formatFecha(r.timestamp), formatHora(r.timestamp), r.tipo]);
  return [header, ...lines].map((line) => line.map(csvField).join(',')).join('\n');
}
