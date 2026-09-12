"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { EXAMPLE } from "@/lib/menu-import";
import { previewMenu, importMenu, type Preview, type ImportResult } from "./actions";

/**
 * Paste a menu, look at it, then import it.
 *
 * ── Why there are two buttons and not one ──
 *
 * The first shows what will happen. The second does it. Somebody pasting forty
 * lines out of a spreadsheet cannot be asked to trust a parser they have never
 * met — and the parser cannot be trusted, not because it is bad but because the
 * spreadsheet is somebody's, and no format survives contact with a real one.
 *
 * So the table below is the actual result, produced by the code that will write
 * it, shown first. Confirming is a decision about something seen rather than a
 * hope about something described.
 */
export default function ImportForm() {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();

  const money = (n: number) => n.toFixed(2);

  function doPreview() {
    setResult(null);
    start(async () => setPreview(await previewMenu(text)));
  }

  function doImport() {
    start(async () => {
      const r = await importMenu(text);
      setResult(r);
      setPreview(null);
    });
  }

  /* ── after ─────────────────────────────────────────────────────── */

  if (result) {
    return (
      <div className="card">
        {result.error ? (
          <>
            <h2 style={{ color: "var(--bad, #c4553f)" }}>Nothing was imported</h2>
            <p className="hint" style={{ marginTop: 10 }}>{result.error}</p>
          </>
        ) : (
          <>
            <h2>{result.created} added</h2>
            <p className="hint" style={{ marginTop: 10 }}>
              {result.skipped > 0 && (
                <>
                  {result.skipped} were already on the menu and were left exactly as they are —
                  an import never changes a price you have set.{" "}
                </>
              )}
              They are on the menu now. Photos, descriptions and which toppings come as standard
              are added on each product&apos;s own page.
            </p>
          </>
        )}

        {result.failed.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <b>{result.failed.length} did not go in:</b>
            <ul style={{ marginTop: 8 }}>
              {result.failed.map((f) => (
                <li key={f.name} className="hint">
                  <b>{f.name}</b> — {f.message}
                </li>
              ))}
            </ul>
            <p className="hint" style={{ marginTop: 8 }}>
              Fix those lines and paste them again. The ones that worked will be skipped.
            </p>
          </div>
        )}

        <div className="field-row" style={{ marginTop: 20 }}>
          <Link className="btn" href="/admin/products">
            See the menu
          </Link>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setResult(null);
              setText("");
            }}
          >
            Paste some more
          </button>
        </div>
      </div>
    );
  }

  /* ── before ────────────────────────────────────────────────────── */

  return (
    <>
      <div className="card">
        <h2>Paste your menu</h2>
        <p className="hint" style={{ marginTop: 8, lineHeight: 1.6 }}>
          Straight out of a spreadsheet — select the cells and paste. One line per item:
          the name, what it is, then the price. A pizza takes three prices, smallest first.
        </p>

        <pre
          style={{
            marginTop: 12,
            padding: 12,
            background: "var(--bg-soft, #f6f6f6)",
            borderRadius: 6,
            fontSize: 12.5,
            lineHeight: 1.7,
            overflowX: "auto",
          }}
        >
          {EXAMPLE.replace(/\t/g, "    ")}
        </pre>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          spellCheck={false}
          placeholder="Paste here"
          style={{ width: "100%", marginTop: 12, fontFamily: "ui-monospace, monospace", fontSize: 13 }}
        />

        <div className="field-row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={doPreview} disabled={!text.trim() || pending}>
            {pending ? "Reading…" : "Show me what you read"}
          </button>
        </div>
      </div>

      {preview && (
        <div className="card" style={{ marginTop: 20 }}>
          <h2>
            {preview.willCreate} to add
            {preview.willSkip > 0 && <> · {preview.willSkip} already there</>}
            {preview.errors.length > 0 && (
              <> · <span style={{ color: "var(--bad, #c4553f)" }}>{preview.errors.length} not understood</span></>
            )}
          </h2>

          {preview.missingCategories.length > 0 && (
            <p
              className="hint"
              style={{ marginTop: 10, color: "var(--bad, #c4553f)", lineHeight: 1.6 }}
            >
              This restaurant is missing {preview.missingCategories.join(", ")}. The storefront
              reads those exact ids, so anything imported would be created and never appear.
              Nothing will be written until that is fixed.
            </p>
          )}

          {preview.errors.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <b>Lines I could not read — they will be left out:</b>
              <ul style={{ marginTop: 8 }}>
                {preview.errors.map((e) => (
                  <li key={e.line} className="hint" style={{ marginBottom: 4 }}>
                    <b>Line {e.line}</b> — {e.message}
                    <br />
                    <code style={{ opacity: 0.7 }}>{e.raw}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.rows.length > 0 && (
            <table className="table" style={{ marginTop: 16 }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Kind</th>
                  <th style={{ textAlign: "right" }}>Price</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.line} style={r.exists ? { opacity: 0.45 } : undefined}>
                    <td>{r.name}</td>
                    <td>{r.kind}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {r.prices.map(money).join(" · ")}
                    </td>
                    <td className="hint">{r.exists ? "already on the menu — left alone" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="field-row" style={{ marginTop: 18 }}>
            <button
              className="btn btn-primary"
              onClick={doImport}
              disabled={pending || preview.willCreate === 0 || preview.missingCategories.length > 0}
            >
              {pending ? "Adding…" : `Add these ${preview.willCreate}`}
            </button>
            <button className="btn btn-ghost" onClick={() => setPreview(null)} disabled={pending}>
              Back
            </button>
          </div>

          <p className="hint" style={{ marginTop: 10 }}>
            Nothing has been written yet. Anything already on the menu stays exactly as it is.
          </p>
        </div>
      )}
    </>
  );
}
