# Wave 2 — what the code actually says

Wave 1 added the capability flags. The plan said Wave 2 would be "move 33 reads
off `type`". Reading the code, that is not what is there.

`grep 'pizza'` returns 33 hits. **Twelve** are comparisons. Of those twelve,
**five do not touch `Product.type` at all**, and of the remaining seven, **one**
is genuinely asking a capability question.

That changes what this wave is.

---

## The twelve, sorted by what they actually mean

### A. Not `Product.type` — a combo-ref namespace (5)

| Where | Code |
|---|---|
| `lib/consumption.ts:169` | `const [type, raw] = ref.split(":")` |
| `lib/data.ts:271` | `const [type, id] = ref.split(":")` |
| `lib/order-pricing.ts:161` | `const [type, id] = ref.split(":")` |

These parse strings like `"pizza:1"`, `"drink:cola"`, `"side:sticks"`. The word
`pizza` here is a *namespace prefix in an identifier*, not a product category.
Changing them has nothing to do with capabilities and would break combos.

**Leave them.** They belong to the ref-format problem below, not to this wave.

### B. Genuinely a capability question (1)

`app/admin/products/actions.ts:33,41` — when an admin creates a product:

```ts
price: type === "pizza" ? null : (fdNum(fd, "price") ?? 0),
…
if (type === "pizza") { /* create S / M / XL rows */ }
```

The real question is *does this product have sizes instead of one price*. That
is `hasSizes`, exactly.

```ts
price: hasSizes ? null : (fdNum(fd, "price") ?? 0),
…
if (hasSizes) { /* create the default size rows */ }
```

The default sizes themselves — `S 20cm · M 30cm · XL 45cm` — are pizzeria
values living in code. They belong in `Setting: menu.defaultSizes`, so a burger
shop gets `Single / Double` and a cafe gets `12oz / 16oz`.

### C. Really asking `legacyId != null` (6)

| Where | Written as | Means |
|---|---|---|
| `app/admin/orders/actions.ts:120` | `p.type === "pizza" && p.legacyId != null` | is this handled by the legacy pizza pipeline |
| `app/pos/page.tsx:29,32` | `o.product.type === "pizza"` / `!== "pizza"` | split into legacy pizza ids vs product ids |
| `lib/menu-db.ts:89` | `products.filter(p => p.type === "pizza")` | build the `PIZZAS` array |
| `lib/menu-db.ts:166` | `if (p.type === "pizza") return \`pizza:${p.legacyId}\`` | which ref namespace |

Every one of these exists to feed or read **`MenuPayload.PIZZAS`** — a separate,
numerically-keyed array that sits beside the normal product tables.

---

## So the real blocker is not the enum

Dropping `ProductType` would satisfy the schema and change nothing about who can
use this system. A burger shop still cannot use it, because:

- the menu payload has a top-level `PIZZAS` array with its own numeric ids
- combos address products as `pizza:1` / `drink:cola` / `side:sticks`
- the POS, pricing, consumption and half-and-half code all read that shape

**That is the vertical lock.** The enum was a symptom.

## What Wave 2 should be

**One goal: `MenuPayload` stops having a `PIZZAS` array.**

1. **`Setting: menu.defaultSizes`** — take S/M/XL and their centimetres out of
   `products/actions.ts`. Small, isolated, immediately useful.
2. **Replace the ref format.** `pizza:1` → `product:<cuid>`; `drink:cola` and
   `side:sticks` → `product:<cuid>`. Write a converter, keep reading the old
   format for existing rows, write only the new one. Combos and consumption
   both go through it, so do them together.
3. **Collapse `PIZZAS`, `DRINKS`, `EXTRAS`, `SAUCES` into one `PRODUCTS` list**
   carrying the capability flags. The pizza constructor asks for `splittable`,
   the size picker for `hasSizes`, the topping panel for `hasModifiers` — the
   questions the flags were added to answer.
4. **Then** the six `legacyId` checks disappear on their own, and `type` has no
   readers left.

Only after that is dropping `type`, `cm` and `dots` a formality.

## Order matters here

Doing step 4 first — a find-and-replace of `type === "pizza"` into
`hasSizes` — would compile, pass a smoke test, and leave the system exactly as
pizza-only as it is now, while making the next person believe the job was done.

That is the trap in this wave. The capability flags are not the migration; they
are what makes the migration expressible.

## Measure it the same way

Stand up an instance for an imaginary burger shop: clone, new database, seed,
configure, first test order. Time it before Wave 2 and after. If the number has
not moved, the wave did not do its job — whatever the diff looks like.
