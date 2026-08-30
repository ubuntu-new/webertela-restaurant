"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { detailLines, lineColor } from "@/lib/item-detail";
import { refreshCachedPage, useOfflineShell } from "./use-offline-shell";
import {
  bumpOfflineTries, canUnlockOffline, forgetPin, matchesPin, rememberPin, resetOfflineTries,
} from "./local-pin";
import { makeFmt } from "@/lib/format-shared";
import type { OrgFormat } from "@/lib/format-shared";

/**
 * POS terminal.
 *
 * Offline foundations present from day one (see the API route):
 *   1. every order carries a `clientRef` uuid — resending is free
 *   2. orders enter a LOCAL QUEUE before being sent, drained by a sender
 *   3. the receipt shows a local number; the server assigns the real one
 *
 * Layout follows what tills actually need: catalogue left, ticket right,
 * everything reachable without scrolling the ticket away.
 */

const SIZES = ["S", "M", "XL"];
const CRUSTS = ["Original", "Thin"];
const SAUCES = ["None", "Light", "Regular", "Extra"];
const QUICK_CASH = [5, 10, 20, 50, 100];
/** Lock after this long with no interaction. */
const IDLE_MS = 3 * 60 * 1000;

const QUEUE_KEY = "ronnys-pos-queue";
const TERMINAL_KEY = "ronnys-pos-terminal";
const COUNTER_KEY = "ronnys-pos-counter";
const HELD_KEY = "ronnys-pos-held";
/**
 * The menu, kept on the device.
 *
 * It arrives as a server-rendered prop, which is right while there is a
 * connection and useless without one. The service worker can serve the last
 * page it saw, but that page could be days old and nothing on screen would say
 * so. Storing the menu separately, with the moment it was confirmed, lets the
 * till both keep working and admit how old what it is showing is.
 */
const MENU_KEY = "ronnys-pos-menu";
/**
 * Who is signed in, kept on the device.
 *
 * `signedIn` starts from a server-rendered prop, and offline there is no server
 * render — the page comes from the cache carrying whatever session state it had
 * when it was stored. Cache it while signed out and every offline reload throws
 * the cashier back to the sign-in screen, mid-shift, with queued sales behind
 * it. That is the precise failure this whole change exists to prevent, arriving
 * by a different door.
 *
 * So the terminal remembers its own session. The cookie is still the authority:
 * it rides along with every request, and if the server disagrees the first API
 * call comes back 401 and signs the terminal out. This only decides what to
 * show while nobody can be asked.
 */
const SESSION_KEY = "ronnys-pos-session";
/** Mirrors TTL_HOURS in lib/pos-auth.ts — the cookie's own life. */
const SESSION_MS = 14 * 60 * 60 * 1000;

interface Pizza { id: number; name: string; sizes: [number, number, number]; ings: string[] }
interface Item { id: string; name: string; price: number; photo?: string }
interface Topping { name: string; ps: [number, number, number] }
interface Menu {
  PIZZAS: Pizza[];
  PIZZA_PHOTOS: Record<number, string>;
  TOPPINGS: Topping[];
  EXTRAS: Item[];
  SAUCES: Item[];
  DRINKS: Item[];
}

interface Line {
  key: string;
  kind: "pizza" | "simple";
  name: string;
  qty: number;
  price: number;
  photo?: string;
  note?: string;
  pizzaId?: number;
  itemId?: string;
  sizeIdx?: number;
  crustIdx?: number;
  sauceIdx?: number;
  toppings?: Record<string, { whole: number; left: number; right: number }>;
  removed?: Record<string, boolean>;
  ingredients?: string[];
}

interface CustomerAddress { id: string; title: string | null; line: string; note: string | null; isDefault: boolean }
interface Customer {
  id: string;
  name: string | null;
  phone: string | null;
  points: number;
  orders: number;
  addresses: CustomerAddress[];
}

interface Held { id: string; label: string; lines: Line[]; at: number }
interface RecentOrder {
  id: string;
  no: number;
  status: string;
  total: number;
  at: string;
  customer: string | null;
  items: { name: string; qty: number; detail: string; total: number }[];
}

/**
 * A sale waiting to be sent, and **whose sale it is**.
 *
 * `shift` is the missing half. Without it the queue is a shared tray: whoever
 * next has a valid cookie sends everything in it, under their own name. That is
 * not hypothetical — it is reachable by the most ordinary sequence there is.
 * Ana signs in, the connection drops, she takes four orders, she locks the till
 * and goes home. Bekah unlocks it, which re-issues the cookie in *her* name,
 * and Ana's four orders file as Bekah's: her sales figures, her audit rows, her
 * name on a void investigation later.
 *
 * So each order remembers the shift that rang it up, and the drainer sends only
 * what belongs to the shift that is signed in now. Anything else is held and
 * shown, to be adopted on purpose or not at all.
 */
interface Queued {
  clientRef: string;
  localNo: string;
  payload: unknown;
  at: number;
  /** Which shift took this. Absent on rows queued before this existed. */
  shift?: string;
  /**
   * Whose shift it was, in words. The session id answers "the same one?" and
   * nothing else — it exists nowhere on the server, so an audit row carrying
   * only that says an adoption happened and cannot say from whom.
   */
  by?: string;
  /**
   * What the till showed when it was rung up.
   *
   * Not authoritative — the payload carries no prices on purpose, because the
   * server reprices everything and a client that could name its own total would
   * be a much worse problem than a stale one. This is only so that a cashier
   * being asked to take responsibility for four unsent sales can see roughly
   * what they come to, and notice if the figure is absurd.
   */
  total?: number;
}

/** "on 3h 20m" — the shift so far, in the shape a person reads it. */
function onFor(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `on ${mins}m`;
  return `on ${Math.floor(mins / 60)}h ${mins % 60}m`;
}

