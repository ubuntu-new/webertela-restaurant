import Link from "next/link";
import { requirePermission } from "@/lib/admin-auth";
import ImportForm from "./ImportForm";

export const dynamic = "force-dynamic";

/**
 * The page that turns ninety form submissions into one paste.
 *
 * Entering a normal menu by hand — a dozen pizzas, twenty toppings, sides and
 * drinks — costs about ninety submissions today, because every product is a
 * create followed by an edit and there is no grid, no clone and no import. It
 * is the single largest cost in getting a new restaurant running, and it falls
 * on the owner in their first week.
 */
export default async function ImportPage() {
  // The permission is checked here as well as in the actions. A page is not a
  // gate — but a gate the reader can see is worth having, and the actions are
  // reachable without ever loading this page.
  await requirePermission("can_edit_menu");

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link className="back" href="/admin/products">
            ← Menu
          </Link>
          <h1>Import a menu</h1>
        </div>
      </div>

      <p className="hint" style={{ maxWidth: "62ch", lineHeight: 1.65, marginBottom: 20 }}>
        Your menu already exists somewhere. Paste it rather than retyping it — you will be shown
        exactly what was read, line by line, before anything is saved. Nothing already on the menu
        is changed.
      </p>

      <ImportForm />
    </div>
  );
}
