# Automation — two audiences, two kinds

There are two people who must not have to do repetitive work: the restaurant
owner, and you.

They need opposite things. The owner needs the software to **come to him**. You
need it to **run without you**. Neither is a feature on the menu screen, and
both decide whether this is a business or a job.

---

# Part 1 — for the owner: push, not pull

The dashboard is pull. Pull requires the owner to remember, to log in, to
choose a period, to read. He will do it for two weeks and then stop, and six
months later he will cancel because "I never used it".

**The product is not the dashboard. It is the message at 9am.**

> Yesterday $3,240 — up 12% on last Thursday.
> Mozzarella runs out Thursday.
> Combo #2 lost money again: 34 sold, 22% margin.
> 4 deliveries over 45 minutes.

Three lines he reads on his phone while the oven heats. The dashboard is where
he goes when one of those lines worries him — which is exactly the L1/L2 split,
except L0 is a message he did not ask for.

### What should happen without being asked

**Every morning** — the brief above, by SMS or email or WhatsApp, whichever he
answers. One message, four lines, a link.

**Every week** — prime cost, the trend, the three worst products by margin, and
labour as a share of sales.

**When something changes, not on a schedule:**

| Trigger | Message |
|---|---|
| revenue 20% below the same weekday | *"Quiet day — $1,900 vs $2,600 last Tuesday"* |
| food cost drifts above 35% for three days | *"Ingredients are costing more — check portions or prices"* |
| a stock item falls under two days of cover | *"Mozzarella: 1.5 days left. Order by tomorrow."* |
| a product's margin drops more than 10 points | *"Pepperoni margin fell from 61% to 44% — cheese price rose"* |
| a shift never clocked out | *"Nika's shift is still open from Saturday"* |
| no orders for two hours during service | *"No orders since 18:40 — is the till working?"* |

That last one is the difference between a tool and a colleague.

### And the work it should do by itself

- **Reorder points computed, not typed.** Par levels come from actual
  consumption over the last N weeks, not from a number someone guessed once.
- **A purchase list, ready to send.** Everything under par, quantities
  suggested, grouped by supplier.
- **A staffing suggestion** from hourly load — where the rota does not match
  the shape of the demand.
- **Dormant customers** — the loyalty data already knows who ordered weekly and
  then stopped. One message wins some of them back.

Every one of these is derivable from data the system already holds. None of
them needs a new integration.

---

# Part 2 — for you: the control plane

This does not exist today, and it is what makes instance-per-tenant possible.

Instance-per-tenant is the right architecture — one customer's bad migration
cannot touch another's data, and one customer's Friday night cannot slow
another's. But it multiplies operations by the number of customers, and today
every deploy on this server is done by hand. **At ten customers that model
collapses, unless the multiplication is automated away.**

## What it has to do

### 1. Create a customer in one command

```
new-tenant.sh ronnys-monroe --domain ronnys-monroe.com --currency USD --tz America/New_York
```

and it does all of it: database and role, `.env` with generated secrets,
systemd unit with the hardening already in place, Caddy block, TLS, migrations,
seed, an admin account with a one-time link, the backup script updated to
include the new database, and a smoke test that places a test order and rolls
it back.

**The demo instance is the first customer this script serves.** Do not deploy
the demo by hand and write the script later — write the script and let the demo
be its first run. Everything awkward in it will be awkward again with a paying
customer, except then somebody is waiting.

### 2. One screen that shows every instance

| | Why it matters |
|---|---|
| up / down, response time | before the phone rings |
| **last order received** | a restaurant with no orders at 19:00 is broken, even if HTTP says 200 |
| errors in the last hour | the shape of a problem before it is a complaint |
| database size, disk | the boring thing that takes a server down at 3am |
| last successful backup, and last **verified restore** | a backup nobody restored is a hope |
| version deployed, migrations pending | which customer is behind |

"Last order received" is the one that earns its place. Every other check can be
green while the till is refusing cards.

### 3. Tell you before the customer does

The whole margin of a $900/month product is in this line. If he calls you, you
have already lost the afternoon and some of the trust. If the alert reaches you
first — *"ronnys-monroe: no orders since 18:40"* — you call him, and the
relationship changes permanently.

Alerts go where you actually look. Not a dashboard you would have to remember
to open — the same mistake the owner makes with his.

### 4. Update everything, safely

```
deploy-all.sh --version 1.4.2
```

per instance: back up, migrate, build, restart, smoke test, and **roll back
that one instance automatically if the smoke test fails**, without touching the
others. A release must never mean ten manual repetitions of what we did today.

### 5. Bill without remembering

Subscriptions, invoices, payment reminders. At ten customers, manual invoicing
is a day a month and one awkward conversation. Stripe Billing does this and
costs nothing to start.

### 6. Support without screenshots

- **View-as-customer** (read-only, logged in the audit trail) so you can see
  what he sees without asking him to photograph his screen.
- Per-instance logs reachable from one place.
- The setup checklist you already have, visible to you — so you can see a
  customer who stalled at step four and call him. **That is churn prevention,
  and it is free.**

---

## What this is not

**Not Kubernetes.** Ten Next.js processes and ten Postgres databases on one or
two boxes. Systemd already does supervision, Caddy already does TLS. Adding an
orchestrator adds a second system to operate and solves nothing you have.

**Not a custom monitoring stack.** A script that checks each instance every
minute and writes to a table is enough for years. Uptime Kuma if you want a UI.

**Not multi-tenancy in the database.** Instance-per-tenant until roughly the
tenth customer, exactly as planned. The control plane is what buys that time.

---

## The order

1. **`new-tenant.sh`** — and prove it by deploying the demo with it
2. **The morning brief** — the highest-value owner feature in this document,
   and it needs no new data
3. **The instance monitor**, with *last order received* in it
4. **Alerts to you**, before the customer
5. **`deploy-all.sh`** with per-instance rollback
6. **Automatic reorder points and the purchase list**
7. **Billing**
8. **View-as-customer**

Items 1 and 3 are what let you say yes to a tenth customer without dread.
Item 2 is what makes the ninth one renew.

---

## The number this is all aimed at

> Ten customers at $900/month, run by one person, without the software needing
> him on a Friday night.

Every hour of manual work per customer per month is an hour multiplied by ten.
That is the only arithmetic that decides whether this is a business or a job
with worse hours than driving.
