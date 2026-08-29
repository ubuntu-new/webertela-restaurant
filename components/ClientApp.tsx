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
  org,
}: {
  lang: Lang;
  menu?: MenuPayload | null;
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
