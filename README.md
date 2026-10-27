<p align="center">
  <img src="./icon.svg" alt="OpenPulse" width="120" height="120" />
</p>

<h1 align="center">OpenPulse</h1>

<p align="center">
  <strong>Open-source social media content calendar and publishing planner.</strong>
</p>

<p align="center">
  The expensive part of a scheduling tool is the dashboard — which is why
  every one charges per seat. OpenPulse is the dashboard: a real month
  calendar, a post composer with per-channel character budgets, a filterable
  queue, a cadence report, and JSON/CSV in and out. It runs entirely in your
  browser. No account, no install, no build step, no server, no telemetry.
  Your plan never leaves your machine.
</p>

<p align="center">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-4c9aff" />
  <img alt="dependencies" src="https://img.shields.io/badge/dependencies-0-orange" />
  <img alt="build" src="https://img.shields.io/badge/build-step%20none-3c873a" />
  <img alt="runtime" src="https://img.shields.io/badge/runtime-any%20modern%20browser-8a6dff" />
  <img alt="storage" src="https://img.shields.io/badge/storage-localStorage-a0a0a0" />
  <img alt="version" src="https://img.shields.io/badge/version-1.0.0-6d5efc" />
  <a href="https://github.com/0xshaikh/OpenPulse/actions">
    <img alt="ci" src="https://github.com/0xshaikh/OpenPulse/workflows/CI/badge.svg" />
  </a>
</p>

---

## What it is

OpenPulse is a **single-page content planning app** written in ~2,100 lines of
plain vanilla JavaScript. There is no framework, no bundler, no
`package.json`, no `npm install`, and no backend — the entire app is one
`index.html`, a stylesheet, six script files, and two SVG icons.

It is a **planner, not a publisher.** Nothing in it talks to any social
platform. There is no OAuth, no API key, no webhooks. "Publishing" a post
flips its status so you can see what has gone out and keep your cadence
honest. What it does is let one person sit down and actually plan a week of
content — across a few channels, on one screen — with no signup and no
monthly fee.

## Quick start

There is nothing to install. Pick whichever feels right:

```sh
# Just open the file
xdg-open index.html          # or double-click it

# Or serve it locally
python3 -m http.server 8080
# then visit http://localhost:8080
```

Or use the hosted copy: **https://0xshaikh.github.io/OpenPulse/**

That is it. There is no build step to run and no environment variable to set.
The app opens with three sample channels and five sample posts so the
calendar is not empty on first load; hit **Reset** at any time to get them
back.

## Features

**Post composer.** Body text, channel, scheduled date and time, plus optional
notes and tags. A live character counter tracks the selected channel's budget
and turns red when you are over — it warns, it does not hard-block, because a
long draft is often exactly what you want to keep.

**Channels.** Add, edit, or remove named channels — for example
`@yourname — X / Twitter`. Each channel carries its own character limit and
its own colour, and every limit is editable if a platform changes its rules.
The composer counter, the queue filter, and the stats all key off this list,
so a channel you add today is immediately useful everywhere.

**Calendar view.** A real month grid computed from `Date` in your local
timezone, Monday-first, always 42 cells. Posts appear as coloured chips on
their scheduled day. Click a day to see and filter just that day's posts;
navigate months with the arrows or **Today**.

**Queue view.** Every post in one list, filterable by channel, by status
(draft / scheduled / published), and by a free-text search over body, notes,
and tags. Sort by date or reverse it. Each row exposes its status controls
directly.

**Status workflow.** `draft → scheduled → published`. Publishing is a state
change, not a network call — there is nothing to send. You can also move a
post back down (scheduled → draft, published → scheduled) when you decide not
to go out with something.

**Edit and delete with undo.** Any post can be edited in place or deleted.
Deleting pops a toast with an **Undo**, so a mis-click is not a loss.

**Export and import.** Download the whole plan as JSON — the same structure
the app stores — or as CSV for opening in a spreadsheet. Import a JSON export
back in. Exports are versioned and validated on the way in, so a file from a
different version is reported rather than silently half-loaded.

**Stats panel.** Total posts, counts by status, counts by channel, and a
"posts per week" bar chart over the last 8 weeks, computed from real dates
rather than hard-coded sample numbers.

**Keyboard.** `Ctrl`/`Cmd`+`Enter` saves the composer. `Esc` closes a dialog
or clears the composer. Calendar days are real focusable buttons, so
navigation is available with the keyboard alone.

**Local storage.** Everything lives in `localStorage` under one key
(`openpulse.document`). If storage is unavailable, the app falls back to an
in-memory store and tells you in the status bar — nothing else changes.

## Limitations

These are deliberate, and they are worth reading before you rely on it:

- **It does not publish.** No OAuth, no API integration, no media upload.
  When you mark a post *published*, you are recording your own decision —
  publish the content yourself on the platform.
- **Browser-local only.** Your plan lives in this browser's `localStorage`.
  Clearing site data, using an incognito window, or switching browsers means
  starting from the sample data again. **Export regularly** if the plan
  matters to you.
- **No server, no sync, no sharing.** There is no account and no account
  layer to sync through. One browser, one person, one plan.
- **No media at all.** Images, video, and attachments are not modelled. This
  is a text post planner.
- **Character budgets are your reminder, not a guarantee.** Limits are the
  defaults listed below and can be edited per channel. Platforms change these
  numbers; Twitter/X in particular counts things other than characters.
