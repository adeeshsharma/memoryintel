function quoteField(value: string): string {
  // Leading whitespace must be quoted as well: rows are written with a two-space indent, and
  // the decoder strips a row's leading whitespace to find its first field. An unquoted
  // ' foo' in the first column would therefore come back as 'foo'.
  if (value.includes(',') || value.includes('"') || value.includes('\n') || /^[ \t]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// Parses the whole body of a TOON table (everything after the header line) into rows of fields.
//
// This MUST scan character-by-character across the entire text rather than splitting on '\n'
// first: `quoteField` deliberately quotes any value containing a newline, so a row's field can
// legitimately span several physical lines. Splitting on '\n' up front would tear such a field
// apart and silently drop everything after its first physical line.
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let fields: string[] = [];
  let current = '';
  let inQuotes = false;
  // True once any field content has been seen on the current row. Used both to strip a row's
  // leading indentation (the encoder writes rows with a two-space prefix) and to ignore blank
  // separator lines between rows without discarding blank lines *inside* a quoted field.
  let rowStarted = false;

  const endRow = (): void => {
    fields.push(current);
    rows.push(fields);
    fields = [];
    current = '';
    rowStarted = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
      continue;
    }

    if (ch === '\r' && text[i + 1] === '\n') continue; // normalize CRLF outside quotes
    if (ch === '\n') {
      if (rowStarted) endRow();
      continue;
    }
    if (!rowStarted && (ch === ' ' || ch === '\t')) continue; // row indentation

    rowStarted = true;
    if (ch === '"') { inQuotes = true; }
    else if (ch === ',') { fields.push(current); current = ''; }
    else { current += ch; }
  }

  if (inQuotes) {
    // rows.length is exactly how many COMPLETE rows were parsed before the failure - the
    // failing row is the next one, at that same 0-indexed position (matching how a
    // field-count-mismatch error below reports rowIndex).
    throw new Error(`Malformed TOON table: unterminated quoted field in row ${rows.length}.`);
  }
  if (rowStarted) endRow();

  return rows;
}

export function encodeToonTable(rows: Record<string, string>[]): string {
  if (rows.length === 0) return `items[0]{}:\n`;

  const fields = Object.keys(rows[0]);
  const header = `items[${rows.length}]{${fields.join(',')}}:`;
  const lines = rows.map((row) => '  ' + fields.map((f) => quoteField(row[f] ?? '')).join(','));
  return [header, ...lines].join('\n') + '\n';
}

// Splits off the first non-blank line (the header) and returns it plus the untouched remainder.
function splitHeaderLine(text: string): { headerLine: string; body: string } {
  let cursor = 0;
  while (cursor < text.length) {
    const newlineIndex = text.indexOf('\n', cursor);
    const rawLine = newlineIndex === -1 ? text.slice(cursor) : text.slice(cursor, newlineIndex);
    const line = rawLine.replace(/\r$/, '');
    if (line.trim().length > 0) {
      return { headerLine: line.trim(), body: newlineIndex === -1 ? '' : text.slice(newlineIndex + 1) };
    }
    if (newlineIndex === -1) break;
    cursor = newlineIndex + 1;
  }
  return { headerLine: '', body: '' };
}

export function decodeToonTable(text: string): Record<string, string>[] {
  const { headerLine, body } = splitHeaderLine(text);
  const headerMatch = /^items\[(\d+)\]\{(.*)\}:$/.exec(headerLine);
  if (!headerMatch) throw new Error(`Malformed TOON table header: ${headerLine}`);

  const count = Number(headerMatch[1]);
  const fields = headerMatch[2].length > 0 ? headerMatch[2].split(',') : [];
  const rawRows = parseCsvRows(body);

  if (rawRows.length !== count) {
    throw new Error(`Malformed TOON table: header declares ${count} row(s) but ${rawRows.length} row(s) were found.`);
  }

  return rawRows.map((values, rowIndex) => {
    if (values.length !== fields.length) {
      throw new Error(
        `Malformed TOON table: row ${rowIndex} has ${values.length} field(s) but the header declares ${fields.length}.`
      );
    }
    const row: Record<string, string> = {};
    fields.forEach((f, idx) => { row[f] = values[idx]; });
    return row;
  });
}

const REQUIRED_PLAN_ROW_FIELDS = ['file', 'action', 'section', 'content', 'reason'] as const;
const OPTIONAL_PLAN_ROW_FIELDS = ['kind'] as const;

function decodeJsonPlan(text: string): Record<string, string>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Malformed JSON plan: ${message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Malformed JSON plan: expected an array of rows.');
  }

  return parsed.map((row, rowIndex) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`Malformed JSON plan: row ${rowIndex} must be an object.`);
    }
    const record = row as Record<string, unknown>;
    for (const field of REQUIRED_PLAN_ROW_FIELDS) {
      if (!(field in record)) {
        throw new Error(`Malformed JSON plan: row ${rowIndex} is missing required field "${field}".`);
      }
    }
    const result: Record<string, string> = {};
    for (const field of [...REQUIRED_PLAN_ROW_FIELDS, ...OPTIONAL_PLAN_ROW_FIELDS]) {
      if (!(field in record)) continue;
      const value = record[field];
      if (typeof value !== 'string') {
        throw new Error(`Malformed JSON plan: row ${rowIndex}'s "${field}" must be a string.`);
      }
      result[field] = value;
    }
    return result;
  });
}

/**
 * Accepts either format update() itself needs to parse: TOON text (the
 * default, more compact for a human/agent to scan), or a JSON array of the
 * same row shape - auto-detected by a leading '[' after trimming, since a
 * real TOON header always starts with the literal 'items['; this can never
 * misfire on a genuinely malformed TOON table. JSON exists specifically so
 * an agent that would rather JSON.stringify a plan than hand-author TOON's
 * own quoting rules (double an internal '"' as '""', not backslash-escape
 * it - a real, repeated mistake in practice, not hypothetical) never has to
 * risk getting that escaping wrong at all. decodeToonTable itself is
 * unchanged and still exported directly for anyone who wants TOON
 * specifically.
 */
export function decodePlanRows(text: string): Record<string, string>[] {
  const trimmed = text.trimStart();
  // A real TOON header never starts with '[' or '{' either (always the literal
  // 'items[') - catching '{' too means a plan mistakenly wrapped as a single
  // object instead of an array gets the clear "expected an array" error below,
  // not an unrelated, confusing TOON header error.
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return decodeJsonPlan(trimmed);
  return decodeToonTable(text);
}
