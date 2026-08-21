/*
** The example's wires. Everything here is ordinary browser code; the
** queue's rules are in the library's Ring half.
*/

var RUNTIME = "../../ringscript/playground/";
var $ = function (id) { return document.getElementById(id); };
var online = true;
var pwa = null;

/* Stands in for a server. Everything up to the request is real. */
function send(payload) {
    if (!online) { return Promise.reject(new Error("offline")); }
    return new Promise(function (res) { setTimeout(res, 200); });
}

function render() {
    if (!pwa) { return; }
    var items = pwa.list();
    var age = pwa.oldest();
    $("state").textContent =
        "connection " + (online ? "up" : "down") +
        " · rung " + pwa.rung() +
        " · " + pwa.pending() + " waiting" +
        (age > 0 ? " (oldest " + age + "s)" : "") +
        (pwa.banner() ? " · " + pwa.banner() : "") +
        (pwa.install.available ? " · installable" : "");
    $("list").innerHTML = items.map(function (e) {
        return "<li>" + e.kind + " — " + e.state + "</li>";
    }).join("");
}

async function boot() {
    var wasm = await (await fetch(RUNTIME + "ringscript.wasm")).arrayBuffer();
    var ring = await RingScript.load(wasm, { onOutput: function () {} });

    pwa = await Pwa.attach(ring, {
        world: "pwa-example",          // the storage identity -- required in 2.0
        device: "example-1",
        sw: "sw.js",
        send: send,
        onChange: render
    });

    $("queue").addEventListener("click", function () {
        // queue() answers a Promise in 2.0: the entry is DURABLE before ok
        pwa.queue("order", { at: Date.now() }).then(function (q) {
            if (!q.ok) { alert(q.problem); }
        });
    });
    $("flush").addEventListener("click", function () { pwa.flush(); });
    $("cut").addEventListener("click", function () {
        online = !online;
        $("cut").textContent = online ? "Cut the connection" : "Restore the connection";
        render();
        if (online) { pwa.flush(); }
    });

    render();
}

var s = document.createElement("script");
s.src = RUNTIME + "ringscript.js";
s.onload = boot;
s.onerror = function () { $("state").textContent = "no runtime at " + RUNTIME; };
document.head.appendChild(s);
