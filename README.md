# ringscript-pwa

**Install to the home screen, open with no network, and a durable outbox
that survives a restart.**

A RingScript library. The rules live in Ring; the wiring lives in
JavaScript; your page keeps its own HTML and CSS.

```bash
ringscript add pwa
```

One line goes into the page, and the library loads its own Ring half:

```html
<script src="lib/pwa/pwa.js"></script>
```

```js
const pwa = await Pwa.attach(ring, {
    device: "phone-7",              // something stable per device or user
    sw: "sw.js",                    // your service worker
    send: (payload) => fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    }).then(r => { if (!r.ok) throw new Error("rejected"); }),
    onChange: render
});

pwa.queue("order", { shop: "m03", total: 4200 });   // works offline
```

## Why the outbox is the library

Two RingScript samples — a field-sales order pad and a stock-count pad —
wrote the same queue independently. Both needed the same three things, and
they are the ones people get wrong:

- **the id is made on the device, before anything is sent.** The work is
  named while it is still local, so a dropped connection during a send is a
  *retry* rather than a second order;
- **one entry at a time**, so a half-successful flush leaves the rest queued
  instead of losing them with the batch;
- **rollback.** A send that failed is not a send. Put it back, or the queue
  becomes a place work goes to disappear.

That is not application logic. It is the local-first pattern, so it belongs
in a library rather than in every application that needs it.

## What is in the box

| | |
|---|---|
| `ring/pwa.ring` | the outbox — no DOM, no `fetch`, no `localStorage` |
| `web/pwa.js` | the wires — service worker, install prompt, connection, storage, sync |
| `web/sw-pwa.js` | the service-worker half: cache-first, and Background Sync |

Your service worker imports the third and says what to cache, because only
your application knows its own files:

```js
importScripts("lib/pwa/sw-pwa.js");
PwaServiceWorker({
    cache: "my-app-v1",
    shell: [ "./", "./index.html", "./app.js", "./app.ring",
             "lib/pwa/pwa.js", "lib/pwa/pwa.ring",
             "../../playground/ringscript.js",
             "../../playground/ringscript.wasm" ],
    endpoint: "/api/orders"
});
```

Background Sync is the one thing a plain website cannot do at all: the
browser flushes the queue when a connection returns **even if the app is
closed**. Where it is unavailable — Safari today — `pwa.flush()` still works
whenever the app is open, so the feature degrades rather than disappears.

## The API

**Ring** — the queue's rules, callable with no page at all:

`PwaOutboxDevice` · `PwaOutboxAdd` · `PwaOutboxList` · `PwaOutboxPayload` ·
`PwaOutboxPending` · `PwaOutboxSent` · `PwaOutboxRollback` ·
`PwaOutboxForget` · `PwaOutboxSnapshot` · `PwaOutboxRestore`

**JavaScript** — `Pwa.attach(ring, opts)` returns
`queue(kind, payload)` · `flush()` · `pending()` · `list()` · `forget()` ·
`online()` · `requestSync()` · `install.available` · `install.prompt()`.

## Tests

```bash
node test/pwa-lib.js
```

Fourteen checks on the Ring half, run in Node with no browser: the money
rules, the refusals, rollback, and that ids stay unique **across a restart**
— which is the one that matters, because a queue restored from storage that
reuses an id will duplicate somebody's order.

It needs a checkout of [ringscript](https://github.com/mayouni/ringscript)
beside this one, or `RINGSCRIPT_HOME` pointing at one.

## Notes

- A service worker needs **https or localhost**. It is not a RingScript
  limitation.
- The library never ships `ringscript.js` or `ringscript.wasm`. The runtime
  belongs to the application, and a page has one VM.

MIT. Part of the [RingScript](https://github.com/mayouni/ringscript) project.
