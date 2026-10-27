/* ------------------------------------------------------------------ *
 * OpenPulse — date primitives
 *
 * Pure functions, no DOM, no globals. Works identically in the browser
 * and under Node (so verify.js can exercise it directly).
 *
 * Week convention: weeks start on Monday. All arithmetic is done on
 * wall-clock local time, so a post you schedule for "Jan 5 09:00" stays
 * on Jan 5 no matter what timezone the machine runs in.
 * ------------------------------------------------------------------ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PulseDates = factory();
  }
})(typeof self !== 'undefined' ? self : global, function () {
  'use strict';

  var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];
  // Monday-first, to match the calendar grid.
  var DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  function pad(n, width) {
    width = width || 2;
    var s = String(n);
    while (s.length < width) { s = '0' + s; }
    return s;
  }

  /** Number of days in a given month. `month` is 0-based. */
  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  /** Strip the time component, keep the calendar day (local). */
  function stripTime(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  /** Monday-based start of week. */
  function startOfWeek(date) {
    var d = stripTime(date);
    var jsDow = d.getDay();          // 0 = Sunday … 6 = Saturday
    var daysBack = jsDow === 0 ? 6 : jsDow - 1;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysBack);
  }

  /** First instant of a month. `month` is 0-based. */
  function startOfMonth(year, month) {
    return new Date(year, month, 1);
  }

  /**
   * 6 weeks × 7 days = 42 cells, Monday-first, always anchored to the
   * Monday on or before the 1st of the month. Cells outside the month
   * carry the neighbouring month's date so the grid is visually complete.
   */
  function buildMonthGrid(year, month) {
    var anchor = startOfWeek(startOfMonth(year, month));
    var weeks = [];
    for (var w = 0; w < 6; w++) {
      var row = [];
      for (var i = 0; i < 7; i++) {
        row.push(new Date(anchor.getFullYear(), anchor.getMonth(),
                          anchor.getDate() + w * 7 + i));
      }
      weeks.push(row);
    }
    return weeks;
  }

  function isSameDay(a, b) {
    if (!(a instanceof Date) || !(b instanceof Date)) { return false; }
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
  }

  function isSameMonth(date, year, month) {
    return date instanceof Date
        && date.getFullYear() === year
        && date.getMonth() === month;
  }

  function addDays(date, n) {
    var d = new Date(date.getTime());
    d.setDate(d.getDate() + n);
    return d;
  }

  function addWeeks(date, n) {
    return addDays(date, n * 7);
  }

  /** Add months to a (year, month) pair, carrying the overflow into years. */
  function addMonths(year, month, n) {
    var total = (year * 12) + month + n;
    return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
  }

  // ---- formatting ---------------------------------------------------

  function formatShort(date) {
    return MONTHS_SHORT[date.getMonth()] + ' ' + date.getDate();
  }

  function formatLong(date) {
    var idx = (date.getDay() + 6) % 7;   // Monday-first index
    return DOW[idx] + ', ' + MONTHS_SHORT[date.getMonth()] + ' ' + date.getDate()
           + ', ' + date.getFullYear();
  }

  function formatTime(date) {
    return pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  /** "Mon, Jan 5 · 14:30" — used in the queue list. */
  function formatDateTime(date) {
    var idx = (date.getDay() + 6) % 7;
    return DOW[idx] + ', ' + MONTHS_SHORT[date.getMonth()] + ' ' + date.getDate()
           + ' · ' + formatTime(date);
  }

  function monthLabel(year, month) {
    return MONTHS_LONG[month] + ' ' + year;
  }

  function weekdayLabel(date) {
    return DOW[(date.getDay() + 6) % 7];
  }

  // ---- serialisation ------------------------------------------------
  // Local, timezone-free ISO ("2026-01-05T09:00:00") so that
  // fromISO(toISO(d)) round-trips the wall clock exactly. The
  // datetime-local form ("2026-01-05T09:00", no seconds) is accepted on
  // the way in because that is what <input type="datetime-local"> emits.

  function toISO(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
      throw new TypeError('toISO: not a Date');
    }
    return toISODate(date)
      + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
  }

  /** Date-only ISO, local wall clock: "2026-01-05". */
  function toISODate(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
      throw new TypeError('toISODate: not a Date');
    }
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function fromISO(value) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new TypeError('fromISO: expected a non-empty string');
    }
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value.trim());
    if (m) {
      var y = +m[1], mo = +m[2] - 1, d = +m[3];
      var hh = m[4] === undefined ? 0 : +m[4];
      var mm = m[5] === undefined ? 0 : +m[5];
      var ss = m[6] === undefined ? 0 : +m[6];
      if (mo < 0 || mo > 11 || d < 1 || d > daysInMonth(y, mo)
          || hh > 23 || mm > 59 || ss > 60) {
        throw new TypeError('fromISO: out of range: ' + value);
      }
      var out = new Date(y, mo, d, hh, mm, ss);
      if (out.getFullYear() !== y || out.getMonth() !== mo || out.getDate() !== d
          || out.getHours() !== hh || out.getMinutes() !== mm) {
        throw new TypeError('fromISO: out of range: ' + value);
      }
      return out;
    }
    var dt = new Date(value);
    if (isNaN(dt.getTime())) {
      throw new TypeError('fromISO: unparseable date: ' + value);
    }
    return dt;
  }

  /** Monday-based week key, stable across renders: "2026-01-05". */
  function weekKey(date) {
    return toISODate(stripTime(startOfWeek(date)));
  }

  return {
    MONTHS_SHORT: MONTHS_SHORT,
    MONTHS_LONG: MONTHS_LONG,
    DOW: DOW,
    pad: pad,
    daysInMonth: daysInMonth,
    stripTime: stripTime,
    startOfWeek: startOfWeek,
    startOfMonth: startOfMonth,
    buildMonthGrid: buildMonthGrid,
    isSameDay: isSameDay,
    isSameMonth: isSameMonth,
    addDays: addDays,
    addWeeks: addWeeks,
    addMonths: addMonths,
    formatShort: formatShort,
    formatLong: formatLong,
    formatTime: formatTime,
    formatDateTime: formatDateTime,
    monthLabel: monthLabel,
    weekdayLabel: weekdayLabel,
    toISO: toISO,
    toISODate: toISODate,
    fromISO: fromISO,
    weekKey: weekKey
  };
});
