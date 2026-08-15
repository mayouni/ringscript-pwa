# A page that uses the library

Minimal, and runnable. It queues work, cuts the connection, and shows the
outbox surviving a reload.

    ringscript add ..            (from this folder)
    ringscript serve 8377 .

The runtime is expected at `../../ringscript/playground/`. Change RUNTIME in
app.js if yours is elsewhere. A service worker needs localhost or https —
`ringscript serve` gives you localhost, which counts.
