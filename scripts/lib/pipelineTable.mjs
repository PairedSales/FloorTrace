// Plain-text tables for the pipeline commands: what the orchestrator reads over
// hundreds of plans, so one line per plan and no wrapping.

/**
 * `rows` as aligned lines under `columns` ([{title, get(row), right?}]); a cell
 * is whatever `get` returns, text. Trailing spaces are trimmed.
 */
export const table = (rows, columns) => {
  const cells = rows.map((row) => columns.map((c) => String(c.get(row) ?? '')));
  const widths = columns.map((c, i) => Math.max(c.title.length, ...cells.map((row) => row[i].length)));
  const line = (row) => row.map((cell, i) => (columns[i].right ? cell.padStart(widths[i]) : cell.padEnd(widths[i]))).join('  ').trimEnd();
  return [line(columns.map((c) => c.title)), ...cells.map(line)];
};

export const pct = (part, whole, digits = 1) => (whole > 0 ? `${((100 * part) / whole).toFixed(digits)}%` : 'n/a');
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
