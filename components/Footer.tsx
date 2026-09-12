"use client";

import { useLang } from "@/lib/i18n";
import { SOCIAL_LINKS, type SocialId } from "@/lib/social";

// Brand glyphs (inline so no icon dependency). Keyed by social id.
const ICONS: Record<SocialId, React.ReactNode> = {
  facebook: <path d="M14 9h3V6h-3c-2.2 0-3.5 1.3-3.5 3.5V12H8v3h2.5v7h3v-7H16l.5-3h-3v-2c0-.7.3-1 1-1z" />,
  instagram: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.3" cy="6.7" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  tiktok: <path d="M15 3c.3 2 1.6 3.6 3.8 3.9v2.8c-1.4.1-2.7-.3-3.8-1v5.6a5.3 5.3 0 1 1-5.3-5.3c.3 0 .6 0 .9.1v2.9a2.5 2.5 0 1 0 1.7 2.3V3H15z" />,
  twitter: <path d="M4 4l6.5 8.7L4.3 20H6l5.3-5.8L15.7 20H20l-6.8-9.1L19.6 4H18l-4.9 5.4L9.1 4H4z" />,
  youtube: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="3" />
      <path d="M11 9.5l4 2.5-4 2.5z" fill="currentColor" stroke="none" />
    </>
  ),
};

export default function Footer() {
  const { t, brand } = useLang();
  const year = new Date().getFullYear();
  const socials = SOCIAL_LINKS.filter((s) => s.enabled && s.href);

  const quick: { key: string; target: string }[] = [
    { key: "nav_combos", target: "section-combos" },
    { key: "nav_pizza", target: "section-pizza" },
    { key: "nav_extras", target: "section-extras" },
    { key: "nav_about", target: "section-about" },
  ];

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <div className="footer-logo">{brand.name || t("menu")}</div>
          {brand.tagline && <p className="footer-motto">{brand.tagline}</p>}
          {socials.length > 0 && (
            <div className="footer-social" aria-label={t("footer_follow")}>
              {socials.map((s) => (
                <a
                  key={s.id}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="social-btn"
                  aria-label={s.label}
                  title={s.label}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    {ICONS[s.id]}
                  </svg>
                </a>
              ))}
            </div>
          )}
        </div>

        <nav className="footer-links" aria-label="Footer">
          <span className="footer-col-title">{t("footer_menu")}</span>
          {quick.map((q) => (
            <button key={q.target} className="footer-link" onClick={() => scrollTo(q.target)}>
              {t(q.key)}
            </button>
          ))}
        </nav>
      </div>

      <div className="footer-bottom">
        {/*
          ⚠️ A copyright line naming the wrong company is not a cosmetic bug.
          It is a public assertion about who owns the business, printed at the
          bottom of every page, and it said "Ronny's Pizza" on every tenant.
          When there is no name yet, the year alone is true and sufficient.
        */}
        <span>
          © {year}
          {brand.name ? ` ${brand.name}.` : "."} {t("footer_rights")}
        </span>
      </div>
    </footer>
  );
}
