# Wave 2 — duplicate protection and error surfacing

What this changes, why, and how to put it on the server.

---

## The problem it fixes

Two of them, and they turned out to be the same problem.

**1. Nothing stopped a duplicate.** `StockItem.name` had no unique constraint —
the only unique column was `sku`, and it is nullable, so with an empty SKU you
could create a hundred rows called "Mozzarella" and the database would accept
every one. The same was true of `Product`, `Category`, `Topping`, `Recipe`,
`Combo`, `Discount` and `Employee`. The single duplicate check anywhere in the
codebase was in the bulk "create items from toppings" button.

This is not cosmetic. Two rows for one ingredient split the record of it in
half: recipes deduct from one, deliveries land on the other, the shelf is right
and the software is wrong. **Food cost is understated and nothing looks
broken** — which makes it exactly the kind of error that survives for a year.

**2. Validation messages never arrived.** Every action validated with
`throw new Error("The English name is required")`. There was no error boundary
under `/admin`, and in production Next.js replaces a thrown server-action
message with an opaque digest. So the software was writing careful advice into
a void: the owner saw a crash page, or nothing.

---

## What is there now

### Before the save — a warning while you type

`lib/name-key.ts` reduces a typed name to a comparison key: Unicode-normalised,
combining marks stripped, lower-cased, every run of non-letters collapsed to one
space. "Mozzarella", "mozzarella ", "MOZZARELLA" and "Crème"/"Creme" all land on
the same key. Georgian passes through unchanged.

The key is stored in a new `nameKey` column on ten models, indexed, so the
lookup is an index hit rather than a scan.

`app/admin/_components/NameField.tsx` asks, half a second after typing stops,
what already matches — and says so **specifically**:

> **You already have this**
> Mozzarella · 4.2 kg on hand · used by 6 menu rules · in 2 recipes

Not "name already exists", which tells nobody anything.

### At the save — a question, not a refusal

`lib/dup.ts` runs the same check server-side, so the guard cannot be bypassed by
disabling JavaScript. It finds exact matches from the index and, failing that,
near matches — a typo ("Mozarella") or a longer form ("Mozzarella Cheese").

It **never refuses outright.** A kitchen legitimately holds "Egg" and "Eggs";
a menu legitimately runs "Margherita" as a pizza and as a calzone. The form
stops, shows what exists, and offers three ways out: open the existing one,
change the name, or *"No — this is a different thing, create it"*. That last
button is the only thing that sets the confirm flag, so it is a decision rather
than something you can click past by resubmitting.

Deliberately **not** done: stemming or singularising. Guessing that "Eggs" is
"Egg" would block a legitimate entry, and a false block teaches the owner to
stop reading the warnings that matter.

### After the fact — merging what is already split

`/admin/stock/duplicates` finds every group of stock items sharing a key and
merges them properly:

- quantities **add**, per location
- cost is **averaged by quantity** (10 at $6 + 2 at $9 = 12 at $6.50), so no
  future sale re-prices because of the merge
- movements are **re-pointed, never deleted** — the ledger is what makes
  "on hand" trustworthy
- colliding consumption rules keep the **larger** quantity (an under-deduction
  hides; an over-deduction shows up and gets corrected)
- recipe / transfer / production lines that would violate their unique index are
  **summed**, not dropped
- the loser is **archived**, its SKU recorded in its note and inherited by the
  survivor if the survivor has none
- one transaction, 120-second timeout, audit-logged

Items in different units cannot be merged. Kilograms and pieces are not the same
measurement, and pretending otherwise would silently invent stock.

The dashboard says so on its own: `lib/advice.ts` gained a finding — *"N
ingredients exist more than once … food cost is understated until they are
merged"* — and `/admin/stock/items` shows a banner.

### Everywhere — errors that reach the person

`lib/action-state.ts` turns a thrown error into form state:

- `ActionError` → shown above the fields, **with the typed values still in
  them**, plus a "go to the field" link
- `DuplicateError` → the confirmation panel
- Prisma `P2002/P2003/P2025/P2000` → translated into plain language
- anything else → a generic message; the real one goes to the log, because an
  unrecognised throw is a bug and a bug's message is a SQL query
- `redirect()` and `notFound()` are re-thrown untouched (any `NEXT_*` digest),
  so a successful save is never swallowed

Button-only actions have nowhere to render state, so they use `failTo()`, which
carries the message in the URL. 42 actions were converted. `app/admin/error.tsx`
is the backstop, and it says the three true things: nothing was saved, here is
the reference, here is the way back.

Submit buttons now disable while in flight — an impatient second click used to
create a second record.

---

## Deploying it

```bash
cd /srv/<instance>
bash scripts/wave2-dup-apply.sh /srv/<instance>
```

The script, in order: backup → **restore the backup into a scratch database to
prove it works** → migrate → check that the two copies of the normalisation rule
still agree → backfill the keys → report existing duplicates → build → **restart
only if the build passed** → health check → log.

