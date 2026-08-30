import "server-only";
import { headers } from "next/headers";

/**
 * Making a wrong guess cost something.
 *
 * A four-digit PIN is ten thousand possibilities, and because the PIN hash is a
 * global lookup key, *any* employee's PIN opens a till — so with eight staff the
 * real target is one guess in 1,250. Unmetered, a script finds one in minutes.
 *
 * ── Throttling, not locking ──
 *
 * Two drafts of this were reviewed and both would have closed a restaurant
 * during service. That is the failure mode to design against, and it is more
 * likely than the attack: every till in a building shares one public address,
 * the terminal re-locks itself after three minutes of stillness, and unlocking
 * goes through here — so a rush with four tills and fumbling fingers looks
 * exactly like a slow brute force.
 *
 * So keys that identify **one actor** may lock, and keys **shared** by people
 * who did nothing wrong may only ever slow down. Every shared key here has a
 * ceiling measured in seconds. A stranger is held to roughly one guess a
 * minute; a cashier is never kept from the till longer than it takes to find a
 * manager.
 *
 * ── What this does not stop ──
 *
 * Stated plainly, because the previous versions of this comment overclaimed and
 * the numbers were wrong:
 *
 *   · **Rotating source addresses.** Anyone with an IPv6 /64 gets a fresh
 *     bucket per request. The global door below is the only thing in the way,
 *     and it is deliberately loose enough that it cannot close a restaurant.
 *   · **An insider who already knows one valid PIN.** They can relieve pressure
 *     by signing in legitimately. `relax` meters that to once a minute so the
 *     relief cannot outrun the throttle, but it does not eliminate it.
 *
 * Held to one guess a minute, 1,250 guesses is about twenty hours — half a day
 * to a day, not the week an earlier version of this comment claimed by
 * forgetting its own eight-staff divisor. What makes that unattractive is not
 * the arithmetic but the audit trail: it is twenty hours of writing evidence.
 *
 * ── Why a Map and not Redis ──
 *
 * Each restaurant runs as its own systemd unit with its own database and its
 * own Node process (deploy/new-tenant.sh). One process means one memory space.
 * If this ever runs behind more than one, this file is where that changes and
 * Postgres is where it goes. `Restart=always` means a crash clears the
 * counters, and anyone who can crash the process at will has a better attack
 * available than guessing PINs.
 */

export interface Policy {
  /**
   * Failures tolerated before the first wait. The wait lands **on** this
   * attempt, so `attempts: 5` means four free misses and a pause on the fifth.
   */
  attempts: number;
  /** How long a run of failures stays on the record after the last one. */
  windowMs: number;
  /** The first wait. Each further failure doubles it. */
  baseLockMs: number;
  /** However bad it gets, never longer than this. */
  maxLockMs: number;
}

/**
 * One address, one terminal. The narrowest key available before a PIN is
 * known — still not one *person*, since two cashiers share a till, which is
 * why the ceiling is five minutes rather than fifteen.
 */
export const PIN_POLICY: Policy = {
  attempts: 5,
  windowMs: 30 * 60_000,
  baseLockMs: 60_000,
  maxLockMs: 5 * 60_000,
};

/**
 * Everyone at one address, which in a restaurant is the whole building.
 * Generous, and capped at a minute: this slows a stranger, never closes a
 * business.
 */
export const PIN_POLICY_WIDE: Policy = {
  attempts: 30,
  windowMs: 30 * 60_000,
  baseLockMs: 10_000,
  maxLockMs: 60_000,
};

/**
 * Drivers, whose phones sit behind carrier-grade NAT — every driver on one
 * network in one city can share an address, so a lockout would strand a shift.
 */
export const PIN_POLICY_SHARED: Policy = {
  attempts: 10,
  windowMs: 15 * 60_000,
  baseLockMs: 5_000,
  maxLockMs: 60_000,
};

/**
 * Every failed attempt at this door, from anywhere, counted together.
 *
 * The only thing in the way of an attacker who rotates addresses, and therefore
 * necessarily shared by every honest user too — so it is set where nothing
 * legitimate can reach it and it never delays anyone by more than a few
 * seconds. Two hundred failed PINs in a quarter of an hour is not a busy
 * Friday; it is a script.
 */
