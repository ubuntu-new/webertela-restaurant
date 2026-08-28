# Two things that must not break: the POS, and the POS

A branch takes orders whether or not the office is looking at a dashboard, and
whether or not the internet is up. Those are two separate problems that get
confused with each other, so they are separated here.

---

## Part 1 — the dashboard must never slow the tills

### It is not a locking problem

Postgres readers do not block writers. A dashboard query, however heavy, cannot
make a POS insert wait. So the fear of "the manager opened a report and the till
froze" is, mechanically, unfounded.

### It is a resources problem, and that one is real

`lib/analytics.ts` runs ten `findMany` calls and sums the rows **in Node**.
Today that is invisible: Ronny's has nine orders. At a real US restaurant:

| | 90-day view |
|---|---|
| orders pulled into memory | ~18,000 rows |
| stock movements pulled | 100,000+ rows |
| transferred and parsed | ~2 MB **per page load** |
| the same in SQL | ~100 bytes |

Every dashboard open holds a connection while it drags that across, parses it
and reduces it. Ten managers with the tab open on a Friday night is when the
till finally does notice — not because of locks, but because the pool is empty
and the CPU is busy adding up numbers Postgres could have added up in place.

### The fix, in order of value

1. **Aggregate in SQL.** `aggregate({ _sum, _count })` and `groupBy` instead of
   `findMany` + `reduce`. Same shape of code, ~100× less work, no new
   dependency. This is the whole of it for the next few years.
2. **Indexes** on `Order(createdAt, status)` and `StockMovement(at, type)` —
   the two filters every report uses.
3. **A connection ceiling** for the web app in `DATABASE_URL`
   (`?connection_limit=10`), so a slow report can never consume every
   connection the tills also need.
4. **A 60-second cache** on the dashboard — later, when several people watch it
   at once. Nobody needs revenue accurate to the second.
5. **Daily rollups** — much later, past a couple of years of history. Closed
   days get summarised; today stays live.

**The rule underneath all of it:** a derived number is never stored as truth. A
rollup is a cache, and a cache must be rebuildable from the source at any
moment. The day two screens disagree about revenue, the owner stops trusting
both.

---

## Part 2 — a branch loses the internet

### Most of this is already built

`app/pos/PosTerminal.tsx` and `app/api/pos/orders/route.ts` already have the
part that is genuinely hard:

- every order carries a **`clientRef` uuid**, and the API returns the existing
  order if it sees one twice — so resending is free and duplicates are
  impossible
- orders enter a **local queue in `localStorage`** before being sent, drained
  by a sender
- each ticket gets a **`localNo`**, so the customer has a receipt number
  without the server
- `navigator.onLine` drives an offline badge and a queue count on screen

That is the foundation, and it is the right one.

### The gap that undoes all of it

**There is no service worker.**

The queue survives in `localStorage`, but the *application* comes from the
network. Lose the internet, and the moment the cashier reloads the tab — or the
tablet sleeps and wakes, or Chrome recycles the page — the POS will not open at
all. The orders that were queued are still on disk, and unreachable, because
nothing can render them.

So the till works offline right up until the first refresh, which is exactly
when someone will press it.

### What closes it

1. **A service worker** that caches the POS shell — its HTML, JS and CSS — and
   serves them without the network. This is the single highest-value item in
   this document.
2. **A cached menu snapshot.** `PosTerminal` receives the menu as props from a
   server component; offline there is no server to render it. The menu payload
   goes into `localStorage` with a version stamp, and is refreshed whenever the
   terminal is online.
3. **Say what is degraded, plainly.** Offline the till must show:
   - *card payments unavailable — cash only* (a card needs the network anyway)
   - *stock not checked* — an offline order cannot know what ran out
   - *N orders waiting to sync*
   Silence here is worse than the outage: a cashier who does not know he is
   offline will promise a card payment he cannot take.
4. **Prices come from the cached snapshot**, and the server recalculates on
   sync. If the two disagree, the order syncs and is **flagged**, not silently
   rewritten. A price that changed mid-outage is a conversation, not a bug to
   paper over.

### Numbering, which is where these systems usually break

Do not let an offline terminal invent a global order number.

- the terminal issues `localNo` — prefixed by terminal, e.g. `T2-118`
- the **server** assigns the canonical `orderNo` on sync
- the receipt shows `localNo`; the back office shows both

No sequence to reconcile, no collisions, nothing clever. The `clientRef` uuid
already makes the join reliable.

### What syncs cleanly, and what does not

| | Offline |
|---|---|
| **New order, cash** | ✅ queues, syncs, idempotent |
| New order, card | ❌ the terminal needs the network regardless |
| Reading the menu | ✅ from the cached snapshot |
| Stock deduction | ⚠️ deferred to sync — may go negative, correct on count |
| Voiding your own unsynced order | ✅ remove it from the queue |
| Editing an order another till created | ❌ refuse — this is where conflicts come from |
| Loyalty points, discounts needing verification | ⚠️ apply on sync, not at the till |

The last row is the discipline: **an offline terminal may create, but may not
edit what it did not create.** That one rule removes almost every conflict case
without a merge algorithm.

---

## What this is not

**Not a branch-local server.** Running Postgres in each branch and replicating
to the centre handles a longer outage, and costs hardware in every location,
replication to maintain, and real conflict resolution. That is a chain's
problem — customer twenty, not customer one.

**Not multi-master sync.** Months of work, and the failure modes are subtle and
awful. A queue plus idempotency covers an outage of minutes to hours, which is
what a Monroe restaurant actually experiences.

---

## Order of work

1. Service worker for the POS shell — without it the rest is theatre
2. Cached menu snapshot with a version stamp
3. Honest offline state on screen: cash only, stock unchecked, N waiting
4. `analytics.ts` onto SQL aggregates, plus the two indexes
5. `connection_limit` on the app's `DATABASE_URL`
6. The create-but-not-edit rule enforced in the API, not only in the UI

Items 1–3 are the promise "your till keeps working". Items 4–5 are the promise
"the office cannot slow the till". Both are things an owner will ask about in
the second meeting, and being able to answer them without hedging is worth more
than another feature.