- **Single-user, no permissions.** There is no authentication, no
  multi-user editing, and no activity log.
- **Timezone-naive by design.** All times are your browser's local wall clock.
  A post scheduled for 09:30 means 09:30 wherever you are when you look at
  it, not 09:30 in some reference zone.

## Architecture

```
OpenPulse/
├── index.html                  # App shell: topbar, views, composer, statusbar
├── css/
│   └── styles.css              # Dark theme, layout, calendar grid, charts
├── js/
│   ├── dates.js                # Monday-first week/month math, month grid, ISO
│   ├── csv.js                  # RFC 4180 CSV serialise + parse, download helper
│   ├── serializers.js          # Document schema, validation, defaults, samples
│   ├── schedule.js             # Next slot, week buckets, cadence, char limits
│   ├── store.js                # localStorage wrapper with in-memory fallback
│   └── app.js                  # DOM layer: rendering, events, views, toasts
├── verify.js                   # Test suite — plain Node, zero dependencies
├── icon.svg                    # 100×100 app icon
├── favicon.svg                 # 32×32 favicon
├── README.md
├── LICENSE                     # MIT
├── .gitignore
└── .github/workflows/
    ├── ci.yml                  # node verify.js on every push
    └── deploy-site.yml         # GitHub Pages deploy
```

Five of the six script files are **pure logic with no DOM access**, wrapped in
a small UMD pattern so the exact same file loads under Node (`require`) and in
a browser (a `window` global). `verify.js` therefore tests the real
production code, not a re-implementation:

```sh
node -e "const D = require('./js/dates.js'); console.log(D.toISO(new Date()))"
```

`app.js` is the only file that touches the DOM, and it is deliberately thin —
render functions plus one delegated click listener, so re-rendering never
detaches handlers.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `Ctrl` / `Cmd` + `Enter` | Save the post in the composer |
| `Esc` | Close the channels dialog, or clear the composer |
| `Tab` / `Shift`+`Tab` | Move through fields, days, and buttons |
| `Enter` / `Space` on a focused day | Open that day's posts |

## Data formats

**JSON** is the full document — the same object the app reads and writes:

```json
{
  "version": 1,
  "exportedAt": "2026-10-27T12:00:00",
  "accounts": [
    { "id": "acc_x_default", "name": "X / Twitter", "handle": "@example",
      "platform": "x", "charLimit": 280, "color": "#1d9bf0" }
  ],
  "posts": [
    { "id": "p_abc123", "body": "Hello", "accountId": "acc_x_default",
      "scheduledAt": "2026-10-28T09:30:00", "notes": "", "tags": ["launch"],
      "status": "scheduled", "createdAt": "2026-10-27T08:00:00" }
  ]
}
```

Dates are local wall-clock ISO strings, not UTC — `2026-10-28T09:30:00` means
9:30 a.m. your time. `version` is bumped when the schema changes; importing a
file with a newer version is refused with a message rather than guessed at.

**CSV** exports the queue with headers `id,body,channel,platform,scheduled_at,status,notes,tags`.
Fields containing commas, quotes, or newlines are quoted, and embedded quotes
are doubled — RFC 4180, so any spreadsheet opens it cleanly.

**Default character budgets:** X / Twitter 280 · Mastodon 500 · Bluesky 300 ·
LinkedIn 3000 · Instagram 2200 · Facebook 5000 · Threads 5000 · Reddit 40000.
Anything unrecognised falls back to 500, and every value is editable in the
channels dialog.

## Testing

```sh
node verify.js
```

That is the whole command. No `npm install`, no test runner, no dev
dependencies, no headless browser — `verify.js` is a plain Node script with its
own tiny assert helper, and it exits non-zero on any failure.

The suite runs **213 assertions** across the five pure modules: month grids
including February in leap and non-leap years and every possible first weekday
of the month, the 42-cell invariant and week boundaries, date round-trips,
CSV escaping (commas, quotes, newlines, empties, unicode) and parse
round-trips, post serialisation and validation rejections, status transitions,
week-bucket and cadence math, character-limit logic, account defaults, and the
storage fallback. The final section loads every module into a bare VM context
with no `module` or `require` in scope — the exact path a browser takes — to
catch bugs that the Node require branch would hide.

```
============================================================
PASS  213/213 assertions passed, 0 failed
============================================================
```

The DOM layer in `app.js` is exercised by hand in a real browser rather than
by jsdom, which is why it stays a thin rendering layer.

## Contributing

Contributions are welcome. A few ground rules, in the spirit of what this is:

- **Keep the dependency count at zero.** No runtime dependencies, no build
  step, no framework. If a change needs `npm install`, it needs to be
  discussed first.
- **Keep pure logic in pure files.** Anything that can be tested without a
  browser belongs in `dates.js`, `csv.js`, `serializers.js`, `schedule.js`, or
  `store.js` — and if you add a function there, add assertions for it.
- **Run `node verify.js` before you push.** It must exit green.
- **Do not add any network call to the app.** This project's value is that
  data never leaves the browser. Adding an API would change what it is.
- **Do not add accounts, auth, or sync.** Same reason.

Issues are a good way to start — in particular, real platform character-limit
changes are worth reporting, since those numbers live in one object.

## License

MIT — see [LICENSE](LICENSE). Use it, fork it, ship it.
