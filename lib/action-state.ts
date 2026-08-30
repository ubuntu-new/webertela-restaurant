/**
 * How a server action tells the user something went wrong.
 *
 * Until now every admin action validated with `throw new Error("…")`. That
 * message never arrived: there is no error boundary under /admin, and in
 * production Next.js replaces a thrown server-action message with a generic
 * digest for security. So the software has been carefully writing advice into
 * a void — the owner saw a crash page, or nothing at all, and had no idea what
 * he had done wrong.
 *
 * This module turns a thrown error into a value the form can render, next to
 * the field, in the user's language. The rule the whole project follows applies
 * here too: **never say only that something is wrong — say what to do about it.**
 *
 * There are three kinds of outcome:
 *
 *  - `{ error }`      — you cannot save this. Fix the field and try again.
 *  - `{ confirm }`    — you probably don't want to save this, but you might.
 *                       Here is what already exists; decide.
 *  - a redirect       — it saved. Not a state at all; the wrapper lets it fly.
 *
 * No `server-only`: the types cross to the client with the state, and the
 * client wrapper (AdminForm) needs them. Only the code that touches the
 * database lives in dup.ts, which is server-only.
 */

import { redirect } from "next/navigation";

/**
 * Which table is being checked.
 *
 * The type lives here rather than in dup.ts because dup.ts is `server-only` and
 * NameField is a client component. A type-only import would be erased, but
 * relying on erasure to keep a server module out of the browser bundle is the
 * kind of thing that works until a compiler option changes.
 */
export type DupModel =
  | "stockItem"
  | "product"
  | "category"
  | "subcategory"
  | "topping"
  | "combo"
  | "discount"
  | "recipe"
  | "branch"
  | "employee"
  | "supplier";

/** One thing that already exists and looks like what is being created. */
export interface DupHit {
  id: string;
  /** As the user would recognise it. */
  name: string;
  /** Where to go to look at it. */
  href: string;
  /** Why it matters that this exists: "4.2 kg on hand", "used in 6 recipes". */
  usage: string[];
  /** Same name after normalisation, as opposed to merely similar. */
  exact: boolean;
  /**
   * How sure the software is, and on what grounds. A barcode match is
   * `certain` and needs no judgement; a similar name is `possible` and needs
   * all of it. The UI shows `why` verbatim, because "same barcode 049000000443"
   * settles the question and "same name" invites the user to think.
   */
  confidence?: "certain" | "strong" | "probable" | "possible";
  why?: string;
}

/** The question put to the user when a duplicate is found. */
export interface DupConfirm {
  title: string;
  message: string;
  hits: DupHit[];
  /**
   * What the "do it anyway" button says. Deliberately specific — a button
   * reading "Confirm" tells nobody what they are confirming.
   *
   * Empty means there is no way through: a barcode is assigned by the
   * manufacturer, so a collision is not a difference of opinion and offering to
   * override it would only produce a row the unique index refuses anyway.
   */
  confirmLabel: string;
}

export type ActionState =
  | null
  | { error: string; field?: string; confirm?: never }
  | { confirm: DupConfirm; error?: never };

/** A validation failure with a message meant for the person, not the log. */
export class ActionError extends Error {
  field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = "ActionError";
    this.field = field;
  }
}

/** "This already exists — do you want it anyway?" */
export class DuplicateError extends Error {
  confirm: DupConfirm;
  constructor(confirm: DupConfirm) {
    super(confirm.title);
    this.name = "DuplicateError";
    this.confirm = confirm;
  }
}

/**
 * `redirect()` and `notFound()` work by throwing. Catching them would turn a
 * successful save into a silent no-op — the single most confusing bug this
 * wrapper could introduce — so they are identified and re-thrown untouched.
 *
 * Next marks them with a `digest` string rather than a class, and the class is
 * an internal import that has moved between versions. The digest is the stable
 * surface.
 */
