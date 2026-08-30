"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { detailLines, lineColor } from "@/lib/item-detail";
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

interface Queued { clientRef: string; localNo: string; payload: unknown; at: number }

const uuid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function PosTerminal({
  session,
  menu,
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
  const [voiding, setVoiding] = useState<RecentOrder | null>(null);
  const [voidPin, setVoidPin] = useState("");
  const [voidReason, setVoidReason] = useState("");

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
    } catch {
      /* first run */
    }
    if (session) {
      setBranchId(session.branchId);
      setPosId(session.posId);
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

  /** Drain the queue. Safe at any time — clientRef makes retries free. */
  const drain = useCallback(async () => {
    const current: Queued[] = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
    if (current.length === 0) return;

    const left: Queued[] = [];
    for (const q of current) {
      try {
        const res = await fetch("/api/pos/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(q.payload),
        });
        if (res.status === 401) { setSignedIn(false); left.push(q); continue; }
        if (!res.ok && res.status >= 500) { left.push(q); continue; }
        // a 4xx that isn't auth will never be accepted — keeping it blocks the queue
      } catch {
        left.push(q);
      }
    }
    persistQueue(left);
  }, [persistQueue]);

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

  const unlock = async () => {
    setError(null);
    try {
      const res = await fetch("/api/pos/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: unlockPin, branchId, posId }),
      });
      if (!res.ok) { setError("PIN not recognised"); setUnlockPin(""); return; }
      setLocked(false);
      setUnlockPin("");
    } catch {
      setError("No connection");
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

  // ── auth ──
  const doSignIn = async () => {
    setError(null);
    try {
      const res = await fetch("/api/pos/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, branchId, posId }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Could not sign in"); setPin(""); return; }
      localStorage.setItem(TERMINAL_KEY, JSON.stringify({ branchId, posId }));
      setWho(data.name);
      setSignedIn(true);
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
    await fetch("/api/pos/session", { method: "DELETE" });
    setSignedIn(false);
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
    const q: Queued[] = [...queue, { clientRef, localNo, payload, at: Date.now() }];
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

  if (!menu) {
    return (
      <div className="pos-login">
        <h1>Menu unavailable</h1>
        <p className="pos-err">The menu could not be loaded. Check the connection and reload.</p>
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
        </div>
        <div className="pos-head-right">
          {!online && <span className="pos-offline">Offline</span>}
          {queue.length > 0 && <span className="pos-sync">{queue.length} to sync</span>}
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
