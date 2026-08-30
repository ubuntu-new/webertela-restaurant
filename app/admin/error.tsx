"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * The last thing between a failure and a blank screen.
 *
 * There was no error boundary under /admin at all, which meant any unhandled
 * throw — including every `throw new Error("The English name is required")` —
 * became the framework's own crash page. In production Next.js redacts the
 * message, so the owner saw a bare "Application error" and had no idea he had
 * simply left a field empty.
 *
 * Most of those now come back as form state (lib/action-state.ts). This catches
 * what is left: real bugs, a database that went away, a page that threw while
 * rendering. It says three true things — nothing was saved, here is the
 * reference for the log, here is the way back — because a dead end with no way
 * out is what makes people stop trusting software.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin] unhandled:", error);
  }, [error]);

  return (
    <div className="admin-panel" style={{ maxWidth: 620, margin: "40px auto", padding: 26 }}>
      <h1 style={{ margin: "0 0 8px", fontSize: 21 }}>This page could not be shown</h1>
      <p style={{ margin: "0 0 14px", color: "var(--a-muted)", fontSize: 14.5, lineHeight: 1.6 }}>
        Nothing was saved and nothing was lost. It is worth trying again — most of these are
        momentary. If it happens twice in a row, send us the reference below and we will find it in
        the log.
      </p>

      {error.digest && (
        <p
          style={{
            fontFamily: "ui-monospace, monospace",
            fontSize: 12.5,
            background: "var(--a-bg)",
            border: "1px solid var(--a-line)",
            borderRadius: 8,
            padding: "9px 11px",
            color: "var(--a-muted)",
            margin: "0 0 16px",
          }}
        >
          reference {error.digest}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn" type="button" onClick={reset}>
          Try again
        </button>
        <Link className="btn btn-ghost" href="/admin">
          Back to the dashboard
        </Link>
      </div>
    </div>
  );
}