function isControlFlow(e: unknown): boolean {
  const digest = (e as { digest?: unknown })?.digest;
  if (typeof digest !== "string") return false;

  // Every one of Next's internal signals is prefixed this way: NEXT_REDIRECT,
  // NEXT_NOT_FOUND on older versions, NEXT_HTTP_ERROR_FALLBACK;404 on newer
  // ones. Matching the prefix rather than the exact strings means a Next
  // upgrade cannot quietly turn a successful redirect into a swallowed one —
  // which would look, to the user, like the save simply did nothing.
  return digest.startsWith("NEXT_");
}

/** Prisma's error codes, in the words of someone who is not a programmer. */
function prismaMessage(e: unknown, t: (s: string) => string): string | null {
  const code = (e as { code?: unknown })?.code;
  if (typeof code !== "string" || !code.startsWith("P")) return null;

  const meta = (e as { meta?: { target?: unknown; field_name?: unknown } })?.meta;
  const target = Array.isArray(meta?.target) ? meta.target.join(", ") : String(meta?.target ?? "");

  switch (code) {
    case "P2002":
      // The database refused a duplicate on a field that must be unique. This
      // is the last line of defence — the application should have caught it
      // first with a better message, so the field name is included to make the
      // gap findable.
      return target
        ? `${t("This is already used by another record")} (${target}). ${t("Change it and try again.")}`
        : t("Something with these details already exists. Change it and try again.");
    case "P2003":
      return t("Something this refers to no longer exists. Reload the page and try again.");
    case "P2025":
      return t("This record was changed or archived by someone else. Reload the page.");
    case "P2000":
      return t("One of the values is too long for its field.");
    default:
      return null;
  }
}

/**
 * Wrap a server action so its failures become form state instead of a crash.
 *
 * The action keeps its natural shape — `(fd) => Promise<void>` that redirects on
 * success — and gains the `(prevState, formData)` signature `useActionState`
 * needs. Bound arguments (an id, usually) are passed through:
 *
 *     export const updateStockItem = formAction(async (fd, id: string) => { … });
 *     // in the page:  <AdminForm action={updateStockItem.bind(null, item.id)}>
 */
export function formAction<A extends unknown[]>(
  handler: (fd: FormData, ...args: A) => Promise<void>,
  translate?: () => Promise<(s: string) => string>,
) {
  return async function (...args: [...A, ActionState, FormData]): Promise<ActionState> {
    const fd = args[args.length - 1] as FormData;
    const bound = args.slice(0, args.length - 2) as A;

    const t = translate ? await translate() : (s: string) => s;

    try {
      await handler(fd, ...bound);
      return null;
    } catch (e) {
      if (isControlFlow(e)) throw e;

      if (e instanceof DuplicateError) return { confirm: e.confirm };
      if (e instanceof ActionError) return { error: e.message, field: e.field };

      const fromPrisma = prismaMessage(e, t);
      if (fromPrisma) {
        console.error("[action] prisma error:", e);
        return { error: fromPrisma };
      }

      // An unplanned failure. The message is NOT passed through: an unrecognised
      // throw is a bug, and a bug's message is a Prisma query with table and
      // column names in it, or a hard-coded string in the wrong language.
      // Next redacts these in production for a reason, and forwarding them here
      // would undo that. Anything meant for a person is an ActionError, and was
      // handled above.
      console.error("[action] unhandled error:", e);
      return {
        error: t("Something went wrong and nothing was saved. Try again, and tell us if it keeps happening."),
      };
    }
  };
}

/**
 * The same courtesy for actions that are a button rather than a form.
 *
 * "Archive" and "Add POS terminal" have nowhere to render a state — there are
 * no fields to come back to. So the refusal is carried in the URL and shown by
 * the page it lands on, which is the pattern the orders screen already used.
 *
 * Throwing from a button action would reach the error boundary, and in
 * production Next.js strips the message — so the person would be told only
 * that something went wrong, when what actually happened is that they tried to
 * archive the last super_admin and the software was right to stop them.
 */
export function failTo(path: string, message: string): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}error=${encodeURIComponent(message)}`);
}

/** Did the user already look at the duplicate warning and decide to go ahead? */
export const CONFIRM_FIELD = "__confirm";
export function isConfirmed(fd: FormData): boolean {
  return String(fd.get(CONFIRM_FIELD) ?? "") === "1";
}
