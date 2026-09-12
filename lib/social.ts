/**
 * Where a restaurant can be followed.
 *
 * ⚠️ This file used to hold the answer instead of the question:
 *
 *   { id: "facebook",  href: "https://www.facebook.com/ronnyspizza",  enabled: true }
 *   { id: "instagram", href: "https://www.instagram.com/ronnyspizza", enabled: true }
 *   { id: "tiktok",    href: "https://www.tiktok.com/@ronnyspizza",   enabled: true }
 *
 * Every tenant shipped those. A new restaurant's footer said "Follow us" above
 * three buttons that sent its customers to a different pizzeria's accounts —
 * and unlike a wrong menu, this one actively hands them to somebody else. The
 * file's own comment promised the source would move to the database in a later
 * phase "WITHOUT changing <Footer/>". The phase never came; the placeholder
 * shipped to production and stayed there.
 *
 * They come from `Setting: social` now. No row means no buttons, which is the
 * right thing to show for a restaurant that has not told us its accounts.
 */

export type SocialId = "facebook" | "instagram" | "tiktok" | "twitter" | "youtube";

export interface SocialLink {
  id: SocialId;
  label: string;
  href: string;
}

const LABELS: Record<SocialId, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  twitter: "X",
  youtube: "YouTube",
};

/** Display order. A restaurant listing them in a different order still gets this one. */
const ORDER: SocialId[] = ["facebook", "instagram", "tiktok", "twitter", "youtube"];

/**
 * Read `Setting: social` into links.
 *
 * Accepts the shape a person would reasonably store:
 *
 *   { "facebook": "https://facebook.com/theirpage", "instagram": "..." }
 *
 * Anything not a recognised network, and anything that is not an http(s) URL,
 * is dropped rather than rendered. A "follow us" button that goes nowhere is
 * worse than an absent one, and a `javascript:` href in a settings row is a
 * stored cross-site scripting hole waiting for an admin account to be careless.
 */
export function toSocialLinks(v: unknown): SocialLink[] {
  const o = (v ?? {}) as Record<string, unknown>;
  const out: SocialLink[] = [];

  for (const id of ORDER) {
    const raw = o[id];
    if (typeof raw !== "string") continue;

    const href = raw.trim();
    if (!href) continue;
    if (!/^https:\/\/|^http:\/\//i.test(href)) continue;

    out.push({ id, label: LABELS[id], href });
  }

  // Anything stored under an unknown key is ignored on purpose: the icon map
  // has no glyph for it, so the button would render blank.
  return out;
}
