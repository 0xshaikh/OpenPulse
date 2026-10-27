#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * OpenPulse verification suite
 *
 * Plain Node, zero dependencies. No npm install, no jest, no jsdom.
 *
 *     node verify.js
 *
 * The date / CSV / serializer / schedule / store modules are pure and
 * UMD-wrapped, so this file loads them straight from ./js and asserts
 * behaviour directly. The DOM layer (app.js) is exercised manually.
 * ------------------------------------------------------------------ */
'use strict';

const D = require('./js/dates.js');
const C = require('./js/csv.js');
const S = require('./js/serializers.js');
const SC = require('./js/schedule.js');
const ST = require('./js/store.js');

let pass = 0;
let fail = 0;
const failures = [];

function ok(name) { pass++; }
function bad(name, extra) { fail++; failures.push(name + (extra ? ' — ' + extra : '')); }

/** Assert `cond`, recording a human-readable name. */
function check(name, cond, extra) {
  if (cond) { ok(name); } else { bad(name, extra); }
}

/** Assert an equality with a JSON-ish diff in the message. */
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'expected ' + e + ', got ' + a);
}

/** Assert two Dates are the same wall-clock instant. */
function dateEq(name, actual, expected) {
  const a = actual instanceof Date ? actual.getTime() : actual;
  const e = expected instanceof Date ? expected.getTime() : expected;
  check(name, a === e, 'expected ' + e + ', got ' + a);
}

/** Assert `fn` throws a TypeError. */
function throws(name, fn) {
  try {
    fn();
    bad(name, 'expected a TypeError, none thrown');
  } catch (e) {
    if (e instanceof TypeError) { ok(name); } else { bad(name, 'wrong error: ' + e.message); }
  }
}

const DT = (y, m, d, h, mi, s) => new Date(y, m - 1, d, h || 0, mi || 0, s || 0);
const iso = (y, m, d, h, mi, s) =>
  D.pad(y, 4) + '-' + D.pad(m, 2) + '-' + D.pad(d, 2) + 'T'
  + D.pad(h || 0, 2) + ':' + D.pad(mi || 0, 2) + ':' + D.pad(s || 0, 2);

/* ================================================================== */
console.log('\nOpenPulse verification\n');
console.log('— dates —');
/* ================================================================== */

check('daysInMonth: Feb 2024 is a leap month (29)', D.daysInMonth(2024, 1) === 29);
check('daysInMonth: Feb 2023 is not leap (28)', D.daysInMonth(2023, 1) === 28);
check('daysInMonth: Feb 2000 is leap (div by 400)', D.daysInMonth(2000, 1) === 29);
check('daysInMonth: Feb 1900 is not leap (div by 100)', D.daysInMonth(1900, 1) === 28);
check('daysInMonth: April 2026 has 30', D.daysInMonth(2026, 3) === 30);

// startOfWeek, Monday-anchored
dateEq('startOfWeek: Sunday steps back to Monday',
       D.startOfWeek(DT(2026, 1, 4, 23, 59)), DT(2025, 12, 29));
dateEq('startOfWeek: Monday is its own week start',
       D.startOfWeek(DT(2026, 1, 5, 12, 30)), DT(2026, 1, 5));
dateEq('startOfWeek: Wednesday steps back two days',
       D.startOfWeek(DT(2026, 1, 7, 8, 0)), DT(2026, 1, 5));
check('startOfWeek strips the time component',
      D.startOfWeek(DT(2026, 1, 7, 22, 15)).getHours() === 0
  && D.startOfWeek(DT(2026, 1, 7, 22, 15)).getMinutes() === 0);
check('startOfWeek: Saturday is a mid-week day',
      D.startOfWeek(DT(2026, 1, 10)).getDate() === 5);

// buildMonthGrid
const grid = D.buildMonthGrid(2026, 0);   // January 2026
check('buildMonthGrid: always 6 weeks', grid.length === 6);
eq('buildMonthGrid: 42 cells total', grid.reduce((n, r) => n + r.length, 0), 42);
check('buildMonthGrid: every cell is a Date',
      grid.every(r => r.every(c => c instanceof Date)));
check('buildMonthGrid: every row starts on a Monday',
      grid.every(r => r[0].getDay() === 1));
dateEq('buildMonthGrid: Jan 2026 anchors to Mon Dec 29 2025',
       grid[0][0], DT(2025, 12, 29));
check('buildMonthGrid: cells are consecutive days',
      grid.every((row, w) =>
        row.every((day, i) => {
          const prev = w === 0 ? null : grid[w - 1][6];
          if (i === 0 && prev) { return D.addDays(prev, 1).getTime() === day.getTime(); }
          if (i === 0) { return true; }
          return D.addDays(row[i - 1], 1).getTime() === day.getTime();
        })
      ));

const flat = grid.reduce((a, r) => a.concat(r), []);
check('buildMonthGrid: contains the 1st of the month',
      flat.some(d => D.isSameDay(d, DT(2026, 1, 1))));
check('buildMonthGrid: contains the last day of the month',
      flat.some(d => D.isSameDay(d, DT(2026, 1, 31))));
check('buildMonthGrid: Feb 2024 (leap) contains Feb 29',
      D.buildMonthGrid(2024, 1).reduce((a, r) => a.concat(r), [])
        .some(d => D.isSameDay(d, DT(2024, 2, 29))));
check('buildMonthGrid: Feb 2023 (non-leap) has no 29th at all',
      !D.buildMonthGrid(2023, 1).reduce((a, r) => a.concat(r), [])
        .some(d => d.getMonth() === 1 && d.getDate() === 29));
