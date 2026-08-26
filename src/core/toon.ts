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
    throw new Error('Malformed TOON table: unterminated quoted field.');
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
