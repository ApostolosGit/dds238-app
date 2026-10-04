import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const swSource = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const resetHtml = readFileSync(new URL("../reset-app.html", import.meta.url), "utf8");
const base = "https://example.test/dds238-app/";
const handlers = new Map(), deleted = [], navigated = [], fetchOptions = [];
const entries = new Map();
let installed = [];
const cache = {
  addAll: async (requests) => { installed = requests; },
  put: async (request, response) => { entries.set(request.url || request, response); },
  match: async (request) => entries.get(request.url || request)
};
let offline = false, httpStatus = 200;
const ctx = vm.createContext({
  URL, Request, Response,
  self: {
    location: { href: base + "sw.js" },
    addEventListener: (name, handler) => handlers.set(name, handler),
    skipWaiting: async () => {},
    clients: {
      claim: async () => {},
      matchAll: async () => [
        { url: base, navigate: async (url) => navigated.push(url) },
        { url: "https://example.test/another-app/", navigate: async (url) => navigated.push(url) }
      ]
    }
  },
  caches: {
    open: async () => cache,
    keys: async () => ["energy-dds-jsy-pwa-v2.0.7", "energy-dds-jsy-pwa-v2.0.8-r2", "another-app-cache"],
    delete: async (key) => deleted.push(key)
  },
  fetch: async (request, options) => {
    fetchOptions.push(options);
    if (offline) throw new Error("offline");
    return new Response("fresh", { status: httpStatus });
  }
});
vm.runInContext(swSource, ctx);
async function lifecycle(name) {
  const waits = [];
  handlers.get(name)({ waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
}
async function request(path, mode = "cors") {
  let responsePromise;
  const waits = [];
  handlers.get("fetch")({
    request: { url: new URL(path, base).href, method: "GET", mode },
    respondWith: (p) => { responsePromise = p; },
    waitUntil: (p) => waits.push(p)
  });
  const response = await responsePromise;
  await Promise.all(waits);
  return response;
}
await lifecycle("install");
assert(installed.length);
assert(installed.every((request) => request.cache === "no-store"));
for (const [, asset] of html.matchAll(/(?:src|href)="((?:app\.js|style\.css)[^"]*)"/g)) {
  assert(!asset.includes("v=2.0.0"));
  assert(installed.some((request) => request.url === new URL(asset, base).href));
}
await lifecycle("activate");
assert.deepEqual(deleted, ["energy-dds-jsy-pwa-v2.0.7"]);
assert.deepEqual(navigated, [base]);
const asset = html.match(/src="(app\.js[^"]+)"/)[1];
assert.equal(await (await request(asset)).text(), "fresh");
assert.equal(fetchOptions.at(-1).cache, "no-store");
offline = true;
assert.equal(await (await request(asset)).text(), "fresh");
assert.equal((await request("uncached.js")).type, "error");
entries.set(base + "index.html", new Response("offline page"));
assert.equal(await (await request("./?new=1", "navigate")).text(), "offline page");
assert.equal(await request("https://example.test/another-app/app.js"), undefined);
offline = false; httpStatus = 404;
await request("missing.js");
assert(!entries.has(base + "missing.js"));

// Recovery clears this app's worker/cache only and retains connection settings.
const resetScript = resetHtml.match(/<script>([\s\S]*?)<\/script>/)[1];
const unregistered = [], cleared = [], redirected = [];
const resetCtx = vm.createContext({
  URL, Date,
  console,
  location: { href: base + "reset-app.html", replace: (url) => redirected.push(url) },
  navigator: { serviceWorker: { getRegistrations: async () => [
    { scope: base, unregister: async () => unregistered.push(base) },
    { scope: "https://example.test/another-app/", unregister: async () => unregistered.push("other") }
  ] } },
  window: { caches: {}, localStorage: { clear: () => { throw new Error("settings cleared"); } } },
  caches: {
    keys: async () => ["energy-dds-jsy-pwa-v2.0.7", "another-app-cache"],
    delete: async (key) => cleared.push(key)
  }
});
await vm.runInContext(resetScript, resetCtx);
assert.deepEqual(unregistered, [base]);
assert.deepEqual(cleared, ["energy-dds-jsy-pwa-v2.0.7"]);
assert.match(redirected[0], /^\.\/\?app=2\.08&reset=\d+$/);
console.log("PWA fresh assets, current-cache offline fallback, scoped cleanup and recovery PASS");
