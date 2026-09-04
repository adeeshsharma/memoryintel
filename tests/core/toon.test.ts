import { describe, it, expect } from 'vitest';
import { encodeToonTable, decodeToonTable, decodePlanRows } from '../../src/core/toon.js';

describe('encodeToonTable / decodeToonTable', () => {
  it('round-trips a simple table', () => {
    const rows = [
      { file: 'architecture.md', action: 'append', section: 'Authentication', content: 'JWT refresh added', reason: 'new auth flow' },
      { file: 'progress.md', action: 'replace', section: 'Status', content: '70% complete', reason: 'progress update' }
    ];
    const encoded = encodeToonTable(rows);
    expect(decodeToonTable(encoded)).toEqual(rows);
  });

  it('handles fields containing commas by quoting them', () => {
    const rows = [{ file: 'a.md', action: 'append', section: 'X', content: 'has, a comma', reason: 'r' }];
    const decoded = decodeToonTable(encodeToonTable(rows));
    expect(decoded).toEqual(rows);
  });

  it('decodes an empty table to an empty array', () => {
    expect(decodeToonTable(encodeToonTable([]))).toEqual([]);
  });

  it('round-trips a field containing embedded newlines', () => {
    const rows = [
      { file: 'a.md', action: 'append', section: 'X', content: 'line one\nline two\nline three', reason: 'multi-line' }
    ];
    expect(decodeToonTable(encodeToonTable(rows))).toEqual(rows);
  });

  it('round-trips multi-line content alongside single-line rows, keeping row alignment', () => {
    const rows = [
      { file: 'a.md', action: 'append', section: 'X', content: 'first\n\nsecond paragraph', reason: 'r1' },
      { file: 'b.md', action: 'replace', section: 'Y', content: 'plain', reason: 'r2' },
      { file: 'c.md', action: 'append', section: 'Z', content: 'has "quotes", commas\nand a newline', reason: 'r3' }
    ];
    expect(decodeToonTable(encodeToonTable(rows))).toEqual(rows);
  });

  it('round-trips values whose whitespace would collide with row indentation', () => {
    const rows = [
      { file: ' leading-space.md', action: 'append', section: ' X ', content: '  indented code\ntrailing space ', reason: 'r' }
    ];
    expect(decodeToonTable(encodeToonTable(rows))).toEqual(rows);
  });

  it('throws when a row has more fields than the header declares', () => {
    const malformed = 'items[1]{file,action,section,content,reason}:\n  a.md,append,X,too,many,fields\n';
    expect(() => decodeToonTable(malformed)).toThrow(/row 0 has 6 field\(s\) but the header declares 5/);
  });

  it('throws when a row has fewer fields than the header declares', () => {
    const malformed = 'items[1]{file,action,section,content,reason}:\n  a.md,append,X\n';
    expect(() => decodeToonTable(malformed)).toThrow(/row 0 has 3 field\(s\) but the header declares 5/);
  });

  it('throws when the row count does not match the declared count', () => {
    const malformed = 'items[2]{file,content}:\n  a.md,x\n';
    expect(() => decodeToonTable(malformed)).toThrow(/declares 2 row\(s\) but 1 row\(s\)/);
  });

  it('throws on an unterminated quoted field instead of silently truncating', () => {
    const malformed = 'items[1]{file,content}:\n  a.md,"never closed\n';
    expect(() => decodeToonTable(malformed)).toThrow(/unterminated quoted field/);
  });

  it('names which row an unterminated quoted field was found in', () => {
    const malformed = 'items[2]{file,content}:\n  a.md,fine\n  b.md,"never closed\n';
    expect(() => decodeToonTable(malformed)).toThrow(/unterminated quoted field.*row 1/);
  });
});

describe('decodePlanRows', () => {
  it('decodes TOON input exactly like decodeToonTable', () => {
    const rows = [{ file: 'a.md', action: 'append', section: 'X', content: 'c', reason: 'r' }];
    expect(decodePlanRows(encodeToonTable(rows))).toEqual(rows);
  });

  it('decodes a JSON array of the same row shape, auto-detected by a leading [', () => {
    const rows = [
      { file: 'a.md', action: 'append', section: 'X', content: 'has "quotes", commas\nand a newline', reason: 'r1' },
      { file: 'b.md', action: 'replace', section: 'Y', content: 'plain', reason: 'r2' }
    ];
    expect(decodePlanRows(JSON.stringify(rows))).toEqual(rows);
  });

  it('tolerates leading whitespace before the JSON array when detecting the format', () => {
    const rows = [{ file: 'a.md', action: 'append', section: 'X', content: 'c', reason: 'r' }];
    expect(decodePlanRows(`   \n${JSON.stringify(rows)}`)).toEqual(rows);
  });

  it('preserves the optional kind field on a JSON row', () => {
    const rows = [{ file: 'a.md', action: 'replace', section: 'X', content: 'c', reason: 'r', kind: 'compress' }];
    expect(decodePlanRows(JSON.stringify(rows))).toEqual(rows);
  });

  it('throws a clear error when the JSON input is not an array', () => {
    expect(() => decodePlanRows('{"file":"a.md"}')).toThrow(/expected an array of rows/);
  });

  it('throws a clear, row-located error when a JSON row is missing a required field', () => {
    const malformed = JSON.stringify([{ file: 'a.md', action: 'append', section: 'X', content: 'c' }]);
    expect(() => decodePlanRows(malformed)).toThrow(/row 0.*missing required field "reason"/);
  });

  it('throws a clear, row-located error when a JSON row has a non-string field', () => {
    const malformed = JSON.stringify([{ file: 'a.md', action: 'append', section: 'X', content: 'c', reason: 5 }]);
    expect(() => decodePlanRows(malformed)).toThrow(/row 0.*"reason" must be a string/);
  });
});
