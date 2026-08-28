# The cycle, and where it does not close

## The thesis

The owner does not buy a POS. He does not buy a menu editor, a stock ledger or
a kitchen display. He buys **one screen that tells him whether the business is
alive**, and everything underneath exists to make the numbers on that screen
true.

That reorders the whole project. A feature earns its place if it either
(a) puts a number on the owner's screen, or (b) captures the event that makes
one of those numbers correct. Anything else is for later.

It also answers the pricing question. Nobody pays $900 a month for order entry
— they can get that free from a delivery app that then takes 30%. They pay for
knowing their prime cost on a Tuesday morning.

---

## What the owner opens the app to see

Ordered by how often it is looked at, not by how hard it is to build.

**Every morning**

| | Source today | Status |
|---|---|---|
| Revenue yesterday, vs the same weekday last week | `Order.total` | data ✅ · view ❌ |
| Orders, average ticket | `Order` | data ✅ · view ❌ |
| Split by channel — web / pos / phone / kiosk | `Order.source` | data ✅ · view ❌ |
| Cash vs card, for the drawer | `Order.paymentMethod`, `paidAmount` | data ✅ · view ❌ |
| Tips | `Order.tip` — added in Wave 1 | column ✅ · capture ❌ |

**Every week**

| | Source today | Status |
|---|---|---|
| Food cost % of sales | `Recipe` → `ConsumptionRule` → `StockMovement` | ✅ mostly |
| Labour cost % of sales | `Shift.clockIn/clockOut/durationMin` × wage | hours ✅ · wage ⚠ |
| **Prime cost** (food + labour) | the two above | ❌ |
| Profit after fixed costs | needs rent, utilities, insurance | ❌ no model |
| Best and worst products — by revenue *and* by margin | `OrderItem` + recipe cost | ✅ data |
| Busiest hours and days | `Order.createdAt` | ✅ data |
| Discounts given away | `Order.discountBreakdown` | ✅ data |
| Delivery: average time, % late | `assignedAt · pickedUpAt · deliveredAt` | ✅ data |
| New vs returning customers | `Order.userId` | ✅ data |
| Items about to run out | `StockLevel` | ✅ data |
| Variance — theoretical usage vs actual | consumption vs movements | ✅ data |

Prime cost is the number American restaurant owners actually live by: food plus
labour, as a share of sales, with about 60–65% the line between a business and
a hobby. Almost nothing on the market shows it to an independent operator
without an accountant. **This system already holds both halves of it.**

---

## The finding — corrected

The first version of this document said there was no reports page and no way to
compute labour cost. **Both were wrong**, and the mistake is worth recording
because it is easy to repeat: the search was for a *file named* `report`,
`dashboard` or `analytics`. The dashboard is `app/admin/page.tsx`, and the
calculations are in `lib/analytics.ts`. Searching by filename instead of by
content produced a confident answer that was false.

What is actually there, already working:

- revenue, order count, average check, growth vs the previous period
- COGS from recipes and consumption, food cost % against a 28–33% target
- labour cost from `Shift` × `Employee.hourlyRate` — the rate field exists
- **prime cost with the ≤65% line**, and a badge that turns red above it
- fixed costs from `Setting: fixedCosts`, and **net profit** derived from them
- waste, stock count variance, per-branch revenue, hourly load, top products,
  production yield, low-stock alerts, a setup checklist

So the owner's screen is not missing. It is further along than most products
sold to independent restaurants, and it already shows the number almost nobody
shows them.

The gap is narrower, and more specific.

---

## Where the cycle breaks

### 1. The dashboard is written in lari

`₾` appeared in the markup in about a hundred places and every date went
through `toLocaleString("ka-GE")`. A Monroe owner opens his dashboard on day one
and sees Georgian currency and day/month/year dates. Nothing else on the screen
survives that.

Fixed for the dashboard: `lib/format.ts` reads `Setting: org`
(`locale · currency · timeZone · country`) and formats through `Intl`. Ronny's
keeps lari because that setting is seeded with its current behaviour rather
than inheriting the new default — **a new default must never reach an existing
customer by accident.**

Still to convert: ~87 places across 33 files. The server components are
mechanical; `PosTerminal` and `DriverApp` are client components and need the
format passed in as props.

### 1b. Numbers the pulse still does not show

All the data exists; none of it is on the screen:

- **tips** — the column landed in Wave 1
- **channel split** — `Order.source` is `web · pos · kiosk · phone`
- **cash vs card** — `paymentMethod`, for reconciling the drawer
- **delivery time and % late** — `assignedAt · pickedUpAt · deliveredAt`
- **new vs returning customers** — `Order.userId`
- **comparison against the same weekday**, not the previous period. A restaurant
  runs on a weekly cycle; Friday always beats Monday and that means nothing.

### 2. Money cannot be taken online

`PaymentMethod` is `cash | card | split`, and `card` means someone typed a
terminal reference afterwards. There is no processor.

