"use client";

import { useActionState, useRef } from "react";
import Link from "next/link";
import { CONFIRM_FIELD, type ActionState } from "@/lib/action-state";
import { useT } from "./AdminLang";

/**
 * Every admin form that writes something goes through here.
 *
 * Three things it fixes, all of them the same underlying problem — the software
 * knew what was wrong and the person never found out:
 *
 *  1. **Errors are shown.** A thrown validation message used to reach a crash
 *     page, or in production nothing at all. Now it appears above the fields,
 *     and the values the user typed are still in them.
 *
 *  2. **Duplicates are a question, not a refusal.** When something with this
 *     name already exists, the form stops and shows what exists, with what it
 *     is used for and a link to open it. The user can rename, go to the
 *     existing one, or say this really is a different thing. Refusing outright
 *     would be wrong — "Egg" and "Eggs" are sometimes two real items — and
 *     saving silently is how a business ends up with its mozzarella in two
 *     halves.
 *
 *  3. **Double submits are stopped.** The button disables while the action is
 *     in flight. An impatient second click used to create a second record.
 *
 * The page stays a server component: this takes the fields as children.
 */
export default function AdminForm({
  action,
  children,
  submitLabel,
  pendingLabel,
  cancelHref,
  className = "admin-panel admin-form",
  id,
  style,
  hideSubmit = false,
  submitDisabled = false,
  disabledReason,
}: {
  action: (state: ActionState, fd: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  cancelHref?: string;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  /** For a form whose contents can legitimately be empty — a Save button with
   *  nothing behind it teaches people that buttons do not always work. */
  hideSubmit?: boolean;
  /** The form cannot be submitted for a reason outside it — no warehouse
   *  exists, say. Always pair it with `disabledReason`: a greyed-out button
   *  with no explanation is the dead end this whole wave is about. */
  submitDisabled?: boolean;
  disabledReason?: string;
}) {
  const t = useT();
  const [state, formAction, pending] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const confirm = state && "confirm" in state ? state.confirm : null;
  const error = state && "error" in state ? state.error : null;
  const field = state && "field" in state ? state.field : undefined;

  /** Put the cursor where the problem is, so a long form does not have to be
   *  re-read to find the one box that is wrong. */
  function focusField(name?: string) {
    if (!name) return;
    formRef.current
      ?.querySelector<HTMLElement>(`[name="${CSS.escape(name)}"]`)
      ?.focus();
  }

  /**
   * Re-submit the same form with the "yes, I mean it" flag set.
   *
   * The values are still in the DOM — the page never navigated — so nothing has
   * to be carried through the round trip.
   *
   * The flag is written straight into the input and cleared straight after,
   * rather than held in React state. Going through state would mean trusting
   * that React had committed the new value into the DOM before requestSubmit
   * reads it; it does today, but if that ever changed the symptom would be
   * "create anyway does nothing at all, forever" — a dead end with no error to
   * explain it. This way the value is simply there when the form is read.
   */
  function createAnyway() {
    const flag = confirmRef.current;
    if (!flag || !formRef.current) return;
    flag.value = "1";
    formRef.current.requestSubmit();
    // Cleared immediately: a form that remembers a confirmation stops
    // protecting anything on the next edit.
    flag.value = "";
  }

  return (
    <form ref={formRef} id={id} className={className} style={style} action={formAction} noValidate={false}>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
          {field && (
            <>
              {" "}
              <button
                type="button"
                className="link-like"
                onClick={() => focusField(field)}
              >
                {t("Go to the field")}
              </button>
            </>
          )}
        </div>
      )}

      {confirm && (
        <div className="dup-warn" role="alert">
          <div className="dup-warn-head">
            <b>{confirm.title}</b>
            <p>{confirm.message}</p>
          </div>

          <ul className="dup-hits">
            {confirm.hits.map((h) => (
              <li key={h.id}>
                <Link href={h.href}>{h.name}</Link>
                {/* Why we think so, in the user's own terms. "same barcode
                    049000000443" settles the question; "similar name" hands it
                    back to him, which is the honest thing to do. */}
                {h.why && <em className={`dup-why dup-why-${h.confidence ?? "possible"}`}> {h.why}</em>}
                {h.usage.length > 0 && <span> · {h.usage.join(" · ")}</span>}
              </li>
            ))}
          </ul>

          <div className="dup-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                formRef.current
                  ?.querySelector<HTMLInputElement>("input[name='name_en'], input[name='name']")
                  ?.focus()
              }
            >
              {t("Change the name")}
            </button>
            {/* No label means there is no way through — a barcode is assigned by
                the manufacturer, so a collision is a fact, not an opinion, and
                the unique index would refuse the row anyway. Offering a button
                that cannot work is worse than offering none. */}
            {confirm.confirmLabel && (
              <button type="button" className="btn btn-warn" onClick={createAnyway} disabled={pending}>
                {confirm.confirmLabel}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Only ever "1" for the one submit the user explicitly asked for.
          Uncontrolled: createAnyway() writes it directly. */}
      <input ref={confirmRef} type="hidden" name={CONFIRM_FIELD} defaultValue="" />

      {children}

      {!hideSubmit && (
        <div className="form-actions">
          <button className="btn" type="submit" disabled={pending || submitDisabled}>
            {pending ? (pendingLabel ?? t("Saving…")) : submitLabel}
          </button>
          {submitDisabled && disabledReason && <span className="hint">{disabledReason}</span>}
          {cancelHref && (
            <Link className="btn btn-ghost" href={cancelHref}>
              {t("Cancel")}
            </Link>
          )}
        </div>
      )}
    </form>
  );
}
