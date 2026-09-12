"use client";

import { useState } from "react";
import { useLang } from "@/lib/i18n";

const TABS: { key: string; target: string }[] = [
  { key: "nav_combos", target: "section-combos" },
  { key: "nav_pizza", target: "section-pizza" },
  { key: "nav_extras", target: "section-extras" },
  { key: "nav_drinks", target: "section-drinks" },
  { key: "nav_about", target: "section-about" },
];

export default function CatNav() {
  const { t, brand } = useLang();
  const [active, setActive] = useState("section-pizza");

  /**
   * The About tab only when there is an About page.
   *
   * MenuBody renders nothing there for a restaurant with no story and no
   * branches, so the tab was a link that scrolled to an anchor which did not
   * exist — a control that appears to do nothing, which reads as broken
   * software rather than as an empty page.
   */
  const tabs = TABS.filter(
    (tab) => tab.target !== "section-about" || Boolean(brand.aboutBody),
  );

  const go = (target: string) => {
    setActive(target);
    document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav className="cat-nav">
      {tabs.map((tab) => (
        <button
          key={tab.target}
          className={`cat-tab${active === tab.target ? " active" : ""}`}
          onClick={() => go(tab.target)}
        >
          <span>{t(tab.key)}</span>
        </button>
      ))}
    </nav>
  );
}