In the US an online menu that cannot take a card is a menu, not a shop. The
whole commission-escape pitch — *stop paying DoorDash 30%* — collapses if the
customer's own site cannot charge the card.

**Undecided, and it gates the launch:** Stripe or Square. Square if the
restaurant already has Square hardware (its POS is then a competitor inside the
building); Stripe if the site is the main channel.

### 3. Tax is a placeholder

Wave 1 added `tax.rates` and `tax.rules` as settings and `Product.taxable`.
Nothing computes anything yet. In several states the rate differs between
dine-in, takeout and delivery. Until this works, the system cannot legally sell
in New York.

### 4. Labour cost has hours but maybe no rate

`Shift` records `clockIn`, `clockOut` and `durationMin` — the hard part is
done. What is missing is a wage on `Employee`, and without it half of prime
cost cannot be computed. This is a one-field change with an outsized payoff.

### 5. Nothing knows what things cost to buy

Recipes say what goes into a dish; stock movements say what left the shelf. But
there is no `Supplier`, no `PurchaseOrder`, no received-at-price. Stock goes
down documented and comes back up undocumented, so food cost rests on numbers
someone typed once.

### 6. Fixed costs do not exist

Rent, utilities, insurance, the loan. Without them the system can show margin
but never **profit** — and profit is what the owner came for.

### 7. Notifications assume Telegram

Telegram carries the dispatch flow. A Monroe restaurant owner does not have
Telegram, and neither do his customers. SMS and email, with Telegram as an
option rather than the spine.

---

## The hierarchy, and the order things are created in

**Recommended: two real levels now, shaped so a third can be added without a
migration.**

```
Organization      the paying account — legal entity, country, currency,
                  timezone, tax profile, subscription
   └── Branch     a physical location — address, hours, fulfilment types,
                  terminals, staff, stock
        └── Terminal
```

`Organization` exists in the schema today but is decorative: `orgId` appears on
`Branch` and `Order` only, referenced in four places. Making it real is small
work and it is the row every other row must eventually hang from.

A third level — a brand, so one owner can run *Ronny's Pizza* and *Ronny's
Grill* under one account — is real but nobody has asked for it. Adding it later
costs one nullable `brandId`; adding it now costs a column on forty tables and
a filter on every query. **Not now.**

### One venue is not one cuisine

A restaurant may sell pizza *and* burgers *and* coffee. So the setup must never
ask "what kind of place is this?" and lock the answer in. Wave 1 already made
this possible: capabilities belong to the **product**, not the venue.

A cuisine preset is therefore only a **seed** — it creates some categories and
sensible defaults, several may be picked at once, and picking none is valid.
It must never become a mode the software runs in.

### The setup sequence

1. **Account** → Organization: name, country, currency, timezone
2. **First branch**: address, hours, fulfilment types (dine-in / pickup / delivery)
3. **Menu seeds** (multi-select, skippable): pizza · burgers · coffee · bakery …
   → creates categories and the default size sets, nothing exclusive
4. **Products**: add or import; each carries its own capabilities
5. **Staff and roles**; wages, so labour cost works from day one
6. **Payments and tax**
7. **Go live** — a checklist that has to be green

Everything after step 2 must be skippable and returnable. An owner who cannot
finish in one sitting must still have a working shop.

---

## Build order

Each step either shows the owner a number or makes one true.

1. **`/admin/reports` — daily.** Revenue, orders, average ticket, by channel,
   cash vs card. Pure queries, no schema change. This is the product appearing.
2. **`Employee.wage` + labour report.** One field, then prime cost becomes
   computable and the dashboard says something no competitor shows.
3. **`FixedCost`** — rent, utilities, insurance, monthly. Then the screen can
   say *profit*, and the subject changes from turnover to the business.
4. **Payments** — Stripe or Square. Until this lands there is no US customer,
   however good the reports are.
5. **Tax** — compute what Wave 1 configured.
6. **Tip capture** — POS control and checkout step; the column is already there.
7. **SMS/email notifications** — Telegram becomes optional.
8. **Supplier + purchase receiving** — food cost stops being a guess.
9. **Wave 2** — the menu payload, so a burger shop can be onboarded at all.

Reports come before Wave 2 on purpose. Wave 2 makes the *second* customer
possible; reports are why the *first* one pays.

---

## The other cycle — the one that pays you

The restaurant's loop is menu → order → kitchen → fulfilment → stock →
purchase → report. Yours is: **find → show → onboard → operate → invoice →
renew.**

It closes only if onboarding is measured. So keep timing the same thing:

> Stand up an instance for an imaginary burger shop — clone, database, seed,
> configure, first test order. **That number is the business.**

At two days, ten customers at $900 is a business one person can run. At two
weeks, three customers is a job with worse hours than driving.

Everything in this document is aimed at one of two numbers: the one on the
owner's screen, and that one.
