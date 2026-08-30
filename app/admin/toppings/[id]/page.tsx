import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { i18nOf, money } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";
import { fmt } from "@/lib/format";
import { updateTopping, archiveTopping } from "../actions";
import ImageField from "../../_components/ImageField";
import ArchiveButton from "../../_components/ArchiveButton";
import AdminForm from "@/app/admin/_components/AdminForm";
import NameField from "@/app/admin/_components/NameField";

export const dynamic = "force-dynamic";

const GROUPS = ["cheese", "protein", "veg", "heat"];

export default async function ToppingEdit({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await tr();
  const f = await fmt();

  const top = await db.topping.findUnique({
    where: { id },
    include: {
      prices: { orderBy: { sizeKey: "asc" } },
      products: { include: { product: true } },
    },
  });
  if (!top) notFound();

  const name = i18nOf(top.name);
  const save = updateTopping.bind(null, id);
  const archive = archiveTopping.bind(null, id);

  const usedIn = top.products.map((x) => i18nOf(x.product.name).ka || i18nOf(x.product.name).en);
  const consequences = [
    t("It disappears from the toppings list and from the builder — nobody can add it to a pizza."),
    usedIn.length > 0
      ? `${usedIn.length} ${t("products have it in their recipe")} (${usedIn.join(", ")}) — ${t("the link stays, but the ingredient stops showing.")}`
      : t("No product has it in its recipe."),
    t("Past orders that included this topping stay exactly as they are."),
  ];

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{name.ka || name.en}</h1>
          <p>{t("Topping")}</p>
        </div>
        <Link className="btn btn-ghost" href="/admin/toppings">
          {t("Back to list")}
        </Link>
      </div>

      <AdminForm
        className="admin-form"
        style={{ maxWidth: 820 }}
        action={save}
        submitLabel={t("Save")}
        cancelHref="/admin/toppings"
      >
        <div className="admin-panel">
          <h2>{t("Basics")}</h2>

          <div className="field-row">
            <NameField
              model="topping"
              name="name_en"
              label={`${t("Name")} (EN)`}
              defaultValue={name.en}
              excludeId={id}
              required
            />
            <div className="field">
              <label htmlFor="name_ka">{t("Name")} (KA)</label>
              <input id="name_ka" name="name_ka" type="text" defaultValue={name.ka} />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="category">{t("Group")}</label>
              <select id="category" name="category" defaultValue={top.category ?? ""}>
                <option value="">—</option>
                {GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sortOrder">{t("Order")}</label>
              <input id="sortOrder" name="sortOrder" type="number" defaultValue={top.sortOrder} />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="emoji">{t("Emoji")}</label>
              <input id="emoji" name="emoji" type="text" defaultValue={top.emoji ?? ""} placeholder="🧀" />
            </div>
            <div className="field">
              <label htmlFor="dots">{t("Dots (comma separated)")}</label>
              <input id="dots" name="dots" type="text" defaultValue={top.dots.join(", ")} placeholder="cheese, veg" />
            </div>
          </div>
        </div>

        <div className="admin-panel">
          <h2>{t("Photo")}</h2>
          <ImageField name="photo" defaultValue={top.photo} />
        </div>

        <div className="admin-panel">
          <h2>{t("Prices by size")} ({f.symbol})</h2>
          <div className="field-row" style={{ gridTemplateColumns: `repeat(${top.prices.length || 1}, 1fr)` }}>
            {top.prices.map((p) => (
              <div className="field" key={p.id}>
                <label htmlFor={`price_${p.sizeKey}`}>{p.sizeKey}</label>
                <input
                  id={`price_${p.sizeKey}`}
                  name={`price_${p.sizeKey}`}
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={money(p.price)}
                />
              </div>
            ))}
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label>{t("New size price")}</label>
            <div className="field-row">
              <input name="newsize_key" type="text" placeholder={t("Size (e.g. XXL)")} />
              <input name="newsize_price" type="number" step="0.01" min="0" placeholder={t("Price")} />
            </div>
          </div>
          <span className="hint">{t("0 = free add-on (spices, for example).")}</span>
        </div>

        <div className="admin-panel">
          <h2>{t("Status")}</h2>
          <div className="field-check">
            <input id="active" name="active" type="checkbox" defaultChecked={top.active} />
            <label htmlFor="active">{t("Enabled")}</label>
          </div>
          <div className="field-check">
            <input id="recipeOnly" name="recipeOnly" type="checkbox" defaultChecked={top.recipeOnly} />
            <label htmlFor="recipeOnly">{t("Recipe only (not sold as an add-on)")}</label>
          </div>
          <div className="field-check">
            <input id="popular" name="popular" type="checkbox" defaultChecked={top.popular} />
            <label htmlFor="popular">{t("Popular (shows near the top of the builder)")}</label>
          </div>

          {top.products.length > 0 && (
            <div className="field" style={{ marginTop: 12 }}>
              <label>{t("Used in products")}</label>
              <span className="hint">{top.products.map((p) => i18nOf(p.product.name).ka).join(", ")}</span>
            </div>
          )}
        </div>

      </AdminForm>

      <div className="admin-panel" style={{ maxWidth: 820, marginTop: 20 }}>
        <h2>{t("Archive")}</h2>
        <p className="hint" style={{ marginBottom: 12 }}>
          <b>{t("To hide it for a while, better to just turn it off.")}</b>{" "}
          {t("The archive is for toppings you no longer use.")}
        </p>
        <ArchiveButton action={archive} subject={name.ka || name.en} consequences={consequences} />
      </div>
    </>
  );
}
