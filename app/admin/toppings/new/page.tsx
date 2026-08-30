import Link from "next/link";
import { tr } from "@/lib/admin-i18n";
import { fmt } from "@/lib/format";
import { createTopping } from "../actions";
import AdminForm from "@/app/admin/_components/AdminForm";
import NameField from "@/app/admin/_components/NameField";

export const dynamic = "force-dynamic";

export default async function NewTopping() {
  const t = await tr();
  const f = await fmt();

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("New topping")}</h1>
          <p>{t("You'll add the photo after you create it")}</p>
        </div>
        <Link className="btn btn-ghost" href="/admin/toppings">
          {t("Back to list")}
        </Link>
      </div>

      <AdminForm
        className="admin-panel admin-form"
        action={createTopping}
        submitLabel={t("Create")}
        cancelHref="/admin/toppings"
      >
        <div className="field-row">
          <NameField
            model="topping"
            name="name_en"
            label={`${t("Name")} (EN)`}
            required
            autoFocus
          />
          <div className="field">
            <label htmlFor="name_ka">{t("Name")} (KA)</label>
            <input id="name_ka" name="name_ka" type="text" />
          </div>
        </div>

        <div className="field">
          <label htmlFor="category">{t("Group")}</label>
          <select id="category" name="category" defaultValue="veg">
            <option value="cheese">cheese</option>
            <option value="protein">protein</option>
            <option value="veg">veg</option>
            <option value="heat">heat</option>
          </select>
        </div>

        <div className="field">
          <label>{t("Prices by size")} ({f.symbol})</label>
          <div className="field-row" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
            <input name="price_S" type="number" step="0.01" min="0" placeholder="S" defaultValue="0" />
            <input name="price_M" type="number" step="0.01" min="0" placeholder="M" defaultValue="0" />
            <input name="price_XL" type="number" step="0.01" min="0" placeholder="XL" defaultValue="0" />
          </div>
        </div>

        <div className="field-check">
          <input id="recipeOnly" name="recipeOnly" type="checkbox" />
          <label htmlFor="recipeOnly">{t("recipe only")}</label>
        </div>

      </AdminForm>
    </>
  );
}
