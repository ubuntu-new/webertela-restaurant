# Phase A — what is actually in this codebase

Written after reading the schema, the route map and the lib layer of the live
`ubuntu-new/webertela-restaurant`. No code was changed.

---

## 1. Scale

| | |
|---|---|
| Application code | **21,630 lines** (app 15,183 · lib 3,918 · components 2,529) |
| Prisma schema | 1,173 lines — **41 models, 21 enums** |
| API routes | 11 |
| Admin sections | 20 |
| Surfaces | customer site `[lang]` · POS `/pos` · driver app `/driver` · admin `/admin` · KDS |

This is not a restaurant website. It is a restaurant operations platform.

## 2. What it does that competitors don't

Worth naming explicitly, because it decides the price:

- **Recipe → Production → Stock consumption chain.** `Recipe`, `RecipeLine`,
  `ProductionOrder`, `ProductionLine`, `StockMovement`, `StockLevel`.
  Dough and sauce are produced from ingredients, not bought.
- **`ConsumptionRule` keyed on (product, topping, item, size).** That is real
  costing granularity — it knows how much mozzarella an XL Supreme consumes.
- **Half-and-half pizzas** with correct pricing.
- **Loyalty points** (`PointsEntry`, `UserDiscount`) and a rules-driven discount
  engine (`Discount`, `DiscountRule`).
- **Driver app and KDS** as first-class surfaces.
- **Per-branch everything** — `BranchProduct`, `BranchCombo`, `StockLocation`,
  `EmployeeBranch`, `Shift`, `Terminal`.

Slice and ChowNow take orders. Toast charges heavily for a fraction of the
inventory side. This does both.

---

## 3. The tenant boundary — the central finding

`Organization` exists. It is **decorative**.

| Scoping | Models |
|---|---|
| Has `orgId` | **2** — `Branch`, `Order` |
| Has `branchId` only | 7 — `Terminal`, `EmployeeBranch`, `Shift`, `AuditLog`, `BranchProduct`, `StockLocation`, `BranchCombo` |
| **No tenant key at all** | **32** — including `Product`, `Category`, `Topping`, `Combo`, `Discount`, `Employee`, `User`, `Setting`, and the entire stock/recipe/production subsystem |

`orgId` appears in application code in **4 places**, all of them writes:

```
app/admin/branches/actions.ts:25
app/admin/orders/actions.ts:159
app/api/orders/route.ts:116
app/api/pos/orders/route.ts:111
```

Nothing ever reads by org. The menu, the staff, the customers, the stock and the
settings are global.

**But the branch layer is thorough.** That is the hard half of multi-location and
it is already done. `Organization → Branch → Terminal` is a real hierarchy; the
work is to make the first arrow mean something.

## 4. Global uniques — each one is a second restaurant failing

| Constraint | What breaks |
|---|---|
| **`Employee.posPinHash`** | Two restaurants cannot both use PIN `1234`. Six digits, several staff each — this collides early and the error will be baffling |
| `Employee.phone` / `.email` | A person cannot work at two clients |
| `User.phone` / `.email` | **A customer of restaurant A cannot be a customer of restaurant B.** In one town, guaranteed |
| `Branch.code` | `TBS-01` is taken forever |
| `Terminal.posId` | same |
| `Order.orderNo` | Global sequence — the second restaurant's first order is #4183 |
| `StockItem.sku`, `Transfer.no`, `ProductionOrder.no` | Numbering collides |

Every one of these needs to become composite with `orgId`.

## 5. The US gap

Confirmed by reading, not assumed:

| | Status | Note |
|---|---|---|
| **Tip / gratuity** | **Does not exist** — not in schema, not in code | `Order` has subtotal, discount, deliveryFee, tax, points, total. No tip. In the US this is not a missing feature, it is a blocker |
| **Sales tax** | `Order.tax` column exists; **no computation found** | US tax is per state/county/city, and can differ between dine-in, takeout and delivery. Needs rate config, item taxability, fulfillment rules |
| **Card processing** | **None.** `PaymentMethod = cash \| card \| split` | Card is *recorded*, not *processed*. Needs Stripe or Square, card-present at POS and online at checkout |
| Receipts | No ESC/POS printing found | Epson/Star thermal is the US norm; kitchen vs customer copy |
| Notifications | `lib/telegram.ts` | Telegram is not how US restaurants work. Needs SMS |
| Locale | `Json { en, ka }` on every name — **already bilingual** | Content i18n is done. Adding `en-US` as default is cheap |
| Phone / address | `lib/phone.ts` presumed GE format | Needs US formats, and ZIP-based delivery zones |

---

## 6. The recommendation that changes the timeline

**Do not build multi-tenancy before the first ten customers.**

Deploy an **instance per restaurant** — exactly the pattern already running on this
server: own port, own subdomain, own Neon database, same codebase, different env.

| | Instance-per-tenant | Shared multi-tenant |
|---|---|---|
| Work before first sale | **none** | 3–4 weeks |
| Data isolation | **absolute** | one missing `WHERE` from a breach |
| Global uniques | **stop being a problem entirely** | all must be fixed first |
| Migrations | run N times (scriptable) | once |
| Cross-tenant analytics | not possible | easy |
| Comfortable ceiling | ~10–15 tenants | hundreds |

Ten tenants at $800–1,500/month **is the $10k target**. Multi-tenancy is the
answer to a problem you do not have yet, and it costs a month you do not have.

Revisit at customer #10, funded by customers #1–9.

## 7. Honest estimate

**Before the first US restaurant can go live:**

| # | Work | Estimate |
|---|---|---|
| 1 | Tipping — schema, POS, online checkout, staff split, reporting | 1 week |
| 2 | US sales tax — config, item taxability, fulfillment rules | 1 week |
| 3 | Payments — Stripe online + card-present | 1.5–2 weeks |
| 4 | English default, US phone/address, ZIP delivery zones | 3 days |
| 5 | SMS in place of Telegram | 2 days |
| 6 | Receipt printing (ESC/POS) | 1 week |
| 7 | Onboarding script — clone, seed, configure a new instance | 4 days |
| | **Total** | **~5–6 weeks** |

**Deferred until customer #10:** `orgId` on 32 models, central scope enforcement,
composite uniques, per-org settings, per-org routing. ~3–4 weeks, paid for by
then-existing revenue.

## 8. What to do first, this week

1. **Tipping.** Largest gap, smallest ambiguity, and it touches the schema — so
   doing it first avoids a second migration later.
2. **The onboarding script.** Before optimising the build, measure it: time
   yourself standing up a fresh instance today. That number is the business.
3. **Do not touch multi-tenancy.**

## 9. Questions I could not answer from the code

- Is `lib/firebase.ts` auth, storage, or push? It affects the US auth story
- Is `Order.tax` ever non-zero today, or is Georgia handled outside the system?
- Does Ronny's use the stock/production subsystem in practice, or was it built
  and left idle? It is the most valuable part and the least verifiable from here
- `lib/data.ts.bak` sits next to `lib/data.ts` — is one of them dead?
