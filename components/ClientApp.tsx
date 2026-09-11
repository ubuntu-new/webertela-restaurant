"use client";
import { useState } from "react";
import { LangProvider } from "@/lib/i18n";
import { CartProvider } from "@/lib/cart";
import { applyMenu, type Lang, type MenuPayload } from "@/lib/data";
import type { OrgFormat } from "@/lib/format-shared";
import AppViewport from "@/components/AppViewport";
import Header from "@/components/Header";
import TrustBar from "@/components/TrustBar";
import CatNav from "@/components/CatNav";
import MenuBody from "@/components/MenuBody";
import Footer from "@/components/Footer";
import Customizer from "@/components/Customizer";
import HalfHalf from "@/components/HalfHalf";
import StickBuilder from "@/components/StickBuilder";
import ComboBuilder from "@/components/ComboBuilder";
import CartDrawer from "@/components/CartDrawer";
import Checkout from "@/components/Checkout";
import Toast from "@/components/Toast";

export default function ClientApp({
  lang,
  menu,
  menuFailed,
  org,
}: {
  lang: Lang;
  menu?: MenuPayload | null;
  /**
   * The database could not be read — as opposed to it being read and having
   * nothing in it. The two look identical on screen unless something says so,
   * and they need opposite responses: one is "call us", the other is "this
   * restaurant has not finished setting up".
   */
  menuFailed?: boolean;
  /** The restaurant's currency and date format, read on the server. */
  org?: OrgFormat;
}) {
  // ბრაუზერშიც უნდა შეივსოს — და შვილების რენდერამდე, სინქრონულად.
  // useState-ის initializer ზუსტად ერთხელ გაეშვება, პირველი რენდერის დროს.
  useState(() => {
    applyMenu(menu);
    return null;
  });

  return (
    <LangProvider initialLang={lang} org={org}>
      <CartProvider>
        <AppViewport>
          <Header />
          {menuFailed && (
            /*
              Said once, at the top, and not dressed up as a menu.
              A customer who reads this can still do the one thing that works —
              pick up the phone — which is more than a silently stale page
              offers them.
            */
            <div
              role="alert"
              style={{
                background: '#7a2d1e',
                color: '#fff',
                padding: '12px 16px',
                fontSize: 14.5,
                lineHeight: 1.5,
                textAlign: 'center',
              }}
            >
              We cannot load the menu right now. Nothing is wrong with your order —
              please call us and we will take it over the phone.
            </div>
          )}
          <TrustBar />
          <CatNav />
          <MenuBody />
          <Footer />
          <Customizer />
          <HalfHalf />
          <StickBuilder />
          <ComboBuilder />
          <CartDrawer />
          <Checkout />
          <Toast />
        </AppViewport>
      </CartProvider>
    </LangProvider>
  );
}
