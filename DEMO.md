# The demo

A prospect should not be told what the software does. He should open a screen
and recognise his own restaurant on it.

That is the whole specification. Everything below serves it.

---

## What the demo is not

**Not a "pizzeria mode".** The temptation is a switch in the software:
pizzeria / burgers / coffee. That is the vertical lock coming back through the
front door, and Wave 1 exists to remove it.

The switch is between **seed datasets**, not between modes. Four different
menus, four different sets of ninety days of orders — and *identical
application code*. When the prospect flips from burgers to coffee and the
software does not change, that is the argument being made without a sentence
of copy.

**Not a screenshot, and not a video.** A picture proves nothing; anyone can
draw one. A running instance with his own kind of food in it, that he can click
through, is the demo. It also costs almost nothing extra, because standing one
up is the same work as onboarding a paying customer.

**Not a sandbox he can break.** Read-only, restored nightly.

---

## The four sets

| Set | Who recognises himself | Proves |
|---|---|---|
| `pizzeria` | Ronny's, and every pizza place in Orange County | sizes, half-and-half, toppings |
| `burgers` | a grill, a diner | modifiers without sizes, no splitting |
| `coffee` | a café, a bakery | sizes in oz, fast tickets, no delivery |
| **`mixed`** | a place that sells pizza *and* burgers *and* coffee | **that it does not force a category on you** |

### Ship `mixed` first

`mixed` is the only one that says something the competition cannot. Every
restaurant system demos a pizzeria; almost none can show one venue selling
three unrelated things without a workaround.

It also covers the other three: a burger owner looking at `mixed` sees his
burgers on the screen, next to things he does not sell — which reads as
capacity, not clutter.

So: build `mixed`, put it live, and add the single-cuisine sets only when a
prospect asks for one. One good demo beats four half-seeded ones.

---

## The menu (`mixed`)

Sixteen products is enough to look like a real menu and small enough to seed
carefully. Prices are Hudson Valley, 2026.

**Pizza** — `hasSizes · hasModifiers · splittable`
- Margherita · 12" $14 · 16" $19 · 18" $23
- Pepperoni · 12" $16 · 16" $21 · 18" $25
- White Garlic · 12" $16 · 16" $22 · 18" $26
- Build your own · from $13

**Burgers** — `hasModifiers`
- Classic Smash $11 · Double Smash $15 · Crispy Chicken $12 · Veggie $11

**Coffee** — `hasSizes · hasModifiers`, sizes in oz
- Drip 12oz $2.75 / 16oz $3.25 · Latte 12oz $4.50 / 16oz $5.25
- Cold Brew 16oz $5 · Hot Chocolate 12oz $4

**Sides & sweets** — `hasModifiers`
- Garlic Knots $6 · Fries $4 · Cheesecake slice $7 · Cookie $3

Toppings are labelled from `Setting: menu.modifierLabel`, so the pizza section
says *Toppings* and the burger section can say *Add-ons* without a schema
change.

**Notice what this menu is doing:** oz next to inches, splittable next to not,
sizes next to a flat price. It is a menu that no vertical template could hold —
and it renders on a dashboard built for one restaurant at a time.

---

## The numbers, which are the actual demo

The menu is the costume. The dashboard is the argument, and it is only
persuasive if the figures behave like a real restaurant's.

**Ninety days of orders**, seeded with:

- **A weekly rhythm.** Friday and Saturday roughly double Monday and Tuesday.
  A flat line reads as fake instantly to anyone who has run a restaurant.
- **A daily shape.** Lunch bump at 12–13, the real peak 18–20, a tail to 21.
- **Channel mix** — about 45% web, 40% POS, 15% phone. The web share is the
  pitch: that is the money that would otherwise go through a delivery app.
- **Payment mix** — roughly 70% card, 30% cash.
- **Tips** on card orders, averaging 16%, absent on cash.
- **Growth** — the last thirty days about 12% ahead of the thirty before.
  Something has to be improving, or the screen has nothing to say.

**And the figures the owner is buying:**

| | Target in the seed | Why |
|---|---|---|
| Food cost | ~31% | inside 28–33%, so the badge is green and believable |
| Labour cost | ~27% | real shifts, real hourly rates |
| **Prime cost** | **~58%** | under 65%, and the number nobody shows them |
| Fixed costs | $9,200/mo | rent, utilities, insurance — so **net profit** appears |
| Net profit | ~8–11% of revenue | the truthful range; 30% would destroy trust |

**Three things must be visibly wrong**, or the demo looks like marketing:

1. **One product losing money.** The combo, or the 18" white garlic — high
   revenue, margin under 25%. This is the single most convincing thing on the
   screen: it tells the owner something he did not know about his own business.
2. **One stock item nearly out.** Mozzarella, under two days of cover.
3. **A few late deliveries.** Four orders over 45 minutes last week.

A dashboard where everything is green is a brochure. A dashboard that points at
three problems is a tool.

**Rule for the seed: every number must be derived, never typed.** Food cost has
to come out of real recipes consuming real stock at real purchase prices. If a
prospect clicks from 31% into the ingredients and the arithmetic does not hold,
the demo has done more damage than no demo.

---

## Safety

- `DEMO_MODE=1` — every server action that writes returns a friendly refusal.
  Enforced in the action, not in the UI: hiding a button is not security.
- **Nightly restore** from a fixed dump at 04:00, so anything a visitor changes
  or breaks is gone by morning. Same `pg_restore` path we already verified.
- No real customer data, no real phone numbers, no real addresses. Invented
  names, `555-01xx` numbers — the range reserved for fiction.
- `robots: noindex` on the admin, indexable on the landing page.

---

## Shape on the server

`demo.webertela.online` → one more instance beside the four already running:
its own database, its own `.env`, its own systemd unit, its own Caddy block.

**Building it is the onboarding rehearsal.** Time it, start to finish — clone,
database, seed, configure, first test order. That number is the one the whole
business rests on:

> at two days, ten customers at $900/month is a business one person can run;
> at two weeks, three customers is a job with worse hours than driving.

Whatever is slow while standing up the demo is exactly what will be slow with a
paying customer, except that then it will be slow in front of someone who is
waiting.

---

## What the prospect does next

The demo is not the end of the funnel, it is the middle. The screen needs one
thing to do:

> **"This is your restaurant's data in thirty days. Ready to see yours?"**

with a single button that starts a conversation — not a signup form, not a
pricing table. At three or four customers at a time, the scarce thing is
attention, not leads.

---

## Order of work

1. Seed script for `mixed` — menu, recipes, stock, purchase prices, staff, rates
2. Ninety days of orders with the rhythm above, derived not typed
3. Fixed costs, so net profit shows
4. `DEMO_MODE` write guard
5. Instance on `demo.webertela.online`, nightly restore cron
6. Landing page and the single button
7. `pizzeria`, `burgers`, `coffee` — only once someone asks
