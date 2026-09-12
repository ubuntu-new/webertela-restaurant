/**
 * What a restaurant says about itself — the pure half.
 *
 * No database and no `server-only`, so client components can hold the same
 * shape. The server half (lib/brand.ts) reads it; this side only describes it.
 * Same split as lib/format-shared.ts, and for the same reason.
 *
 * ── Why these four live together ──
 *
 * Each was a literal in the markup, and each was a claim about one business
 * that every other business then made on its own website:
 *
 *   name          "Ronny's" in the header, footer, copyright and signature
 *   tagline       "Makes Life Better"
 *   deliveryTime  "30–45 min"
 *   rating        "4.8"
 *
 * The last two are the serious ones. A restaurant that opened this morning
 * displayed a 4.8 rating and a delivery promise it had never made — to
 * customers, on its own front page. A wrong menu is embarrassing; a rating
 * nobody earned is a claim about other people's opinions.
 *
 * ⚠️ Every field is optional and empty means HIDDEN, never a default. There is
 * no honest default for any of them: a made-up rating is a lie, a made-up
 * delivery time is a promise the kitchen did not make, and a made-up name is
 * how this file came to exist.
 */
import type { SocialLink } from "@/lib/social";

export interface Brand {
  name: string;
  tagline: string;
  /** e.g. "30–45 min". Shown only if the restaurant has stated one. */
  deliveryTime: string;
  /** e.g. "4.8". Shown only if the restaurant actually has a rating. */
  rating: string;
  /**
   * What the browser tab and the Google result say after the name.
   *
   * ⚠️ Separate from `tagline`, and the difference is the whole point.
   *
   *   tagline   "Makes Life Better"                    — a slogan, for humans
   *   seoLine   "Fresh pizza delivery in Tbilisi"      — words people search
   *
   * The first version of this work replaced a hand-written title with a
   * generic one, because the hand-written one named another restaurant's city.
   * That was right for a new tenant and a real loss for Ronny's: they went from
   * a title containing "pizza delivery" and "Tbilisi" to one containing
   * neither, which is the difference between being found and not.
   *
   * Empty falls back to a neutral sentence — true of any restaurant, useful to
   * none of them in search. It is meant to be filled in.
   */
  seoLine: string;
  /** The meta description. Same rule: theirs if they have one. */
  seoDescription: string;
  /**
   * The About page, in the restaurant's own words.
   *
   * ⚠️ Twenty-six translation keys used to hold this — a complete brand story
   * written for one pizzeria and shipped to every tenant:
   *
   *   "We're an American pizza shop in Tbilisi. Five locations. Since 2009."
   *   "We don't want Ronny's to be just another place to buy pizza."
   *
   * A translation file is for words the software says. This is a business
   * speaking about itself, and no other business can borrow it — not with the
   * name changed, not at all. There is nothing generic underneath it to fall
   * back to, which is why the fallback is nothing: no story, no section, and
   * no tab in the menu pointing at one.
   *
   * `body` is plain text; blank lines separate paragraphs. Structure beyond
   * that belongs to a restaurant that wants it, not to a schema.
   */
  aboutHeading: string;
  aboutBody: string;
  /**
   * Where it can be followed, from `Setting: social`.
   *
   * These were three hardcoded links to Ronny's Facebook, Instagram and TikTok,
   * shipped to every tenant under the words "Follow us" — the one item on this
   * list that actively delivered a restaurant's own customers to a competitor.
   */
  socials: SocialLink[];
}

export const NO_BRAND: Brand = {
  name: "",
  tagline: "",
  deliveryTime: "",
  rating: "",
  seoLine: "",
  seoDescription: "",
  aboutHeading: "",
  aboutBody: "",
  socials: [],
};

/** Read an unknown value (a Setting row plus the org name) into a Brand. */
export function toBrand(
  v: unknown,
  name: string,
  socials: SocialLink[] = [],
  lang: string = "en",
): Brand {
  const o = (v ?? {}) as Record<string, unknown>;
  /**
   * A field may be a plain string or the { en, ka } shape the rest of the
   * schema uses. A title in one language is worse than none in the other, and a
   * restaurant with two locales will want two titles.
   */
  const str = (k: string) => {
    const raw = o[k];
    if (typeof raw === "string") return raw.trim();
    if (raw && typeof raw === "object") {
      const m = raw as Record<string, string>;
      return String(m[lang] ?? m.en ?? "").trim();
    }
    return "";
  };

  return {
    name: name.trim(),
    tagline: str("tagline"),
    deliveryTime: str("deliveryTime"),
    rating: str("rating"),
    seoLine: str("seoLine"),
    seoDescription: str("seoDescription"),
    aboutHeading: str("aboutHeading"),
    aboutBody: str("aboutBody"),
    socials,
  };
}
