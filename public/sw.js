/* eslint-disable no-restricted-globals */
/**
 * The till's service worker.
 *
 * One job, and it is worth stating plainly because it is easy to overreach:
 * **the terminal must survive being reloaded with no internet.**
 *
 * Everything else about offline already worked. An order is written to a local
 * queue before it is sent, it carries a uuid so resending is free, and a
 * drainer retries every fifteen seconds. What did not work was a reload — the
 * menu arrives as a server-rendered prop, so a refresh with no connection gave
 * a dead screen reading "Menu unavailable". On a Friday evening that is a
 * closed till, and the causes are mundane: a tablet sleeping, a browser
 * discarding a background tab, a router blinking, someone pressing F5.
 *
 * ── What is cached, and what is deliberately not ──
 *
 *   · `/_next/static/*` — cache first, forever. The filenames contain a build
 *     hash, so a given URL's content can never change. A new deploy asks for
 *     different names and those are fetched and stored alongside.
 *
 *   · the `/pos` document — network first, cache as a fallback. Online the
 *     cashier always gets the current menu; offline they get the last one that
 *     loaded, which is the whole point.
 *
 *   · `/api/*` — NEVER touched. This is the important one. The queue works
 *     because a failed POST throws and the order stays queued; a service worker
 *     that helpfully answered from a cache would turn a failed sale into a
 *     silent one. Reads are just as bad: a stale `/api/pos/recent` would offer
 *     a void of an order that no longer exists. Requests to the API must fail
 *     honestly when there is no connection.
 *
 * ── How the shell gets cached ──
 *
 * A hand-written worker cannot know the hashed chunk names at build time, and
 * generating a manifest would tie this file to the build. It does not need to:
 * after one successful online load the page has already requested every asset
 * it needs, and the client posts that list here (see PRECACHE below). One good
 * load online is all it takes, and it is the load the cashier does anyway when
 * they open the till in the morning.
 */

/**
 * ⚠️ `pos-v1-shell` is also named in app/pos/use-offline-shell.ts, which opens
 * this cache to check whether the till is genuinely ready. If the two ever
 * disagree the badge sticks on "Preparing offline…" forever while the caching
 * works perfectly — a failure that looks like a bug in the wrong half. Change
 * both, or neither.
 */
const VERSION = "pos-v1";
const SHELL = `${VERSION}-shell`;
const KEEP = [SHELL];

self.addEventListener("install", (event) => {
  // A till should never be left waiting for the old worker to release. There is
  // exactly one tab, and the new worker is strictly better than the old.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !KEEP.includes(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

/**
 * The page hands over the assets it actually used, once it is loaded and
 * online. Anything already stored is skipped, so this is cheap to repeat.
 */
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "PRECACHE" || !Array.isArray(data.urls)) return;

  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      await Promise.all(
        data.urls.map(async (url) => {
          try {
            if (await cache.match(url)) return;
            const res = await fetch(url, { credentials: "same-origin" });
            if (res.ok && !res.redirected) await cache.put(url, res.clone());
          } catch {
            // One asset failing to cache is not worth failing the batch over.
          }
        }),
      );
    })(),
  );
});

const isStatic = (url) => url.pathname.startsWith("/_next/static/");
const isApi = (url) => url.pathname.startsWith("/api/");

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // The API answers for itself or not at all. See the note at the top.
  if (isApi(url)) return;

  // Immutable by construction: the hash is in the name.
  if (isStatic(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && !res.redirected) cache.put(req, res.clone());
        return res;
      })(),
    );
    return;
  }

  // The page itself. Network first so the menu is never stale while there is a
  // connection; the cache is what makes a reload survivable when there is not.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL);
        try {
          const res = await fetch(req);
          // `cache.put` throws on a redirected response, and throwing here
          // would fail the navigation itself rather than merely skipping the
          // cache — the page would go blank because storing it went wrong.
          if (res.ok && !res.redirected) cache.put(req, res.clone());
          return res;
        } catch {
          const hit = (await cache.match(req)) || (await cache.match("/pos"));
          if (hit) return hit;
          return new Response(
            `<!doctype html><meta charset="utf-8"><title>Offline</title>
             <body style="font:16px system-ui;padding:40px;text-align:center">
               <h1>No connection</h1>
               <p>This till has not been opened online yet, so there is nothing
                  stored to fall back on. Reconnect and load it once.</p>
             </body>`,
            { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
          );
        }
      })(),
    );
    return;
  }

  // Fonts, icons, the stylesheet: serve what is stored and refresh behind it.
  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL);
      const hit = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected) cache.put(req, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })(),
  );
});