That last point is not a detail. The demo went down once because a deploy loop
restarted the service whether or not `next build` had succeeded. The migration
is additive, so if the build fails the site keeps serving the old code quite
happily while you fix it.

### Afterwards

1. Open `/admin/stock/items`. If there is an amber banner, the restaurant has
   duplicates — go to `/admin/stock/duplicates` and merge them.
2. Try creating "Mozzarella" again. The warning should appear under the field
   before you reach the Create button.

### The parity check

`lib/name-key.ts` (TypeScript, used by the app) and
`scripts/backfill-name-keys.mjs` (plain Node, used by the migration, which
cannot import TypeScript) hold the same rule twice.
`scripts/check-name-key-parity.mjs` compares them and the deploy script runs it
**before** the backfill — because if they drift, the backfill writes keys the
app can never match, every existing row silently stops being detected, and the
failure looks exactly like success.

---

---

## Part two — identity beyond the name

A name is the weakest identifier a product has, because it is the one part a
human types. Comparing names alone made mistakes in both directions: it missed
the same product bought under two names, and it invented duplicates out of
"Coca-Cola 330 ml" versus "Coca-Cola 1.5 L". The second kind is the more
dangerous one — noise teaches an owner to click past warnings, and then the
warning that mattered goes past too.

So three identifiers were added that nobody types:

**Barcode (GTIN)** — `lib/gtin.ts`. Stored as 14 digits, zero-padded, which is
GS1's own recommendation: the UPC-A on an American can and the EAN-13 on the
same can in Europe are the same number with a leading zero, and storing them as
typed would put one product in the database twice. The last digit is a mod-10
checksum, so a mistyped barcode is caught **at the keyboard**. `BarcodeField`
reads it with the phone's back camera (`BarcodeDetector`); where the browser has
no such API — Safari on iPhone — the button says so in one line instead of
silently doing nothing.

**Pack size** — 500 g, 1.5 L, 12 pcs. This is the field that stops the check
crying wolf: same name plus a different pack is two real items.

**Supplier + their code** — `/admin/suppliers`. Most of what a kitchen buys has
no barcode at all; for a sack of flour, the only identifier nobody typed is the
code the mill uses for it.

### How the evidence is weighed

| evidence | verdict |
|---|---|
| same barcode | **certain** — no override; the column is unique |
| same supplier + code | **strong** — no override; the pair is unique |
| same name, same pack | probable — asks |
| same name, nothing else known | possible — asks |
| same name, **different barcode** | not a duplicate — silent |
| same name, different pack | not a duplicate — silent |

That fifth row is the one that makes this feel intelligent rather than nagging:
**two different barcodes are proof that two things are different**, so the name
similarity is discarded. The products most likely to share a name are the same
brand in two pack sizes — and those are exactly the ones that both have
barcodes.

### Units now convert

`lib/units.ts` gives every unit a dimension and an exact factor (1 lb is
453.59237 g by treaty, not a rounded figure). The merge tool no longer refuses
"Flour (g)" and "Flour (kg)" — it converts. Kilograms and pieces stay refused,
because how many pieces make a kilogram depends on the item, and converting
would invent stock.

A conversion restates **everything**: stock levels, minimums, unit costs, every
past movement, recipe amounts, transfer and production lines, and the yield of
any recipe that produces the item. Prices scale the opposite way to quantities
($2/kg is $0.002/g, not $2000), which is easy to get backwards and produces a
number that looks plausible. Converting into a unit more than 1000× larger is
refused rather than attempted: the quantity columns hold three decimals, so
1 ml would round to 0.000 gal and the ledger would keep its money and lose its
quantity.

## Known limits

- `nameKey` is indexed but **not unique**, on purpose: a deliberate duplicate has
  to remain possible. The guard is in the application, so a race between two
  simultaneous submits could still create one — the advice panel catches it.
  `barcode` and `(supplierId, supplierCode)` **are** unique at the database, so
  those cannot race.
- The merge tool covers stock items. Duplicate products, toppings and categories
  are warned about at creation but have no merge screen yet; they are far less
  damaging, because none of them splits a running balance.
- A merge rewrites the lines of transfers and production orders that are already
  closed. The ledger stays correct, but a printed document may no longer match
  its record.
- Barcodes, pack sizes and supplier codes are **empty on every existing row**.
  Nothing is worse than it was, but the strong signals only start working as
  they get filled in. The practical order: scan the barcode on anything that has
  one (drinks, packaged goods), and put supplier codes on the rest as deliveries
  come in.
- Camera scanning needs `BarcodeDetector`: Chrome and Android, not Safari on
  iPhone. On an iPhone the number is typed and still checksum-validated.
- No density conversion. Litres do not become kilograms, because the factor is a
  property of the substance rather than the units, and guessing it would
  misstate stock.