export const GLOBAL_POLICY: Policy = {
  attempts: 200,
  windowMs: 15 * 60_000,
  baseLockMs: 2_000,
  maxLockMs: 10_000,
};

/** One account. Passwords are long, so the threat is bcrypt's CPU cost. */
export const PASSWORD_POLICY: Policy = {
  attempts: 8,
  windowMs: 30 * 60_000,
  baseLockMs: 30_000,
  maxLockMs: 10 * 60_000,
};

/** Everyone at one address. Protects the CPU without locking out an office. */
export const PASSWORD_POLICY_WIDE: Policy = {
  attempts: 20,
  windowMs: 30 * 60_000,
  baseLockMs: 10_000,
  maxLockMs: 60_000,
};

interface Bucket {
  fails: number;
  /** When the record of those failures goes stale. */
  expires: number;
  /** Held until this moment, or 0. */
  until: number;
  /** When a success last bought a failure back — see `relax`. */
  relaxed: number;
}

// Attached to globalThis unconditionally, unlike the Prisma client, which only
// does so in development. The reason differs: Prisma guards against hot reload
// opening a second connection pool. Here a reload would silently reset the
// counters mid-test and make a broken limit look like a working one.
const g = globalThis as unknown as {
  __rateBuckets?: Map<string, Bucket>;
  __rateSweep?: number;
  __rateLogTokens?: number;
  __rateLogAt?: number;
};
const buckets: Map<string, Bucket> = (g.__rateBuckets ??= new Map());

/**
 * A ceiling on how much memory this can occupy. An attacker rotating addresses
 * mints a bucket per request; a real restaurant needs a few dozen keys.
 */
const MAX_KEYS = 10_000;
const SWEEP_EVERY_MS = 60_000;
/** Bounds a key's memory, not just the key count. See `key`. */
const MAX_PART = 96;
/** A success can buy back at most one failure this often. See `relax`. */
const RELAX_EVERY_MS = 60_000;

/**
 * Drop what has gone stale; if that was not enough, drop what expires soonest.
 *
 * Two earlier versions got this wrong. The first only swept above 500 entries,
 * so it did nothing until the map was already too big and then walked it on
 * every read while freeing nothing. The second evicted in insertion order —
 * but `Map.set` on an existing key does not reorder it, so long-lived honest
 * buckets were permanently "oldest" and a flood of fresh keys evicted *them*
 * while resetting the attacker's own throttle. Choosing by expiry cannot be
 * steered that way: the attacker's newest buckets are the furthest out.
 */
function sweep(now: number): void {
  if (now - (g.__rateSweep ?? 0) < SWEEP_EVERY_MS && buckets.size <= MAX_KEYS) return;
  g.__rateSweep = now;

  for (const [k, b] of buckets) {
    if (b.expires < now && b.until < now) buckets.delete(k);
  }

  if (buckets.size > MAX_KEYS) {
    // Counted before the loop: `Map.size` is live, so testing against it while
    // deleting moved the bound down as the index moved up and evicted only half
    // of what was asked for — leaving the map over the cap and paying for a
    // full sort on every request to under-evict again.
    const excess = buckets.size - MAX_KEYS;
    const byExpiry = [...buckets.entries()].sort(
      (a, b) => Math.max(a[1].expires, a[1].until) - Math.max(b[1].expires, b[1].until),
    );
    for (let i = 0; i < excess; i++) buckets.delete(byExpiry[i][0]);
  }
}

export interface Verdict {
  ok: boolean;
  /** Whole seconds to wait, for the message shown to whoever is waiting. */
  retryAfter: number;
  /** Failures on the record, so a caller can log the interesting ones only. */
  fails: number;
}

const ALLOWED: Verdict = Object.freeze({ ok: true, retryAfter: 0, fails: 0 });

function stale(b: Bucket, now: number): boolean {
  return b.expires < now && b.until < now;
}

/**
 * Is this key allowed an attempt right now? Reads only; records nothing.
 *
 * Takes no policy: `fail` already wrote the deadline into the bucket, so
 * deciding needs the clock and nothing else.
 */
