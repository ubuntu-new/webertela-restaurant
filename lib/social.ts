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
 * ── Two shapes, and the array is the real one ──
 *
 * ⚠️ The first version of this parser read only an object:
 *
 *   { "facebook": "https://facebook.com/theirpage", … }
 *
 * which is the shape somebody writing the row by hand would choose, and is not
 * the shape production actually holds. `app/admin/settings/actions.ts:95` reads
 * the row, requires `Array.isArray`, and maps over the existing entries:
 *
 *   const list = Array.isArray(current?.value) ? … : [];
 *   const next = list.map(item => ({ id, label, href, enabled }));
 *
 * So an object-shaped row makes `list` empty, `next` empty, and the next save
 * in the admin **deletes every social link** — silently, on a button that says
 * Save. Writing the object shape would have been a change to the data that
 * broke a page nobody would have thought to retest.
 *
 * The array is also the better shape: it carries `enabled`, so a restaurant can
 * hide a network without losing the address. It stays the canonical one, and
 * the object is accepted for a row typed in by hand.
 */
export function toSocialLinks(v: unknown): SocialLink[] {
  const ok = (href: unknown): href is string =>
    typeof href === "string" && /^https?:\/\//i.test(href.trim());

  // The shape the admin writes and production holds.
  if (Array.isArray(v)) {
    const out: SocialLink[] = [];
    for (const raw of v) {
      const item = (raw ?? {}) as Record<string, unknown>;
      const id = String(item.id ?? "");
      if (!(ORDER as string[]).includes(id)) continue;
      if (item.enabled === false) continue;
      if (!ok(item.href)) continue;

      out.push({
        id: id as SocialId,
        label: String(item.label ?? LABELS[id as SocialId]),
        href: (item.href as string).trim(),
      });
    }
    // Sorted into display order rather than trusting the stored order, which
    // the admin form does not control.
    return out.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  }

  // The shape a person would write by hand.
  const o = (v ?? {}) as Record<string, unknown>;
  const out: SocialLink[] = [];
  for (const id of ORDER) {
    if (!ok(o[id])) continue;
    out.push({ id, label: LABELS[id], href: (o[id] as string).trim() });
  }

  // Anything under an unknown key is ignored on purpose: the icon map has no
  // glyph for it, so the button would render blank. And a non-http href is
  // dropped rather than printed — a settings row is exactly where a
  // `javascript:` link would sit waiting for a careless admin account.
  return out;
}
