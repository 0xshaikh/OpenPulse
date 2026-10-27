/* ------------------------------------------------------------------ *
 * OpenPulse — CSV helpers
 *
 * RFC 4180-ish: fields containing a comma, double quote, or line break
 * are wrapped in double quotes and internal quotes are doubled. Output
 * uses LF terminators (universally accepted; Excel opens it fine).
 *
 * Pure functions, browser + Node.
 * ------------------------------------------------------------------ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PulseCSV = factory();
  }
})(typeof self !== 'undefined' ? self : global, function () {
  'use strict';

  var NEEDS_QUOTE = /["\n\r,]/;

  /** Escape a single cell value for CSV output. */
  function escapeField(value) {
    if (value === null || value === undefined) { return ''; }
    var s = typeof value === 'string' ? value : String(value);
    if (s.indexOf('"') === -1 && s.indexOf('\n') === -1
        && s.indexOf('\r') === -1 && s.indexOf(',') === -1) {
      return s;
    }
    return '"' + s.replace(/"/g, '""') + '"';
  }

  /**
   * Serialise rows to CSV.
   *
   *   toCSV([{a: 1, b: 'x'}], ['a', 'b'])   -> "a,b\n1,x\n"
   *   toCSV([[1, 2], [3, 4]])                -> "1,2\n3,4\n"
   *
   * `rows` may be an array of arrays, or an array of objects keyed by
   * `headers`. Returns '' for an empty/absent input.
   */
  function toCSV(rows, headers) {
    if (!rows || !rows.length) { return ''; }
    var lines = [];
    if (headers && headers.length) {
      lines.push(headers.map(escapeField).join(','));
    }
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var cells;
      if (Array.isArray(row)) {
        cells = row;
      } else if (row && typeof row === 'object') {
        if (!headers || !headers.length) {
          throw new TypeError('toCSV: object rows require a headers list');
        }
        cells = headers.map(function (h) { return row[h]; });
      } else {
        throw new TypeError('toCSV: row must be an array or object, got '
                            + typeof row);
      }
      lines.push(cells.map(escapeField).join(','));
    }
    return lines.join('\n') + '\n';
  }

  /**
   * Parse CSV text into an array of row arrays. Handles quoted fields,
   * escaped double quotes, embedded newlines and CRLF. A trailing
   * terminator does not produce a phantom empty row.
   */
  function parseCSV(text) {
    if (typeof text !== 'string' || text === '') { return []; }
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    var i = 0;
    var n = text.length;

    function endField() {
      row.push(field);
      field = '';
    }
    function endRow() {
      endField();
      rows.push(row);
      row = [];
    }

    while (i < n) {
      var c = text.charAt(i);

      if (inQuotes) {
        if (c === '"') {
          if (i + 1 < n && text.charAt(i + 1) === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        field += c;
        i++;
        continue;
      }

      if (c === '"') {
        // Only honoured at the very start of a field; elsewhere a quote
        // is literal text.
        if (field === '') {
          inQuotes = true;
          i++;
          continue;
        }
        field += c;
        i++;
        continue;
      }
      if (c === ',') { endField(); i++; continue; }
      if (c === '\r') {
        endRow();
        i++;
        if (i < n && text.charAt(i) === '\n') { i++; }
        continue;
      }
      if (c === '\n') { endRow(); i++; continue; }
      field += c;
      i++;
    }

    // Flush the final field/row unless the input ended on a terminator.
    if (field !== '' || row.length > 0) { endRow(); }

    return rows;
  }

  /**
   * Convenience: parse CSV text into objects keyed by the first row.
   * Returns [] when there is no header row.
   */
  function parseCSVRows(text) {
    var rows = parseCSV(text);
    if (!rows.length) { return []; }
    var headers = rows[0];
    var out = [];
    for (var i = 1; i < rows.length; i++) {
      var obj = {};
      for (var j = 0; j < headers.length; j++) {
        obj[headers[j]] = j < rows[i].length ? rows[i][j] : '';
      }
      out.push(obj);
    }
    return out;
  }

  return {
    escapeField: escapeField,
    toCSV: toCSV,
    parseCSV: parseCSV,
    parseCSVRows: parseCSVRows
  };
});