export function check(key: string): Verdict {
  const now = Date.now();
  sweep(now);

  const b = buckets.get(key);
  if (!b) return ALLOWED;

  if (b.until > now) {
    return { ok: false, retryAfter: Math.ceil((b.until - now) / 1000), fails: b.fails };
  }
  if (stale(b, now)) {
    buckets.delete(key);
    return ALLOWED;
  }
  // The wait has run out, but the failures behind it stay on the record until
  // the window closes — otherwise waiting out each pause buys a fresh full
  // allowance and the doubling never bites.
  return { ok: true, retryAfter: 0, fails: b.fails };
}

/**
 * Record a wrong guess and say what it cost.
 *
 * Called for every attempt that did not end in a session — including ones
 * refused for a reason other than the secret being wrong. A correct PIN
 * belonging to someone not allowed at this branch still tells an attacker they
 * found a real PIN, so it has to be as expensive as a wrong one.
 */
export function fail(key: string, policy: Policy): Verdict {
  const now = Date.now();
  // ⚠️ A wait already being served is never extended — see the guard below.
  //
  // The first version reset the deadline on every failure, which made it a
  // sliding block rather than a cooldown. That is the difference between "wait
  // ten seconds" and "closed indefinitely": an attacker sending one failure
  // every nine seconds against a key everyone shares would have kept it shut
  // forever, and on this endpoint that means no cashier can reopen a till.
  //
  // With the guard, every cycle ends in the door being open for at least one
  // attempt, whoever gets there first.

  let b = buckets.get(key);
  // Self-healing rather than trusting that `check` pruned first: a caller that
  // returns early on one key never checks the others, and a stale bucket there
  // would accumulate on top of a count that should have been zero.
  if (b && stale(b, now)) b = undefined;
  if (!b) b = { fails: 0, expires: now + policy.windowMs, until: 0, relaxed: 0 };

  b.fails += 1;
  b.expires = now + policy.windowMs;

  if (b.fails >= policy.attempts && b.until <= now) {
    const over = b.fails - policy.attempts;
    // `2 ** over` reaches Infinity eventually; Math.min handles that, and the
    // cap is what the answer was going to be anyway.
    b.until = now + Math.min(policy.baseLockMs * 2 ** over, policy.maxLockMs);
  }

  buckets.set(key, b);
  sweep(now);

  return b.until > now
    ? { ok: false, retryAfter: Math.ceil((b.until - now) / 1000), fails: b.fails }
    : { ok: true, retryAfter: 0, fails: b.fails };
}

/** A correct secret on a key that names one actor: forget the failures. */
export function succeed(key: string): void {
  buckets.delete(key);
}

/**
 * A correct secret's effect on a **shared** key: one step back, at most once a
 * minute.
 *
 * The metering is the whole point, and its absence was the flaw that made two
 * earlier versions of this useless. Clearing a shared key on success let an
 * insider who knew one valid PIN burn the building's allowance guessing, sign
 * in with their own PIN, and start again. Decrementing without a clock was no
 * better: nothing meters *successes*, so N sign-ins bought back N failures and
 * the attacker simply alternated — two requests per guess and never a wait.
 *
 * Tied to a clock, relief accrues at most once a minute however many times
 * anyone signs in, which is slower than the throttle it is relieving. Honest
 * traffic still recovers from an evening of mistyping; an attacker cannot
 * outrun it.
 */
export function relax(key: string): void {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b) return;

  // Never shorten a wait already being served. No caller can reach this while
  // locked today — they all gate on `check` first — but the next one might.
  if (b.until > now) return;
  if (now - b.relaxed < RELAX_EVERY_MS) return;

  b.relaxed = now;
  b.fails = Math.max(0, b.fails - 1);
  if (b.fails === 0) buckets.delete(key);
}

/**
 * The address the request actually came from.
 *
 * The app binds 127.0.0.1 and only Caddy can reach it, so `X-Forwarded-For` is
 * trustworthy here in a way it never is on a directly exposed server. But the
 * header is a *list*, and a proxy appends: a client sending
 * `X-Forwarded-For: 1.2.3.4` gets their real address added after it. Reading
 * the first entry — the usual mistake — reads the attacker's own writing.
 *
 * ⚠️ This rests on the `proxyheaders` snippet in the server's global Caddyfile,
 * which is not in this repository. If that snippet ever passes the client's own
 * header through untouched, everything keyed on an address here is decorative —
 * which is part of why `GLOBAL_POLICY` exists. And if a CDN is ever put in
 * front, the last entry becomes the edge's address and every visitor collapses
 * into a handful of buckets.
 */
