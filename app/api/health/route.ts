import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Is this instance actually serving, or merely running?
 *
 * The distinction is the whole reason this exists. `systemctl status` says the
 * Node process is alive, and it can be alive with Postgres refusing
 * connections, its disk full, or its connection pool exhausted — every page
 * returning an error while every dashboard says green. So this asks the one
 * question that cannot be answered by looking at the process: **can it read the
 * database right now.**
 *
 * ── What it must not become ──
 *
 * It is unauthenticated, because a monitor cannot hold a password, and it is
 * polled every minute forever. Both of those set hard limits:
 *
 *   · **It says nothing.** No counts, no names, no versions of anything an
 *     attacker could use to pick an exploit, no error text from the database.
 *     Up or not up, and how long. A health endpoint that reports "connection
 *     refused for user demo at 127.0.0.1:5432" is a reconnaissance gift.
 *   · **It stays cheap.** One trivial query. Anything that grows with the size
 *     of the business would make the monitor the heaviest visitor on the site,
 *     and would fail on a busy evening for reasons that have nothing to do with
 *     health.
 *
 * ── Why the status code carries the meaning ──
 *
 * 503 when the database is unreachable, 200 when it is. Every uptime service on
 * earth understands a status code; only some can be taught to parse a body. The
 * body is for a human reading it afterwards.
 */
export async function GET() {
  const started = Date.now();

  try {
    // `SELECT 1` and nothing else. It proves the pool can hand out a connection
    // and Postgres will answer on it — which is the failure this catches — and
    // it touches no table, so it cannot become slow as a restaurant grows.
    await db.$queryRaw`SELECT 1`;

    return NextResponse.json(
      {
        ok: true,
        db: "up",
        // Seconds this process has been running. A number that keeps resetting
        // is the signature of a crash loop, which `Restart=always` would
        // otherwise hide completely: the service looks healthy at every glance
        // because it has just started again.
        uptime: Math.round(process.uptime()),
        ms: Date.now() - started,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    // Deliberately no detail. Whoever is on call reads the journal; whoever is
    // probing gets nothing.
    return NextResponse.json(
      { ok: false, db: "down", uptime: Math.round(process.uptime()), ms: Date.now() - started },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
