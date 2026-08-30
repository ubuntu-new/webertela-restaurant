"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { detailLines, lineColor } from "@/lib/item-detail";

/**
 * Kitchen display board.
 *
 * Design decisions worth knowing:
 *   • Polls every 8s — a kitchen screen on flaky wifi recovers on its own,
 *     which websockets do not.
 *   • The elapsed clock is the point of the whole screen. Colour changes at
 *     10 and 20 minutes so a late order is visible from across the room.
 *   • Sound only fires for orders that weren't there on the previous poll,
 *     so a reconnect doesn't set off a chime storm.
 */

const POLL_MS = 8000;

interface Item {
  id: string;
  kind: string;
  name: string;
  nameKa: string;
  qty: number;
  config: Record<string, unknown> | null;
}

interface Order {
  id: string;
  no: number;
  status: string;
  type: string;
  createdAt: string;
  customer: string | null;
  note: string | null;
  source: string;
  items: Item[];
}

function minutesSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

export default function KdsBoard({
  branchId,
  branchName,
}: {
  branchId: string;
  branchName: string;
}) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [drivers, setDrivers] = useState<{ id: string; name: string }[]>([]);
  const [, setTick] = useState(0);

  const seen = useRef<Set<string>>(new Set());
  const first = useRef(true);

  // ── sound ──
  const chime = useCallback(() => {
    if (muted) return;
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
      osc.start();
      osc.stop(ctx.currentTime + 0.62);
    } catch {
      /* audio blocked until first interaction — not worth surfacing */
    }
  }, [muted]);

  // ── poll ──
  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const res = await fetch(`/api/admin/kds?branch=${branchId}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (!alive) return;

        const list: Order[] = data.orders ?? [];

        const fresh = list.filter((o) => !seen.current.has(o.id));
        if (!first.current && fresh.length > 0) chime();
        first.current = false;
        seen.current = new Set(list.map((o) => o.id));

        setOrders(list);
        setDrivers(Array.isArray(data.drivers) ? data.drivers : []);
        setError(null);
      } catch {
        if (alive) setError("Connection lost — retrying");
      }
    };

    load();
    const id = window.setInterval(load, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [branchId, chime]);

  // clock ticks so elapsed time stays honest between polls
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 20000);
    return () => window.clearInterval(id);
  }, []);

  const move = async (id: string, status: string, driverId?: string) => {
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
    try {
      await fetch("/api/admin/kds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status, driverId }),
      });
    } catch {
      setError("Could not save — will refresh");
    }
  };

  const columns: { key: string; title: string; statuses: string[] }[] = [
    { key: "queue", title: "Queue", statuses: ["new", "confirmed"] },
    { key: "preparing", title: "Preparing", statuses: ["preparing"] },
    { key: "ready", title: "Ready", statuses: ["ready"] },
    { key: "out", title: "Out for delivery", statuses: ["delivering"] },
  ];

  const fullscreen = () => {
    const el = document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  };

  return (
    <div className="kds">
      <div className="kds-top">
        <div>
          <b>{branchName}</b>
          <span className="kds-count">{orders.length} open</span>
        </div>
        <div className="kds-top-actions">
          {error && <span className="kds-error">{error}</span>}
          <button type="button" onClick={() => setMuted((m) => !m)}>
            {muted ? "🔇 Sound off" : "🔔 Sound on"}
          </button>
          <button type="button" onClick={fullscreen}>
            ⛶ Fullscreen
          </button>
        </div>
      </div>

      <div className="kds-cols">
        {columns.map((col) => {
          const list = orders.filter((o) => col.statuses.includes(o.status));
          return (
            <section className="kds-col" key={col.key}>
              <h2>
                {col.title} <span>{list.length}</span>
              </h2>

              {list.length === 0 && <p className="kds-empty">—</p>}

              {list.map((o) => {
                const mins = minutesSince(o.createdAt);
                const age = mins >= 20 ? "late" : mins >= 10 ? "warn" : "fresh";

                return (
                  <article className={`kds-card kds-${age}`} key={o.id}>
                    <header>
                      <b>#{o.no}</b>
                      <span className="kds-time">{mins}m</span>
                    </header>

                    <div className="kds-meta">
                      {o.type === "pickup" ? "Pickup" : "Delivery"}
                      {o.source === "phone" && " · phone"}
                      {o.customer && ` · ${o.customer}`}
                    </div>

                    <ul className="kds-items">
                      {o.items.map((it) => {
                        const lines = detailLines(it.config);
                        return (
                          <li key={it.id}>
                            <span className="kds-qty">{it.qty}×</span>
                            <span>
                              {it.nameKa || it.name}
                              {lines.length > 0 && (
                                <em>
                                  {lines.map((l, i) => (
                                    <span key={i} style={{ color: lineColor(l.kind) }}>
                                      {i > 0 && " · "}
                                      {l.kind === "removed" ? "− " : l.kind === "added" ? "+ " : ""}
                                      {l.text}
                                    </span>
                                  ))}
                                </em>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>

                    {o.note && <p className="kds-note">📝 {o.note}</p>}

                    <footer>
                      {(o.status === "new" || o.status === "confirmed") && (
                        <button type="button" onClick={() => move(o.id, "preparing")}>
                          Start
                        </button>
                      )}
                      {o.status === "preparing" && (
                        <button type="button" onClick={() => move(o.id, "ready")}>
                          Ready
                        </button>
                      )}
                      {o.status === "ready" && o.type === "delivery" && drivers.length > 0 && (
                        <select
                          className="kds-driver"
                          defaultValue=""
                          onChange={(e) => e.target.value && move(o.id, "delivering", e.target.value)}
                        >
                          <option value="">Assign driver…</option>
                          {drivers.map((d) => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
                      )}
                      {o.status === "ready" && (
                        <button type="button" className="kds-done" onClick={() => move(o.id, "completed")}>
                          Handed over
                        </button>
                      )}
                      {o.status === "delivering" && (
                        <button type="button" className="kds-done" onClick={() => move(o.id, "completed")}>
                          Delivered
                        </button>
                      )}
                    </footer>
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