const uuid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function PosTerminal({
  session,
  menu: menuProp,
  branches,
  terminals,
  org,
  unavailable = [],
  unavailableItems = [],
}: {
  session: { name: string; branchId: string; posId: string } | null;
  menu: Menu | null;
  branches: { id: string; name: string; code: string }[];
  terminals: { posId: string; branchId: string; label: string }[];
  org: OrgFormat;
  unavailable?: number[];
  unavailableItems?: string[];
}) {
  const f = useMemo(() => makeFmt(org), [org]);

  const [branchId, setBranchId] = useState("");
  const [posId, setPosId] = useState("");
  const [pin, setPin] = useState("");
  const [signedIn, setSignedIn] = useState(!!session);
  const [who, setWho] = useState(session?.name ?? "");
  const [error, setError] = useState<string | null>(null);

  const [lines, setLines] = useState<Line[]>([]);
  const [editing, setEditing] = useState<Line | null>(null);
  const [tab, setTab] = useState("Pizza");
  const [search, setSearch] = useState("");
  const [fulfillment, setFulfillment] = useState<"pickup" | "delivery">("pickup");
  const [customer, setCustomer] = useState({ name: "", phone: "", address: "", notes: "" });
  const [known, setKnown] = useState<Customer | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [addrId, setAddrId] = useState<string | null>(null);
  const [usePoints, setUsePoints] = useState(false);
  const [suggestions, setSuggestions] = useState<Customer[]>([]);
  const [showSug, setShowSug] = useState(false);
  const [paying, setPaying] = useState(false);
  const [tendered, setTendered] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<{ no: number | string; total: number; change: number | null } | null>(null);

  const [held, setHeld] = useState<Held[]>([]);
  const [showHeld, setShowHeld] = useState(false);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [online, setOnline] = useState(true);
  const [locked, setLocked] = useState(false);
  const [unlockPin, setUnlockPin] = useState("");
  const [recent, setRecent] = useState<RecentOrder[] | null>(null);

  /**
   * Identifies the shift currently signed in, so a queued sale can say which
   * one it belongs to. Minted at sign-in, and at an unlock that changed who is
   * standing there — see `unlock`.
   *
   * Minted by the server, never here. Two earlier attempts decided "is this the
   * same person?" by comparing the displayed name, which is wrong in both
   * directions: two employees called Ana miss a real handover, and an unlock
   * before the name has loaded invents one that did not happen.
   *
   * State rather than a ref, so that the list of another shift's unsent sales
   * can be *derived* from the queue rather than stored beside it. Stored, the
   * two drifted: the count came from React state, the orphan list from a
   * localStorage read inside the drainer, and after an unlock the header showed
   * sales "to sync" that would never be sent, with no button, until the next
   * fifteen-second tick noticed.
   */
  const [shift, setShift] = useState<string | null>(null);

  /**
   * When this person clocked in.
   *
   * Shown because a cashier has no other way to know their hours are being
   * counted, and hours nobody can see are hours nobody trusts. It is also the
   * cheapest possible prompt to sign out at the end: a number that has been
   * climbing all evening is harder to walk away from than a blank screen.
   */
  const [since, setSince] = useState<string | null>(null);

  /**
   * One offline unlock at a time.
   *
   * Without it, holding Enter down during a two-minute wait queued sixty
   * attempts that all read the same count, all slept the same delay together,
   * and all cost one increment between them. The delay looked like a throttle
   * and was a batching opportunity.
   */
  const unlocking = useRef(false);
  /** The confirmation shown before another shift's sales become this one's. */
  const [adopting, setAdopting] = useState(false);

  /**
   * Sales queued by a shift that is no longer signed in.
   *
   * Derived, never stored. Held rather than sent, and shown rather than hidden:
   * silently refusing to send them would be the worse bug, because the count
   * beside "to sync" would never fall and nobody would know why.
   *
   * A row with no `shift` at all predates this field and is treated as ours —
   * the old behaviour, and the only sane reading of a row that never recorded
   * an owner. Those are gone within a day of deploying.
   */
  const orphans = useMemo(
    () => queue.filter((q) => q.shift && q.shift !== shift),
    [queue, shift],
  );

  /**
   * What the held sales came to on screen. A count alone is not enough to
   * notice a wrong number; a figure is something a cashier can weigh against
   * the drawer before putting their name to it.
   */
  const orphanTotal = useMemo(
    () => Math.round(orphans.reduce((sum, q) => sum + (q.total ?? 0), 0) * 100) / 100,
    [orphans],
  );
  const [savedMenu, setSavedMenu] = useState<{ menu: Menu; at: number } | null>(null);
  const [voiding, setVoiding] = useState<RecentOrder | null>(null);
  const [voidPin, setVoidPin] = useState("");
  const [voidReason, setVoidReason] = useState("");

  const shell = useOfflineShell();

  /**
   * What the till actually sells from: the freshly rendered menu when there is
   * one, otherwise the last one stored on the device.
   *
   * `menuProp` is null when the server could not build a menu — the database is
   * unreachable, or this is a cached page from a load that already failed. That
   * used to be a dead screen reading "Menu unavailable", which is the correct
   * message only if there is genuinely nothing to sell from, and there almost
   * never is.
   */
  const menu = menuProp ?? savedMenu?.menu ?? null;

  /** How old what is on screen might be, in words, or null while it is live. */
  const menuAge = useMemo(() => {
    if (menuProp && online) return null;
    if (!savedMenu) return null;
    const mins = Math.round((Date.now() - savedMenu.at) / 60000);
    if (mins < 2) return "just now";
    if (mins < 60) return `${mins} minutes ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
    const days = Math.round(hrs / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }, [menuProp, online, savedMenu]);

  // Every load that reaches the server refreshes the stored copy. Writing it on
  // each render would be wasteful; the menu only changes when the page does.
  useEffect(() => {
    if (!menuProp) return;
    const record = { menu: menuProp, at: Date.now() };
    setSavedMenu(record);
    try {
      localStorage.setItem(MENU_KEY, JSON.stringify(record));
    } catch {
      // Storage full or blocked. The till still works right now; it simply will
      // not survive a reload, which is what the badge in the header reports.
    }
  }, [menuProp]);

  /**
   * Confirm a locally restored session the moment the connection allows it.
   *
   * The terminal restores its shift from the device when there is no server to
   * ask. Usually right; occasionally not — the cookie can have been cleared, or
   * the employee deactivated mid-shift. Without this the first proof arrives
   * when a queued order comes back 401, by which time the cashier has already
   * taken the money and handed over the food.
   *
   * GET /api/pos/session is the cheapest possible answer: it returns the
   * session the cookie actually carries, or null. Only a definitive null signs
   * the terminal out — a failed request means the connection is still bad, not
   * that the shift is over.
   */
  useEffect(() => {
    if (!online || !signedIn || !posId) return;
    let gone = false;

    (async () => {
      try {
        const res = await fetch("/api/pos/session", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (gone) return;

        // A session for a different terminal is as wrong as none: this device
        // would be filing its sales under someone else's till.
        const valid = data?.session && data.session.posId === posId;

        // The cookie carries its own session id. If it no longer matches, this
        // shift ended somewhere else — a second tab, another till sharing the
        // browser — and everything queued under the old one has to stop
        // draining here rather than going out under a stranger's name.
        if (valid && typeof data.session.since === "string") setSince(data.session.since);

        if (valid && typeof data.session.shift === "string" && data.session.shift !== shift) {
          setShift(data.session.shift);
          setWho(data.session.name ?? "");
        }

        if (!valid) {
          try { localStorage.removeItem(SESSION_KEY); } catch { /* already gone */ }
          forgetPin();
          setSignedIn(false);
          setError(
            queue.length > 0
              ? "The shift ended while this till was offline. Sign in to send the orders still stored here."
              : "The shift ended while this till was offline. Please sign in again.",
          );
        }
      } catch {
        /* still unreachable — believe the device until the server can answer */
      }
    })();

    return () => {
      gone = true;
    };
    // Deliberately not keyed on `queue`: this is a check that runs when the
    // connection or the shift changes, not on every sale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // `shift` is read to compare, not to trigger: re-running on every shift
    // change would ask the server again immediately after we just learned the
    // answer from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, signedIn, posId]);

  // ── boot ──
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(TERMINAL_KEY) ?? "null");
      if (saved?.branchId) setBranchId(saved.branchId);
      if (saved?.posId) setPosId(saved.posId);
      const q = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
      if (Array.isArray(q)) setQueue(q);
      const h = JSON.parse(localStorage.getItem(HELD_KEY) ?? "[]");
      if (Array.isArray(h)) setHeld(h);
      const m = JSON.parse(localStorage.getItem(MENU_KEY) ?? "null");
      if (m?.menu?.PIZZAS) setSavedMenu(m);
    } catch {
      /* first run */
    }
    if (session) {
      setBranchId(session.branchId);
      setPosId(session.posId);
      // Keep the shift this device already recorded rather than minting a new
      // one: the cookie has not changed, so neither has whose sales these are.
      // Replacing it would orphan everything queued before the reload.
      //
      // Computed *outside* the try. Inside it, a storage read that threw —
      // private browsing, a full disk — left the id null, and a null id writes
      // sales with no owner at all, which the next shift then claims silently.
      let prevShift: string | null = null;
      try {
        prevShift = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null")?.shift ?? null;
      } catch {
        /* unreadable — a fresh id below is the safe answer, not no id */
      }
      const id = prevShift ?? uuid();
      setShift(id);

      try {
        localStorage.setItem(
          SESSION_KEY,
          JSON.stringify({
            name: session.name, branchId: session.branchId, posId: session.posId,
            at: Date.now(), shift: id,
          }),
        );
      } catch {
        /* the shift still works; only an offline reload would forget it */
      }
    } else {
      // No server-rendered session. Either genuinely signed out, or this page
      // came from the cache with no connection to ask. Only the device knows.
      try {
        const saved = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
        if (saved?.posId && Date.now() - saved.at < SESSION_MS) {
          // `?? uuid()` and not `?? null`. A session stored by the previous
          // release has no `shift`, and for the fourteen hours those records
          // stay valid a null here would make every sale unowned — the exact
          // bug this change exists to close, on the day it ships.
          setShift(saved.shift ?? uuid());
          setBranchId(saved.branchId);
          setPosId(saved.posId);
          setWho(saved.name ?? "");
          setSignedIn(true);
        } else if (saved) {
          // Past the cookie's own lifetime, so the server would refuse it too.
          localStorage.removeItem(SESSION_KEY);
        }
      } catch {
        /* nothing stored — the sign-in screen is correct */
      }
    }
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [session]);

  /**
   * Autocomplete from 3 characters.
   *
   * The 250ms delay is not cosmetic: firing on every keystroke floods a till's
   * connection and answers arrive out of order, so the last thing typed isn't
   * the last thing shown. `cancelled` drops any reply that a newer query has
   * already superseded.
   */
  useEffect(() => {
    const q = customer.phone.trim();
    if (q.length < 3) { setSuggestions([]); return; }

    let cancelled = false;
    const id = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/pos/customers?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (!cancelled) {
          setSuggestions(Array.isArray(data.results) ? data.results : []);
          setShowSug(true);
        }
      } catch {
        /* silent — autocomplete is a convenience, not a requirement */
      }
    }, 250);

    return () => { cancelled = true; window.clearTimeout(id); };
  }, [customer.phone]);

  const pickCustomer = useCallback((c: Customer) => {
    setKnown(c);
    setShowSug(false);
    setSuggestions([]);
    const def = c.addresses.find((a) => a.isDefault) ?? c.addresses[0];
    setAddrId(def?.id ?? null);
    setCustomer((cur) => ({
      ...cur,
      name: c.name ?? cur.name,
      phone: c.phone ?? cur.phone,
      address: def?.line ?? cur.address,
    }));
  }, []);

  const persistQueue = useCallback((q: Queued[]) => {
    setQueue(q);
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* full */ }
  }, []);

  const persistHeld = useCallback((h: Held[]) => {
    setHeld(h);
    try { localStorage.setItem(HELD_KEY, JSON.stringify(h)); } catch { /* full */ }
  }, []);

  /**
   * Drain the queue. Safe at any time — `clientRef` makes retries free.
   *
   * Only this shift's own sales are sent. Anything belonging to an earlier one
   * is left where it is and surfaced instead, because sending it now would file
   * it under the person signed in now — see the note on `Queued`.
   *
   * Rows queued before this field existed have no `shift` and are treated as
   * this shift's, which is the old behaviour and the only sane reading of a row
   * that never recorded an owner. Those disappear within a day of deploying.
   */
  const drain = useCallback(async () => {
    const all: Queued[] = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
    if (all.length === 0) return;

    const current = all.filter((q) => !q.shift || q.shift === shift);
    const others = all.filter((q) => q.shift && q.shift !== shift);
    if (current.length === 0) return;

    const left: Queued[] = [...others];
    for (const q of current) {
      try {
        const res = await fetch("/api/pos/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(q.payload),
        });
        if (res.status === 401) {
          // The server has the final word. Whatever the device believed, the
          // shift is over — and the order stays queued for whoever signs in next.
          try { localStorage.removeItem(SESSION_KEY); } catch { /* already gone */ }
          setSignedIn(false);
          left.push(q);
          continue;
        }
        if (!res.ok && res.status >= 500) { left.push(q); continue; }
        // a 4xx that isn't auth will never be accepted — keeping it blocks the queue
      } catch {
        left.push(q);
      }
    }
    persistQueue(left);
  }, [persistQueue, shift]);

  useEffect(() => {
    if (!signedIn) return;
    drain();
    const id = window.setInterval(drain, 15000);
    return () => window.clearInterval(id);
  }, [signedIn, drain, online]);

  /**
   * Idle lock.
   *
   * The session lasts a shift, but the terminal stands on a counter all day.
   * Without this, "who sold this" stops meaning anything the moment the
   * cashier steps away — anyone can ring up a sale under their name.
   */
  useEffect(() => {
    if (!signedIn) return;
    let timer: number;

    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setLocked(true), IDLE_MS);
    };

    const events = ["pointerdown", "keydown", "wheel"];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();

    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [signedIn]);

  /**
   * Reopen a locked terminal.
   *
   * Online this asks the server, as it always did. Offline it compares against
   * the PIN the server accepted when this shift began — see local-pin.ts for
   * why that is a safe trade. Without it the three-minute idle lock becomes a
   * closed till: the unlock needs the network, and so does signing in again, so
   * a cashier who steps away during an outage comes back to a screen with nine
   * unsent sales behind it and no way through.
   */
  const unlock = async () => {
    setError(null);
    try {
      const res = await fetch("/api/pos/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: unlockPin, branchId, posId }),
      });

      if (!res.ok) {
        // This branch used to say "PIN not recognised" whatever the server
        // answered, which is the most-travelled path on the whole till — the
        // terminal re-locks every three minutes — and now that attempts are
        // rate limited it would be a lie in the one case that matters. A
        // cashier told their correct PIN is wrong types it again, which is
        // exactly the wrong thing to do, and the field being cleared each time
        // makes it feel broken rather than throttled.
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "PIN not recognised");
        // Keep what they typed when the server is asking them to wait: it was
        // probably right, and re-entering it changes nothing.
        if (res.status !== 429) setUnlockPin("");
        return;
      }

      /**
       * Unlocking is really a re-sign-in: the server issues a cookie for
       * whoever's PIN was typed, so the shift may have changed hands. Ana locks
       * the till and goes home; Bekah unlocks it; from this moment the sales
       * are Bekah's, and the device has to agree with the server about that.
       *
       * A new shift id is minted for exactly that reason. Anything Ana queued
       * stays hers and stops draining here — the point of the id.
       */
      const data = await res.json().catch(() => ({}));
      const name = typeof data?.name === "string" ? data.name : who;
      const nextShift = typeof data?.shift === "string" ? data.shift : null;

      /**
       * A new shift only when somebody new is standing there.
       *
       * Unlocking is a re-sign-in — the server issues a cookie for whoever's
       * PIN was typed — so a handover really is a new shift and Ana's unsent
       * sales must stop draining as Bekah's. But the till re-locks every three
       * minutes, and minting on *every* unlock meant Ana adopting her own sales
       * from nine minutes ago, a dozen times a shift. That trains a cashier to
       * press the adopt button without reading it, which destroys the one thing
       * it is for.
       */
      // The server decides. A sign-in by the same person still produces a new
      // session id, which is correct: the cookie really did change, and rows
      // queued under the old one belong to a shift that has ended.
      const handover = !!nextShift && nextShift !== shift;
      if (handover) {
        const id = nextShift;
        setShift(id);
        setWho(name);
        try {
          localStorage.setItem(
            SESSION_KEY,
            JSON.stringify({ name, branchId, posId, at: Date.now(), shift: id }),
          );
        } catch {
          /* the shift is real either way */
        }
        // Only worth the six queries a /pos render costs when the page would
        // actually come back different.
        void refreshCachedPage();
      }

      await resetOfflineTries(posId);
      await rememberPin(unlockPin, posId);
      setLocked(false);
      setUnlockPin("");
    } catch {
      /**
       * No connection, so the stored hash is all there is.
       *
       * ⚠️ Be honest about what this is: a PIN the server *did* bless, checked
       * on the device with none of the server's defences. Someone holding the
       * tablet can pull the network and guess against it. Ten thousand
       * candidates is nothing if the attempts are free.
       *
       * They are not free. The count below survives until the shift ends and
       * the delay doubles, so a scripted search costs days rather than seconds,
       * and the honest cashier who mistypes twice notices nothing. This does
       * not make the local check as good as the server's — nothing on a device
       * can be — it makes using it not worth the attacker's evening.
       */
      if (unlocking.current) return;
      unlocking.current = true;
      try {
        // Charged before the comparison, not after: an attempt that is never
        // judged still has to be paid for, or twenty at once cost one.
        const wait = bumpOfflineTries(posId);
        if (wait < 0) {
          setError("This till cannot check a PIN offline right now. Reconnect to sign in.");
          setUnlockPin("");
          return;
        }
        if (wait > 0) {
          setError(`Wait ${Math.ceil(wait / 1000)} seconds — too many attempts on this till.`);
          await new Promise((r) => setTimeout(r, wait));
        }

        if (await matchesPin(unlockPin, posId)) {
          await resetOfflineTries(posId);
          setLocked(false);
          setUnlockPin("");
          setError(null);
          return;
        }
      } finally {
        unlocking.current = false;
      }

      setError(
        canUnlockOffline(posId)
          ? "PIN not recognised"
          : "No connection, and this terminal has no PIN stored to check against.",
      );
      setUnlockPin("");
    }
  };

  const loadRecent = async () => {
    try {
      const res = await fetch("/api/pos/recent", { cache: "no-store" });
      const data = await res.json();
      setRecent(Array.isArray(data.orders) ? data.orders : []);
    } catch {
      setRecent([]);
    }
  };

  const doVoid = async () => {
    if (!voiding) return;
    setError(null);
    try {
      const res = await fetch("/api/pos/void", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: voiding.id, pin: voidPin, reason: voidReason }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Could not void"); return; }
      setVoiding(null);
      setVoidPin("");
      setVoidReason("");
      loadRecent();
    } catch {
      setError("No connection");
    }
  };

  /**
   * Take responsibility for another shift's unsent sales.
   *
   * One tap, and it is the cashier's own decision. The alternative designs are
   * both worse: sending them automatically puts someone else's takings in this
   * person's name without asking, and leaving them forever means real money
   * never reaches the books. Restamping them makes the adoption explicit here
   * and visible in the audit trail afterwards, since the orders arrive under
   * the adopter's session.
   */
  const adoptOrphans = useCallback(() => {
    const all: Queued[] = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
    const mine = shift ?? uuid();
    const restamped = all.map((q) =>
      q.shift && q.shift !== mine
        ? // Recorded on the order itself, so "Bekah sent four of Ana's sales"
          // is answerable months later from the audit log and not only by
          // whoever happened to be watching the screen. The *name* travels,
          // because the session id means nothing on the server.
          //
          // An existing value is kept: passed along twice, the interesting fact
          // is who took the money, not who handled it last.
          {
              ...q,
              shift: mine,
              payload: {
                ...(q.payload as object),
                adoptedFrom:
                  (q.payload as { adoptedFrom?: string }).adoptedFrom ?? q.by ?? "an earlier shift",
              },
            }
        : { ...q, shift: mine },
    );
    persistQueue(restamped);
    void drain();
  }, [persistQueue, drain, shift]);

  // ── auth ──
  const doSignIn = async () => {
    setError(null);
    try {
      const res = await fetch("/api/pos/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, branchId, posId }),
      });
      // Tolerant of a non-JSON body: a 502 from the proxy is HTML, and throwing
      // here would land in the outer catch and report "no connection" for a
      // server that answered.
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not sign in");
        // Same reasoning as unlock: when the server is asking them to wait,
        // what they typed was probably right and wiping it reads as a fault.
        if (res.status !== 429) setPin("");
        return;
      }
      /**
       * Signing in again as the same person must not orphan her own queue.
       *
       * The session id changes on every sign-in, so treating any change as a
       * handover would mean this: the till loses its cookie mid-outage, the
       * screen says "sign in to send the orders stored here", she does — and
       * every one of her own sales becomes something she has to adopt through a
       * dialogue telling her they are somebody else's. So the previous id is
       * carried when the name is unchanged, and only a different person starts
       * a new shift.
       */
      let prevName: string | null = null;
      let prevShift: string | null = null;
      try {
        const prev = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
        prevName = prev?.name ?? null;
        prevShift = prev?.shift ?? null;
      } catch {
        /* unreadable — a new shift is the safe answer */
      }
      const sameCashier = !!prevShift && prevName === data.name;
      const id = sameCashier ? prevShift : (typeof data.shift === "string" ? data.shift : uuid());
      setSince(typeof data.since === "string" ? data.since : null);

      setShift(id);
      await resetOfflineTries(posId);
      localStorage.setItem(TERMINAL_KEY, JSON.stringify({ branchId, posId }));
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ name: data.name, branchId, posId, at: Date.now(), shift: id }),
      );
      // Only ever stored after the server has said yes.
      await rememberPin(pin, posId);
      setWho(data.name);
      setSignedIn(true);
      // Store the page as it looks signed in, so an offline reload comes back
      // to the till rather than to this screen.
      void refreshCachedPage();
      setPin("");
    } catch {
      setError("No connection to the server");
    }
  };

  /**
   * Phone is the key: one person, one record. Typed number → normalised →
   * either the customer is already here with their addresses and points, or
   * we create them on the spot.
   */
  const lookupCustomer = async () => {
    const phone = customer.phone.trim();
    if (phone.replace(/\D/g, "").length < 6) return;

    setLookingUp(true);
    setError(null);
    try {
      const res = await fetch(`/api/pos/customers?phone=${encodeURIComponent(phone)}`);
      const data = await res.json();
      if (data.customer) {
        setKnown(data.customer);
        setCustomer((c) => ({ ...c, name: data.customer.name ?? c.name }));
        const def = data.customer.addresses.find((a: CustomerAddress) => a.isDefault) ?? data.customer.addresses[0];
        if (def) {
          setAddrId(def.id);
          setCustomer((c) => ({ ...c, address: def.line }));
        }
      } else {
        setKnown(null);
        setAddrId(null);
      }
    } catch {
      setError("Could not look up the customer");
    } finally {
      setLookingUp(false);
    }
  };

  const saveCustomer = async () => {
    const phone = customer.phone.trim();
    if (phone.replace(/\D/g, "").length < 6) { setError("Enter a phone number"); return; }

    setLookingUp(true);
    setError(null);
    try {
      const res = await fetch("/api/pos/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          name: customer.name,
          address:
            fulfillment === "delivery" && customer.address.trim() && !addrId
              ? { street: customer.address.trim() }
              : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Could not save the customer"); return; }
      setKnown(data.customer);
      const def = data.customer?.addresses?.[0];
      if (def && !addrId) { setAddrId(def.id); setCustomer((c) => ({ ...c, address: def.line })); }
    } catch {
      setError("Could not save the customer");
    } finally {
      setLookingUp(false);
    }
  };

  const signOut = async () => {
    forgetPin();
    // Before the await, not after: the DELETE has no timeout, and a hanging
    // request would otherwise leave a signed-in till on screen with no shift —
    // where every sale is instantly an orphan of itself.
    setSignedIn(false);
    setShift(null);
    setSince(null);
    void resetOfflineTries(posId);
    try { localStorage.removeItem(SESSION_KEY); } catch { /* already gone */ }
    await fetch("/api/pos/session", { method: "DELETE" }).catch(() => {
      // Offline sign-out still ends the shift on this device. The cookie
      // expires on its own, and the stored PIN is already gone.
    });
    setLines([]);
  };

  // ── pricing (display only — the server reprices) ──
  const priceOf = useCallback(
    (l: Line): number => {
      if (l.kind !== "pizza" || !menu) return l.price;
      const p = menu.PIZZAS.find((x) => x.id === l.pizzaId);
      if (!p) return l.price;
      const si = l.sizeIdx ?? 1;
      let total = p.sizes[si];
      for (const [name, z] of Object.entries(l.toppings ?? {})) {
        const t = menu.TOPPINGS.find((x) => x.name === name);
        if (!t) continue;
        total += t.ps[si] * (z.whole + 0.5 * z.left + 0.5 * z.right);
      }
      return Math.round(total * 100) / 100;
    },
    [menu],
  );

  const subtotal = useMemo(() => lines.reduce((s, l) => s + l.price * l.qty, 0), [lines]);
  const count = useMemo(() => lines.reduce((s, l) => s + l.qty, 0), [lines]);
  const change = useMemo(() => {
    const t = Number(tendered);
    return Number.isFinite(t) && t >= subtotal ? Math.round((t - subtotal) * 100) / 100 : null;
  }, [tendered, subtotal]);

  // ── cart ──
  const addSimple = (it: Item) => {
    setLines((prev) => {
      const found = prev.find((l) => l.kind === "simple" && l.itemId === it.id && !l.note);
      if (found) return prev.map((l) => (l === found ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { key: uuid(), kind: "simple", name: it.name, itemId: it.id, qty: 1, price: it.price, photo: it.photo }];
    });
  };

  const openPizza = (p: Pizza) =>
    setEditing({
      key: uuid(),
      kind: "pizza",
      name: p.name,
      pizzaId: p.id,
      qty: 1,
      sizeIdx: 1,
      crustIdx: 0,
      sauceIdx: 2,
      toppings: {},
      removed: {},
      ingredients: p.ings,
      photo: menu?.PIZZA_PHOTOS?.[p.id],
      price: p.sizes[1],
    });

  const commitPizza = () => {
    if (!editing) return;
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.key === editing.key);
      const line = { ...editing, price: priceOf(editing) };
      if (idx >= 0) return prev.map((l, i) => (i === idx ? line : l));
      return [...prev, line];
    });
    setEditing(null);
  };

  const setQty = (key: string, delta: number) =>
    setLines((prev) =>
      prev.flatMap((l) => {
        if (l.key !== key) return [l];
        const q = l.qty + delta;
        return q <= 0 ? [] : [{ ...l, qty: q }];
      }),
    );

  const clearTicket = () => {
    setLines([]);
    setCustomer({ name: "", phone: "", address: "", notes: "" });
    setKnown(null);
    setAddrId(null);
    setUsePoints(false);
    setTendered("");
  };

  // ── park / recall ──
  // A cashier constantly needs to set one customer aside and serve the next.
  // Without this they either rush or lose the ticket.
  const park = () => {
    if (lines.length === 0) return;
    const label = customer.name.trim() || `${f.money(subtotal)} · ${count} items`;
    persistHeld([...held, { id: uuid(), label, lines, at: Date.now() }]);
    clearTicket();
  };

  const recall = (h: Held) => {
    if (lines.length > 0) park();
    setLines(h.lines);
    persistHeld(held.filter((x) => x.id !== h.id));
    setShowHeld(false);
  };

  // ── send ──
  const send = async () => {
    if (lines.length === 0) return;
    setSending(true);
    setError(null);

    const clientRef = uuid();
    const counter = Number(localStorage.getItem(COUNTER_KEY) ?? "0") + 1;
    localStorage.setItem(COUNTER_KEY, String(counter));
    const localNo = `${posId}-${String(counter).padStart(4, "0")}`;

    const payload = {
      clientRef,
      localNo,
      fulfillment,
      userId: known?.id,
      redeemPoints: usePoints && known ? known.points : 0,
      customerName: customer.name,
      customerPhone: customer.phone,
      address: customer.address,
      notes: [customer.notes, ...lines.filter((l) => l.note).map((l) => `${l.name}: ${l.note}`)]
        .filter(Boolean)
        .join(" · "),
      lines: lines.map((l) =>
        l.kind === "pizza"
          ? {
              kind: "pizza",
              qty: l.qty,
              pizzaId: l.pizzaId,
              sizeIdx: l.sizeIdx,
              crustIdx: l.crustIdx,
              sauceIdx: l.sauceIdx,
              toppings: l.toppings ?? {},
              removed: l.removed ?? {},
            }
          : { kind: "simple", qty: l.qty, itemId: l.itemId },
      ),
    };

    // queue first, then try — a crash mid-send must never lose the sale
    // `?? undefined` was a trap: JSON.stringify drops an undefined key, so a
    // null shift produced a row indistinguishable from a legacy one — and
    // legacy rows are claimed by whoever drains next. Signed in means owned.
    const q: Queued[] = [...queue, { clientRef, localNo, payload, at: Date.now(), shift: shift ?? uuid(), by: who || undefined, total: Math.round(subtotal * 100) / 100 }];
    persistQueue(q);

    const ch = change;

    try {
      const res = await fetch("/api/pos/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (res.status === 401) {
        setSignedIn(false);
        setError("Session expired — sign in again. The order is saved.");
      } else if (!res.ok) {
        setError(data.error ?? "Could not save — kept in the queue");
      } else {
        persistQueue(q.filter((x) => x.clientRef !== clientRef));
        setDone({ no: data.orderNo, total: data.total, change: ch });
        clearTicket();
        setPaying(false);
      }
    } catch {
      setDone({ no: localNo, total: Math.round(subtotal * 100) / 100, change: ch });
      clearTicket();
      setPaying(false);
      setError("Saved locally — will sync when the connection returns");
    } finally {
      setSending(false);
    }
  };

  // ─────────────────────────────────────────────
  // sign in
  // ─────────────────────────────────────────────
  if (!signedIn) {
    const posOptions = terminals.filter((t) => t.branchId === branchId);
    return (
      <div className="pos-login">
        <h1>Ronny&apos;s POS</h1>

        <label>Branch</label>
        <select value={branchId} onChange={(e) => { setBranchId(e.target.value); setPosId(""); }}>
          <option value="">— select —</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>

        <label>Terminal</label>
        <select value={posId} onChange={(e) => setPosId(e.target.value)} disabled={!branchId}>
          <option value="">— select —</option>
          {posOptions.map((t) => <option key={t.posId} value={t.posId}>{t.posId}</option>)}
        </select>

        <label>PIN</label>
        <input
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
          onKeyDown={(e) => e.key === "Enter" && doSignIn()}
          placeholder="••••"
        />

        <div className="pos-keys">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <button key={n} type="button" onClick={() => setPin((p) => (p + n).slice(0, 8))}>{n}</button>
          ))}
          <button type="button" onClick={() => setPin("")}>C</button>
          <button type="button" onClick={() => setPin((p) => (p + "0").slice(0, 8))}>0</button>
          <button type="button" onClick={() => setPin((p) => p.slice(0, -1))}>←</button>
        </div>

        {error && <p className="pos-err">{error}</p>}

        <button className="pos-primary" type="button" onClick={doSignIn} disabled={!branchId || !posId || pin.length < 4}>
          Sign in
        </button>

        {queue.length > 0 && <p className="pos-queue-note">{queue.length} order(s) waiting to sync</p>}
      </div>
    );
  }

  // Reached only when the server could not supply a menu AND this terminal has
  // never stored one. After a single successful load online it is unreachable,
  // which is the whole point of the change.
  if (!menu) {
    return (
      <div className="pos-login">
        <h1>Menu unavailable</h1>
        <p className="pos-err">
          {online
            ? "The menu could not be loaded. Check the connection and reload."
            : "There is no connection, and this till has not yet loaded the menu once while online. Reconnect and open it once — after that a dropout will not stop it."}
        </p>
        {queue.length > 0 && (
          <p className="pos-queue-note">
            {queue.length} order(s) are still stored here and will sync when the connection returns.
            Nothing has been lost.
          </p>
        )}
      </div>
    );
  }

  // ─────────────────────────────────────────────
  // terminal
  // ─────────────────────────────────────────────
  const q = search.trim().toLowerCase();

  const offPizzas = new Set(unavailable);
  const offItems = new Set(unavailableItems);

  const pizzaTiles = menu.PIZZAS
    .filter((p) => !offPizzas.has(p.id))
    .filter((p) => !q || p.name.toLowerCase().includes(q))
    .map((p) => ({ key: `p${p.id}`, name: p.name, price: p.sizes[0], photo: menu.PIZZA_PHOTOS?.[p.id], onTap: () => openPizza(p), from: true }));

  const itemTiles = (arr: Item[]) =>
    arr.filter((i) => !offItems.has(i.id))
      .filter((i) => !q || i.name.toLowerCase().includes(q))
      .map((i) => ({ key: i.id, name: i.name, price: i.price, photo: i.photo, onTap: () => addSimple(i), from: false }));

  const tiles = q
    ? [...pizzaTiles, ...itemTiles(menu.EXTRAS), ...itemTiles(menu.SAUCES), ...itemTiles(menu.DRINKS)]
    : tab === "Pizza" ? pizzaTiles
    : tab === "Extras" ? itemTiles(menu.EXTRAS)
    : tab === "Sauces" ? itemTiles(menu.SAUCES)
    : itemTiles(menu.DRINKS);

  return (
    <div className="pos">
      <header className="pos-head">
        <div className="pos-head-left">
          <b>{posId}</b>
          <span>{who}</span>
          {since && <span className="pos-since">{onFor(since)}</span>}
        </div>
        <div className="pos-head-right">
          {!online && <span className="pos-offline">Offline</span>}
          {/* Prices and availability are as of this moment, and saying so is
              the difference between working offline and guessing offline. */}
          {menuAge && <span className="pos-stale">Menu {menuAge}</span>}
          {/* Shown only while it is a real risk: online, with the shell not yet
              stored. Once the till is ready this disappears and stays gone. */}
          {online && !shell.ready && (
            <span className="pos-notready" title={shell.problem ?? "Preparing this till for offline use…"}>
              {shell.problem ? "Offline not available" : "Preparing offline…"}
            </span>
          )}
          {queue.length - orphans.length > 0 && (
            <span className="pos-sync">{queue.length - orphans.length} to sync</span>
          )}
          {orphans.length > 0 && (
            <button type="button" className="pos-orphans" onClick={() => setAdopting(true)}>
              {orphans.length} from an earlier shift
            </button>
          )}
          <button type="button" onClick={() => { loadRecent(); }}>
            Recent
          </button>
          <button type="button" onClick={() => setShowHeld(true)}>
            Held {held.length > 0 && <b>{held.length}</b>}
          </button>
          <button type="button" onClick={() => setLocked(true)}>Lock</button>
          <button type="button" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <div className="pos-main">
        {/* ── catalogue ── */}
        <section className="pos-catalog">
          <div className="pos-toolbar">
            <input
              className="pos-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
            />
            <nav className="pos-tabs">
              {["Pizza", "Extras", "Sauces", "Drinks"].map((t) => (
                <button key={t} type="button" className={tab === t && !q ? "on" : ""} onClick={() => { setTab(t); setSearch(""); }}>
                  {t}
                </button>
              ))}
            </nav>
          </div>

          <div className="pos-grid">
            {tiles.length === 0 && <p className="pos-empty">Nothing found</p>}
            {tiles.map((t) => (
              <button key={t.key} type="button" className="pos-tile" onClick={t.onTap}>
                <span className="pos-tile-img">
                  {t.photo ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={t.photo} alt="" loading="lazy" />
                  ) : (
                    <i>🍕</i>
                  )}
                </span>
                <b>{t.name}</b>
                <span className="pos-tile-price">
                  {t.from && "from "}{f.money(t.price)}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* ── ticket ── */}
        <aside className="pos-cart">
          <div className="pos-seg">
            <button type="button" className={fulfillment === "pickup" ? "on" : ""} onClick={() => setFulfillment("pickup")}>Pickup</button>
            <button type="button" className={fulfillment === "delivery" ? "on" : ""} onClick={() => setFulfillment("delivery")}>Delivery</button>
          </div>

          {(true) && (
            <div className="pos-customer">
              <div className="pos-phone-row">
                <div className="pos-sug-wrap">
                  <input
                    placeholder="Phone or name — from 3 characters"
                    value={customer.phone}
                    onChange={(e) => { setCustomer({ ...customer, phone: e.target.value }); setKnown(null); setAddrId(null); }}
                    onFocus={() => suggestions.length > 0 && setShowSug(true)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { setShowSug(false); lookupCustomer(); }
                      if (e.key === "Escape") setShowSug(false);
                    }}
                  />
                  {showSug && suggestions.length > 0 && (
                    <ul className="pos-sug">
                      {suggestions.map((c) => (
                        <li key={c.id}>
                          <button type="button" onClick={() => pickCustomer(c)}>
                            <b>{c.name ?? "No name"}</b>
                            <span>{c.phone}</span>
                            <i>{c.orders} orders{c.points > 0 && ` · ${c.points} pts`}</i>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <button type="button" onClick={() => { setShowSug(false); lookupCustomer(); }} disabled={lookingUp}>
                  {lookingUp ? "…" : "Find"}
                </button>
              </div>

              {known ? (
                <div className="pos-known">
                  <b>{known.name ?? "No name"}</b>
                  <span>
                    {known.orders} orders
                    {known.points > 0 && ` · ${known.points} pts`}
                  </span>
                </div>
              ) : (
                customer.phone.replace(/\D/g, "").length >= 6 && (
                  <div className="pos-new-customer">
                    New customer — will be created on save
                  </div>
                )
              )}

              <input
                placeholder="Customer name"
                value={customer.name}
                onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
              />

              {fulfillment === "delivery" && (
                <>
                  {known && known.addresses.length > 0 && (
                    <select
                      value={addrId ?? ""}
                      onChange={(e) => {
                        const a = known.addresses.find((x) => x.id === e.target.value);
                        setAddrId(a?.id ?? null);
                        setCustomer((c) => ({ ...c, address: a?.line ?? "" }));
                      }}
                    >
                      {known.addresses.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.title ? `${a.title} — ` : ""}{a.line}
                        </option>
                      ))}
                      <option value="">+ new address</option>
                    </select>
                  )}
                  <input
                    placeholder="Address"
                    value={customer.address}
                    onChange={(e) => { setCustomer({ ...customer, address: e.target.value }); setAddrId(null); }}
                  />
                </>
              )}

              <input placeholder="Order note" value={customer.notes} onChange={(e) => setCustomer({ ...customer, notes: e.target.value })} />

              <button type="button" className="pos-ghost" onClick={saveCustomer} disabled={lookingUp}>
                {known ? "Update customer" : "Save customer"}
              </button>
            </div>
          )}

          <div className="pos-lines">
            {lines.length === 0 && <p className="pos-empty">Tap a product to start</p>}

            {lines.map((l) => {
              const detail = detailLines(l, l.ingredients);
              return (
                <div className="pos-line" key={l.key}>
                  <div className="pos-line-top">
                    <b>{l.name}</b>
                    <span>{f.money(l.price * l.qty)}</span>
                  </div>

                  {detail.length > 0 && (
                    <div className="pos-line-detail">
                      {detail.map((d, i) => (
                        <span key={i} style={{ color: lineColor(d.kind) }}>
                          {i > 0 && " · "}
                          {d.kind === "removed" ? "− " : d.kind === "added" ? "+ " : ""}
                          {d.text}
                        </span>
                      ))}
                    </div>
                  )}

                  {l.note && <div className="pos-line-note">📝 {l.note}</div>}

                  <div className="pos-line-actions">
                    <div className="pos-qty">
                      <button type="button" onClick={() => setQty(l.key, -1)}>−</button>
                      <span>{l.qty}</span>
                      <button type="button" onClick={() => setQty(l.key, 1)}>+</button>
                    </div>
                    <div className="pos-line-tools">
                      {l.kind === "pizza" && (
                        <button type="button" onClick={() => setEditing(l)}>Edit</button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          const n = window.prompt("Note for this item", l.note ?? "");
                          if (n !== null) setLines((prev) => prev.map((x) => (x.key === l.key ? { ...x, note: n } : x)));
                        }}
                      >
                        Note
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pos-foot">
            {known && known.points >= 100 && (
              <button
                type="button"
                className={`pos-points${usePoints ? " on" : ""}`}
                onClick={() => setUsePoints((v) => !v)}
              >
                {usePoints ? "✓ " : ""}Use {known.points} points
                <em>−{f.money(Math.min(known.points * 0.1, subtotal))}</em>
              </button>
            )}

            <div className="pos-total">
              <span>{count} items</span>
              <b>
                {usePoints && known
                  ? f.money(Math.max(0, subtotal - Math.min(known.points * 0.1, subtotal)))
                  : f.money(subtotal)}
              </b>
            </div>
            {error && <p className="pos-err">{error}</p>}
            <div className="pos-foot-row">
              <button type="button" className="pos-ghost" onClick={park} disabled={lines.length === 0}>Hold</button>
              <button type="button" className="pos-ghost" onClick={clearTicket} disabled={lines.length === 0}>Clear</button>
            </div>
            <button className="pos-primary" type="button" onClick={() => setPaying(true)} disabled={lines.length === 0}>
              Charge {f.money(subtotal)}
            </button>
          </div>
        </aside>
      </div>

      {/* ── pizza builder ── */}
      {editing && (
        <div className="pos-modal" onClick={(e) => e.target === e.currentTarget && setEditing(null)}>
          <div className="pos-sheet">
            <h2>{editing.name}</h2>

            <label>Size</label>
            <div className="pos-choice">
              {SIZES.map((s, i) => (
                <button key={s} type="button" className={editing.sizeIdx === i ? "on" : ""} onClick={() => setEditing({ ...editing, sizeIdx: i })}>{s}</button>
              ))}
            </div>

            <label>Crust</label>
            <div className="pos-choice">
              {CRUSTS.map((c, i) => (
                <button key={c} type="button" className={editing.crustIdx === i ? "on" : ""} onClick={() => setEditing({ ...editing, crustIdx: i })}>{c}</button>
              ))}
            </div>

            <label>Sauce</label>
            <div className="pos-choice">
              {SAUCES.map((c, i) => (
                <button key={c} type="button" className={editing.sauceIdx === i ? "on" : ""} onClick={() => setEditing({ ...editing, sauceIdx: i })}>{c}</button>
              ))}
            </div>

            <label>Recipe — tap to remove</label>
            <div className="pos-choice wrap">
              {(editing.ingredients ?? []).map((n) => {
                const off = editing.removed?.[n];
                return (
                  <button key={n} type="button" className={off ? "off" : "on"}
                    onClick={() => setEditing({ ...editing, removed: { ...(editing.removed ?? {}), [n]: !off } })}>
                    {off ? `− ${n}` : n}
                  </button>
                );
              })}
            </div>

            <label>Add toppings — tap again for double</label>
            <div className="pos-choice wrap">
              {menu.TOPPINGS.map((t) => {
                const cur = editing.toppings?.[t.name]?.whole ?? 0;
                return (
                  <button key={t.name} type="button" className={cur > 0 ? "on" : ""}
                    onClick={() => {
                      const next = { ...(editing.toppings ?? {}) };
                      const w = (next[t.name]?.whole ?? 0) + 1;
                      if (w > 2) delete next[t.name];
                      else next[t.name] = { whole: w, left: 0, right: 0 };
                      setEditing({ ...editing, toppings: next });
                    }}>
                    {t.name}{cur > 1 && ` ×${cur}`}
                    <em>+{f.money(t.ps[editing.sizeIdx ?? 1])}</em>
                  </button>
                );
              })}
            </div>

            <div className="pos-sheet-foot">
              <button type="button" onClick={() => setEditing(null)}>Cancel</button>
              <button className="pos-primary" type="button" onClick={commitPizza}>
                Add · {f.money(priceOf(editing))}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── payment ── */}
      {paying && (
        <div className="pos-modal" onClick={(e) => e.target === e.currentTarget && setPaying(false)}>
          <div className="pos-sheet pos-pay">
            <h2>Cash</h2>
            <p className="pos-pay-due">Due <b>{f.money(subtotal)}</b></p>

            <input
              className="pos-pay-input"
              inputMode="decimal"
              value={tendered}
              onChange={(e) => setTendered(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder="Tendered"
            />

            <div className="pos-choice wrap">
              {/* the tendered field is parsed with Number() — it must stay a raw numeric string, never formatted money */}
              <button type="button" onClick={() => setTendered(subtotal.toFixed(2))}>Exact</button>
              {QUICK_CASH.filter((c) => c >= subtotal).slice(0, 4).map((c) => (
                <button key={c} type="button" onClick={() => setTendered(String(c))}>{f.money(c)}</button>
              ))}
            </div>

            <p className={`pos-change${change === null ? " dim" : ""}`}>
              Change <b>{change === null ? "—" : f.money(change)}</b>
            </p>

            <div className="pos-sheet-foot">
              <button type="button" onClick={() => setPaying(false)}>Back</button>
              <button className="pos-primary" type="button" onClick={send} disabled={sending}>
                {sending ? "Sending…" : "Complete sale"}
              </button>
            </div>

            <p className="pos-fiscal">
              ⚠️ The fiscal receipt still comes from the certified device, as before.
            </p>
          </div>
        </div>
      )}

      {/* ── another shift's unsent sales ── */}
      {/**
        * Adopting another shift's sales is a decision, so it is asked as one.
        *
        * A one-tap button in the header would have been a notification, and the
        * cashier would be taking responsibility for money they cannot see. What
        * they need before agreeing is how many and how much — enough to notice
        * that the number is wrong.
        */}
      {adopting && (
        <div className="pos-modal" onClick={(e) => e.target === e.currentTarget && setAdopting(false)}>
          <div className="pos-sheet">
            <h2>
              Send {orphans.length} order(s) from an earlier shift
              {orphanTotal > 0 && <> — {f.money(orphanTotal)}</>}?
            </h2>
            <p style={{ fontSize: 14.5, lineHeight: 1.6, margin: "0 0 4px" }}>
              These were rung up on this till before you signed in, and never reached the server.
              Sending them now files them under <b>{who || "your name"}</b> — the books will show you
              took them.
            </p>
            <p style={{ margin: 0, fontSize: 13, color: "var(--p-muted)", lineHeight: 1.55 }}>
              The record notes that they came from an earlier shift, so this can be looked up later.
              If they are not yours, leave them: the person who took them can sign in and send them.
            </p>
            <div className="pos-sheet-foot">
              <button type="button" onClick={() => setAdopting(false)}>Leave them</button>
              <button
                type="button"
                className="pos-primary"
                onClick={() => { setAdopting(false); adoptOrphans(); }}
              >
                Send as {who || "me"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── held tickets ── */}
      {showHeld && (
        <div className="pos-modal" onClick={(e) => e.target === e.currentTarget && setShowHeld(false)}>
          <div className="pos-sheet">
            <h2>Held tickets</h2>
            {held.length === 0 && <p className="pos-empty">Nothing held</p>}
            {held.map((h) => (
              <div className="pos-held" key={h.id}>
                <div>
                  <b>{h.label}</b>
                  <span>{f.time(new Date(h.at))}</span>
                </div>
                <div className="pos-line-tools">
                  <button type="button" onClick={() => recall(h)}>Recall</button>
                  <button type="button" onClick={() => persistHeld(held.filter((x) => x.id !== h.id))}>Discard</button>
                </div>
              </div>
            ))}
            <div className="pos-sheet-foot">
              <button type="button" onClick={() => setShowHeld(false)}>Close</button>
              <span />
            </div>
          </div>
        </div>
      )}

      {/* ── recent orders ── */}
      {recent !== null && (
        <div className="pos-modal" onClick={(e) => e.target === e.currentTarget && setRecent(null)}>
          <div className="pos-sheet">
            <h2>Recent orders — this terminal</h2>
            {recent.length === 0 && <p className="pos-empty">Nothing yet</p>}
            {recent.map((o) => (
              <div className="pos-recent" key={o.id}>
                <div className="pos-recent-top">
                  <b>#{o.no}</b>
                  <span>{f.time(o.at)}</span>
                  <b className="pos-recent-total">{f.money(o.total)}</b>
                </div>
                <div className="pos-recent-items">
                  {o.items.map((it, i) => (
                    <div key={i}>
                      {it.qty}× {it.name}
                      {it.detail && <em> · {it.detail}</em>}
                    </div>
                  ))}
                </div>
                <div className="pos-recent-foot">
                  {o.status === "cancelled" ? (
                    <span className="pos-voided">Voided</span>
                  ) : (
                    <button type="button" onClick={() => { setVoiding(o); setRecent(null); }}>
                      Void
                    </button>
                  )}
                </div>
              </div>
            ))}
            <div className="pos-sheet-foot">
              <button type="button" onClick={() => setRecent(null)}>Close</button>
              <span />
            </div>
          </div>
        </div>
      )}

      {/* ── void ── */}
      {voiding && (
        <div className="pos-modal" onClick={(e) => e.target === e.currentTarget && setVoiding(null)}>
          <div className="pos-sheet pos-pay">
            <h2>Void order #{voiding.no}</h2>
            <p className="pos-pay-due">Amount <b>{f.money(voiding.total)}</b></p>

            <label>Reason</label>
            <input
              className="pos-void-input"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Wrong item, customer left…"
            />

            <label>Manager PIN</label>
            <input
              className="pos-void-input"
              type="password"
              inputMode="numeric"
              value={voidPin}
              onChange={(e) => setVoidPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
              placeholder="••••"
            />

            <p className="pos-fiscal">
              ⚠️ A void needs someone else&apos;s PIN. Both names and the reason are recorded, and
              the stock goes back.
            </p>

            {error && <p className="pos-err">{error}</p>}

            <div className="pos-sheet-foot">
              <button type="button" onClick={() => { setVoiding(null); setError(null); }}>Cancel</button>
              <button className="pos-primary" type="button" onClick={doVoid} disabled={voidReason.trim().length < 3 || voidPin.length < 4}>
                Void order
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── idle lock ── */}
      {locked && (
        <div className="pos-lock">
          <div className="pos-lock-box">
            <h2>Locked</h2>
            <p>{posId} · enter your PIN to continue</p>
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              value={unlockPin}
              onChange={(e) => setUnlockPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
              onKeyDown={(e) => e.key === "Enter" && unlock()}
              placeholder="••••"
            />
            <div className="pos-keys">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <button key={n} type="button" onClick={() => setUnlockPin((p) => (p + n).slice(0, 8))}>{n}</button>
              ))}
              <button type="button" onClick={() => setUnlockPin("")}>C</button>
              <button type="button" onClick={() => setUnlockPin((p) => (p + "0").slice(0, 8))}>0</button>
              <button type="button" onClick={() => setUnlockPin((p) => p.slice(0, -1))}>←</button>
            </div>
            {error && <p className="pos-err">{error}</p>}
            <button className="pos-primary" type="button" onClick={unlock} disabled={unlockPin.length < 4}>
              Unlock
            </button>
            <p className="pos-lock-note">The ticket is kept — nothing is lost.</p>
          </div>
        </div>
      )}

      {/* ── confirmation ── */}
      {done && (
        <div className="pos-modal" onClick={() => setDone(null)}>
          <div className="pos-sheet pos-done">
            <h2>Order #{done.no}</h2>
            <p className="pos-done-total">{f.money(done.total)}</p>
            {done.change !== null && (
              <p className="pos-done-change">Change <b>{f.money(done.change)}</b></p>
            )}
            <button className="pos-primary" type="button" onClick={() => setDone(null)}>Next order</button>
          </div>
        </div>
      )}
    </div>
  );
}