check('buildMonthGrid: Feb 2023 (non-leap) still shows Feb 28',
      D.buildMonthGrid(2023, 1).reduce((a, r) => a.concat(r), [])
        .some(d => d.getMonth() === 1 && d.getDate() === 28));
check('buildMonthGrid: Feb 2000 (div 400) contains Feb 29',
      D.buildMonthGrid(2000, 1).reduce((a, r) => a.concat(r), [])
        .some(d => D.isSameDay(d, DT(2000, 2, 29))));

// Every month, every starting weekday: the grid must still be sane.
let gridMonthsGood = true;
for (let m = 0; m < 12; m++) {
  const g = D.buildMonthGrid(2026, m);
  const f = g.reduce((a, r) => a.concat(r), []);
  const first = g[0][0];
  const one = DT(2026, m + 1, 1);
  const last = DT(2026, m + 1, D.daysInMonth(2026, m));
  if (first.getDay() !== 1) { gridMonthsGood = false; }
  if (first.getTime() > one.getTime()) { gridMonthsGood = false; }
  if (!f.some(d => D.isSameDay(d, one))) { gridMonthsGood = false; }
  if (!f.some(d => D.isSameDay(d, last))) { gridMonthsGood = false; }
}
check('buildMonthGrid: all 12 months of 2026 anchor correctly and span 1st→last',
      gridMonthsGood);

// Every month of a leap year too (covers Feb 29 adjacency).
let gridLeapGood = true;
for (let m = 0; m < 12; m++) {
  const g = D.buildMonthGrid(2024, m);
  const f = g.reduce((a, r) => a.concat(r), []);
  if (f.length !== 42 || g.length !== 6) { gridLeapGood = false; }
  if (!f.some(d => D.isSameDay(d, DT(2024, m + 1, 1)))) { gridLeapGood = false; }
}
check('buildMonthGrid: all 12 months of 2024 are 42 cells and contain the 1st',
      gridLeapGood);

check('isSameDay: same day, different times',
      D.isSameDay(DT(2026, 1, 5, 0, 0), DT(2026, 1, 5, 23, 59)));
check('isSameDay: adjacent days differ', !D.isSameDay(DT(2026, 1, 5), DT(2026, 1, 6)));
check('isSameDay: rejects null', !D.isSameDay(null, DT(2026, 1, 5)));
check('isSameMonth: matching', D.isSameMonth(DT(2026, 3, 9, 5, 0), 2026, 2));
check('isSameMonth: wrong month', !D.isSameMonth(DT(2026, 4, 1), 2026, 2));

eq('toISO: formats local wall clock with zero padding',
   D.toISO(DT(2026, 1, 5, 9, 4, 7)), '2026-01-05T09:04:07');
dateEq('toISO/fromISO round-trip preserves wall clock',
       D.fromISO(D.toISO(DT(2026, 2, 29, 23, 59, 58))), DT(2026, 2, 29, 23, 59, 58));
dateEq('fromISO: accepts datetime-local form (no seconds)',
       D.fromISO('2026-01-05T09:30'), DT(2026, 1, 5, 9, 30));
dateEq('fromISO: accepts date-only form as local midnight',
       D.fromISO('2026-01-05'), DT(2026, 1, 5));
throws('fromISO: rejects empty string', () => D.fromISO(''));
throws('fromISO: rejects non-string', () => D.fromISO(12345));
throws('fromISO: rejects unparseable text', () => D.fromISO('not-a-date'));
throws('fromISO: rejects Feb 30', () => D.fromISO('2026-02-30T10:00:00'));
throws('fromISO: rejects hour 24', () => D.fromISO('2026-01-05T24:00:00'));
throws('fromISO: rejects month 13', () => D.fromISO('2026-13-01T00:00:00'));
throws('toISO: rejects a non-Date', () => D.toISO('nope'));

dateEq('addDays: crosses a month boundary',
       D.addDays(DT(2026, 1, 31), 1), DT(2026, 2, 1));
dateEq('addDays: negative crosses a year boundary',
       D.addDays(DT(2026, 1, 1, 0, 0), -1), DT(2025, 12, 31));
dateEq('addWeeks: +2 weeks is exactly 14 days',
       D.addWeeks(DT(2026, 1, 5), 2), DT(2026, 1, 19));
dateEq('addWeeks: preserves the time of day',
       D.addWeeks(DT(2026, 1, 5, 14, 30), 1), DT(2026, 1, 12, 14, 30));
eq('addMonths: December rolls into January of next year',
   D.addMonths(2026, 11, 1), { year: 2027, month: 0 });
eq('addMonths: January back to December',
   D.addMonths(2027, 0, -1), { year: 2026, month: 11 });
eq('addMonths: multi-year span', D.addMonths(2020, 0, 25), { year: 2022, month: 1 });

eq('formatShort: "Jan 5"', D.formatShort(DT(2026, 1, 5)), 'Jan 5');
eq('formatTime: zero-pads hours and minutes', D.formatTime(DT(2026, 1, 5, 9, 4)), '09:04');
eq('monthLabel: full month name and year',
   D.monthLabel(2026, 0), 'January 2026');
eq('formatLong: weekday uses Monday-first ordering',
   D.formatLong(DT(2026, 1, 5, 10, 0)), 'Mon, Jan 5, 2026');
check('formatDateTime: includes weekday, day and time',
      /^Mon, Jan 5 · 14:30$/.test(D.formatDateTime(DT(2026, 1, 5, 14, 30))));
eq('weekdayLabel: Sunday is last', D.weekdayLabel(DT(2026, 1, 4)), 'Sun');
check('weekKey: all days of one week share a key',
      D.weekKey(DT(2026, 1, 5)) === D.weekKey(DT(2026, 1, 11)));
