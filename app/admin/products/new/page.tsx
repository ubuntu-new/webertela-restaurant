import Link from "next/link";
import { db } from "@/lib/db";
import { i18nText } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";
import { fmt } from "@/lib/format";
import { createProduct } from "../actions";
import AdminForm from "@/app/admin/_components/AdminForm";
import NameField from "@/app/admin/_components/NameField";

export const dynamic = "force-dynamic";

export default async function NewProduct() {
  const t = await tr();
  const f = await fmt();
  const categories = await db.category.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: "asc" } });

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("New product")}</h1>
          <p>{t("You'll fill in the rest after you create it")}</p>
        </div>
        <Link className="btn btn-ghost" href="/admin/products">
          {t("Back to list")}
        </Link>
      </div>

      <AdminForm
        className="admin-panel admin-form"
        action={createProduct}
        submitLabel={t("Create and edit")}
        cancelHref="/admin/products"
      >
        <div className="field-row">
          <NameField
            model="product"
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

        <div className="field-row">
          <div className="field">
            <label htmlFor="categoryId">{t("Category")}</label>
            <select id="categoryId" name="categoryId" required>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {i18nText(c.name)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="type">{t("Type")}</label>
            <select id="type" name="type" defaultValue="item">
              <option value="pizza">{t("Pizza (3 sizes added for you)")}</option>
              <option value="item">{t("Regular")}</option>
              <option value="sticks">{t("Sticks / builder")}</option>
              <option value="drink">{t("Drink")}</option>
              <option value="merch">{t("Merch")}</option>
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="price">{t("Price")} ({f.symbol})</label>
          <input id="price" name="price" type="number" step="0.01" min="0" defaultValue="0" />
          <span className="hint">{t("Ignored for pizzas — size prices are set on the edit page.")}</span>
        </div>

        <div className="alert" style={{ background: "#fdf3d6", color: "#8a6a12" }}>
          <b>{t("A new product is created disabled.")}</b> {t("Turn it on from the edit page to show it on the menu.")}
        </div>

      </AdminForm>
    </>
  );
}