/**
 * `*` names the key that everyone shares, so no address may spell it. Should
 * the proxy contract ever slip and let a client choose its own address, one
 * presenting `*` would otherwise land in the global bucket and trip a door
 * meant to take two hundred attempts in about fifteen.
 */
function safe(ip: string): string {
  return ip === "*" ? "star" : ip.slice(0, 64);
}

export async function clientIp(): Promise<string> {
  const h = await headers();

  const fwd = h.get("x-forwarded-for");
  if (fwd) {
    // Read from the end rather than splitting: the value is attacker-influenced
    // and can be enormous, and only the last entry is ever used.
    const cut = fwd.lastIndexOf(",");
    const last = (cut === -1 ? fwd : fwd.slice(cut + 1)).trim();
    if (last) return safe(last);
  }

  const real = h.get("x-real-ip");
  if (real) return safe(real.trim());

  // No proxy headers at all. Rather than fall back to "no limit", everything
  // unattributable shares one bucket: a misconfiguration should narrow the
  // door, not open it.
  return "unknown";
}

/**
 * Build a key whose parts cannot run into each other or grow without bound.
 *
 * A bare IPv6 address contains colons, so `pos:${ip}:${posId}` is ambiguous.
 * The separator is escaped rather than stripped — stripping made `a|b` and `ab`
 * the same key — and every part is cut to a fixed length, because one caller
 * builds a key from a submitted email address and `MAX_KEYS` bounds how many
 * keys exist, not how large one can be.
 */
export function key(...parts: string[]): string {
  return parts.map((p) => p.slice(0, MAX_PART).replace(/\|/g, "%7C")).join("|");
}

/**
 * The shared-by-everyone door: make the caller wait rather than turning them
 * away.
 *
 * A hard refusal on a key that every branch, every till and every driver shares
 * is a way to close a business, and review found exactly that — one failure
 * every nine seconds from anywhere would have kept the sign-in endpoint shut
 * for everyone, indefinitely. A key nobody can be excluded from must not be
 * able to exclude anybody.
 *
 * So this delays instead. An attacker is held to a few requests a second; a
 * cashier who happens to arrive during an attack waits at most two seconds and
 * is then treated normally. Awaiting a timer costs a Node process almost
 * nothing, and the ceiling is what keeps that true.
 */
export async function slowDown(verdict: Verdict): Promise<void> {
  if (verdict.ok) return;
  await new Promise((r) => setTimeout(r, Math.min(verdict.retryAfter * 1000, 2000)));
}

/** How long to wait, in words a cashier can act on. */
export function waitMessage(seconds: number): string {
  if (seconds < 90) return `Too many attempts. Wait ${Math.max(1, seconds)} seconds and try again.`;
  const mins = Math.ceil(seconds / 60);
  return `Too many attempts. Wait ${mins} minutes and try again.`;
}

/**
 * Is this failure worth a row in the audit log?
 *
 * Two limits, because per-key sampling alone was not enough. A fresh source
 * address has `fails === 1`, so an attacker rotating addresses still wrote one
 * row per request — turning an unauthenticated endpoint into unbounded disk
 * growth on the restaurant's own server, which is the thing it was added to
 * prevent.
 *
 * So: interesting-per-key, *and* a hard ceiling of one row a second across the
 * whole process. An owner needs to see that an attack happened, not to own a
 * row per guess.
 */
export function worthLogging(v: Verdict): boolean {
  if (!(v.fails === 1 || !v.ok || v.fails % 25 === 0)) return false;

  const now = Date.now();
  const since = now - (g.__rateLogAt ?? 0);
  if (since >= 60_000) {
    g.__rateLogAt = now;
    g.__rateLogTokens = 60;
  }
  const left = g.__rateLogTokens ?? 60;
  if (left <= 0) return false;
  g.__rateLogTokens = left - 1;
  return true;
}
