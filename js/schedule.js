/* ------------------------------------------------------------------ *
 * OpenPulse — scheduling maths
 *
 * Cadence, upcoming slots, and week buckets for the stats panel.
 * All functions take plain arrays and return new values; nothing is
 * mutated in place.
 * ------------------------------------------------------------------ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PulseSchedule = factory(root);
  }
})(typeof self !== 'undefined' ? self : global, function (root) {
  'use strict';

  // dates.js is a sibling module: require it under Node, read the global in
  // a browser. `root` is the same object the wrapper assigns exports to.
  var PulseDates = (typeof require === 'function')
    ? require('./dates.js')
    : (typeof root !== 'undefined' && root.PulseDates || null);

  function asDate(value) {
    if (value instanceof Date) { return value; }
    return PulseDates.fromISO(value);
  }

  /** Posts with a valid date, sorted ascending by scheduledAt. */
  function sortedByDate(posts) {
    var out = [];
    for (var i = 0; i < posts.length; i++) {
      var p = posts[i];
      try {
        out.push({ post: p, when: asDate(p.scheduledAt) });
      } catch (e) {
        continue; // skip malformed entries rather than blow up the view
      }
    }
    out.sort(function (a, b) { return a.when - b.when; });
    return out;
  }

  /**
   * The soonest post at or after `from`. Defaults to "scheduled" posts
   * only, since drafts are deliberately not yet committed.
   */
  function nextSlot(posts, from, statusFilter) {
    posts = posts || [];
    var fromMs = from ? asDate(from).getTime() : new Date().getTime();
    var list = sortedByDate(posts);
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (item.when.getTime() < fromMs) { continue; }
      if (statusFilter && item.post.status !== statusFilter) { continue; }
      return { post: item.post, when: item.when };
    }
    return null;
  }

  /** Coerce a requested window length: 8 by default, never below 1. */
  function clampWeeks(weeks) {
    var n = Math.floor(weeks);
    if (!isFinite(n) || isNaN(n)) { return 8; }
    return Math.max(1, n);
  }

  /**
   * Count posts per week for the trailing `weeks` weeks, oldest first,
   * where the last bucket is the week containing `now` (Monday-anchored).
   *
   * Returns [{ weekStart: Date, iso: string, label, count }]
   */
  function weekBuckets(posts, weeks, now) {
    weeks = clampWeeks(weeks);
    var today = now ? (now instanceof Date ? now : asDate(now)) : new Date();
    var currentMonday = PulseDates.startOfWeek(today);
    var buckets = [];
    for (var w = weeks - 1; w >= 0; w--) {
      var start = PulseDates.addWeeks(currentMonday, -w);
      buckets.push({
        weekStart: start,
        iso: PulseDates.toISODate(start),
        label: PulseDates.formatShort(start),
        count: 0
      });
    }
    var list = sortedByDate(posts || []);
    for (var i = 0; i < list.length; i++) {
      var ms = list[i].when.getTime();
      for (var b = 0; b < buckets.length; b++) {
        var lo = buckets[b].weekStart.getTime();
        if (ms >= lo && ms < lo + 7 * 86400000) {
          buckets[b].count++;
          break;
        }
      }
    }
    return buckets;
  }

  /**
   * Aggregate numbers for the stats panel.
   *
   * Returns {
   *   total, byStatus: {draft, scheduled, published},
   *   byAccount: [{ id, name, color, count }],
   *   avgPerWeek, busiestWeek: { label, count } | null
   * }
   */
  function cadenceStats(posts, accounts, weeks, now) {
    posts = posts || [];
    accounts = accounts || [];
    var byStatus = { draft: 0, scheduled: 0, published: 0 };
    var countByAccount = {};
    var total = 0;

    for (var i = 0; i < accounts.length; i++) {
      countByAccount[accounts[i].id] = 0;
    }

    var dated = 0;
    for (var j = 0; j < posts.length; j++) {
      var p = posts[j];
      total++;
      if (Object.prototype.hasOwnProperty.call(byStatus, p.status)) {
        byStatus[p.status]++;
      }
      if (countByAccount[p.accountId] !== undefined) {
        countByAccount[p.accountId]++;
      }
      try { asDate(p.scheduledAt); dated++; } catch (e) { /* ignore */ }
    }

    var byAccount = [];
    for (var k = 0; k < accounts.length; k++) {
      var acc = accounts[k];
      byAccount.push({
        id: acc.id,
        name: acc.name,
        color: acc.color,
        count: countByAccount[acc.id] || 0
      });
    }

    var buckets = weekBuckets(posts, weeks, now);
    var maxCount = 0;
    var busiest = null;
    for (var b = 0; b < buckets.length; b++) {
      if (buckets[b].count > maxCount) {
        maxCount = buckets[b].count;
        busiest = buckets[b];
      }
    }

    return {
      total: total,
      dated: dated,
      byStatus: byStatus,
      byAccount: byAccount,
      buckets: buckets,
      avgPerWeek: buckets.length ? total / buckets.length : 0,
      busiestWeek: maxCount > 0
        ? { label: busiest.label, iso: busiest.iso, count: maxCount }
        : null
    };
  }

  /** How many characters a post body is over its account's budget. */
  function overflowFor(post, accounts) {
    if (!post || !post.body) { return 0; }
    var limit = 0;
    for (var i = 0; i < accounts.length; i++) {
      if (accounts[i].id === post.accountId) { limit = accounts[i].charLimit; break; }
    }
    if (!limit) { return 0; }
    var used = Array.from(String(post.body)).length; // code points, not UTF-16 units
    return used - limit;
  }

  /** True when the body is within budget for its account. */
  function withinLimit(post, accounts) {
    return overflowFor(post, accounts) <= 0;
  }

  /** Code-point length of a string (emoji count as 1, not 2). */
  function lengthOf(value) {
    return Array.from(String(value === null || value === undefined ? '' : value)).length;
  }

  return {
    sortedByDate: sortedByDate,
    nextSlot: nextSlot,
    clampWeeks: clampWeeks,
    weekBuckets: weekBuckets,
    cadenceStats: cadenceStats,
    overflowFor: overflowFor,
    withinLimit: withinLimit,
    lengthOf: lengthOf
  };
});
