/*
** The browser half, tested with no browser at all.
**
** v2 made every environmental edge injectable — storage, clock, timers,
** fetch, EventSource — for exactly this file (PARTITION-FOUNDATIONS.md §5:
** time is injected so the alarm is testable; the partition is a fact the
** test controls). The Ring VM here is the REAL wasm runtime; only the
** browser is stubbed.
**
**   node test/pwa-web.js
*/
const fs = require("fs"), path = require("path");
const HOME = process.env.RINGSCRIPT_HOME || path.join(__dirname, "..", "..", "ringscript");
const RUNTIME = path.join(HOME, "playground");
if (!fs.existsSync(path.join(RUNTIME, "ringscript.wasm"))) {
    console.error("No RingScript runtime at " + RUNTIME); process.exit(2);
}
const RingScript = require(path.join(RUNTIME, "ringscript.js"));
require(path.join(__dirname, "..", "web", "pwa.js"));   // defines global Pwa
const RING_SRC = fs.readFileSync(path.join(__dirname, "..", "ring", "pwa.ring"), "utf8");

let bad = 0;
const ok = (n, c, d) => { console.log((c ? "  PASS  " : "  FAIL  ") + n +
    (c || d === undefined ? "" : "  [" + JSON.stringify(d) + "]")); if (!c) bad++; };

/* ---- the injectable browser ------------------------------------------ */

function manualClock(start) {
    let t = start || 1755640000000, seq = 0, due = [];
    return {
        now: () => t,
        timer: {
            set: (fn, ms) => { const id = ++seq; due.push({ id, at: t + ms, fn }); return id; },
            clear: (id) => { due = due.filter(d => d.id !== id); }
        },
        tick: (ms) => {
            t += ms;
            const fire = due.filter(d => d.at <= t); due = due.filter(d => d.at > t);
            fire.forEach(d => d.fn());
        }
    };
}

function failableDriver() {
    let held = null, failing = false;
    return {
        name: "test",
        load: () => Promise.resolve(held),
        save: (rec) => failing ? Promise.reject(new Error("quota"))
                               : (held = rec, Promise.resolve()),
        fail: (v) => { failing = v; },
        held: () => held
    };
}

class FakeEventSource {
    constructor(url) { this.url = url; this.listeners = {}; FakeEventSource.last = this; }
    addEventListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); }
    emit(name, data) { (this.listeners[name] || []).forEach(fn => fn({ data })); }
}