check('weekKey: adjacent weeks differ',
      D.weekKey(DT(2026, 1, 5)) !== D.weekKey(DT(2026, 1, 12)));
eq('weekKey: is the date-only Monday of the week', D.weekKey(DT(2026, 1, 7)), '2026-01-05');
eq('toISODate: date-only local ISO', D.toISODate(DT(2026, 1, 5, 13, 7)), '2026-01-05');

/* ================================================================== */
console.log('— csv —');
/* ================================================================== */

eq('toCSV: emits the header row first',
   C.toCSV([{ a: 1, b: 'x' }], ['a', 'b']), 'a,b\n1,x\n');
eq('toCSV: accepts array rows', C.toCSV([[1, 2], [3, 4]]), '1,2\n3,4\n');
eq('toCSV: empty input returns empty string', C.toCSV([]), '');
eq('toCSV: empty value serialises as an empty field',
   C.toCSV([{ a: '', b: 'x' }], ['a', 'b']), 'a,b\n,x\n');
eq('toCSV: null value serialises as an empty field',
   C.toCSV([{ a: null, b: 'x' }], ['a', 'b']), 'a,b\n,x\n');
eq('toCSV: comma forces quoting',
   C.toCSV([{ a: 'hello, world' }], ['a']), 'a\n"hello, world"\n');
eq('toCSV: quote is doubled inside a quoted field',
   C.toCSV([{ a: 'say "hi"' }], ['a']), 'a\n"say ""hi"""\n');
eq('toCSV: newline forces quoting and survives verbatim',
   C.toCSV([{ a: 'line1\nline2' }], ['a']), 'a\n"line1\nline2"\n');
eq('toCSV: CRLF inside a field is preserved',
   C.toCSV([{ a: 'a\rb' }], ['a']), 'a\n"a\rb"\n');
eq('toCSV: unicode passes through untouched',
   C.toCSV([{ a: 'naïve → 🚀' }], ['a']), 'a\nnaïve → 🚀\n');
eq('toCSV: numbers and booleans are stringified',
   C.toCSV([{ a: 0, b: false, c: true }], ['a', 'b', 'c']), 'a,b,c\n0,false,true\n');
throws('toCSV: object rows without headers is a programming error',
       () => C.toCSV([{ a: 1 }]));
throws('toCSV: rejects a scalar row', () => C.toCSV([42]));

check('parseCSV: round-trips toCSV output exactly',
      JSON.stringify(C.parseCSV(C.toCSV(
        [{ n: 'plain', q: 'a"b', c: 'x,y', nl: 'p\nq', empty: '' }],
        ['n', 'q', 'c', 'nl', 'empty']
      ))) === JSON.stringify([
        ['n', 'q', 'c', 'nl', 'empty'],
        ['plain', 'a"b', 'x,y', 'p\nq', '']
      ]));
eq('parseCSV: quoted field containing a comma',
   C.parseCSV('a,b\n"hello, world",2\n'), [['a', 'b'], ['hello, world', '2']]);
eq('parseCSV: doubled quotes unescape to a single quote',
   C.parseCSV('a\n"say ""hi"""\n'), [['a'], ['say "hi"']]);
eq('parseCSV: embedded newline stays inside one field',
   C.parseCSV('a,b\n"line1\nline2",3\n'), [['a', 'b'], ['line1\nline2', '3']]);
