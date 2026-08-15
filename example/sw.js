importScripts("lib/pwa/sw-pwa.js");

PwaServiceWorker({
    cache: "pwa-example-v1",
    shell: [
        "./", "./index.html", "./app.js", "./manifest.webmanifest",
        "lib/pwa/pwa.js", "lib/pwa/pwa.ring",
        "../../ringscript/playground/ringscript.js",
        "../../ringscript/playground/ringscript.wasm"
    ],
    endpoint: "./api/orders"
});
