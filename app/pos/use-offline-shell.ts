"use client";

import { useEffect, useState } from "react";

/**
 * Registers the till's service worker and reports, honestly, whether this
 * terminal would survive being reloaded right now with no connection.
 *
 * The honesty matters more than the registration. "Offline ready" is a promise
 * about a bad evening, and a badge that shows it optimistically — the moment
 * the worker registers, before a single asset is stored — is worse than no
 * badge, because it is believed on the one night it is wrong. So `ready` only
 * goes true after the assets the page actually used are confirmed in the cache.
 *
 * The list comes from the browser rather than from a build manifest: once the
 * page has loaded, `performance.getEntriesByType("resource")` is a precise
 * record of what it needed. A hand-written worker with no build step could not
 * know those hashed filenames any other way, and asking the page after the fact
 * is both simpler and more accurate than predicting them.
 */

export interface OfflineShell {
  /** Whether this browser can do any of it at all. */
  supported: boolean;
  /** The shell is stored: a reload with no connection will work. */
  ready: boolean;
  /** Something went wrong, in words worth showing a cashier. */
  problem: string | null;
}

/** ⚠️ Must match `SHELL` in public/sw.js — see the note there. */
const SHELL_CACHE = "pos-v1-shell";

export function useOfflineShell(): OfflineShell {
  const [state, setState] = useState<OfflineShell>({
    supported: true,
    ready: false,
    problem: null,
  });

  useEffect(() => {
    // A till served over plain http on a LAN address gets no service worker,
    // and no amount of retrying changes that. Say so rather than sitting at
    // "not ready" forever with no explanation.
    if (!("serviceWorker" in navigator)) {
      setState({
        supported: false,
        ready: false,
        problem: window.isSecureContext
          ? "This browser cannot store the till for offline use."
          : "Offline mode needs https. On http a reload with no connection will fail.",
      });
      return;
    }

    let cancelled = false;

    const verify = async () => {
      try {
        const cache = await caches.open(SHELL_CACHE);
        const keys = await cache.keys();
        const hasShell = keys.some((r) => new URL(r.url).pathname.startsWith("/_next/static/"));
        const hasPage = keys.some((r) => new URL(r.url).pathname === "/pos");
        if (!cancelled) {
          setState((s) => ({ ...s, ready: hasShell && hasPage, problem: null }));
        }
      } catch {
        /* storage unavailable — leave it not-ready rather than claiming it is */
      }
    };

    /**
     * Hand over exactly what this page load used. Anything already stored is
     * skipped by the worker, so repeating this is nearly free — and it is
     * repeated, because assets are still arriving when the first effect runs
     * and a shell missing one chunk is a shell that does not boot.
     */
    const handOver = (target: ServiceWorker | null) => {
      const urls = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((u) => {
          try {
            const p = new URL(u);
            return p.origin === location.origin && p.pathname.startsWith("/_next/static/");
          } catch {
            return false;
          }
        });
      target?.postMessage({ type: "PRECACHE", urls });
    };

    const run = async () => {
      try {
        // Scoped to /pos, not to the whole site. The worker file sits at the
        // root so it *could* claim everything, and it should not: the customer
        // menu is a public page that ought to behave like a public page, and a
        // till's cache has no business deciding what a diner sees. Narrowing
        // the scope costs nothing — subresources of a controlled page still go
        // through the worker, which is where the chunks come from.
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/pos" });
        await navigator.serviceWorker.ready;

        const target = reg.active ?? navigator.serviceWorker.controller;
        handOver(target);
        window.setTimeout(() => handOver(reg.active ?? navigator.serviceWorker.controller), 2000);

        // The worker caches the page document on its own, but only for requests
        // it controlled. The very first load happens before it exists, so ask
        // for the page once explicitly — otherwise the till is one reload away
        // from ready and nobody knows it.
        const cache = await caches.open(SHELL_CACHE);
        if (!(await cache.match("/pos"))) {
          try {
            const res = await fetch("/pos", { credentials: "same-origin" });
            if (res.ok && !res.redirected) await cache.put("/pos", res.clone());
          } catch {
            /* offline on first ever load — nothing to store yet */
          }
        }

        // Caching is asynchronous inside the worker, so check, then check again
        // shortly after rather than reporting on the first look.
        await verify();
        window.setTimeout(verify, 2500);
      } catch {
        if (!cancelled) {
          setState({
            supported: true,
            ready: false,
            problem: "Could not prepare this till for offline use.",
          });
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
