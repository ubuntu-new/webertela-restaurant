# Migration wave 1 — one schema change, not three

Everything here touches `schema.prisma`. Doing it as **one migration** means
Ronny's is migrated once. Splitting it across weeks means migrating a live
restaurant two or three times, and later doing it again on every customer
database that exists by then.

Rule for all of it: **Ronny's keeps working at every step.**

---

## 1. `ProductType` — the enum that locks the vertical

**Now:** `enum ProductType { pizza item sticks drink merch }`

`pizza` and `sticks` are Ronny's menu written into the type system. A burger
shop, a bakery or a sushi place has no row it can honestly pick.

**Change:** replace the type with **capabilities**. What a product *is* stops
being a category, and becomes what it *supports*.

```prisma
model Product {
  // remove: type ProductType
  hasSizes     Boolean @default(false)  // coffee yes, burger no
  hasModifiers Boolean @default(false)  // almost everything
  splittable   Boolean @default(false)  // half-and-half — pizza only
  hasVariants  Boolean @default(false)  // merch, colours
  sizeMeta     Json?                    // { cm: 32 } or { oz: 16 }
}
```

A pizza is then a product with `hasSizes + hasModifiers + splittable`. A burger
is `hasModifiers`. A latte is `hasSizes + hasModifiers`. **No code changes when a
new kind of restaurant arrives** — which is the entire point.

**Migration, safe order:**

1. Add the four booleans with defaults `false`. Nothing breaks; nothing reads them yet
2. Backfill from the old enum:
   - `pizza` → `hasSizes=true, hasModifiers=true, splittable=true`
   - `sticks`, `item` → `hasModifiers=true`
   - `drink` → `hasSizes=true`
   - `merch` → `hasVariants=true`
3. Change every read of `type === 'pizza'` to read the capability it actually
   meant. **Search for the enum, not for the word "pizza"** — some checks will
   turn out to mean "splittable", others "hasSizes". They are not the same test
4. Only when no reads remain: drop the column and the enum

**Verify:** Ronny's menu renders identically. Half-and-half still works. The
constructor still opens on pizzas and not on drinks.

---

## 2. `ProductSize.cm` — a pizza diameter in the shared table

**Now:** `cm Int?` — meaningless for a 16oz coffee.

**Change:** it moves into `Product.sizeMeta` (added above) or becomes
`ProductSize.meta Json?`. Prefer per-size:

```prisma
model ProductSize {
  // remove: cm Int?
  meta Json?   // { cm: 32 } · { oz: 16 } · { serves: 4 }
}
```

Backfill `{"cm": <old value>}`, then drop the column. The UI reads
`meta.cm ?? meta.oz ?? null` and shows whichever exists.

---

## 3. `Topping` — do NOT rename the model

The name is pizza language, and the instinct is to rename it to `Modifier`
everywhere. **Resist that.** It is a rename across 21,000 lines to change a word
the customer never sees in the database.

**Do this instead:** make the *label* configuration.

```
Setting: menu.modifierLabel = { en: "Toppings" }   // pizzeria
Setting: menu.modifierLabel = { en: "Add-ons" }    // burgers
Setting: menu.modifierLabel = { en: "Extras" }     // cafe
```

The admin UI and the customer menu read the label. The schema keeps saying
`Topping`. Cost: an afternoon instead of a week, and zero migration risk.

This is the discipline line for the whole project: **change what the customer
sees, not what the database calls it.**

---

## 4. `Topping.dots` — pizza-constructor UI state in the domain model

**Now:** `dots String[]` — coloured markers for the pizza builder.

**Change:** fold into a generic `ui Json?` alongside `emoji`, `photo`, `popular`.
Same data, no longer a named field that only one vertical understands.

---

## 5. `DiscountType` — an enum that should be a table

**Now:** `enum DiscountType { student diplomatic employee loyalty promo custom }`

`diplomatic` is a Georgian retail concept. A Monroe pizzeria wants `first
responder`, `senior`, `student`. Adding a discount type should never be a
deployment.

**Change:** `DiscountType` becomes rows.

```prisma
model DiscountKind {
  id     String  @id @default(cuid())
  code   String  @unique       // "student" | "first_responder"
  label  Json                  // { en: "First responder" }
  active Boolean @default(true)
}
```

Seed the six existing values so Ronny's is unchanged, then point `Discount.type`
at the table.

---

## 6. `StockUnit` — metric only

**Now:** `enum StockUnit { g kg ml l pcs }`

US kitchens buy in oz, lb, fl oz, gal, and "each". Add them:

```prisma
enum StockUnit { g kg ml l pcs oz lb floz gal each }
```

Plus `Setting: units.system = "metric" | "imperial"` so the UI defaults sensibly.
Purely additive — nothing existing changes.

---

## 7. Tip — the US blocker, and it belongs in this migration

Not in the schema and not in the code today. In the US this is not a missing
feature; it is the reason a restaurant cannot use the system at all.

```prisma
model Order {
  tip Decimal @default(0) @db.Decimal(10, 2)
}
```

`total = subtotal - discountTotal + deliveryFee + tax + tip - pointsValue`

**In scope now:** the column, inclusion in the total, a tip control at POS
(preset % + custom), a tip step at online checkout, and tip visible in the
sales report.

**Not now:** pooling and splitting tips between staff. That blocks customer #10,
not customer #1. Note it and move on.

---

## 8. Tax — configuration, not a bare column

`Order.tax` exists; no computation was found anywhere. US tax is per
state/county/city, and in several states differs between dine-in, takeout and
delivery.

**Minimum for the first customer:**

```
Setting: tax.rates = [{ code, label, percent }]
Setting: tax.rules = { dine_in: "...", pickup: "...", delivery: "..." }
Product: taxable Boolean @default(true)
```

A flat configurable rate per fulfilment type, with per-product taxability. Not a
tax engine. Avalara integration is a customer-#10 problem — and by then someone
will have asked for it, which is when you should build it.

---

## Order of work

| | | |
|---|---|---|
| 1 | Add all new columns and tables, defaults only | nothing reads them — safe |
| 2 | Backfill | Ronny's data is now expressed both ways |
| 3 | Move reads onto the new fields, one call site at a time | verify after each |
| 4 | Drop old columns and enums | only when zero reads remain |
| 5 | Tip and tax UI | new surface, nothing to break |

**One migration. One backfill. One live restaurant to check.**

## Explicitly not in this wave

- `orgId` on 32 models — instance-per-customer makes it unnecessary until ~#10
- Renaming `Topping` → `Modifier`
- Tip pooling
- A real tax engine
- Anything for sushi, bakeries or any restaurant that has not paid you

## When it is done

Time yourself standing up a fresh instance for an imaginary burger shop: clone,
new database, seed, configure, first test order.

**That number is the business.** Everything in this document exists to move it
toward two days.