eq('parseCSV: CRLF endings parse like LF',
   C.parseCSV('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
eq('parseCSV: bare CR is also a terminator',
   C.parseCSV('a,b\r1,2\r'), [['a', 'b'], ['1', '2']]);
eq('parseCSV: trailing terminator produces no phantom row',
   C.parseCSV('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
eq('parseCSV: no trailing terminator still flushes the last row',
   C.parseCSV('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
eq('parseCSV: empty input is an empty array', C.parseCSV(''), []);
eq('parseCSV: empty line is a single empty field', C.parseCSV('a\n\n'), [['a'], ['']]);
eq('parseCSV: a quote mid-field is literal',
   C.parseCSV('a\nx"y\n'), [['a'], ['x"y']]);
eq('parseCSVRows: first row becomes keys',
   C.parseCSVRows('a,b\n1,2\n'), [{ a: '1', b: '2' }]);
eq('parseCSVRows: short rows are padded with empty strings',
   C.parseCSVRows('a,b,c\n1\n'), [{ a: '1', b: '', c: '' }]);
eq('escapeField: plain text is returned bare',
   C.escapeField('hello world'), 'hello world');
eq('escapeField: unicode does not need quoting',
   C.escapeField('naïve → 🚀'), 'naïve → 🚀');

/* ================================================================== */
console.log('— serializers —');
/* ================================================================== */

eq('SCHEMA_VERSION is 1', S.SCHEMA_VERSION, 1);

const accs = S.defaultAccounts();
eq('defaultAccounts: three starter channels', accs.length, 3);
check('defaultAccounts: every account has all required fields',
      accs.every(a =>
        typeof a.id === 'string' && a.id.length > 0
        && typeof a.name === 'string' && a.name.length > 0
        && typeof a.platform === 'string'
        && typeof a.charLimit === 'number' && a.charLimit > 0
        && /^#[0-9a-fA-F]{3,6}$/.test(a.color)
      ));
eq('defaultAccounts: ids are unique',
   accs.map(a => a.id).length, new Set(accs.map(a => a.id)).size);
eq('defaultAccounts: the X channel caps at 280',
   accs.find(a => a.platform === 'x').charLimit, 280);
eq('defaultAccounts: the Mastodon channel caps at 500',
   accs.find(a => a.platform === 'mastodon').charLimit, 500);
eq('defaultAccounts: the Instagram channel caps at 2200',
   accs.find(a => a.platform === 'instagram').charLimit, 2200);

eq('charLimitFor: x is 280', S.charLimitFor('x'), 280);
eq('charLimitFor: aliases like "twitter" map to the same budget',
   S.charLimitFor('twitter'), 280);
eq('charLimitFor: mastodon is 500', S.charLimitFor('mastodon'), 500);
eq('charLimitFor: unknown platforms fall back to the generic 500',
   S.charLimitFor('carrier-pigeon'), 500);
eq('charLimitFor: lookup is case-insensitive', S.charLimitFor('MASTODON'), 500);

eq('sampleDocument: validates as a document',
   S.validateDocument(S.sampleDocument()).version, S.SCHEMA_VERSION);
check('sampleDocument: every post points at a real account',
      (() => {
        const d = S.sampleDocument();
        const ids = d.accounts.map(a => a.id);
        return d.posts.every(p => ids.indexOf(p.accountId) !== -1);
      })());
check('sampleDocument: spans draft, scheduled and published',
      (() => {
        const st = S.sampleDocument().posts.map(p => p.status);
        return ['draft', 'scheduled', 'published'].every(s => st.indexOf(s) !== -1);
      })());

// Round trip
const doc = S.sampleDocument();
const text = S.serializePosts(doc);
const back = S.deserializePosts(text);
eq('serialize→deserialize: post count survives', back.posts.length, doc.posts.length);
eq('serialize→deserialize: account count survives', back.accounts.length, doc.accounts.length);
eq('serialize→deserialize: every body survives verbatim',
   back.posts.map(p => p.body), doc.posts.map(p => p.body));
eq('serialize→deserialize: every tag survives verbatim',
   back.posts.map(p => p.tags.join('|')), doc.posts.map(p => p.tags.join('|')));
eq('serialize→deserialize: every status survives',
   back.posts.map(p => p.status), doc.posts.map(p => p.status));
check('serialize: output declares the current version',
      JSON.parse(text).version === S.SCHEMA_VERSION);
check('serialize: output is pretty-printed JSON', /^\{\n  "version":/.test(text));

// Validation rejections
throws('deserializePosts: rejects empty text', () => S.deserializePosts(''));
throws('deserializePosts: rejects invalid JSON', () => S.deserializePosts('{nope'));
throws('deserializePosts: rejects a bare array', () => S.deserializePosts(JSON.stringify([])));
throws('deserializePosts: rejects missing version',
       () => S.deserializePosts(JSON.stringify({ accounts: [], posts: [] })));
throws('deserializePosts: rejects a newer schema version',
       () => S.deserializePosts(JSON.stringify({ version: 99, accounts: [], posts: [] })));
throws('deserializePosts: rejects missing accounts array',
       () => S.deserializePosts(JSON.stringify({ version: 1, accounts: 'no', posts: [] })));
throws('deserializePosts: rejects missing posts array',
       () => S.deserializePosts(JSON.stringify({ version: 1, accounts: [], posts: null })));

const goodDoc = {
  version: 1,
  accounts: [{ id: 'a1', name: 'X', platform: 'x', color: '#1d9bf0' }],
  posts: [{ id: 'p1', body: 'hello', accountId: 'a1',
            scheduledAt: '2026-01-05T09:00:00', status: 'draft', tags: [] }]
};
eq('deserializePosts: accepts a minimal valid document',
   S.deserializePosts(JSON.stringify(goodDoc)).posts.length, 1);
throws('deserializePosts: rejects a post with an empty body',
       () => S.deserializePosts(JSON.stringify({
         version: 1, accounts: goodDoc.accounts,
         posts: [{ body: '   ', accountId: 'a1', scheduledAt: '2026-01-05T09:00:00' }]
       })));
throws('deserializePosts: rejects a post with no accountId',
       () => S.deserializePosts(JSON.stringify({
         version: 1, accounts: goodDoc.accounts,
         posts: [{ body: 'hi', scheduledAt: '2026-01-05T09:00:00' }]
       })));
throws('deserializePosts: rejects a post pointing at an unknown account',
       () => S.deserializePosts(JSON.stringify({
         version: 1, accounts: goodDoc.accounts,
         posts: [{ body: 'hi', accountId: 'ghost', scheduledAt: '2026-01-05T09:00:00' }]
       })));
throws('deserializePosts: rejects an unparseable scheduledAt',
       () => S.deserializePosts(JSON.stringify({
         version: 1, accounts: goodDoc.accounts,
         posts: [{ body: 'hi', accountId: 'a1', scheduledAt: 'tomorrow' }]
       })));
throws('deserializePosts: rejects a date that cannot exist (Feb 30)',
       () => S.deserializePosts(JSON.stringify({
         version: 1, accounts: goodDoc.accounts,
         posts: [{ body: 'hi', accountId: 'a1', scheduledAt: '2026-02-30T10:00:00' }]
       })));
throws('deserializePosts: rejects an unknown status',
       () => S.deserializePosts(JSON.stringify({
         version: 1, accounts: goodDoc.accounts,
         posts: [{ body: 'hi', accountId: 'a1',
                   scheduledAt: '2026-01-05T09:00:00', status: 'queued' }]
       })));
throws('deserializePosts: rejects tags that are not an array',
       () => S.deserializePosts(JSON.stringify({
         version: 1, accounts: goodDoc.accounts,
         posts: [{ body: 'hi', accountId: 'a1',
                   scheduledAt: '2026-01-05T09:00:00', tags: 'launch' }]
       })));
throws('deserializePosts: rejects a tag entry that is not a string',
       () => S.deserializePosts(JSON.stringify({
         version: 1, accounts: goodDoc.accounts,
         posts: [{ body: 'hi', accountId: 'a1',
                   scheduledAt: '2026-01-05T09:00:00', tags: ['ok', 42] }]
       })));
throws('deserializePosts: rejects an account with an empty name',
       () => S.deserializePosts(JSON.stringify({
         version: 1,
         accounts: [{ id: 'a1', name: '   ', platform: 'x', color: '#1d9bf0' }],
         posts: []
       })));
throws('deserializePosts: rejects an account with a non-hex color',
       () => S.deserializePosts(JSON.stringify({
         version: 1,
         accounts: [{ id: 'a1', name: 'X', platform: 'x', color: 'blue' }],
         posts: []
       })));
throws('deserializePosts: rejects an account with a non-positive charLimit',
       () => S.deserializePosts(JSON.stringify({
         version: 1,
         accounts: [{ id: 'a1', name: 'X', platform: 'x', color: '#1d9bf0', charLimit: 0 }],
         posts: []
       })));
throws('deserializePosts: rejects duplicate account ids',
       () => S.deserializePosts(JSON.stringify({
         version: 1,
         accounts: [
           { id: 'a1', name: 'X', platform: 'x', color: '#1d9bf0' },
           { id: 'a1', name: 'Y', platform: 'y', color: '#ff0000' }
         ],
         posts: []
       })));
throws('validateDocument: rejects a non-object document',
       () => S.validateDocument('nope'));

// Normalisation behaviour
const norm = S.normalizePost({
  body: '  spaced out  ', accountId: 'a1', scheduledAt: '2026-01-05T09:00:00',
  tags: ['  launch  ', '', '  ']
}, 0, ['a1']);
eq('normalizePost: trims the body', norm.body, 'spaced out');
eq('normalizePost: trims tags and drops the empty ones', norm.tags, ['launch']);
eq('normalizePost: defaults the status to draft', norm.status, 'draft');
check('normalizePost: assigns an id when none is given', /^p_/.test(norm.id));
check('normalizePost: fills createdAt from scheduledAt',
      norm.createdAt === norm.scheduledAt);
eq('normalizeAccount: derives charLimit from the platform when omitted',
   S.normalizeAccount({ id: 'z', name: 'Bluesky', platform: 'bluesky', color: '#1185fe' }, 0).charLimit,
   300);
eq('normalizeAccount: trims the display name',
   S.normalizeAccount({ id: 'z', name: '  X  ', platform: 'x', color: '#1d9bf0' }, 0).name, 'X');

// Status workflow
check('canTransition: draft → scheduled', S.canTransition('draft', 'scheduled'));
check('canTransition: scheduled → published', S.canTransition('scheduled', 'published'));
check('canTransition: scheduled → draft (unschedule)', S.canTransition('scheduled', 'draft'));
check('canTransition: published → scheduled (revert)', S.canTransition('published', 'scheduled'));
check('canTransition: draft cannot jump straight to published',
      !S.canTransition('draft', 'published'));
check('canTransition: a status cannot transition to itself',
      !S.canTransition('draft', 'draft'));
check('canTransition: unknown statuses are refused',
      !S.canTransition('nope', 'draft') && !S.canTransition('draft', 'nope'));
eq('advanceStatus: draft → scheduled', S.advanceStatus('draft'), 'scheduled');
eq('advanceStatus: scheduled → published', S.advanceStatus('scheduled'), 'published');
eq('advanceStatus: published is a terminal state', S.advanceStatus('published'), null);
check('newId: ids are unique across rapid calls',
      new Set(Array.from({ length: 200 }, () => S.newId())).size === 200);
check('newId: ids match the p_<ts>_<rand> shape', /^p_[0-9a-z]+_[0-9a-z]{8}$/.test(S.newId()));

/* ================================================================== */
console.log('— schedule —');
/* ================================================================== */

const baseAccs = S.defaultAccounts();
function mkPost(body, accountId, when, status, tags) {
  return {
    id: S.newId(),
    body: body,
    accountId: accountId || baseAccs[0].id,
    scheduledAt: D.toISO(when),
    notes: '',
    tags: tags || [],
    status: status || 'draft',
    createdAt: D.toISO(when)
  };
}

const monday = DT(2026, 1, 5, 9, 0);
const lateMon = DT(2026, 1, 5, 23, 0);
const wed = DT(2026, 1, 7, 12, 0);
const nextMon = DT(2026, 1, 12, 8, 0);
const prevSun = DT(2026, 1, 4, 10, 0);

const posts3 = [
  mkPost('later', baseAccs[0].id, nextMon, 'scheduled'),
  mkPost('earlier', baseAccs[1].id, monday, 'scheduled'),
  mkPost('after', baseAccs[2].id, wed, 'scheduled')
];

const slot = SC.nextSlot(posts3, DT(2026, 1, 5, 10, 0));
check('nextSlot: returns the soonest post at or after `from`',
      !!slot && slot.post.body === 'after' && slot.when.getTime() === wed.getTime());
check('nextSlot: includes a post exactly at `from`',
      SC.nextSlot(posts3, wed).post.body === 'after');
check('nextSlot: skips posts in the past',
      SC.nextSlot(posts3, DT(2026, 1, 8, 0, 0)).post.body === 'later');
check('nextSlot: returns null when nothing is upcoming',
      SC.nextSlot(posts3, DT(2026, 2, 1, 0, 0)) === null);
check('nextSlot: honours a status filter',
      (() => {
        const mixed = [
          mkPost('a-draft', baseAccs[0].id, monday, 'draft'),
          mkPost('a-scheduled', baseAccs[0].id, monday, 'scheduled')
        ];
        const r = SC.nextSlot(mixed, DT(2026, 1, 5, 0, 0), 'scheduled');
        return r && r.post.status === 'scheduled';
      })());
check('nextSlot: ignores posts with unparseable dates instead of throwing',
      (() => {
        const bad = [
          { id: 'x', body: 'b', accountId: 'a', scheduledAt: 'nope', status: 'draft' },
          mkPost('ok', baseAccs[0].id, monday, 'draft')
        ];
        return SC.nextSlot(bad, DT(2025, 1, 1)).post.body === 'ok';
      })());

// Week buckets, anchored on Monday 2026-01-05
const bucketPosts = [
  mkPost('w0', baseAccs[0].id, DT(2026, 1, 5, 9, 0), 'draft'),
  mkPost('w0b', baseAccs[0].id, DT(2026, 1, 11, 18, 0), 'draft'),
  mkPost('w1', baseAccs[0].id, DT(2026, 1, 12, 9, 0), 'draft'),
  mkPost('w2', baseAccs[0].id, DT(2026, 1, 19, 9, 0), 'draft'),
  mkPost('before', baseAccs[0].id, DT(2025, 12, 29, 9, 0), 'draft'),
  mkPost('far', baseAccs[0].id, DT(2026, 3, 2, 9, 0), 'draft')
];
const bk = SC.weekBuckets(bucketPosts, 4, DT(2026, 1, 7, 12, 0));
eq('weekBuckets: returns exactly `weeks` buckets', bk.length, 4);
eq('weekBuckets: last bucket is the current week (contains `now`)',
   D.toISODate(bk[bk.length - 1].weekStart), '2026-01-05');
check('weekBuckets: buckets are ordered oldest → newest',
      bk.every((b, i) => i === 0 || b.weekStart.getTime() > bk[i - 1].weekStart.getTime()));
eq('weekBuckets: bucket boundaries are exactly 7 days apart, trailing the current week',
   bk.map(b => b.iso),
   ['2025-12-15', '2025-12-22', '2025-12-29', '2026-01-05']);
eq('weekBuckets: counts fall into the right buckets',
   bk.map(b => b.count), [0, 0, 1, 2]);
check('weekBuckets: posts outside the window are excluded',
      bk.reduce((n, b) => n + b.count, 0) === 3);
check('weekBuckets: each bucket exposes an iso key and a short label',
      bk.every(b => typeof b.iso === 'string' && typeof b.label === 'string' && b.label.length > 0));
eq('weekBuckets: a single bucket with no posts is zero',
   SC.weekBuckets([], 1, DT(2026, 1, 7)).map(b => b.count), [0]);
eq('weekBuckets: weeks is clamped to at least 1',
   SC.weekBuckets(bucketPosts, 0, DT(2026, 1, 7)).length, 1);

// Cadence
const cadPosts = [
  mkPost('a', baseAccs[0].id, DT(2026, 1, 5, 9, 0), 'draft'),
  mkPost('b', baseAccs[0].id, DT(2026, 1, 6, 9, 0), 'scheduled'),
  mkPost('c', baseAccs[1].id, DT(2026, 1, 7, 9, 0), 'published'),
  mkPost('d', baseAccs[1].id, DT(2026, 1, 12, 9, 0), 'scheduled'),
  mkPost('e', baseAccs[2].id, DT(2025, 12, 30, 9, 0), 'draft')
];
const NOW = DT(2026, 1, 12, 12, 0);   // a Tuesday inside the Jan 12 week
const st = SC.cadenceStats(cadPosts, baseAccs, 4, NOW);
eq('cadenceStats: total counts every post', st.total, 5);
eq('cadenceStats: byStatus breaks down correctly',
   st.byStatus, { draft: 2, scheduled: 2, published: 1 });
eq('cadenceStats: byAccount counts per channel',
   st.byAccount.map(a => [a.name, a.count]),
   [['X / Twitter', 2], ['Mastodon', 2], ['Instagram', 1]]);
eq('cadenceStats: busiest week is the one with three posts',
   st.busiestWeek && st.busiestWeek.count, 3);
eq('cadenceStats: busiest week is labelled by its Monday',
   st.busiestWeek && st.busiestWeek.iso, '2026-01-05');
eq('cadenceStats: avgPerWeek divides total by the window',
   Math.round(st.avgPerWeek * 100) / 100, Math.round(5 / 4 * 100) / 100);
check('cadenceStats: empty input yields zeros and a null busiest week',
      (() => {
        const e = SC.cadenceStats([], baseAccs, 4, NOW);
        return e.total === 0 && e.busiestWeek === null
            && e.byAccount.every(a => a.count === 0);
      })());
check('cadenceStats: reports how many posts had a parseable date',
      (() => {
        const mixed = cadPosts.concat([{
          id: 'bad', body: 'b', accountId: baseAccs[0].id,
          scheduledAt: 'nope', status: 'draft'
        }]);
        const r = SC.cadenceStats(mixed, baseAccs, 8, NOW);
        return r.total === 6 && r.dated === 5;
      })());
eq('clampWeeks: defaults to 8 when nothing is given', SC.clampWeeks(undefined), 8);
eq('clampWeeks: clamps zero and negatives up to 1', SC.clampWeeks(0), 1);
eq('clampWeeks: clamps negatives up to 1', SC.clampWeeks(-4), 1);
eq('clampWeeks: floors fractional requests', SC.clampWeeks(8.9), 8);
eq('clampWeeks: recovers from garbage input', SC.clampWeeks('nope'), 8);

// Character limits
eq('lengthOf: counts code points, not UTF-16 units (emoji = 1)',
   SC.lengthOf('hi 🚀'), 4);
eq('lengthOf: plain ASCII', SC.lengthOf('abcdef'), 6);
eq('lengthOf: empty string', SC.lengthOf(''), 0);
eq('lengthOf: null becomes empty', SC.lengthOf(null), 0);
eq('overflowFor: reports how many characters over budget',
   SC.overflowFor(mkPost('x'.repeat(285), baseAccs[0].id, monday), baseAccs), 5);
eq('overflowFor: negative when under budget',
   SC.overflowFor(mkPost('short', baseAccs[0].id, monday), baseAccs), -275);
check('withinLimit: true at exactly the limit',
      SC.withinLimit(mkPost('x'.repeat(280), baseAccs[0].id, monday), baseAccs));
check('withinLimit: false one over the limit',
      !SC.withinLimit(mkPost('x'.repeat(281), baseAccs[0].id, monday), baseAccs));
check('withinLimit: emoji are counted as single characters, not UTF-16 units',
      SC.withinLimit(mkPost('🚀'.repeat(280), baseAccs[0].id, monday), baseAccs)
   && !SC.withinLimit(mkPost('🚀'.repeat(281), baseAccs[0].id, monday), baseAccs));
check('overflowFor: unknown account is not penalised',
      SC.overflowFor(mkPost('x'.repeat(9000), 'ghost', monday), baseAccs) === 0);

/* ================================================================== */
console.log('— store —');
/* ================================================================== */

const mem = { data: {} };
const stub = {
  getItem: k => (k in mem.data ? mem.data[k] : null),
  setItem: (k, v) => { mem.data[k] = String(v); },
  removeItem: k => { delete mem.data[k]; },
  get length() { return Object.keys(mem.data).length; },
  key: i => Object.keys(mem.data)[i]
};

const store = ST.createStore({ backend: stub, prefix: 'op.' });
eq('store: backend() reports the injected backend', store.backend(), 'localStorage');
check('store: get returns null for a missing key', store.get('nope') === null);
store.set('doc', { version: 1, accounts: [], posts: [{ n: 1 }] });
eq('store: set/get round-trips a nested object',
   store.get('doc'), { version: 1, accounts: [], posts: [{ n: 1 }] });
check('store: values are prefixed', 'op.doc' in mem.data);
store.remove('doc');
check('store: remove clears the key', store.get('doc') === null);
check('store: corrupt JSON is reported as null, not a throw',
      (() => {
        mem.data['op.bad'] = '{not json';
        const r = store.get('bad');
        delete mem.data['op.bad'];
        return r === null;
      })());
check('store: has() is true for a present key', store.set('present', 1) && store.has('present'));
check('store: has() is false for a missing key', !store.has('missing'));
check('store: has() still reports a key whose JSON is corrupt, so a caller can tell absent from unreadable',
      (() => {
        mem.data['op.bad2'] = '{not json';
        const both = store.has('bad2') && store.get('bad2') === null;
        delete mem.data['op.bad2'];
        return both;
      })());
check('store: has() reflects remove()',
      (() => {
        store.set('gone', { a: 1 });
        const before = store.has('gone');
        store.remove('gone');
        return before && !store.has('gone');
      })());
store.set('a', 1);
store.set('b', 2);
mem.data['other.c'] = 3;
store.clear();
check('store: clear() removes only its own prefixed keys',
      store.get('a') === null && store.get('b') === null && mem.data['other.c'] === 3);
check('store: set returns false for a value that cannot be serialised',
      (() => {
        const circular = {};
        circular.self = circular;
        return store.set('c', circular) === false;
      })());

const nodeStore = ST.createStore();   // no localStorage under Node
eq('store: falls back to memory when localStorage is unavailable',
   nodeStore.backend(), 'memory');
nodeStore.set('k', [1, 2, 3]);
eq('store: the memory backend round-trips values', nodeStore.get('k'), [1, 2, 3]);
nodeStore.set('l', { deep: { nested: true } });
eq('store: the memory backend handles nested objects',
   nodeStore.get('l'), { deep: { nested: true } });
nodeStore.remove('k');
nodeStore.clear();
check('store: the memory backend honours remove and clear',
      nodeStore.get('k') === null && nodeStore.get('l') === null);

/* ================================================================== */
console.log('— integration —');
/* ================================================================== */

check('integration: sample document → CSV → JSON survives an import round trip',
      (() => {
        const d = S.sampleDocument();
        const rows = d.posts.map(p => ({
          body: p.body, accountId: p.accountId, status: p.status,
          scheduledAt: p.scheduledAt, tags: p.tags.join('; ')
        }));
        const csv = C.toCSV(rows, ['body', 'accountId', 'status', 'scheduledAt', 'tags']);
        const parsed = C.parseCSVRows(csv);
        if (parsed.length !== d.posts.length) { return false; }
        for (let i = 0; i < parsed.length; i++) {
          if (parsed[i].body !== d.posts[i].body) { return false; }
          if (parsed[i].status !== d.posts[i].status) { return false; }
        }
        // Rebuild a document from the parsed rows and validate it.
        const rebuilt = {
          version: S.SCHEMA_VERSION,
          accounts: d.accounts,
          posts: parsed.map(p => ({
            body: p.body, accountId: p.accountId, status: p.status,
            scheduledAt: p.scheduledAt, tags: p.tags === '' ? [] : p.tags.split('; ')
          }))
        };
        return S.validateDocument(rebuilt).posts.length === d.posts.length;
      })());

check('integration: export text imports back into the live store',
      (() => {
        const d = S.sampleDocument();
        const s = ST.createStore();
        s.set('document', d);
        const text = S.serializePosts(s.get('document'));
        const again = S.deserializePosts(text);
        s.set('document', again);
        return JSON.stringify(s.get('document').posts.map(p => p.body))
             === JSON.stringify(d.posts.map(p => p.body));
      })());

check('integration: a planned week lands on the right calendar cells',
      (() => {
        const posts = [
          mkPost('mon', baseAccs[0].id, DT(2026, 1, 5, 9, 0), 'scheduled'),
          mkPost('sat', baseAccs[1].id, DT(2026, 1, 10, 9, 0), 'draft')
        ];
        const grid = D.buildMonthGrid(2026, 0);
        const flat = grid.reduce((a, r) => a.concat(r), []);
        const byDay = {};
        posts.forEach(p => {
          const when = D.fromISO(p.scheduledAt);
          byDay[D.toISO(when)] = p.body;
        });
        return flat.some(d => D.toISO(d) === '2026-01-05T00:00:00'
                          && byDay['2026-01-05T09:00:00'] === 'mon')
            && flat.some(d => D.toISO(d) === '2026-01-10T00:00:00'
                          && byDay['2026-01-10T09:00:00'] === 'sat');
      })());

check('integration: char-limit enforcement works end to end',
      (() => {
        const d = S.validateDocument({
          version: 1,
          accounts: [{ id: 'a1', name: 'X', platform: 'x', color: '#1d9bf0' }],
          posts: [
            { body: 'x'.repeat(279), accountId: 'a1',
              scheduledAt: '2026-01-05T09:00:00', status: 'draft' },
            { body: 'x'.repeat(281), accountId: 'a1',
              scheduledAt: '2026-01-06T09:00:00', status: 'draft' }
          ]
        });
        return SC.withinLimit(d.posts[0], d.accounts)
            && !SC.withinLimit(d.posts[1], d.accounts);
      })());

check('integration: the whole workflow is walkable draft → scheduled → published',
      (() => {
        let cur = 'draft';
        const path = [];
        while (true) {
          const next = S.advanceStatus(cur);
          path.push(next);
          if (next === null) { break; }
          if (!S.canTransition(cur, next)) { return false; }
          cur = next;
        }
        return JSON.stringify(path) === JSON.stringify(['scheduled', 'published', null]);
      })());

/* ================================================================== */
console.log('— browser emulation —');
/* ================================================================== */

// The five modules are UMD. Under Node the `require` branch runs, which can
// hide a bug in the browser branch (for example a variable referenced inside
// the factory that the wrapper never passes in). Load every module into a
// bare VM context with no `module`/`require` in scope — exactly the path a
// browser takes — and prove the whole chain still works.
const vm = require('vm');
const fs = require('fs');

const browserGlobal = {};
browserGlobal.self = browserGlobal;
vm.createContext(browserGlobal);

const MODULE_FILES = ['dates.js', 'csv.js', 'serializers.js', 'schedule.js', 'store.js'];
const browserErrors = [];

for (let i = 0; i < MODULE_FILES.length; i++) {
  const file = 'js/' + MODULE_FILES[i];
  try {
    vm.runInContext(fs.readFileSync(file, 'utf8'), browserGlobal, { filename: file });
  } catch (e) {
    browserErrors.push(MODULE_FILES[i] + ': ' + e.message);
  }
}

eq('browser mode: every module evaluates without throwing', browserErrors, []);
eq('browser mode: all five globals are attached to `self`',
   MODULE_FILES.map(f => typeof browserGlobal[
     { 'dates.js': 'PulseDates', 'csv.js': 'PulseCSV', 'serializers.js': 'PulseSerializers',
       'schedule.js': 'PulseSchedule', 'store.js': 'PulseStore' }[f]])
     .filter(t => t !== 'object'), []);
check('browser mode: the context really has no `module` or `require`',
      vm.runInContext('typeof module + "/" + typeof require', browserGlobal) === 'undefined/undefined');
eq('browser mode: serializers still reaches dates.js across modules',
   browserGlobal.PulseSerializers.deserializePosts(
     browserGlobal.PulseSerializers.serializePosts(browserGlobal.PulseSerializers.sampleDocument())
   ).posts.length, 5);
eq('browser mode: schedule still reaches dates.js across modules',
   browserGlobal.PulseSchedule.cadenceStats(
     browserGlobal.PulseSerializers.sampleDocument().posts,
     browserGlobal.PulseSerializers.sampleDocument().accounts, 8
   ).total, 5);
check('browser mode: the storage module falls back to memory',
      browserGlobal.PulseStore.createStore().backend() === 'memory');
check('browser mode: the character-limit chain works end to end',
      (() => {
        const S2 = browserGlobal.PulseSerializers;
        const SC2 = browserGlobal.PulseSchedule;
        const doc = S2.validateDocument({
          version: 1,
          accounts: [{ id: 'a1', name: 'X', platform: 'x', color: '#1d9bf0' }],
          posts: [{ body: 'x'.repeat(281), accountId: 'a1',
                    scheduledAt: '2026-01-05T09:00:00', status: 'draft' }]
        });
        return !SC2.withinLimit(doc.posts[0], doc.accounts);
      })());

/* ================================================================== */
const total = pass + fail;
console.log('\n' + '='.repeat(60));
if (fail === 0) {
  console.log('PASS  ' + pass + '/' + total + ' assertions passed, 0 failed');
} else {
  console.log('FAIL  ' + pass + '/' + total + ' passed, ' + fail + ' failed:');
  failures.forEach(f => console.log('   × ' + f));
}
console.log('='.repeat(60));
process.exit(fail === 0 ? 0 : 1);
