import Link from "next/link";
import { tr } from "@/lib/admin-i18n";
import { STARTER_PACKS } from "@/lib/starter-packs";
import { planPack } from "@/lib/starter-pack-apply";
import AdminForm from "../../_components/AdminForm";
import { applyStarterPack, undoStarterPack } from "./actions";

export const dynamic = "force-dynamic";

/**
 * The first screen of an empty restaurant.
 *
 * It asks one question a restaurant owner can answer without learning anything:
 * what kind of place is this. Everything after that is recognition rather than
 * instruction — he reads a list of things he already keeps on his shelves and
 * decides whether it is his kitchen.
 *
 * The whole list is shown before the button, not summarised. Forty rows arriving
 * at once is the thing that makes people hesitate, and the cure is not a
 * reassuring sentence, it is seeing the forty rows.
 */
export default async function StarterPacksPage({
  searchParams,
}: {
  searchParams: Promise<{ pack?: string; added?: string; toppings?: string; rules?: string; undone?: string }>;
}) {
  const sp = await searchParams;
  const t = await tr();

  const chosen = sp.pack ?? null;
  const plan = chosen ? await planPack(chosen) : null;

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("Start from a kind of place")}</h1>
          <p>
            {t(
              "The ingredients, units and portions that every kitchen of this kind already has. Your menu and your prices stay yours — this is only the boring half.",
            )}
          </p>
        </div>
        <Link className="btn btn-ghost" href="/admin/stock/items">
          {t("Stock items")}
        </Link>
      </div>

      {sp.added && (
        <div className="alert alert-ok">
          {t("Added")} {sp.added} {t("ingredients")}, {sp.toppings} {t("toppings")} {t("and")} {sp.rules}{" "}
          {t("portions. Nothing that was already there was touched.")}
        </div>
      )}
      {sp.undone && <div className="alert alert-ok">{t("Taken back out. Everything is as it was.")}</div>}

      {/* ── the choice ── */}
      <div className="grid-packs">
        {STARTER_PACKS.map((p) => (
          <Link
            key={p.id}
            href={`/admin/setup/starter?pack=${p.id}`}
            className={`pack-card${chosen === p.id ? " pack-card-on" : ""}`}
          >
            <div className="pack-emoji">{p.emoji}</div>
            <b>{p.name}</b>
            <p>{p.description}</p>
            <span className="hint">
              {p.items.length} {t("ingredients")} · {p.toppings.length} {t("toppings")}
            </span>
          </Link>
        ))}
      </div>

      <p className="hint" style={{ marginTop: 14 }}>
        {t(
          "Mixed place? Apply more than one. Anything they share — paper bags, cheese — is only ever created once.",
        )}
      </p>

      {/* ── what it would actually do ── */}
      {plan && (
        <div className="admin-panel" style={{ marginTop: 22, borderLeft: "3px solid var(--a-orange)" }}>
          <h2>
            {plan.pack.emoji} {plan.pack.name}
          </h2>

          {plan.appliedAt && (
            <div className="alert alert-ok" style={{ marginTop: 8 }}>
              {t("Already applied on")} {plan.appliedAt.toISOString().slice(0, 10)}.{" "}
              {plan.canUndo
                ? t("Nothing has used it yet, so it can still be taken back out.")
                : `${t("It can no longer be taken back —")} ${plan.undoBlockedBy}.`}
            </div>
          )}

          {plan.newItems + plan.newToppings > 0 ? (
            <p style={{ fontSize: 14.5 }}>
              <b>
                {plan.newItems} {t("ingredients")}
              </b>
              {" · "}
              <b>
                {plan.newToppings} {t("toppings")}
              </b>
              {" · "}
              <b>
                {plan.rules} {t("portions")}
              </b>
              <span className="hint"> {t("would be added")}</span>
              {plan.preExistingItems + plan.preExistingToppings > 0 && (
                <span className="hint">
                  {" · "}
                  {plan.preExistingItems + plan.preExistingToppings} {t("you already had, left alone")}
                </span>
              )}
            </p>
          ) : (
            <p style={{ fontSize: 14.5 }}>
              {/* After applying, saying "you already have this" about a row this
                  pack created ten seconds ago is true and useless. The two are
                  counted separately so the sentence says what the button did. */}
              {plan.addedItems + plan.addedToppings > 0 && (
                <>
                  <b>
                    {plan.addedItems} {t("ingredients")} {t("and")} {plan.addedToppings} {t("toppings")}
                  </b>{" "}
                  {t("came from this pack")}
                  {plan.preExistingItems + plan.preExistingToppings > 0 && ". "}
                </>
              )}
              {plan.preExistingItems + plan.preExistingToppings > 0 && (
                <span className="hint">
                  {plan.preExistingItems + plan.preExistingToppings}{" "}
                  {t("were already yours before you used it.")}
                </span>
              )}
            </p>
          )}

          <div className="grid-2" style={{ alignItems: "start" }}>
            <div>
              <h3>{t("Ingredients")}</h3>
              <ul className="pack-list">
                {plan.items.map((i) => (
                  <li key={i.name} className={i.exists ? "pack-have" : undefined}>
                    <b>{i.name}</b>
                    <span> · {i.detail}</span>
                    {i.fromPack ? (
                      <em className="pack-added"> — {t("added by this pack")}</em>
                    ) : (
                      i.exists && <em> — {t("you already had this")}</em>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3>{t("Toppings")}</h3>
              <ul className="pack-list">
                {plan.toppings.map((tp) => (
                  <li key={tp.name} className={tp.exists ? "pack-have" : undefined}>
                    <b>{tp.name}</b>
                    <span> · {tp.detail}</span>
                    {tp.fromPack ? (
                      <em className="pack-added"> — {t("added by this pack")}</em>
                    ) : (
                      tp.exists && <em> — {t("you already had this")}</em>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="merge-note">
            <b>{t("What it deliberately does not do")}</b>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.7 }}>
              <li>
                {t(
                  "No products, no prices, no menu. Your pizzas are yours — a template guessing at them would be worse than an empty list.",
                )}
              </li>
              <li>
                {t(
                  "No minimums or targets. A minimum is a promise about days, and on day one there is nothing being used to measure it against. They come later, from your own trading.",
                )}
              </li>
              <li>
                {t(
                  "Topping prices start at zero. What you charge for extra cheese is a decision, not a default.",
                )}
              </li>
              <li>
                {t(
                  "The portions are a real pizzeria's — a 16-inch pie takes 420 g of mozzarella. Check them against your own once; they are the number food cost is built on.",
                )}
              </li>
            </ul>
          </div>

          {plan.newItems === 0 && plan.newToppings === 0 ? (
            <p style={{ margin: "14px 0 0", fontSize: 14.5 }}>
              <b>{t("There is nothing left to add.")}</b>{" "}
              {t("Everything in this pack is now in your kitchen.")}
            </p>
          ) : (
            <AdminForm
              className="admin-form"
              action={applyStarterPack}
              submitLabel={`${t("Add these")} ${plan.newItems + plan.newToppings} ${t("rows")}`}
              pendingLabel={t("Adding…")}
            >
              <input type="hidden" name="packId" value={plan.pack.id} />
              <div className="field" style={{ maxWidth: 280 }}>
                <label htmlFor="iUnderstand">{t("Type ADD to confirm")}</label>
                <input id="iUnderstand" name="iUnderstand" type="text" autoComplete="off" placeholder="ADD" />
                <span className="hint">
                  {t("All of it can be taken back out until you start using it.")}
                </span>
              </div>
            </AdminForm>
          )}

          {plan.appliedAt && plan.canUndo && (
            <AdminForm
              className="admin-form"
              style={{ marginTop: 8 }}
              action={undoStarterPack}
              submitLabel={t("Take this pack back out")}
              pendingLabel={t("Removing…")}
            >
              <input type="hidden" name="packId" value={plan.pack.id} />
              <p className="hint" style={{ margin: 0 }}>
                {t(
                  "Removes only what this pack created and only while nothing has used it. Anything you have edited, counted or put on a product stays.",
                )}
              </p>
            </AdminForm>
          )}
        </div>
      )}

      {!plan && (
        <div className="admin-panel" style={{ marginTop: 22 }}>
          <h2>{t("Why this exists")}</h2>
          <p style={{ fontSize: 14.5 }}>
            {t(
              "Setting up a restaurant means typing forty ingredients, their units, and the portion of each topping — two days of work before the software has told you one true thing about your business. Almost none of it is specific to you: two pizzerias hold the same flour and put the same weight of cheese on a 16-inch pie.",
            )}
          </p>
          <p style={{ fontSize: 14.5, margin: 0 }}>
            {t("The part that is yours — the menu, the prices, the names on the board — is the part worth typing.")}
          </p>
        </div>
      )}
    </>
  );
}
