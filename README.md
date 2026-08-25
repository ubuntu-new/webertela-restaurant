# Ronny's Pizza — Next.js (App Router)

Ronny's-ის ორდერ-აპი, გადატანილი v12 სტატიკური `index.html`-დან **Next.js 15 + TypeScript**-ზე.
დიზაინი **ზუსტად** ორიგინალია: სუფთა CSS (Tailwind არა), Noto Serif/Noto Sans (+ ქართული),
production skin თეთრ ფონზე, საფრონისფერი აქცენტი `#F1C338`.

## სრული ფუნქციონალი

- **მენიუ** — 13 პიცა + BYO, Half & Half გალერეა, extras/sauces/drinks, About + Find us.
- **Customizer** — ზომა/ცომი/სოუსი, zones (whole/left/right), 2×, defaultExtras,
  WHAT'S ON IT chips, 6-topping ლიმიტი, ცოცხალი ფასი. mobile + desktop layout.
- **Half & Half** — ორ-პიცის builder (მარცხ./მარჯვ. picker), fair pricing.
- **Sticks builders** — Super Sticks (დიპები + ექსტრა მოცარელა), Cinnamon Sticks (ექსტრა გლეზური).
- **კალათა** — min-order (25 ₾) / free-delivery (60 ₾) states, edit/stack, qty.
- **Checkout** — delivery/pickup, კონტაქტი, order review, place-order + success.
- **i18n** — EN/KA სრული.

## ინსტალაცია (Windows)

```bash
cd C:\Users\levan\projects\webertela-restaurant
pnpm install      # ან npm install
pnpm dev          # http://localhost:3000
```

## შენიშვნები / დაშვებები

- v12 ორიგინალს **სრული H&H / Sticks modal-ები არ ჰქონდა** — ესენი ავაწყვე იმავე
  დიზაინ-სისტემით (segment-ები, zone-ფერები, chips, `cta-primary`).
- Sticks-ის „ექსტრა მოცარელა" ფასი (`EXTRA_MOZZ_PRICE = 2.00`) დაშვებაა —
  `components/StickBuilder.tsx`-ში ადვილად შესაცვლელი. დიპები/გლეზური რეალური ფასებია (1.80).
- Checkout backend არ აქვს — „place order" ლოკალურ success-ეკრანს აჩვენებს და კალათას ასუფთავებს.

## შემდეგი (სურვილისამებრ)

- Checkout-ის რეალურ backend/payment-თან მიერთება.
- CatNav-ის scroll-spy (აქტიური ტაბი სქროლზე).
- SEO/slug routing (v12-ის `tools/generate.mjs` ანალოგი App Router-ზე).

## SEO — Phase 1: Locale foundation (`/en`, `/ka`)

URL-ზე დაფუძნებული ენები (localStorage აღარ):
- `/en` და `/ka` ცალკე მისამართებით; `/` → `middleware.ts` ავტომატურად ამისამართებს
  ბრაუზერის ენის მიხედვით (Accept-Language), fallback `DEFAULT_LOCALE` (`lib/locales.ts`, ახლა `ka`).
- `<html lang>` თითო locale-ზე სწორია; ენის გადართვა Header-ში ახლა **ნავიგაციაა** (URL იცვლება).
- **hreflang** alternates (`en` / `ka` / `x-default`) + canonical — `app/[lang]/layout.tsx` → `generateMetadata`.
- per-locale `title`/`description` + OpenGraph/Twitter.
- `app/sitemap.ts` (ორივე locale + language-alternates) და `app/robots.ts` ავტომატურად → `/sitemap.xml`, `/robots.txt`.
- კალათა ახლა localStorage-ში ინახება — ენის გადართვისას/refresh-ზე აღარ იკარგება.

### აუცილებელი კონფიგი
`.env` (ან `.env.local`) ფაილში მიუთითე რეალური დომენი (canonical/sitemap/OG-სთვის):
```
NEXT_PUBLIC_SITE_URL=https://შენი-დომენი.ge
```
ნაგულისხმევია `https://ronnys.ge` — შეცვალე რეალურით.

### შენიშვნა არქიტექტურაზე
root layout ახლა `app/[lang]/layout.tsx`-ია (ცალკე `app/layout.tsx` აღარაა — ეს Next-ის
ოფიციალური i18n პატერნია). თუ პირველ `pnpm dev`/`build`-ზე root-layout-ის შესახებ შეცდომა
გამოვა, მაცნობე — 1 წუთის საკითხია.

### ჯერ დარჩენილი (Phase 2/3)
- **Phase 2:** მენიუს **server-rendering** (ახლა კონტენტი client-ზეა → crawler-ს ცარიელი HTML ხვდება),
  JSON-LD (Restaurant + 5 ფილიალი + Products), `next/image` + `next/font`.
- **Phase 3:** `/[lang]/pizza/[slug]` ცალკე გვერდები + dynamic OG + breadcrumbs.
