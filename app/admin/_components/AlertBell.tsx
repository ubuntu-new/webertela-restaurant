"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "./AdminLang";

interface Alert {
  key: string;
  label: string;
  count: number;
  href: string;
}

/**
 * შეტყობინებების ზარი.
 *
 * ყოველ 30 წამში ეკითხება სერვერს. რიცხვები მონაცემებიდან გამოითვლება,
 * ამიტომ „წაკითხვა" არ არსებობს — ჩანაწერი ქრება მაშინ, როცა მიზეზი ქრება
 * (შეკვეთა დადასტურდა, მოთხოვნა დამტკიცდა, მარაგი შეივსო).
 */
export default function AlertBell() {
  const t = useT();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const res = await fetch("/api/admin/alerts", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (alive) setAlerts(Array.isArray(data.items) ? data.items : []);
      } catch {
        /* ქსელის ჩავარდნა ჩუმად — ზარი მეორეხარისხოვანია */
      }
    };

    load();
    const id = window.setInterval(load, 30_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [pathname]);

  const total = alerts.reduce((s, a) => s + a.count, 0);

  return (
    <div className="alert-bell">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label={t("Notifications")}>
        <span aria-hidden="true">🔔</span>
        {total > 0 && <span className="alert-bell-dot">{total > 99 ? "99+" : total}</span>}
      </button>

      {open && (
        <div className="alert-bell-menu">
          {alerts.length === 0 ? (
            <div className="alert-bell-empty">{t("All clear")}</div>
          ) : (
            alerts.map((a) => (
              <Link key={a.key} href={a.href} onClick={() => setOpen(false)}>
                <span>{a.label}</span>
                <b>{a.count}</b>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
