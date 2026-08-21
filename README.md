# ringscript-pwa

**Install to the home screen, open with no network, and a durable outbox
that survives a restart — partition-tolerant by default.**

A RingScript library. The rules live in Ring; the wiring lives in
JavaScript; your page keeps its own HTML and CSS. Since 2.0 the design
contract is written down:
[`ringscript/docs/PARTITION-FOUNDATIONS.md`](https://github.com/mayouni/ringscript/blob/main/docs/PARTITION-FOUNDATIONS.md)
— every guarantee below cites it.

```bash
ringscript add pwa
```

One line goes into the page, and the library loads its own Ring half:

```html
<script src="lib/pwa/pwa.js"></script>
```

```js
const pwa = await Pwa.attach(ring, {
    world:  "cousbox-remote",       // REQUIRED — the storage identity
    device: "phone-7",              // something stable per device or user
    endpoint: "/api/orders",        // same-origin; flush() sends one ordered batch
    sw: "sw.js",                    // your service worker
    onChange: render
});

const q = await pwa.queue("order", { shop: "m03", total: 4200 });
if (!q.ok) show(q.problem);         // "storage-full" is loud, never a silent loss
```

## What 2.0 guarantees, and what it asks of your server

- **Write locally before any network attempt, and never be silent about
  pending state.** `queue()` persists the entry *before* answering `ok` —
  a store that cannot hold the entry refuses it by name
  (`{ok:0, problem:"storage-full"}`) rather than accepting work it cannot
  keep. `pending()` and `oldest()` feed the visible counter.
- **Replay is at-least-once, ordered, and idempotent by entry id.** The id
  is minted on the device before the first send, transmission is strictly
  in queue order with one request in flight, and a failure *stops* the
  replay rather than letting later entries overtake a retry. **Your
  server's half of the contract: treat the entry id as an idempotency key
  — a repeated id gets the original verdict, never a second effect.**
- **The degraded-mode rung is readable by Ring rules.** `alone` →
  `streaming` → `unreachable`, maintained by the library, pushed into the
  VM (`PwaRung()`), so a rule like *card payment needs the server* lives in
  Ring where business rules belong. `banner()` names the state for the UI:
  `NETWORK-LOST`, `ALONE`, `STORAGE-FULL`, `STORAGE-PINNED-TO-ADDRESS` —
  never a freeze, never a silent spinner.
- **A server snapshot replaces local state; it never merges.** Wire
  `stream: { url, apply, reconcile }` and the event order after any
  reconnection is contractual: `connected → snapshot → orphaned×N →
  replay → live`. The alarm fires only after 8 seconds of true silence
  (configurable) — a one-second blip is not an event.
- **Storage names its risk.** The default store is IndexedDB keyed by your
  `world` name — never by the serving path. `pwa.identity` says which
  origin the storage is pinned to, whether that origin is a bare IP (the
  DHCP-lease trap), and whether the browser granted persistence. For data
  that must survive an origin change, `pwa.mirror` writes a user-visible
  file — a file has no origin.

## Why the outbox is the library

Two RingScript samples — a field-sales order pad and a stock-count pad —
wrote the same queue independently. Both needed the same three things, and
they are the ones people get wrong:

- **the id is made on the device, before anything is sent.** The work is
  named while it is still local, so a dropped connection during a send is a
  *retry* rather than a second order;
- **ordered delivery that stops at the first failure**, so a
  half-successful flush leaves the rest queued — in order — instead of
  losing them with the batch or reordering them around a retry;
- **rollback.** A send that failed is not a send. Put it back, or the queue
  becomes a place work goes to disappear.

That is not application logic. It is the local-first pattern, so it belongs
in a library rather than in every application that needs it.

## What is in the box

| | |
|---|---|
| `ring/pwa.ring` | the outbox and the rung — no DOM, no `fetch`, no storage |
| `web/pwa.js` | the wires — storage drivers, service worker, install prompt, stream, rung |
| `web/sw-pwa.js` | the service-worker half: cache-first, and Background Sync straight from IndexedDB |

Your service worker imports the third and says what to cache, because only
your application knows its own files:

```js
importScripts("lib/pwa/sw-pwa.js");
PwaServiceWorker({
    cache: "my-app-v1",
    shell: [ "./", "./index.html", "./app.js", "./app.ring",
             "lib/pwa/pwa.js", "lib/pwa/pwa.ring",
             "../../playground/ringscript.js",
             "../../playground/ringscript.wasm" ]
});
```

Background Sync is the one thing a plain website cannot do at all: the
browser flushes the queue when a connection returns **even if the app is
closed** — since 2.0 the worker reads the same IndexedDB record the app
writes, in the same order the app would send. Where Background Sync is
unavailable — Safari today — `pwa.flush()` still works whenever the app is
open, so the feature degrades rather than disappears.

## The API

**Ring** — the rules, callable with no page at all:

`PwaOutboxDevice` · `PwaOutboxAdd` · `PwaOutboxDrop` · `PwaOutboxList` ·
`PwaOutboxPayload` · `PwaOutboxPending` · `PwaOutboxOldest` ·
`PwaOutboxSent` · `PwaOutboxRollback` · `PwaOutboxForget` ·
`PwaOutboxSnapshot` · `PwaOutboxRestore` · `PwaOutboxBatch` ·
`PwaOutboxMarkSending` · `PwaOutboxApply` · `PwaOutboxRollbackAll` ·
`PwaRung` · `PwaRungSet`

**JavaScript** — `Pwa.attach(ring, opts)` returns
`queue(kind, payload) → Promise` · `flush()` · `pending()` · `oldest()` ·
`list()` · `forget()` · `rung()` · `banner()` · `states()` · `identity` ·
`on(event, fn)` · `mirror.enable() / .download()` · `requestSync()` ·
`install.available` · `install.prompt()`.

Events: `rung` · `silent` · `alive` · `connected` · `snapshot` ·
`orphaned` · `replay` · `live` · `banner` · `event`.

Every environmental edge is injectable — `storage`, `now`, `timer`,
`fetchFn`, `eventSource`, `ringSource` — which is what makes the browser
half testable with no browser.

## Upgrading from 1.x

`world` is now required, and `queue()` returns a Promise. A queue persisted
by 1.x under the old localStorage key is imported once, automatically, on
the first 2.0 attach. Old snapshots restore (entries gain an empty note and
an age of 0). `flush()` semantics changed deliberately: ordered with
stop-at-first-failure, where 1.x raced all entries concurrently.

## Tests

```bash
node test/pwa-lib.js     # the Ring half: rules, ids across restarts, the rung
node test/pwa-web.js     # the browser half, no browser: ordered replay,
                         # storage-full refusal, the 8-second alarm, the
                         # five-event stream sequence — clock and store injected
```

Both need a checkout of [ringscript](https://github.com/mayouni/ringscript)
beside this one, or `RINGSCRIPT_HOME` pointing at one.

## Notes

- A service worker needs **https or localhost**. It is not a RingScript
  limitation.
- The library never ships `ringscript.js` or `ringscript.wasm`. The runtime
  belongs to the application, and a page has one VM.
- Origin storage — localStorage, IndexedDB, all of it — dies with a changed
  serving origin, and a bare-IP origin dies with a DHCP lease. The library
  cannot repeal that; it can name it (`identity.pinned_to_ip`, the
  `STORAGE-PINNED-TO-ADDRESS` banner) and offer the file mirror. Serve
  worlds from a stable hostname.

MIT. Part of the [RingScript](https://github.com/mayouni/ringscript) project.
