/* ------------------------------------------------------------------ *
 * OpenPulse — UI layer
 *
 * This is the only file that touches the DOM. Everything testable
 * (dates, CSV, serialisation, cadence, storage) lives in the pure
 * modules beside it, so this file is deliberately thin: it reads
 * input, calls a pure function, and paints the result.
 *
 * One global click listener with data-action attributes keeps the
 * rebinding surface small, and re-rendering never has to detach
 * handlers.
 * ------------------------------------------------------------------ */
(function () {
  'use strict';

  var D = window.PulseDates;
  var C = window.PulseCSV;
  var S = window.PulseSerializers;
  var SC = window.PulseSchedule;
  var ST = window.PulseStore;

  var DOC_KEY = 'document';
  var WEEKS_FOR_STATS = 8;
  var PLATFORMS = ['x', 'mastodon', 'bluesky', 'instagram', 'linkedin',
                   'facebook', 'threads', 'reddit', 'generic'];

  var store = ST.createStore();

  var state = {
    doc: null,
    view: 'calendar',
    cal: null,          // { year, month } — cursor of the calendar view
    selectedDay: null,  // Date, or null
    q: { account: 'all', status: 'all', text: '', dir: 'asc' },
    editingId: null
  };

  var inited = false;

  // ---- tiny helpers -------------------------------------------------

  function $(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function truncate(value, n) {
    var s = String(value || '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  /** Local ISO clock (seconds precision) — what the app persists. */
  function toLocalInput(date) {
    return D.toISODate(date) + 'T' + D.pad(date.getHours()) + ':' + D.pad(date.getMinutes());
  }

  /** A sensible default slot: the next whole hour. */
  function defaultWhen() {
    var d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return toLocalInput(d);
  }

  function findPost(id) {
    for (var i = 0; i < state.doc.posts.length; i++) {
      if (state.doc.posts[i].id === id) { return state.doc.posts[i]; }
    }
    return null;
  }

  function findAccount(id) {
    for (var i = 0; i < state.doc.accounts.length; i++) {
      if (state.doc.accounts[i].id === id) { return state.doc.accounts[i]; }
    }
    return null;
  }

  function postsForAccount(accountId) {
    return state.doc.posts.filter(function (p) { return p.accountId === accountId; });
  }

  // ---- persistence --------------------------------------------------

  function persist() {
    store.set(DOC_KEY, state.doc);
    renderStatusbar();
  }

  function load() {
    if (!store.has(DOC_KEY)) {
      // First run: nothing stored yet, so seed the sample data.
      state.doc = S.sampleDocument();
      persist();
      return;
    }

    var raw = store.get(DOC_KEY);
    if (raw === null) {
      // The key exists but its JSON is unreadable. Recover, and say so —
      // otherwise the user would silently be looking at sample data.
      state.doc = S.sampleDocument();
      persist();
      toast('Saved data in this browser was unreadable, so the sample data was loaded instead.', true);
      return;
    }

    try {
      state.doc = S.validateDocument(raw);
    } catch (e) {
      state.doc = S.sampleDocument();
      persist();
      toast('Saved data was out of date or malformed (' + e.message + '), so the sample data was loaded instead.', true);
    }
  }

  // ---- toasts -------------------------------------------------------

  function toast(message, warn, action, onAction) {
    var root = $('toast-root');
    var div = document.createElement('div');
    div.className = 'toast' + (warn ? ' toast--warn' : '');

    var span = document.createElement('span');
    span.className = 'toast__msg';
    span.textContent = message;
    div.appendChild(span);

    if (action) {
      var btn = document.createElement('button');
      btn.className = 'toast__action';
      btn.setAttribute('data-action', 'toast-action');
      btn.textContent = action;
      div.appendChild(btn);
    }

    root.appendChild(div);

    var kill = function () {
      if (div.parentNode) { div.parentNode.removeChild(div); }
    };

    div.addEventListener('click', function (ev) {
      if (ev.target.getAttribute && ev.target.getAttribute('data-action') === 'toast-action') {
        kill();
        if (typeof onAction === 'function') { onAction(); }
      }
    });

    setTimeout(kill, warn ? 6500 : 4200);
  }

  // ---- downloads ----------------------------------------------------

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  function exportJSON() {
    download('openpulse-' + D.toISODate(new Date()) + '.json',
             S.serializePosts(state.doc), 'application/json');
    toast('Exported ' + state.doc.posts.length + ' post(s) and '
          + state.doc.accounts.length + ' channel(s) as JSON.');
  }

  function exportCSV() {
    var byId = {};
    state.doc.accounts.forEach(function (a) { byId[a.id] = a; });
    var rows = SC.sortedByDate(state.doc.posts).map(function (item) {
      var p = item.post;
      var a = byId[p.accountId] || {};
      return {
        id: p.id,
        date: D.toISODate(item.when),
        time: D.formatTime(item.when),
        channel: a.name || '',
        platform: a.platform || '',
        handle: a.handle || '',
        status: p.status,
        chars: SC.lengthOf(p.body),
        limit: a.charLimit === undefined ? '' : a.charLimit,
        tags: p.tags.join('; '),
        body: p.body,
        notes: p.notes || ''
      };
    });
    download('openpulse-' + D.toISODate(new Date()) + '.csv',
             C.toCSV(rows, ['id', 'date', 'time', 'channel', 'platform', 'handle',
                            'status', 'chars', 'limit', 'tags', 'body', 'notes']),
             'text/csv;charset=utf-8');
    toast('Exported ' + rows.length + ' post(s) as CSV.');
  }

  function importJSON(text) {
    try {
      state.doc = S.deserializePosts(text);
      state.editingId = null;
      state.selectedDay = null;
      persist();
      loadComposer(null);
      renderAll();
      toast('Imported ' + state.doc.posts.length + ' post(s) and '
            + state.doc.accounts.length + ' channel(s).');
    } catch (e) {
      toast('Import failed: ' + e.message, true);
    }
  }

  function resetAll() {
    var n = state.doc.posts.length;
    if (!window.confirm('Replace everything with the sample data?\n'
          + n + ' post(s) will be discarded. Export first if you want a copy.')) {
      return;
    }
    state.doc = S.sampleDocument();
    state.editingId = null;
    state.selectedDay = null;
    state.cal = null;
    persist();
    loadComposer(null);
    setView('calendar');
    renderAll();
    toast('Reset to sample data.');
  }

  // ---- composer -----------------------------------------------------

  function currentAccount() {
    var id = $('f-account').value;
    return findAccount(id) || state.doc.accounts[0] || null;
  }

  function updateCounter() {
    var acc = currentAccount();
    var n = SC.lengthOf($('f-body').value);
    var node = $('f-count');
    if (!acc) {
      node.textContent = n + ' character' + (n === 1 ? '' : 's');
      node.classList.remove('is-over');
      return;
    }
    var over = n - acc.charLimit;
    node.textContent = n + ' / ' + acc.charLimit
      + '  ·  ' + (over > 0 ? over + ' over' : (-over) + ' left');
    node.classList.toggle('is-over', over > 0);
  }

  function renderComposerAccountSelect() {
    var sel = $('f-account');
    var keep = sel.value;
    sel.innerHTML = state.doc.accounts.map(function (a) {
      return '<option value="' + esc(a.id) + '">'
        + esc(a.name) + (a.handle ? ' — ' + esc(a.handle) : '')
        + ' · ' + a.charLimit + '</option>';
    }).join('');
    if (keep && findAccount(keep)) { sel.value = keep; }
    updateCounter();
  }

  function loadComposer(post) {
    state.editingId = post ? post.id : null;
    $('composer-title').textContent = post ? 'Edit post' : 'New post';
    $('btn-save').textContent = post ? 'Update post' : 'Save post';

    if (post) {
      $('f-account').value = post.accountId;
      $('f-body').value = post.body;
      try { $('f-when').value = toLocalInput(D.fromISO(post.scheduledAt)); } catch (e) { $('f-when').value = defaultWhen(); }
      $('f-notes').value = post.notes || '';
      $('f-tags').value = (post.tags || []).join(', ');
    } else {
      $('f-body').value = '';
      $('f-when').value = defaultWhen();
      $('f-notes').value = '';
      $('f-tags').value = '';
      if (state.doc.accounts.length) { $('f-account').value = state.doc.accounts[0].id; }
    }
    updateCounter();
    $('f-body').focus();
  }

  function resetComposer() {
    loadComposer(null);
  }

  function savePost() {
    var body = $('f-body').value.trim();
    if (!body) { toast('Write something first.', true); return; }

    var acc = currentAccount();
    if (!acc) { toast('Add a channel before saving.', true); return; }

    var when;
    try {
      when = D.fromISO($('f-when').value);
    } catch (e) {
      toast('That date does not look right.', true);
      return;
    }

    var tags = $('f-tags').value.split(',')
      .map(function (t) { return t.trim(); })
      .filter(Boolean);
    var notes = $('f-notes').value;
    var over = SC.lengthOf(body) - acc.charLimit;

    var post = findPost(state.editingId);
    var wasEditing = !!post;
    if (post) {
      post.body = body;
      post.accountId = acc.id;
      post.scheduledAt = D.toISO(when);
      post.notes = notes;
      post.tags = tags;
    } else {
      state.doc.posts.push({
        id: S.newId(),
        body: body,
        accountId: acc.id,
        scheduledAt: D.toISO(when),
        notes: notes,
        tags: tags,
        status: 'draft',
        createdAt: D.toISO(new Date())
      });
    }

    persist();
    resetComposer();
    setView('queue');
    renderAll();
    toast((wasEditing ? 'Post updated.' : 'Saved as a draft to ' + acc.name + '.')
          + (over > 0 ? ' It is ' + over + ' character(s) over the ' + acc.charLimit + ' limit.' : ''));
  }

  // ---- post actions -------------------------------------------------

  function transitionPost(id, target) {
    var p = findPost(id);
    if (!p) { return; }
    if (!S.canTransition(p.status, target)) {
      toast('Cannot move ' + p.status + ' → ' + target + '.', true);
      return;
    }
    p.status = target;
    persist();
    renderAll();
    toast(truncate(p.body, 42) + ' → ' + target + '.');
  }

  function deletePost(id) {
    var idx = -1;
    for (var i = 0; i < state.doc.posts.length; i++) {
      if (state.doc.posts[i].id === id) { idx = i; break; }
    }
    if (idx === -1) { return; }

    var removed = state.doc.posts.splice(idx, 1)[0];
    if (state.editingId === id) { resetComposer(); }
    persist();
    renderAll();

    toast('Deleted "' + truncate(removed.body, 44) + '"', false, 'Undo', function () {
      state.doc.posts.splice(Math.min(idx, state.doc.posts.length), 0, removed);
      persist();
      renderAll();
      toast('Restored.');
    });
  }

  // ---- channels -----------------------------------------------------

  function platformOptions() {
    return PLATFORMS.map(function (p) {
      return '<option value="' + esc(p) + '">' + esc(p)
        + ' · ' + S.charLimitFor(p) + ' chars</option>';
    }).join('');
  }

  function openAccounts() {
    var html = '<div class="modal-backdrop" data-action="modal-close">';
    html += '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">'
          + '<header class="modal__head"><h2 id="modal-title">Channels</h2>'
          + '<button class="btn btn--ghost btn--sm" data-action="modal-close">Close ✕</button></header>';
    html += '<p class="hint">Each channel carries its own character budget and colour. '
          + 'The budget follows the platform preset and can be overridden.</p>';
    html += '<ul class="modal-list">';
    state.doc.accounts.forEach(function (a) {
      var n = postsForAccount(a.id).length;
      html += '<li class="modal-item"><span class="swatch" style="background:' + esc(a.color) + '"></span>'
            + '<span class="modal-item__main"><strong>' + esc(a.name) + '</strong>'
            + '<em>' + esc(a.handle || 'no handle') + ' · ' + esc(a.platform)
            + ' · ' + a.charLimit + ' chars · ' + n + ' post' + (n === 1 ? '' : 's') + '</em></span>'
            + '<button class="btn btn--ghost btn--sm btn--danger" data-action="account-delete" '
            + 'data-account="' + esc(a.id) + '">Remove</button></li>';
    });
    html += '</ul>';
    html += '<form class="modal-form" data-role="account-form">'
          + '<h3>Add a channel</h3>'
          + '<div class="field-row">'
          + '<label class="field"><span class="field__label">Name</span>'
          + '<input id="m-name" type="text" required placeholder="X / Twitter"></label>'
          + '<label class="field"><span class="field__label">Handle</span>'
          + '<input id="m-handle" type="text" placeholder="@you"></label></div>'
          + '<div class="field-row">'
          + '<label class="field"><span class="field__label">Platform</span>'
          + '<select id="m-platform" data-role="m-platform">' + platformOptions() + '</select></label>'
          + '<label class="field"><span class="field__label">Char limit</span>'
          + '<input id="m-limit" type="number" min="1" step="1"></label>'
          + '<label class="field"><span class="field__label">Colour</span>'
          + '<input id="m-color" type="color" value="#6d5efc"></label></div>'
          + '<button type="submit" class="btn btn--primary">Add channel</button>'
          + '</form></div></div>';
    $('modal-root').innerHTML = html;
    $('m-limit').value = S.charLimitFor($('m-platform').value);
    $('m-name').focus();
  }

  function closeModal() {
    $('modal-root').innerHTML = '';
  }

  function addAccount() {
    var name = $('m-name').value.trim();
    if (!name) { toast('Give the channel a name.', true); return; }
    var platform = $('m-platform').value;
    var limit = parseInt($('m-limit').value, 10);
    try {
      var acc = S.normalizeAccount({
        name: name,
        handle: $('m-handle').value.trim(),
        platform: platform,
        charLimit: isFinite(limit) && limit > 0 ? limit : undefined,
        color: $('m-color').value
      }, state.doc.accounts.length);
      acc.id = S.newId();
      state.doc.accounts.push(acc);
      persist();
      renderComposerAccountSelect();
      renderAll();
      closeModal();
      toast('Added ' + acc.name + ' (' + acc.charLimit + ' chars).');
    } catch (e) {
      toast(e.message, true);
    }
  }

  function deleteAccount(id) {
    var acc = findAccount(id);
    if (!acc) { return; }
    if (state.doc.accounts.length <= 1) {
      toast('Keep at least one channel.', true);
      return;
    }
    var orphans = postsForAccount(id).length;
    var msg = 'Remove ' + acc.name + '?';
    if (orphans) {
      msg += '\nIts ' + orphans + ' post' + (orphans === 1 ? '' : 's') + ' will be deleted too.';
    }
    if (!window.confirm(msg)) { return; }
    state.doc.accounts = state.doc.accounts.filter(function (a) { return a.id !== id; });
    state.doc.posts = state.doc.posts.filter(function (p) { return p.accountId !== id; });
    if (state.editingId) { resetComposer(); }
    persist();
    renderComposerAccountSelect();
    renderAll();
    closeModal();
    toast('Removed ' + acc.name + '.');
  }

  // ---- views --------------------------------------------------------

  function setView(view) {
    state.view = view;
    ['calendar', 'queue', 'stats'].forEach(function (name) {
      var node = $('view-' + name);
      node.hidden = name !== view;
      var btn = document.querySelector('.view-btn[data-view="' + name + '"]');
      if (btn) {
        btn.classList.toggle('is-active', name === view);
        btn.setAttribute('aria-selected', name === view ? 'true' : 'false');
      }
    });
    if (view === 'calendar') { renderCalendar(); }
    else if (view === 'queue') { renderQueue(); }
    else { renderStats(); }
  }

  function postsByDay() {
    var map = {};
    SC.sortedByDate(state.doc.posts).forEach(function (item) {
      var key = D.toISODate(item.when);
      if (!map[key]) { map[key] = []; }
      map[key].push(item.post);
    });
    return map;
  }

  function totalForMonth(cal) {
    var n = 0;
    state.doc.posts.forEach(function (p) {
      try { if (D.isSameMonth(D.fromISO(p.scheduledAt), cal.year, cal.month)) { n++; } }
      catch (e) { /* skip malformed */ }
    });
    return n;
  }

  function renderPostList(posts) {
    if (!posts.length) {
      return '<p class="empty">Nothing here yet — save a post from the composer.</p>';
    }
    var html = '<ul class="post-list">';
    posts.forEach(function (p) {
      var acc = findAccount(p.accountId) || { name: '—', color: '#6d5efc', charLimit: 0 };
      var when;
      try { when = D.fromISO(p.scheduledAt); } catch (e) { when = new Date(); }
      var over = SC.overflowFor(p, state.doc.accounts);
      var next = S.advanceStatus(p.status);

      html += '<li class="post" style="--accent:' + esc(acc.color) + '">';
      html += '<div class="post__meta">';
      html += '<span class="post__when">' + esc(D.formatDateTime(when)) + '</span>';
      html += '<span class="post__account">' + esc(acc.name)
            + (acc.handle ? ' <em>' + esc(acc.handle) + '</em>' : '') + '</span>';
      html += '<span class="pill pill--' + esc(p.status) + '">' + esc(p.status) + '</span>';
      if (over > 0) { html += '<span class="pill pill--over">' + over + ' over</span>'; }
      html += '</div>';

      html += '<p class="post__body">' + esc(p.body) + '</p>';
      if (p.notes) { html += '<p class="post__notes">' + esc(p.notes) + '</p>'; }
      if (p.tags && p.tags.length) {
        html += '<p class="post__tags">' + p.tags.map(function (t) {
          return '<span class="tag">#' + esc(t) + '</span>';
        }).join('') + '</p>';
      }

      html += '<div class="post__actions">';
      html += '<button class="btn btn--ghost btn--sm" data-action="edit-post" '
            + 'data-post="' + esc(p.id) + '">Edit</button>';
      if (next) {
        html += '<button class="btn btn--primary btn--sm" data-action="transition-post" '
              + 'data-post="' + esc(p.id) + '" data-to="' + esc(next) + '">→ ' + esc(next) + '</button>';
      }
      if (p.status === 'scheduled') {
        html += '<button class="btn btn--ghost btn--sm" data-action="transition-post" '
              + 'data-post="' + esc(p.id) + '" data-to="draft">Unschedule</button>';
      }
      if (p.status === 'published') {
        html += '<button class="btn btn--ghost btn--sm" data-action="transition-post" '
              + 'data-post="' + esc(p.id) + '" data-to="scheduled">Revert</button>';
      }
      html += '<button class="btn btn--ghost btn--sm btn--danger" data-action="delete-post" '
            + 'data-post="' + esc(p.id) + '">Delete</button>';
      html += '</div></li>';
    });
    html += '</ul>';
    return html;
  }

  function renderCalendar() {
    if (!state.cal) {
      var now = new Date();
      state.cal = { year: now.getFullYear(), month: now.getMonth() };
    }
    var cal = state.cal;
    var grid = D.buildMonthGrid(cal.year, cal.month);
    var byDay = postsByDay();

    var html = '<header class="cal-head">'
      + '<div class="cal-nav">'
      + '<button class="btn btn--icon" data-action="cal-prev" aria-label="Previous month">‹</button>'
      + '<h2 class="cal-title">' + esc(D.monthLabel(cal.year, cal.month)) + '</h2>'
      + '<button class="btn btn--icon" data-action="cal-next" aria-label="Next month">›</button>'
      + '</div>'
      + '<button class="btn btn--ghost btn--sm" data-action="cal-today">Today</button>'
      + '<span class="cal-count">' + totalForMonth(cal) + ' post'
      + (totalForMonth(cal) === 1 ? '' : 's') + ' this month</span>'
      + '</header>';

    html += '<div class="cal-grid">';
    D.DOW.forEach(function (d) { html += '<div class="cal-dow">' + esc(d) + '</div>'; });
    grid.forEach(function (row) {
      row.forEach(function (day) {
        var iso = D.toISODate(day);
        var inMonth = D.isSameMonth(day, cal.year, cal.month);
        var isToday = D.isSameDay(day, new Date());
        var selected = !!state.selectedDay && D.isSameDay(day, state.selectedDay);
        var cls = 'day' + (inMonth ? '' : ' is-outside')
                + (isToday ? ' is-today' : '') + (selected ? ' is-selected' : '');
        var dayPosts = byDay[iso] || [];

        html += '<div class="' + cls + '" data-action="day" data-day="' + esc(iso)
              + '" tabindex="0" role="button" aria-label="'
              + esc(D.formatLong(day)) + ', ' + dayPosts.length + ' post'
              + (dayPosts.length === 1 ? '' : 's') + '">';
        html += '<span class="day__num">' + day.getDate() + '</span>';
        if (dayPosts.length) {
          html += '<ul class="day__posts">';
          dayPosts.slice(0, 3).forEach(function (p) {
            var acc = findAccount(p.accountId) || { color: '#6d5efc' };
            var when;
            try { when = D.fromISO(p.scheduledAt); } catch (e) { when = new Date(); }
            html += '<li class="chip" data-action="edit-post" data-post="' + esc(p.id)
                  + '" style="--accent:' + esc(acc.color) + '" title="' + esc(p.body) + '">'
                  + '<span class="chip__time">' + esc(D.formatTime(when)) + '</span>'
                  + '<span class="chip__body">' + esc(truncate(p.body, 32)) + '</span>'
                  + '</li>';
          });
          if (dayPosts.length > 3) {
            html += '<li class="day__more">+' + (dayPosts.length - 3) + ' more</li>';
          }
          html += '</ul>';
        }
        html += '</div>';
      });
    });
    html += '</div>';

    if (state.selectedDay) {
      var sel = byDay[D.toISODate(state.selectedDay)] || [];
      html += '<section class="card day-panel"><header class="card__head">'
            + '<h2>' + esc(D.formatLong(state.selectedDay)) + ' · ' + sel.length
            + ' post' + (sel.length === 1 ? '' : 's') + '</h2>'
            + '<button class="btn btn--ghost btn--sm" data-action="day-clear">Clear</button>'
            + '</header>' + renderPostList(sel) + '</section>';
    }

    $('view-calendar').innerHTML = html;
  }

  function renderQueue() {
    var f = state.q;
    var html = '<header class="queue-head">'
      + '<div class="filters">'
      + '<label class="field field--sm"><span class="field__label">Channel</span>'
      + '<select data-role="q-account"><option value="all"' + (f.account === 'all' ? ' selected' : '')
      + '>All channels</option>'
      + state.doc.accounts.map(function (a) {
        return '<option value="' + esc(a.id) + '"' + (f.account === a.id ? ' selected' : '')
          + '>' + esc(a.name) + '</option>';
      }).join('')
      + '</select></label>'
      + '<label class="field field--sm"><span class="field__label">Status</span>'
      + '<select data-role="q-status"><option value="all"' + (f.status === 'all' ? ' selected' : '')
      + '>All statuses</option>'
      + S.STATUSES.map(function (s) {
        return '<option value="' + esc(s) + '"' + (f.status === s ? ' selected' : '')
          + '>' + esc(s) + '</option>';
      }).join('')
      + '</select></label>'
      + '<label class="field field--sm field--grow"><span class="field__label">Search</span>'
      + '<input data-role="q-text" type="search" placeholder="body, note or tag" '
      + 'value="' + esc(f.text) + '"></label>'
      + '</div>'
      + '<div class="queue-head__right">'
      + '<button class="btn btn--ghost btn--sm" data-action="sort-toggle">Sort: '
      + (f.dir === 'asc' ? 'earliest first' : 'latest first') + '</button>'
      + '</div></header>';
    html += '<div id="queue-results"></div>';
    $('view-queue').innerHTML = html;
    renderQueueResults();
  }

  function filterPosts() {
    var f = state.q;
    var q = f.text.trim().toLowerCase();
    var list = SC.sortedByDate(state.doc.posts).map(function (i) { return i.post; });
    if (f.account !== 'all') {
      list = list.filter(function (p) { return p.accountId === f.account; });
    }
    if (f.status !== 'all') {
      list = list.filter(function (p) { return p.status === f.status; });
    }
    if (q) {
      list = list.filter(function (p) {
        return p.body.toLowerCase().indexOf(q) !== -1
            || (p.notes || '').toLowerCase().indexOf(q) !== -1
            || (p.tags || []).join(' ').toLowerCase().indexOf(q) !== -1;
      });
    }
    if (f.dir === 'desc') { list.reverse(); }
    return list;
  }

  function renderQueueResults() {
    var node = $('queue-results');
    if (!node) { return; }
    var list = filterPosts();
    node.innerHTML = '<p class="queue-count">' + list.length + ' of '
      + state.doc.posts.length + ' post(s)</p>' + renderPostList(list);
  }

  function renderStats() {
    var stats = SC.cadenceStats(state.doc.posts, state.doc.accounts, WEEKS_FOR_STATS);

    function card(label, value, accent) {
      return '<div class="stat-card' + (accent ? ' stat-card--accent' : '') + '">'
        + '<span class="stat-card__n">' + value + '</span>'
        + '<span class="stat-card__l">' + esc(label) + '</span></div>';
    }

    var html = '<div class="stat-cards">'
      + card('Total posts', stats.total, true)
      + card('Drafts', stats.byStatus.draft)
      + card('Scheduled', stats.byStatus.scheduled)
      + card('Published', stats.byStatus.published)
      + card('Channels', state.doc.accounts.length)
      + card('Avg / week', stats.avgPerWeek.toFixed(1))
      + '</div>';

    html += '<section class="card"><header class="card__head">'
      + '<h2>Posts per week — last ' + WEEKS_FOR_STATS + ' weeks</h2>'
      + (stats.busiestWeek
        ? '<span class="hint">busiest: ' + esc(stats.busiestWeek.label) + ' · '
          + stats.busiestWeek.count + '</span>'
        : '<span class="hint">no posts in this window</span>')
      + '</header><div class="bars">';
    var max = 0;
    stats.buckets.forEach(function (b) { if (b.count > max) { max = b.count; } });
    stats.buckets.forEach(function (b) {
      var pct = max ? Math.max(b.count > 0 ? 7 : 3, (b.count / max) * 100) : 3;
      html += '<div class="bar" title="' + esc(b.label) + ': ' + b.count
            + ' post' + (b.count === 1 ? '' : 's') + '">'
            + '<span class="bar__n">' + b.count + '</span>'
            + '<div class="bar__track"><div class="bar__fill" style="height:'
            + pct.toFixed(1) + '%"></div></div>'
            + '<span class="bar__l">' + esc(b.label) + '</span>'
            + '</div>';
    });
    html += '</div></section>';

    html += '<section class="card"><header class="card__head"><h2>By channel</h2>'
      + '<span class="hint">' + stats.total + ' post(s) in total</span></header>'
      + '<div class="acccount-bars">';
    var maxAcc = 0;
    stats.byAccount.forEach(function (a) { if (a.count > maxAcc) { maxAcc = a.count; } });
    stats.byAccount.forEach(function (a) {
      var pct = maxAcc ? (a.count / maxAcc) * 100 : 0;
      html += '<div class="acc-bar">'
            + '<span class="acc-bar__name"><i style="background:' + esc(a.color) + '"></i>'
            + esc(a.name) + '</span>'
            + '<span class="acc-bar__track"><span class="acc-bar__fill" style="width:'
            + pct.toFixed(1) + '%;background:' + esc(a.color) + '"></span></span>'
            + '<span class="acc-bar__n">' + a.count + '</span></div>';
    });
    html += '</div></section>';

    $('view-stats').innerHTML = html;
  }

  function renderAccountSummary() {
    $('account-summary').innerHTML = state.doc.accounts.map(function (a) {
      var n = postsForAccount(a.id).length;
      return '<li><span class="swatch" style="background:' + esc(a.color) + '"></span>'
        + '<span class="acct__name">' + esc(a.name) + '</span>'
        + '<span class="acct__meta">' + a.charLimit + ' · ' + n + '</span></li>';
    }).join('');
  }

  function renderNextSlot() {
    var r = SC.nextSlot(state.doc.posts, new Date(), 'scheduled');
    var node = $('next-slot');
    if (!r) {
      node.innerHTML = '<p class="empty">Nothing scheduled yet. Save a post, then mark it '
        + '<em>scheduled</em>.</p>';
      return;
    }
    var p = r.post;
    var acc = findAccount(p.accountId) || { name: '—', color: '#6d5efc' };
    node.innerHTML = '<button class="nextslot" data-action="edit-post" data-post="'
      + esc(p.id) + '" style="--accent:' + esc(acc.color) + '" title="Edit this post">'
      + '<span class="nextslot__when">' + esc(D.formatDateTime(r.when)) + '</span>'
      + '<span class="nextslot__body">' + esc(truncate(p.body, 64)) + '</span>'
      + '<span class="nextslot__acc">' + esc(acc.name) + '</span></button>';
  }

  function renderStatusbar() {
    var live = store.backend() === 'localStorage';
    $('status-storage').textContent = live
      ? 'Saved in this browser (localStorage)'
      : 'Session-only memory — storage is blocked, so export regularly';
    $('status-counts').textContent = state.doc.posts.length + ' post(s) · '
      + state.doc.accounts.length + ' channel(s) · schema v' + S.SCHEMA_VERSION;
  }

  function renderAll() {
    renderAccountSummary();
    renderNextSlot();
    if (state.view === 'calendar') { renderCalendar(); }
    else if (state.view === 'queue') { renderQueue(); }
    else { renderStats(); }
    renderStatusbar();
  }

  // ---- calendar navigation -------------------------------------------

  function stepMonth(n) {
    if (!state.cal) {
      var now = new Date();
      state.cal = { year: now.getFullYear(), month: now.getMonth() };
    }
    var r = D.addMonths(state.cal.year, state.cal.month, n);
    state.cal = { year: r.year, month: r.month };
    state.selectedDay = null;
    renderCalendar();
  }

  function selectDay(iso) {
    try { state.selectedDay = D.fromISO(iso); } catch (e) { return; }
    renderCalendar();
  }

  // ---- events -------------------------------------------------------

  function onAction(t) {
    switch (t.getAttribute('data-action')) {
      case 'view':
        setView(t.getAttribute('data-view'));
        break;
      case 'day':
        selectDay(t.getAttribute('data-day'));
        break;
      case 'day-clear':
        state.selectedDay = null;
        renderCalendar();
        break;
      case 'edit-post':
        loadComposer(findPost(t.getAttribute('data-post')));
        break;
      case 'transition-post':
        transitionPost(t.getAttribute('data-post'), t.getAttribute('data-to'));
        break;
      case 'delete-post':
        deletePost(t.getAttribute('data-post'));
        break;
      case 'sort-toggle':
        state.q.dir = state.q.dir === 'asc' ? 'desc' : 'asc';
        renderQueue();
        break;
      case 'cal-prev':
        stepMonth(-1);
        break;
      case 'cal-next':
        stepMonth(1);
        break;
      case 'cal-today':
        {
          var now = new Date();
          state.cal = { year: now.getFullYear(), month: now.getMonth() };
          state.selectedDay = null;
          renderCalendar();
        }
        break;
      case 'accounts':
        openAccounts();
        break;
      case 'modal-close':
        closeModal();
        break;
      case 'account-delete':
        deleteAccount(t.getAttribute('data-account'));
        break;
      case 'btn-save':
        savePost();
        break;
      case 'btn-clear':
        resetComposer();
        break;
      case 'btn-export-json':
        exportJSON();
        break;
      case 'btn-export-csv':
        exportCSV();
        break;
      case 'btn-import':
        $('file-import').click();
        break;
      case 'btn-reset':
        resetAll();
        break;
    }
  }

  // ---- wiring -------------------------------------------------------

  function wire() {
    document.addEventListener('click', function (ev) {
      var t = ev.target.closest ? ev.target.closest('[data-action]') : null;
      if (!t) { return; }
      onAction(t);
    });

    document.addEventListener('change', function (ev) {
      var role = ev.target.getAttribute && ev.target.getAttribute('data-role');
      if (role === 'q-account') {
        state.q.account = ev.target.value;
        renderQueueResults();
      } else if (role === 'q-status') {
        state.q.status = ev.target.value;
        renderQueueResults();
      } else if (role === 'm-platform') {
        $('m-limit').value = S.charLimitFor(ev.target.value);
      }
    });

    document.addEventListener('input', function (ev) {
      var t = ev.target;
      if (t.id === 'f-body' || t.id === 'f-account') {
        updateCounter();
        return;
      }
      if (t.getAttribute && t.getAttribute('data-role') === 'q-text') {
        state.q.text = t.value;
        renderQueueResults();
      }
    });

    document.addEventListener('submit', function (ev) {
      if (ev.target.getAttribute && ev.target.getAttribute('data-role') === 'account-form') {
        ev.preventDefault();
        addAccount();
      }
    });

    $('file-import').addEventListener('change', function (ev) {
      var file = ev.target.files && ev.target.files[0];
      if (!file) { return; }
      var reader = new FileReader();
      reader.onload = function () { importJSON(String(reader.result)); };
      reader.onerror = function () { toast('Could not read that file.', true); };
      reader.readAsText(file);
      ev.target.value = '';
    });

    // Keyboard: ⌘/Ctrl+Enter saves, Esc closes the modal or clears the composer.
    document.addEventListener('keydown', function (ev) {
      var modalOpen = !!$('modal-root').firstChild;

      if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter' && !modalOpen) {
        ev.preventDefault();
        savePost();
        return;
      }

      if (ev.key === 'Escape') {
        if (modalOpen) {
          closeModal();
          return;
        }
        var el = document.activeElement;
        var ids = ['f-body', 'f-tags', 'f-notes', 'f-account', 'f-when'];
        for (var i = 0; i < ids.length; i++) {
          if (el === $(ids[i])) {
            resetComposer();
            return;
          }
        }
        if (state.selectedDay) {
          state.selectedDay = null;
          renderCalendar();
        }
      }
    });

    // Delegated activation for keyboard-focusable day cells.
    document.addEventListener('keydown', function (ev) {
      var t = ev.target.closest ? ev.target.closest('.day[data-action="day"]') : null;
      if (t && (ev.key === 'Enter' || ev.key === ' ')) {
        ev.preventDefault();
        selectDay(t.getAttribute('data-day'));
      }
    });
  }

  // ---- boot ---------------------------------------------------------

  function boot() {
    if (inited) { return; }
    inited = true;
    load();
    renderComposerAccountSelect();
    loadComposer(null);
    wire();
    setView('calendar');
    renderAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
