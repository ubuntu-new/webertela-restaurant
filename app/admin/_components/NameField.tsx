"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { DupHit, DupModel } from "@/lib/action-state";
import { checkDuplicateName } from "./dup-actions";
import { useT } from "./AdminLang";

/**
 * The name box that answers before you finish typing.
 *
 * The guard on the server is what actually prevents a duplicate. This exists
 * because being told *after* pressing Create is a worse experience than being
 * told while typing: by then the person has filled in the unit, the group, the
 * SKU and the note, and the warning feels like the software wasted their time.
 *
 * Half a second after the typing stops, it asks what already matches. If
 * something does, it says so quietly under the field, with a link — no modal,
 * no blocked button. Most of the time the right outcome is the person reading
 * "Mozzarella · 4.2 kg on hand", saying "ah", and clicking through instead of
 * creating anything at all.
 *
 * Failure here is silent by design. A lookup that errors must never stop
 * someone from filling in a form; the server-side guard still runs on submit.
 */
export default function NameField({
  model,
  name,
  id,
  label,
  defaultValue,
  excludeId,
  required,
  autoFocus,
  placeholder,
  contextFields,
}: {
  model: DupModel;
  /** Form field name — "name_en" almost everywhere, "name" for a person. */
  name: string;
  id?: string;
  label: string;
  defaultValue?: string;
  /** When editing, the record being edited is not its own duplicate. */
  excludeId?: string;
  required?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  /**
   * Other fields on the same form whose values change the answer — the barcode
   * above all. Without it the check can only compare names, and "Coca-Cola
   * 330 ml" against "Coca-Cola 1.5 L" comes back as a warning about two things
   * that are not the same product at all.
   */
  contextFields?: { barcode?: string; packSize?: string; packUnit?: string; supplierId?: string; supplierCode?: string };
}) {
  const t = useT();
  const [value, setValue] = useState(defaultValue ?? "");
  const [hits, setHits] = useState<DupHit[]>([]);
  const [pending, startTransition] = useTransition();
  const seq = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);

  /**
   * Read the sibling fields straight out of the DOM at the moment of the check.
   *
   * Lifting them into React state would mean turning every form on the site
   * into a controlled one for the sake of a hint. The form element is right
   * there and it already holds the current values.
   */
  function readContext() {
    if (!contextFields || !boxRef.current) return undefined;
    const form = boxRef.current.closest("form");
    if (!form) return undefined;

    const read = (fieldName?: string) => {
      if (!fieldName) return undefined;
      const el = form.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${CSS.escape(fieldName)}"]`);
      const v = el?.value?.trim();
      return v || undefined;
    };

    const packSize = read(contextFields.packSize);
    return {
      barcode: read(contextFields.barcode),
      packSize: packSize ? Number(packSize.replace(",", ".")) : undefined,
      packUnit: read(contextFields.packUnit) as never,
      supplierId: read(contextFields.supplierId),
      supplierCode: read(contextFields.supplierCode),
    };
  }

  useEffect(() => {
    const typed = value.trim();

    // Unchanged from what is already saved: nothing to warn about.
    if (typed.length < 3 || typed === (defaultValue ?? "").trim()) {
      setHits([]);
      return;
    }

    const mine = ++seq.current;
    const timer = setTimeout(() => {
      startTransition(async () => {
        try {
          const found = await checkDuplicateName(model, typed, excludeId, readContext());
          // A slow answer to an old keystroke must not overwrite a fresh one.
          if (mine === seq.current) setHits(found);
        } catch {
          if (mine === seq.current) setHits([]);
        }
      });
    }, 450);

    return () => clearTimeout(timer);
  }, [value, model, excludeId, defaultValue]);

  const exact = hits.some((h) => h.exact);

  return (
    <div className="field" ref={boxRef}>
      <label htmlFor={id ?? name}>{label}</label>
      <input
        id={id ?? name}
        name={name}
        type="text"
        defaultValue={defaultValue}
        required={required}
        autoFocus={autoFocus}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => setValue(e.target.value)}
      />

      {hits.length > 0 && (
        <div className="dup-live">
          <b>{exact ? t("You already have this") : t("Very close to something you have")}</b>
          {hits.map((h) => (
            <div key={h.id} style={{ marginTop: 4 }}>
              <Link href={h.href}>{h.name}</Link>
              {h.usage.length > 0 && <span> · {h.usage.join(" · ")}</span>}
            </div>
          ))}
          <div style={{ marginTop: 6 }}>
            {exact
              ? t("Open that one instead, or change this name if it is genuinely something else.")
              : t("Worth a look before you create a second one.")}
          </div>
        </div>
      )}

      {pending && hits.length === 0 && value.trim().length >= 3 && (
        <div className="dup-live checking">{t("Checking…")}</div>
      )}
    </div>
  );
}
