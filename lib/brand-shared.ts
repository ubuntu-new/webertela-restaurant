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
  socials: [],
};

/** Read an unknown value (a Setting row plus the org name) into a Brand. */
export function toBrand(v: unknown, name: string, socials: SocialLink[] = []): Brand {
  const o = (v ?? {}) as Record<string, unknown>;
  const str = (k: string) => {
    const raw = o[k];
    return typeof raw === "string" ? raw.trim() : "";
  };
  return {
    name: name.trim(),
    tagline: str("tagline"),
    deliveryTime: str("deliveryTime"),
    rating: str("rating"),
    socials,
  };
}
