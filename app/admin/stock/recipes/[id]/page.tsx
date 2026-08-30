import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { i18nOf, i18nText } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";
import { fmtQty } from "@/lib/stock";
import { updateRecipe, archiveRecipe } from "../actions";
import ArchiveButton from "../../../_components/ArchiveButton";
import AdminForm from "@/app/admin/_components/AdminForm";
import NameField from "@/app/admin/_components/NameField";

export const dynamic = "force-dynamic";

const inp: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid var(--a-line)",
  borderRadius: 6,
  font: "inherit",
};

export default async function RecipeEdit({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const t = await tr();

  const [recipe, items] = await Promise.all([
    db.recipe.findUnique({
      where: { id },
      include: {
        outputItem: true,
        lines: { include: { item: true } },
        _count: { select: { orders: true } },
      },
    }),
    db.stockItem.findMany({ where: { deletedAt: null, active: true }, orderBy: { category: "asc" } }),
  ]);
  if (!recipe) notFound();

  const name = i18nOf(recipe.name);
  const used = new Set(recipe.lines.map((l) => l.itemId));

  const save = updateRecipe.bind(null, id);
  const archive = archiveRecipe.bind(null, id);

  const consequences = [
    t("You won't be able to pick it when starting a new batch."),
    `${recipe._count.orders} ${t("finished batches stay untouched — each one keeps its own copy of the inputs.")}`,
    t("Stock does not change."),
  ];

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{name.ka || name.en}</h1>
          <p>
            {fmtQty(Number(recipe.outputQty), recipe.outputItem.unit)}{" "}
            {i18nText(recipe.outputItem.name)} · {recipe._count.orders} {t("batches")}
          </p>
        </div>
        <Link className="btn btn-ghost" href="/admin/stock/recipes">
          {t("Back to list")}
        </Link>
      </div>

      {sp.saved && <div className="alert alert-ok">{t("Saved.")}</div>}

      <AdminForm
        className="admin-form"
        style={{ maxWidth: 900 }}
        action={save}
        submitLabel={t("Save")}
        cancelHref="/admin/stock/recipes"
      >
        <div className="admin-panel">
          <h2>{t("Basics")}</h2>
          <div className="field-row">
            <NameField
              model="recipe"
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
              <label htmlFor="outputItemId">{t("Produces")}</label>
              <select id="outputItemId" name="outputItemId" defaultValue={recipe.outputItemId}>
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {i18nText(it.name)} ({it.unit})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="outputQty">{t("Yield per run")}</label>
              <input
                id="outputQty"
                name="outputQty"
                type="number"
                step="0.001"
                min="0"
                defaultValue={Number(recipe.outputQty)}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="note">{t("Note")}</label>
            <input id="note" name="note" type="text" defaultValue={recipe.note ?? ""} />
          </div>

          <div className="field-check">
            <input id="active" name="active" type="checkbox" defaultChecked={recipe.active} />
            <label htmlFor="active">{t("Active")}</label>
          </div>
        </div>

        <div className="admin-panel">
          <h2>{t("Raw material inputs")}</h2>
          <p className="hint" style={{ marginTop: -8, marginBottom: 14 }}>
            {t("Quantity is")} <b>{t("per one run")}</b>.{" "}
            {t("In a batch it's multiplied by the number of runs.")}
          </p>

          {recipe.lines.length > 0 && (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("Item")}</th>
                  <th style={{ width: 160 }}>{t("Quantity")}</th>
                  <th style={{ width: 70 }}>{t("Delete")}</th>
                </tr>
              </thead>
              <tbody>
                {recipe.lines.map((l) => (
                  <tr key={l.id}>
                    <td>{i18nText(l.item.name)}</td>
                    <td>
                      <input
                        name={`qty_${l.id}`}
                        type="number"
                        step="0.001"
                        min="0"
                        defaultValue={Number(l.qty)}
                        style={inp}
                      />
                      <span className="hint">{l.item.unit}</span>
                    </td>
                    <td>
                      <input type="checkbox" name={`del_${l.id}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="field" style={{ marginTop: 14 }}>
            <label>{t("Add an input")}</label>
            <div className="field-row">
              <select name="new_itemId" defaultValue="">
                <option value="">{t("— select —")}</option>
                {items
                  .filter((it) => !used.has(it.id) && it.id !== recipe.outputItemId)
                  .map((it) => (
                    <option key={it.id} value={it.id}>
                      {i18nText(it.name)} ({it.unit})
                    </option>
                  ))}
              </select>
              <input name="new_qty" type="number" step="0.001" min="0" placeholder={t("Quantity")} />
            </div>
          </div>
        </div>

      </AdminForm>

      <div className="admin-panel" style={{ maxWidth: 900, marginTop: 20 }}>
        <h2>{t("Archive")}</h2>
        <ArchiveButton action={archive} subject={name.ka || name.en} consequences={consequences} />
      </div>
    </>
  );
}
