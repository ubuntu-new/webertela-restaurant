"use client";

/**
 * Re-entry to an already-open shift when there is no connection.
 *
 * The till locks itself after three minutes of stillness, and unlocking asks
 * the server to check the PIN. Offline that request fails, so the lock that
 * exists to protect a shift instead ends it: a terminal that has queued nine
 * sales, cannot be reopened, and cannot be signed into either — because
 * signing in also needs the server. The Friday it happens, the queue sits
 * unsent behind a screen nobody can get past.
 *
 * So the PIN the server accepted at sign-in is hashed and kept on the device,
 * and offline unlocking compares against that.
 *
 * ── What this does and does not claim ──
 *
 * It proves one thing: *the same PIN that opened this shift, on this terminal,
 * minutes ago*. It cannot start a shift — a cold sign-in still goes to the
 * server, always — and the value is written only after the server has said yes
 * and deleted the moment the shift ends.
 *
 * The hash is salted with the terminal id and iterated, so the stored value is
 * not a lookup key for the PIN and is worthless on a different till. That is
 * deliberately weaker than the server's own scheme and it does not need to be
 * stronger: an attacker holding the tablet already has the cash drawer, which
 * opens with a key. The risk this accepts is far smaller than the one it
 * removes.
 */

const PIN_KEY = "ronnys-pos-unlock";
const ROUNDS = 60_000;

const enc = new TextEncoder();

function usable(): boolean {
  return typeof crypto !== "undefined" && !!crypto.subtle;
}

/**
 * PBKDF2 rather than a bare digest: a four-digit PIN has ten thousand
 * possibilities, and a single SHA-256 pass over that space is instant. This
 * makes each guess cost something, which is the only defence a short secret has
 * once its hash is sitting on the device.
 */
async function derive(pin: string, posId: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(`ronnys-pos:${posId}`), iterations: ROUNDS, hash: "SHA-256" },
    key,
    256,
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Called only after the server has accepted this PIN. */
export async function rememberPin(pin: string, posId: string): Promise<void> {
  if (!usable()) return;
  try {
    localStorage.setItem(PIN_KEY, JSON.stringify({ posId, hash: await derive(pin, posId) }));
  } catch {
    /* offline unlock is a convenience; failing to store it is not an error */
  }
}

/** Whether an offline unlock is even possible on this terminal right now. */
export function canUnlockOffline(posId: string): boolean {
  if (!usable()) return false;
  try {
    const saved = JSON.parse(localStorage.getItem(PIN_KEY) ?? "null");
    return !!saved?.hash && saved.posId === posId;
  } catch {
    return false;
  }
}

export async function matchesPin(pin: string, posId: string): Promise<boolean> {
  if (!usable()) return false;
  try {
    const saved = JSON.parse(localStorage.getItem(PIN_KEY) ?? "null");
    if (!saved?.hash || saved.posId !== posId) return false;
    const got = await derive(pin, posId);

    // Constant-time comparison. The margin it buys over a timing attack on a
    // local string compare is thin, but the cost is four lines.
    if (got.length !== saved.hash.length) return false;
    let diff = 0;
    for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ saved.hash.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}

/** The shift is over: the device should not be able to reopen it. */
export function forgetPin(): void {
  try {
    localStorage.removeItem(PIN_KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Making an offline guess cost something.
 *
 * ⚠️ Read this before trusting it. The check above compares a typed PIN against
 * a hash of one the *server accepted*, on the device, with none of the server's
 * defences. That is a real oracle and it cannot be argued away — it is kept
 * because the alternative is a till that dies when a router does, and it is the
 * narrowest version available: one PIN, this terminal, gone at sign-out.
 *
 * What this adds is price. The count is persisted, so a reload does not buy
 * five fresh attempts, and it is raised *before* the comparison, so twenty
 * concurrent taps cost twenty increments rather than one. Five free, then a
 * doubling wait to two minutes: the whole four-digit space costs about a
 * fortnight instead of a few seconds.
 *
 * What it does not do, and no client-side control can: an attacker with the
 * tablet and a devtools console reads the hash out of localStorage and attacks
 * it offline, untouched by any of this. This raises the cost of the *easy* path
 * — driving the real UI — and nothing more. A shorter answer would be a longer
 * PIN.
 */
const TRIES_KEY = "ronnys-pos-offline-tries";

function triesFor(posId: string): number {
  try {
    const v = JSON.parse(localStorage.getItem(TRIES_KEY) ?? "null");
    return v?.posId === posId && typeof v.n === "number" ? v.n : 0;
  } catch {
    return 0;
  }
}

/**
 * Raise the count and say how long this attempt must wait before it is judged.
 *
 * Returns -1 when the count could not be written. That is deliberate and the
 * caller must refuse the unlock: on a device where the counter cannot persist,
 * the hash still reads and still answers, so guesses would be free — a full
 * disk would quietly turn the throttle off and leave the oracle running. A till
 * that cannot charge for a guess should not sell one.
 */
export function bumpOfflineTries(posId: string): number {
  const n = triesFor(posId) + 1;
  try {
    localStorage.setItem(TRIES_KEY, JSON.stringify({ posId, n }));
  } catch {
    return -1;
  }
  // Five free. The sixth waits two seconds, and each one after that doubles to
  // a two-minute ceiling.
  return n <= 5 ? 0 : Math.min(2 ** (n - 5), 120) * 1000;
}

/** Called only after the server, or the shift's own PIN, has said yes. */
export async function resetOfflineTries(posId: string): Promise<void> {
  try {
    localStorage.setItem(TRIES_KEY, JSON.stringify({ posId, n: 0 }));
  } catch {
    /* nothing to clear */
  }
}