(async () => {
    const b = fs.readFileSync(path.join(RUNTIME, "ringscript.wasm"));
    const mk = () => RingScript.load(
        b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), { onOutput: () => {} });

    /* ---- attach refuses namelessness ---------------------------------- */
    try {
        await Pwa.attach(await mk(), { device: "d" });
        ok("attach without a world is refused", false);
    } catch (e) {
        ok("attach without a world is refused, and says why",
           e.message.indexOf("world") >= 0, e.message);
    }

    /* ---- storage-full: refused loudly, never accepted-then-lost ------- */
    {
        const drv = failableDriver(), clk = manualClock();
        const pwa = await Pwa.attach(await mk(), {
            world: "t1", device: "d1", storage: drv,
            now: clk.now, timer: clk.timer, ringSource: RING_SRC,
            send: () => Promise.reject(new Error("no server in this test"))
        });
        const q1 = await pwa.queue("order", { total: 10 });
        ok("a queue that persisted answers ok with a device id",
           q1.ok === 1 && /^order-d1-1-/.test(q1.id), q1);
        ok("...and the driver holds snapshot AND the worker's pending copy",
           drv.held().pending.length === 1 && drv.held().pending[0].payload.total === 10);

        drv.fail(true);
        const q2 = await pwa.queue("order", { total: 20 });
        ok("a queue the store cannot hold is REFUSED with a name (defect two fixed)",
           q2.ok === 0 && q2.problem === "storage-full", q2);
        ok("...the entry was rolled back, not held in memory as a lie",
           pwa.pending() === 1);
        ok("...and STORAGE-FULL is the banner", pwa.banner() === "STORAGE-FULL");
        drv.fail(false);
        await pwa.queue("order", { total: 30 });
        ok("recovery clears the banner on the next successful save",
           pwa.states().indexOf("STORAGE-FULL") < 0);
    }

    /* ---- ordered replay: seq order, stop at first failure ------------- */
    {
        const drv = failableDriver(), clk = manualClock();
        const sent = []; let failAt = 2;
        const pwa = await Pwa.attach(await mk(), {
            world: "t2", device: "d2", storage: drv,
            now: clk.now, timer: clk.timer, ringSource: RING_SRC,
            send: (p) => {
                if (sent.length + 1 === failAt) { return Promise.reject(new Error("boom")); }
                sent.push(p.id); return Promise.resolve();
            }
        });
        const a = await pwa.queue("order", { n: 1 });
        const b2 = await pwa.queue("order", { n: 2 });
        const c = await pwa.queue("order", { n: 3 });
        await pwa.flush();
        ok("replay is ordered and STOPS at the first failure (defect one fixed)",
           sent.length === 1 && sent[0] === a.id, sent);
        ok("the failed entry and everything behind it stay queued",
           pwa.pending() === 2);
        failAt = 99;
        await pwa.flush();
        ok("the next flush resumes in order, nothing sent twice",
           sent.join() === [a.id, b2.id, c.id].join(), sent);
    }

    /* ---- the rung, driven by observed exchanges, timed by the alarm --- */
    {
        const drv = failableDriver(), clk = manualClock();
        let up = true; const events = [];
        const ring3 = await mk();
        const pwa = await Pwa.attach(ring3, {
            world: "t3", device: "d3", storage: drv, silence: 8,
            now: clk.now, timer: clk.timer, ringSource: RING_SRC,
            send: () => up ? Promise.resolve() : Promise.reject(new Error("gone"))
        });
        pwa.on("silent", () => events.push("silent"));
        pwa.on("alive", () => events.push("alive"));
        ok("the boot rung is alone", pwa.rung() === "alone" && pwa.banner() === "ALONE");

        await pwa.queue("order", { n: 1 });
        await pwa.flush();
        ok("a successful exchange reaches streaming", pwa.rung() === "streaming");

        up = false;
        await pwa.queue("order", { n: 2 });
        await pwa.flush();
        ok("one failure is not yet an outage (Law 4)", pwa.rung() === "streaming");
        clk.tick(7000);
        ok("...seven seconds of silence still is not", pwa.rung() === "streaming");
        clk.tick(2000);
        ok("nine seconds is: rung unreachable, silent fired once",
           pwa.rung() === "unreachable" && events.join() === "silent",
           { rung: pwa.rung(), events });
        ok("...and the banner says so", pwa.banner() === "NETWORK-LOST");
        ok("...and Ring world rules see the same rung",
           ring3.call("PwaRung", 1).result === "unreachable");

        up = true;
        await pwa.flush();
        ok("recovery: alive fired, streaming again, queue drained",
           pwa.rung() === "streaming" && events.join() === "silent,alive" && pwa.pending() === 0);
    }

    /* ---- the stream: the five-event order is the contract ------------- */
    {
        const drv = failableDriver(), clk = manualClock();
        const order = [];
        const ring = await mk();
        const pwa = await Pwa.attach(ring, {
            world: "t4", device: "d4", storage: drv, silence: 8,
            now: clk.now, timer: clk.timer, ringSource: RING_SRC,
            eventSource: FakeEventSource,
            stream: { url: "/flux", apply: "SnapApply", reconcile: "SnapReconcile" },
            send: () => Promise.resolve()
        });
        /* the world's own Ring half — its OWN eval, so its main section
           runs (two sources concatenated share ONE main section, and the
           second file's state would never initialise) */
        const wv = ring.eval(fs.readFileSync(path.join(__dirname, "world-snap.ring"), "utf8"));
        if (!wv.ok) { throw new Error("world-snap: " + wv.error); }
        ["connected", "snapshot", "replay", "live"].forEach(n => pwa.on(n, () => order.push(n)));
        pwa.on("orphaned", (id) => order.push("orphaned:" + id));
        pwa.on("error", (m) => order.push("error:" + m));

        /* seed: one locally-restored order the server will not confirm, and
           one queued transition ON that ghost, plus one honest entry */
        ring.call("SnapSeed", "ghost-1");
        await pwa.queue("transition", { id: "ghost-1", to: "ready" });
        await pwa.queue("order", { id: "loc-9" });

        const es = FakeEventSource.last;
        es.emit("open");
        es.emit("snapshot", JSON.stringify({ orders: ["srv-1"] }));
        await new Promise(r => setImmediate(r));

        ok("the event order is the contract: connected, snapshot, orphaned, replay, live",
           order.join() === "connected,snapshot,orphaned:ghost-1,replay,live", order);
        ok("the world applied the snapshot by replacing (clear-then-load)",
           JSON.parse(ring.call("SnapHeld", 1).result).join() === "srv-1");
        ok("the ghost's queued transition was dropped; the honest entry survived and was replayed",
           pwa.pending() === 0 && pwa.list().length === 1 &&
           pwa.list()[0].kind === "order", pwa.list());
        ok("after the sequence the rung is streaming", pwa.rung() === "streaming");

        es.emit("heartbeat", "");
        clk.tick(9000);
        ok("heartbeats hold the rung up", pwa.rung() === "streaming");
        clk.tick(0);
        es.emit("error");
        clk.tick(9000);
        ok("a dead stream trips the alarm", pwa.rung() === "unreachable");
    }

    /* ---- oldest(), with injected time --------------------------------- */
    {
        const drv = failableDriver(), clk = manualClock();
        const pwa = await Pwa.attach(await mk(), {
            world: "t5", device: "d5", storage: drv,
            now: clk.now, timer: clk.timer, ringSource: RING_SRC
        });
        ok("no queue, no age", pwa.oldest() === -1);
        await pwa.queue("order", { n: 1 });
        clk.tick(125000);
        ok("the banner can say how long the oldest entry has waited",
           pwa.oldest() === 125, pwa.oldest());
    }

    console.log(bad ? "\n" + bad + " FAILED" : "\nAll pwa.js checks passed.");
    process.exit(bad ? 1 : 0);
})().catch(e => { console.error("ERROR", e); process.exit(1); });
