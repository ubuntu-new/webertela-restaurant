# Security — what is solid, and what is not

Written after the 21 August intrusion, when an attacker took root through
Next.js 15.5.4 running as root and created a second root account that
reinstated itself every thirty minutes.

That hole is closed: patched to 15.5.7, the app runs as a dedicated
unprivileged user under a hardened systemd unit, SSH password auth is off, and
every secret has been rotated. This document is about the application.

---

## What is already right

Worth stating plainly, because the temptation with security is to list
everything that could theoretically be added and lose the few things that
actually matter.

- **Every API route authenticates.** `/api/pos/*` requires a POS session,
  `/api/driver/*` a driver session, `/api/admin/*` an admin session with a
  permission check. `/api/orders` is public because a customer must be able to
  place an order — that is correct, not an oversight.
- **Authorisation is checked per route**, not only in the UI. `pos/void`
  additionally demands a manager PIN; `driver/orders` refuses an order that is
  not assigned to that driver.
- **Session cookies** are `httpOnly`, `secure`, `sameSite: lax` in all three
  auth systems. That closes cross-site POST and JavaScript theft of the cookie.
- **No raw SQL anywhere.** Everything goes through Prisma, so SQL injection is
  not a live concern.
- **Uploads** are allow-listed by type, capped at 5 MB, and stored under a
  random filename with an extension taken from the allow-list rather than from
  the client.
- **The audit log** records who did what — the thing you need on the day
  something goes wrong and nobody remembers.

---

## The real gap: nothing is rate limited

There is no rate limiting, anywhere in the application. Four places make that
serious, in descending order.

### 1. POS and driver PIN login

`isValidPin` accepts **4 to 8 digits**. A four-digit PIN is ten thousand
combinations. With unlimited attempts, a script reaches every one of them in
minutes over a home connection — and a POS session can create orders, read
customer records and take payments.

`lib/pin.ts` also, deliberately and correctly, does not use bcrypt: PIN sign-in
looks the user up *by hash*, which requires the hash to be deterministic. That
is a reasonable trade, but it means the only thing standing between an attacker
and a till is the number of guesses allowed. Right now that number is infinite.

**Fix:**
- minimum **6 digits**, and reject obvious sequences (`123456`, `111111`)
- **lockout per terminal**: 5 failures → 60 seconds, then doubling
- **lockout per PIN**: 10 failures across any terminal → the PIN is disabled
  and a manager must reset it
- every failure written to the audit log

### 2. Admin login

A password with unlimited attempts. Same treatment: exponential backoff per IP
and per account, and an audit entry for each failure.

### 3. The public order endpoint

`/api/orders` is unauthenticated by necessity, and each call does real work —
prices the order, computes consumption, writes stock movements, sends a
Telegram message. A few hundred requests a second will bury the database and
flood the restaurant's phone.

**Fix:** per-IP limit (say 10 orders per minute), a hard cap on cart size and
line count, and a duplicate check on `clientRef` — which already exists and
makes the retry case free.

### 4. Everything else public

The menu and content endpoints are cheap but not free. One global limit per IP
is enough.

**Implementation:** in-process token bucket keyed by IP and by account. No
Redis, no dependency — the app is a single process per instance, which makes
this a Map and a timestamp. If it ever runs multi-process, move it to Postgres
before reaching for anything larger.

---

## Missing headers

`next.config.mjs` sets none. Add:

| Header | Value | Stops |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'` + what is actually used | injected scripts |
| `X-Frame-Options` | `DENY` | clickjacking the admin |
| `X-Content-Type-Options` | `nosniff` | an upload being run as a script |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | URL leakage |
| `Strict-Transport-Security` | `max-age=63072000` | downgrade |

CSP takes a real pass — the admin uses inline styles today, so it needs either
a nonce or those styles moved out. Do it properly once rather than shipping
`unsafe-inline` and calling it done.

---

## No validation at the boundary

Request bodies are cast (`as { orderId?: string }`) rather than parsed. Prisma
prevents injection, so this is not critical, but it means a malformed or
hostile body reaches business logic before anything checks its shape.

Add a small schema at the edge of each route — `zod` is about 12 KB. Validate
and *reject*, so the handler below can trust what it holds.

Also: never build a Prisma `data` object by spreading a request body. Name each
field. That is how a customer sets their own loyalty balance.

---

## Uploads: one more check

The MIME type comes from the client and can be lied about. The extension is
already forced from the allow-list, which contains the damage, but the file
should also be checked by its **magic bytes** before it is written. Fifteen
lines, and it closes the "polyglot image that is really something else" case.

Confirm too that the upload directory is served by Caddy as static files with
`Content-Type` from the extension and no execution — never from inside the
application root.

---

## The lesson from August, which is not on any checklist

The intrusion did not come from a clever attack on this code. It came from a
**known vulnerability in a dependency, on a server where the app ran as root.**

So the two controls that would have prevented it entirely are boring:

1. **Patch quickly.** Subscribe to Next.js security advisories. A CVSS 10.0 RCE
   in the framework is not a maintenance ticket for next month.
2. **Run as nobody in particular.** The app now runs as `ronnys` with
   `NoNewPrivileges`, `ProtectSystem=strict` and a whitelist of writable paths.
   Even with the same RCE, `useradd` would have failed.

Everything above matters. Neither of these two is optional.

---

## Order of work

1. **Rate limiting + PIN policy** — the only gap an attacker can use today
2. Security headers, CSP done properly
3. `zod` at each route boundary
4. Magic-byte check on uploads
5. A dependency alert that actually reaches you — email, not a dashboard

Items 1 and 5 are worth more than everything else on this page combined.
