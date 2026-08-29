"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { makeFmt } from "@/lib/format-shared";
import type { OrgFormat } from "@/lib/format-shared";

/**
 * Driver screen — a phone, not a desk.
 *
 * Everything is one tap and one thumb: call the customer, open the address in
 * maps, mark delivered. Anything that needs two hands or careful aiming won't
 * be used on a scooter.
 */

interface DriverOrder {
  id: string;
  no: number;
  status: string;
  total: number;
  paymentStatus: string;
  customer: string | null;
  phone: string | null;
  address: string | null;
  note: string | null;
  branch: string;
  assignedAt: string | null;
  items: { name: string; qty: number }[];
}

function minutesSince(iso: string | null) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

export default function DriverApp({
  session,
  org,
}: {
  session: { name: string } | null;
  org: OrgFormat;
}) {
  const f = useMemo(() => makeFmt(org), [org]);

  const [signedIn, setSignedIn] = useState(!!session);
  const [who, setWho] = useState(session?.name ?? "");
  const [pin, setPin] = useState("");
  const [orders, setOrders] = useState<DriverOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<DriverOrder | null>(null);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/driver/orders", { cache: "no-store" });
      if (res.status === 401) { setSignedIn(false); return; }
      const data = await res.json();
      setOrders(Array.isArray(data.orders) ? data.orders : []);
      setError(null);
    } catch {
      setError("No connection — retrying");
    }
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    load();
    const id = window.setInterval(load, 20000);
    const t = window.setInterval(() => setTick((x) => x + 1), 30000);
    return () => { window.clearInterval(id); window.clearInterval(t); };
  }, [signedIn, load]);

  const signIn = async () => {
    setError(null);
    try {
      const res = await fetch("/api/driver/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Could not sign in"); setPin(""); return; }
      setWho(data.name);
      setSignedIn(true);
      setPin("");
    } catch {
      setError("No connection");
    }
  };

  const signOut = async () => {
    await fetch("/api/driver/session", { method: "DELETE" });
    setSignedIn(false);
  };

  const markDelivered = async (o: DriverOrder) => {
    setConfirming(null);
    setOrders((prev) => prev.filter((x) => x.id !== o.id));
    try {
      await fetch("/api/driver/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: o.id }),
      });
    } catch {
      setError("Could not save — will retry on refresh");
      load();
    }
  };

  if (!signedIn) {
    return (
      <div className="drv-login">
        <h1>Ronny&apos;s</h1>
        <p>Driver</p>
        <input
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
          onKeyDown={(e) => e.key === "Enter" && signIn()}
          placeholder="••••"
        />
        <div className="drv-keys">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <button key={n} type="button" onClick={() => setPin((p) => (p + n).slice(0, 8))}>{n}</button>
          ))}
          <button type="button" onClick={() => setPin("")}>C</button>
          <button type="button" onClick={() => setPin((p) => (p + "0").slice(0, 8))}>0</button>
          <button type="button" onClick={() => setPin((p) => p.slice(0, -1))}>←</button>
        </div>
        {error && <p className="drv-err">{error}</p>}
        <button className="drv-primary" type="button" onClick={signIn} disabled={pin.length < 4}>
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div className="drv">
      <header className="drv-head">
        <div>
          <b>{who}</b>
          <span>{orders.length} to deliver</span>
        </div>
        <button type="button" onClick={signOut}>Sign out</button>
      </header>

      {error && <p className="drv-err drv-err-bar">{error}</p>}

      <main className="drv-list">
        {orders.length === 0 && (
          <p className="drv-empty">Nothing assigned right now.</p>
        )}

        {orders.map((o) => {
          const mins = minutesSince(o.assignedAt);
          const late = mins !== null && mins >= 30;

          return (
            <article className={`drv-card${late ? " drv-late" : ""}`} key={o.id}>
              <header>
                <b>#{o.no}</b>
                {mins !== null && <span className="drv-mins">{mins}m</span>}
              </header>

              {o.address && <p className="drv-addr">{o.address}</p>}

              <p className="drv-meta">
                {o.customer ?? "—"}
                {o.branch && ` · from ${o.branch}`}
              </p>

              <ul className="drv-items">
                {o.items.map((it, i) => (
                  <li key={i}>{it.qty}× {it.name}</li>
                ))}
              </ul>

              {o.note && <p className="drv-note">📝 {o.note}</p>}

              <p className="drv-total">
                {f.money(o.total)}
                <span className={o.paymentStatus === "paid" ? "drv-paid" : "drv-unpaid"}>
                  {o.paymentStatus === "paid" ? "Paid" : "Collect cash"}
                </span>
              </p>

              <div className="drv-actions">
                {o.phone && (
                  <a className="drv-btn" href={`tel:${o.phone}`}>Call</a>
                )}
                {o.address && (
                  <a
                    className="drv-btn"
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.address)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Map
                  </a>
                )}
              </div>

              <button className="drv-primary" type="button" onClick={() => setConfirming(o)}>
                Delivered
              </button>
            </article>
          );
        })}
      </main>

      {confirming && (
        <div className="drv-modal" onClick={(e) => e.target === e.currentTarget && setConfirming(null)}>
          <div className="drv-sheet">
            <h2>Order #{confirming.no}</h2>
            <p>
              {confirming.paymentStatus === "paid"
                ? "Already paid — nothing to collect."
                : `Collect ${f.money(confirming.total)} in cash.`}
            </p>
            <button className="drv-primary" type="button" onClick={() => markDelivered(confirming)}>
              Confirm delivered
            </button>
            <button className="drv-ghost" type="button" onClick={() => setConfirming(null)}>
              Not yet
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
