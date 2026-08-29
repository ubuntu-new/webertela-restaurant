"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useT } from "./AdminLang";

/**
 * ცხრილების ძებნა — ერთი კომპონენტი მთელი admin-ისთვის.
 *
 * `layout.tsx`-ში ერთხელ ჯდება და თვითონ პოულობს გვერდზე ყველა `.admin-table`-ს.
 * ალტერნატივა იყო თითო გვერდზე ცალკე ფილტრი — 10+ ფაილის ცვლილება, ყოველი
 * თავისი რისკით. აქ ერთი ფაილია და ქცევა ყველგან იდენტურია.
 *
 * ⚠️ ფილტრი DOM-ზე მუშაობს, ანუ ეძებს იმაში, რაც უკვე ჩატვირთულია.
 * იმ ცხრილებზე, სადაც სერვერი რიცხვს ზღუდავს (შეკვეთები 100, ჟურნალი 200),
 * ძებნა იმ ნაწილში ხდება — ამიტომ იქ სტატუსის/ლოკაციის ფილტრებიც დარჩა.
 */
export default function AdminSearch() {
  const t = useT();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState("");
  const [stats, setStats] = useState<{ shown: number; total: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const apply = useCallback((query: string) => {
    const needle = query.trim().toLowerCase();
    const tables = document.querySelectorAll<HTMLTableElement>("table.admin-table");

    let shown = 0;
    let total = 0;

    tables.forEach((table) => {
      const rows = table.querySelectorAll<HTMLTableRowElement>("tbody tr");
      rows.forEach((row) => {
        total++;
        if (!needle) {
          row.style.removeProperty("display");
          shown++;
          return;
        }
        // input-ების მნიშვნელობები textContent-ში არ ხვდება — ცალკე ვამატებთ
        const values = Array.from(row.querySelectorAll<HTMLInputElement>("input[type='text'], input[type='number']"))
          .map((i) => i.value)
          .join(" ");
        const hay = `${row.textContent ?? ""} ${values}`.toLowerCase();

        const hit = hay.includes(needle);
        row.style.display = hit ? "" : "none";
        if (hit) shown++;
      });
    });

    setStats(total > 0 ? { shown, total } : null);
  }, []);

  // გვერდის შეცვლაზე ძებნა იწმინდება
  useEffect(() => {
    setQ("");
    const id = window.setTimeout(() => apply(""), 0);
    return () => window.clearTimeout(id);
  }, [pathname, params, apply]);

  // "/" — ფოკუსი, Esc — გასუფთავება
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;

      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape" && el === inputRef.current) {
        setQ("");
        apply("");
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [apply]);

  const onChange = (v: string) => {
    setQ(v);
    apply(v);
  };

  if (stats === null && q === "") {
    // ცხრილის გარეშე გვერდებზე (ფორმები, დეტალები) ზოლს არ ვაჩვენებთ
    return <AdminSearchProbe onFound={() => setStats({ shown: 0, total: 0 })} />;
  }

  return (
    <div className="admin-search">
      <input
        ref={inputRef}
        type="text"
        value={q}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("Search this table…  ( / )")}
        aria-label={t("Search")}
      />
      {q && (
        <>
          <span className="admin-search-count">
            {stats ? `${stats.shown} / ${stats.total}` : ""}
          </span>
          <button type="button" onClick={() => onChange("")}>
            {t("Clear")}
          </button>
        </>
      )}
    </div>
  );
}

/** ცხრილის არსებობას ერთხელ ამოწმებს — ზოლი მხოლოდ მაშინ ჩნდება. */
function AdminSearchProbe({ onFound }: { onFound: () => void }) {
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (document.querySelector("table.admin-table tbody tr")) onFound();
    }, 0);
    return () => window.clearTimeout(id);
  }, [onFound]);
  return null;
}
