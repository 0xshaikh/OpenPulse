/* ------------------------------------------------------------------ *
 * OpenPulse — persistence format, validation, and defaults
 *
 * The document shape is:
 *
 *   {
 *     version: 1,
 *     exportedAt: "2026-01-05T09:00:00",
 *     accounts: [ { id, name, handle, platform, charLimit, color } ],
 *     posts:    [ { id, body, accountId, scheduledAt, notes, tags,
 *                   status, createdAt } ]
 *   }
 *
 * Validation is strict: deserializePosts throws on malformed input
 * rather than silently producing a half-broken store.
 * ------------------------------------------------------------------ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PulseSerializers = factory(root);
  }
})(typeof self !== 'undefined' ? self : global, function (root) {
  'use strict';

  // dates.js is a sibling module: require it under Node, read the global in
  // a browser. `root` is the same object the wrapper assigns exports to.
  var PulseDates = (typeof require === 'function')
    ? require('./dates.js')
    : (typeof root !== 'undefined' && root.PulseDates || null);

  var SCHEMA_VERSION = 1;

  var STATUSES = ['draft', 'scheduled', 'published'];
  // Forward edges of the workflow. Nothing moves backwards automatically;
  // published -> scheduled is offered in the UI as an explicit "revert".
  var STATUS_FLOW = {
    draft:     ['scheduled'],
    scheduled: ['published', 'draft'],
    published: ['scheduled']
  };

  // Character budgets per platform. Keys are normalised to lowercase.
  var CHAR_LIMITS = {
    x: 280, twitter: 280,
    mastodon: 500, bluesky: 300,
    linkedin: 3000,
    instagram: 2200, facebook: 5000, threads: 5000,
    reddit: 40000,
    generic: 500
  };

  var HEX_COLOR = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

  function isNonEmptyString(v) {
    return typeof v === 'string' && v.trim() !== '';
  }

  /** Character budget for a platform key, falling back to the generic one. */
  function charLimitFor(platform) {
    var key = String(platform === null || platform === undefined ? '' : platform).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(CHAR_LIMITS, key)) { return CHAR_LIMITS[key]; }
    return CHAR_LIMITS.generic;
  }

  function newId() {
    var t = Date.now().toString(36);
    var r = '';
    for (var i = 0; i < 8; i++) {
      r += Math.floor(Math.random() * 36).toString(36);
    }
    return 'p_' + t + '_' + r;
  }

  // ---- defaults -----------------------------------------------------

  /** Three sensible starter channels; seeded on first run. */
  function defaultAccounts() {
    return [
      {
        id: 'acc_x_default',
        name: 'X / Twitter',
        handle: '@example',
        platform: 'x',
        charLimit: CHAR_LIMITS.x,
        color: '#1d9bf0'
      },
      {
        id: 'acc_mastodon_default',
        name: 'Mastodon',
        handle: '@example@mastodon.social',
        platform: 'mastodon',
        charLimit: CHAR_LIMITS.mastodon,
        color: '#6364ff'
      },
      {
        id: 'acc_instagram_default',
        name: 'Instagram',
        handle: '@example',
        platform: 'instagram',
        charLimit: CHAR_LIMITS.instagram,
        color: '#e1306c'
      }
    ];
  }

  /** A small set of sample posts spread across the current and next week. */
  function samplePosts(accounts) {
    accounts = accounts || defaultAccounts();
    var base = new Date();
    base.setHours(9, 30, 0, 0);
    function at(daysAhead, hour) {
      var d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + daysAhead);
      d.setHours(hour === undefined ? 9 : hour, 30, 0, 0);
      return d;
    }
    var now = new Date();
    return [
      {
        id: newId(),
        body: 'Welcome to OpenPulse — your week is planned in about a minute.',
        accountId: accounts[0].id,
        scheduledAt: PulseDates.toISO(at(1, 9)),
        notes: 'Announcement post for the week.',
        tags: ['launch', 'announcement'],
        status: 'scheduled',
        createdAt: PulseDates.toISO(now)
      },
      {
        id: newId(),
        body: 'Draft: share three things that changed in your workflow this week.',
        accountId: accounts[1].id,
        scheduledAt: PulseDates.toISO(at(3, 11)),
        notes: '',
        tags: ['draft'],
        status: 'draft',
        createdAt: PulseDates.toISO(now)
      },
      {
        id: newId(),
        body: 'Reminder: post the case study at the usual morning slot.',
        accountId: accounts[0].id,
        scheduledAt: PulseDates.toISO(at(5, 16)),
        notes: 'Needs a link.',
        tags: ['case-study'],
        status: 'scheduled',
        createdAt: PulseDates.toISO(now)
      },
      {
        id: newId(),
        body: 'Weekly recap — what shipped and what slipped.',
        accountId: accounts[1].id,
        scheduledAt: PulseDates.toISO(at(6, 17)),
        notes: '',
        tags: ['recap'],
        status: 'draft',
        createdAt: PulseDates.toISO(now)
      },
      {
        id: newId(),
        body: 'Published recap from last week, kept for reference.',
        accountId: accounts[2].id,
        scheduledAt: PulseDates.toISO(at(-3, 10)),
        notes: '',
        tags: ['recap'],
        status: 'published',
        createdAt: PulseDates.toISO(now)
      }
    ];
  }

  function sampleDocument() {
    var accounts = defaultAccounts();
    var posts = samplePosts(accounts);
    return {
      version: SCHEMA_VERSION,
      exportedAt: PulseDates.toISO(new Date()),
      accounts: accounts,
      posts: posts
    };
  }

  // ---- status workflow ----------------------------------------------

  function isStatus(v) {
    return STATUSES.indexOf(v) !== -1;
  }

  /** Is `to` a legal forward/back step from `from`? */
  function canTransition(from, to) {
    if (!isStatus(from) || !isStatus(to)) { return false; }
    if (from === to) { return false; }
    var opts = STATUS_FLOW[from];
    return !!(opts && opts.indexOf(to) !== -1);
  }

  /** The next status in the happy path, or null at the end. */
  function advanceStatus(status) {
    if (status === 'draft') { return 'scheduled'; }
    if (status === 'scheduled') { return 'published'; }
    return null;
  }

  // ---- validation ---------------------------------------------------

  function normalizeAccount(raw, index) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new TypeError('accounts[' + index + ']: not an object');
    }
    var name = raw.name;
    if (!isNonEmptyString(name)) {
      throw new TypeError('accounts[' + index + ']: "name" must be a non-empty string');
    }
    var platform = String(raw.platform === undefined || raw.platform === null ? 'generic' : raw.platform).toLowerCase();
    var color = String(raw.color || '#6d5efc');
    if (!HEX_COLOR.test(color)) {
      throw new TypeError('accounts[' + index + ']: "color" must be a hex color like #6d5efc');
    }
    var charLimit = raw.charLimit;
    if (charLimit === undefined || charLimit === null) { charLimit = charLimitFor(platform); }
    if (typeof charLimit !== 'number' || !isFinite(charLimit) || charLimit < 1) {
      throw new TypeError('accounts[' + index + ']: "charLimit" must be a positive number');
    }
    charLimit = Math.floor(charLimit);

    return {
      id: isNonEmptyString(raw.id) ? raw.id : 'acc_' + (index + 1),
      name: name.trim(),
      handle: typeof raw.handle === 'string' ? raw.handle : '',
      platform: platform,
      charLimit: charLimit,
      color: color
    };
  }

  function normalizePost(raw, index, accountIds) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new TypeError('posts[' + index + ']: not an object');
    }
    var body = raw.body;
    if (!isNonEmptyString(body)) {
      throw new TypeError('posts[' + index + ']: "body" must be a non-empty string');
    }
    if (!isNonEmptyString(raw.accountId)) {
      throw new TypeError('posts[' + index + ']: "accountId" must be a non-empty string');
    }
    if (accountIds && accountIds.indexOf(raw.accountId) === -1) {
      throw new TypeError('posts[' + index + ']: accountId "' + raw.accountId +
                          '" does not match any account');
    }
    var when;
    try {
      when = PulseDates.fromISO(raw.scheduledAt);
    } catch (e) {
      throw new TypeError('posts[' + index + ']: "scheduledAt" is not a valid date: ' + e.message);
    }
    var status = typeof raw.status === 'string' ? raw.status : 'draft';
    if (!isStatus(status)) {
      throw new TypeError('posts[' + index + ']: unknown status "' + raw.status + '"');
    }
    var tags = raw.tags;
    if (tags === undefined || tags === null) { tags = []; }
    if (!Array.isArray(tags)) {
      throw new TypeError('posts[' + index + ']: "tags" must be an array of strings');
    }
    var cleanTags = [];
    for (var i = 0; i < tags.length; i++) {
      if (typeof tags[i] !== 'string') {
        throw new TypeError('posts[' + index + '].tags[' + i + ']: not a string');
      }
      var t = tags[i].trim();
      if (t !== '') { cleanTags.push(t); }
    }

    var createdAt;
    try {
      createdAt = raw.createdAt ? PulseDates.fromISO(raw.createdAt) : when;
    } catch (e) {
      throw new TypeError('posts[' + index + ']: "createdAt" is not a valid date: ' + e.message);
    }

    return {
      id: isNonEmptyString(raw.id) ? raw.id : newId(),
      body: body.trim(),
      accountId: raw.accountId,
      scheduledAt: PulseDates.toISO(when),
      notes: typeof raw.notes === 'string' ? raw.notes : '',
      tags: cleanTags,
      status: status,
      createdAt: PulseDates.toISO(createdAt)
    };
  }

  /**
   * Strictly validate and normalise an in-memory document.
   * Returns a new object; throws TypeError on malformed input.
   */
  function validateDocument(doc) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
      throw new TypeError('document: not an object');
    }
    var version = doc.version;
    if (typeof version !== 'number' || !isFinite(version)) {
      throw new TypeError('document: "version" must be a number');
    }
    if (version > SCHEMA_VERSION) {
      throw new TypeError('document: version ' + version +
                          ' is newer than this app understands (' + SCHEMA_VERSION + ')');
    }
    if (!Array.isArray(doc.accounts)) {
      throw new TypeError('document: "accounts" must be an array');
    }
    if (!Array.isArray(doc.posts)) {
      throw new TypeError('document: "posts" must be an array');
    }
    var accounts = [];
    for (var i = 0; i < doc.accounts.length; i++) {
      accounts.push(normalizeAccount(doc.accounts[i], i));
    }
    var ids = accounts.map(function (a) { return a.id; });
    var seen = {};
    for (var k = 0; k < ids.length; k++) {
      if (seen[ids[k]]) { throw new TypeError('duplicate account id "' + ids[k] + '"'); }
      seen[ids[k]] = true;
    }
    var posts = [];
    for (var j = 0; j < doc.posts.length; j++) {
      posts.push(normalizePost(doc.posts[j], j, ids));
    }
    var seenPost = {};
    for (var m = 0; m < posts.length; m++) {
      if (seenPost[posts[m].id]) {
        throw new TypeError('duplicate post id "' + posts[m].id + '"');
      }
      seenPost[posts[m].id] = true;
    }
    return {
      version: SCHEMA_VERSION,
      exportedAt: typeof doc.exportedAt === 'string' ? doc.exportedAt : PulseDates.toISO(new Date()),
      accounts: accounts,
      posts: posts
    };
  }

  /** Serialise a document to pretty JSON text. */
  function serializePosts(doc) {
    var clean = validateDocument(doc);
    clean.exportedAt = PulseDates.toISO(new Date());
    return JSON.stringify(clean, null, 2);
  }

  /** Parse JSON text back into a validated document. Throws on bad input. */
  function deserializePosts(text) {
    if (typeof text !== 'string' || text.trim() === '') {
      throw new TypeError('deserializePosts: expected JSON text');
    }
    var doc;
    try {
      doc = JSON.parse(text);
    } catch (e) {
      throw new TypeError('deserializePosts: invalid JSON — ' + e.message);
    }
    return validateDocument(doc);
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    STATUSES: STATUSES,
    STATUS_FLOW: STATUS_FLOW,
    CHAR_LIMITS: CHAR_LIMITS,
    isStatus: isStatus,
    canTransition: canTransition,
    advanceStatus: advanceStatus,
    charLimitFor: charLimitFor,
    newId: newId,
    defaultAccounts: defaultAccounts,
    samplePosts: samplePosts,
    sampleDocument: sampleDocument,
    normalizeAccount: normalizeAccount,
    normalizePost: normalizePost,
    validateDocument: validateDocument,
    serializePosts: serializePosts,
    deserializePosts: deserializePosts
  };
});
