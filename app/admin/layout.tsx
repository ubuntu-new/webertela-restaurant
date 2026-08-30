import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { getSession } from "@/lib/admin-auth";
import { tr, getAdminLang } from "@/lib/admin-i18n";
import { logout } from "./actions";
import AdminSearch from "./_components/AdminSearch";
import { AdminLangProvider } from "./_components/AdminLang";
import AlertBell from "./_components/AlertBell";
import "./admin.css";

export const metadata: Metadata = {
  title: "Ronny's — Admin",
  robots: { index: false, follow: false },
};

/** English is the source language; the dictionary maps to Georgian. */
const NAV: { href: string; label: string }[] = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/customers", label: "Customers" },
  { href: "/admin/kds", label: "Kitchen" },
  { href: "/admin/products", label: "Products" },
  { href: "/admin/toppings", label: "Toppings" },
  { href: "/admin/combos", label: "Combos" },
  { href: "/admin/availability", label: "Availability" },
  { href: "/admin/categories", label: "Categories" },
  { href: "/admin/stock", label: "Stock" },
  { href: "/admin/stock/transfers", label: "Transfers" },
  { href: "/admin/stock/production", label: "Production" },
  { href: "/admin/stock/costing", label: "Costing" },
  { href: "/admin/stock/consumption", label: "Consumption rules" },
  { href: "/admin/suppliers", label: "Suppliers" },
  { href: "/admin/shifts", label: "Shifts" },
  { href: "/admin/setup/starter", label: "Starter packs" },
  { href: "/admin/branches", label: "Branches" },
  { href: "/admin/employees", label: "Staff" },
  { href: "/admin/discounts", label: "Discounts" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/audit", label: "Activity log" },
  { href: "/admin/archive", label: "Archive" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const lang = await getAdminLang();

  if (!session) {
    // The login screen renders here — it needs the language too.
    return (
      <html lang="en">
        <body className="admin-body">
          <AdminLangProvider lang={lang}>{children}</AdminLangProvider>
        </body>
      </html>
    );
  }

  const t = await tr();

  return (
    <html lang="en">
      <body className="admin-body">
        <AdminLangProvider lang={lang}>
        <div className="admin-shell">
          <aside className="admin-side">
            <div className="admin-brand">
              Ronny&apos;s <span>Admin</span>
              <AlertBell />
            </div>
            <nav className="admin-nav">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href}>
                  {t(n.label)}
                </Link>
              ))}
            </nav>
            <div className="admin-side-foot">
              {session.name}
              <br />
              <small>{session.role}</small>
              <form action={logout}>
                <button type="submit">{t("Sign out")}</button>
              </form>
            </div>
          </aside>
          <main className="admin-main">
            <Suspense fallback={null}>
              <AdminSearch />
            </Suspense>
            {children}
          </main>
        </div>
        </AdminLangProvider>
      </body>
    </html>
  );
}
