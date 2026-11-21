// Single-pass zero-alloc CSV reader, exact csv-reader 1.0.0 semantics.
//
// A faster drop-in for make.fun's own csv-reader 1.0.0 (the reference program of
// csv-reader-speed-01). run(input) returns exactly csv-reader's answer for every
// input {text, header}: {columns, rows, errors}. Each case is answered alone;
// nothing is cached from one case to the next.
//
// How it is fast while staying exact:
//   - Fields are sliced out of the input, never built character by character.
//   - Unquoted fields are found with native indexOf scans for the next comma /
//     LF / CR, so the common field costs one slice, not a per-character loop.
//   - Whole clean records (no quote anywhere before the line break, no stray
//     CR) are split natively in one String.split(',').
//   - Quoted fields are found with indexOf('"') scans; doubled quotes and
//     line breaks inside quotes take a slow path that only runs when present.
//   - Error objects are allocated only when an error actually occurs.
// No WebAssembly, no native addon, no prebuilt binary, no dependencies.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The field just read, shared by the readers below (no per-field object).
  let fieldValue = '';
  let fieldEnded = END;
  let fieldAdded = 0;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters from pos, starting from `init` ('' for a plain
  // field, the quoted value for quote junk, '"' for an unterminated quote):
  // a CR not followed by LF is dropped (stray_cr). Sets fieldValue, fieldEnded
  // (COMMA / LINE_BREAK / END) and fieldAdded (characters kept after `init`).
  const DELIM = /[,\n\r]/g;
  const RECDELIM = /["\n\r]/g;
  function readUnquoted(init) {
    let parts = null; // kept segments, only when a stray CR splits the field
    let segStart = pos;
    let added = 0;
    let p = pos;
    for (;;) {
      DELIM.lastIndex = p;
      const m = DELIM.exec(text);
      let idx = -1;
      let kind = -1; // 0 comma, 1 LF, 2 CR
      if (m !== null) {
        idx = m.index;
        kind = m[0] === ',' ? 0 : m[0] === '\n' ? 1 : 2;
      }
      if (idx === -1) {
        // No delimiter left: the rest of the text is the field.
        if (parts === null) {
          fieldValue = init === '' ? text.slice(segStart, n) : init + text.slice(segStart, n);
        } else {
          parts.push(text.slice(segStart, n));
          fieldValue = init + parts.join('');
        }
        fieldAdded = added + (n - segStart);
        pos = n;
        fieldEnded = END;
        return;
      }
      if (kind === 2 && !(idx + 1 < n && text.charCodeAt(idx + 1) === 10)) {
        // A lone CR: drop it (stray_cr) and keep reading the same field.
        error('stray_cr');
        if (parts === null) parts = [];
        parts.push(text.slice(segStart, idx));
        added += idx - segStart;
        p = idx + 1;
        segStart = idx + 1;
        continue;
      }
      // Comma, LF, or CRLF: the field ends here.
      if (parts === null) {
        fieldValue = init === '' ? text.slice(segStart, idx) : init + text.slice(segStart, idx);
      } else {
        parts.push(text.slice(segStart, idx));
        fieldValue = init + parts.join('');
      }
      fieldAdded = added + (idx - segStart);
      if (kind === 0) {
        pos = idx + 1;
        fieldEnded = COMMA;
      } else {
        pos = kind === 1 ? idx + 1 : idx + 2;
        line += 1;
        fieldEnded = LINE_BREAK;
      }
      return;
    }
  }

  const QSPECIAL = /["\n\r]/g;
  // Reads a quoted field whose opening quote is at pos. Sets fieldValue and
  // fieldEnded; on quote_junk it reports the error after the junk is read.
  // One native scan finds the closing quote, doubled quotes and line breaks
  // together; CRLF and lone CR inside quotes each read as one LF.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let parts = null; // content segments split by doubled quotes / line breaks
    let segStart = pos + 1;
    let lineDelta = 0;
    QSPECIAL.lastIndex = pos + 1;
    for (;;) {
      const m = QSPECIAL.exec(text);
      if (m === null) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted (unterminated_quote).
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        readUnquoted('"');
        return;
      }
      const i = m.index;
      const ch = m[0];
      if (ch === '"') {
        if (i + 1 < n && text.charCodeAt(i + 1) === 34) {
          // A doubled quote: one quote in the value, and the field goes on.
          if (parts === null) parts = [];
          parts.push(text.slice(segStart, i));
          parts.push('"');
          QSPECIAL.lastIndex = i + 2;
          segStart = i + 2;
          continue;
        }
        // The closing quote.
        let value;
        if (parts === null) {
          value = text.slice(segStart, i);
        } else {
          parts.push(text.slice(segStart, i));
          value = parts.join('');
        }
        line += lineDelta;
        pos = i + 1;
        if (pos >= n) {
          fieldValue = value;
          fieldEnded = END;
          return;
        }
        const c = text.charCodeAt(pos);
        if (c === 44) {
          fieldValue = value;
          pos += 1;
          fieldEnded = COMMA;
          return;
        }
        if (c === 10) {
          fieldValue = value;
          pos += 1;
          line += 1;
          fieldEnded = LINE_BREAK;
          return;
        }
        if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
          fieldValue = value;
          pos += 2;
          line += 1;
          fieldEnded = LINE_BREAK;
          return;
        }
        // What follows the closing quote is appended as it stands, up to the
        // next comma or line break (quote_junk, when the field ends).
        readUnquoted(value);
        if (fieldAdded > 0) error('quote_junk');
        return;
      }
      // A line break inside the quotes: one LF in the value, one line counted.
      if (parts === null) parts = [];
      parts.push(text.slice(segStart, i));
      parts.push('\n');
      lineDelta += 1;
      if (ch === '\r' && i + 1 < n && text.charCodeAt(i + 1) === 10) {
        QSPECIAL.lastIndex = i + 2;
        segStart = i + 2;
      } else {
        QSPECIAL.lastIndex = i + 1;
        segStart = i + 1;
      }
    }
  }

  // Reads one record the slow way (it holds a quote or a stray CR). Returns
  // its fields, or null when it held only stray CRs and is no record.
  function slowRecord() {
    const fields = [];
    let quoted = false;
    do {
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        readQuoted();
      } else {
        quoted = false;
        readUnquoted('');
      }
      fields.push(fieldValue);
    } while (fieldEnded === COMMA);
    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) return null;
    return fields;
  }

  // Applies a record to columns / rows, padding or cutting it to the first
  // record's width.
  function finishRecord(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: one native scan finds the record's first special character.
    // A line break first means no quote and no stray CR before it, so the whole
    // clean record is one native split; a CRLF ending is one too. Anything
    // with a quote or a stray CR goes through the slow reader.
    RECDELIM.lastIndex = pos;
    const m = RECDELIM.exec(text);
    if (m !== null) {
      const i = m.index;
      const ch = m[0];
      if (ch === '\n') {
        finishRecord(text.slice(pos, i).split(','));
        pos = i + 1;
        line += 1;
        continue;
      }
      if (ch === '\r' && i + 1 < n && text.charCodeAt(i + 1) === 10) {
        // The first special is the CRLF that ends the record.
        finishRecord(text.slice(pos, i).split(','));
        pos = i + 2;
        line += 1;
        continue;
      }
      // Otherwise (a quote, or a stray CR): the slow reader handles it.
    } else {
      // No special left: the rest of the text is one clean record.
      finishRecord(text.slice(pos, n).split(','));
      pos = n;
      continue;
    }
    const fields = slowRecord();
    if (fields !== null) finishRecord(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
