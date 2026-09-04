/**
 * Minimal RFC 4180 CSV reader. Salesforce and Excel exports quote any field with a
 * comma in it and escape quotes by doubling them, so a naive split(',') mangles
 * exactly the rows most likely to matter ("Acme Health Systems, Inc.").
 */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;

  const src = text.replace(/^﻿/, ''); // Excel writes a BOM
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

/** Quote a value only when it needs it, so the file stays readable by hand. */
export function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvLine = cells => cells.map(csvCell).join(',');
