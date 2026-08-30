"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { createSession, destroySession, getSession } from "@/lib/admin-auth";
import { fdStr } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";
import { logAction } from "@/lib/audit";
import {
  check, clientIp, fail, key, relax, slowDown, succeed, waitMessage, worthLogging,
  PASSWORD_POLICY, PASSWORD_POLICY_WIDE, GLOBAL_POLICY,
} from "@/lib/rate-limit";

// ─────────────────────────────────────────────
// AUTH — მხოლოდ ავტორიზაცია; დანარჩენი actions
// თითოეული განყოფილების საკუთარ ფაილშია.
// ─────────────────────────────────────────────

export async function login(_prev: string | null, fd: FormData): Promise<string | null> {
  const email = fdStr(fd, "email").toLowerCase();
  const password = fdStr(fd, "password");
  const next = fdStr(fd, "next") || "/admin";
  const t = await tr();

  if (!email || !password) return t("Fill in both fields.");

  /**
   * A limit here is about cost before it is about guessing.
   *
   * The password itself is long enough that nobody walks the space. But every
   * attempt spends roughly a quarter-second of bcrypt on the only Node process
   * this restaurant has, so an unbounded login form is a way to take the
   * ordering site down — during service, from anywhere, with no account.
   *
   * Three keys. The narrow one is the email rather than an address, so one
   * owner's mistyped password does not lock out the manager logging in beside
   * them. The wide one is the office. The third counts every failed attempt
   * from anywhere, because the other two are keyed on an address and an
   * attacker who rotates addresses walks past both.
   */
  const ip = await clientIp();
  const narrow = key("admin", ip, email);
  const wide = key("admin", ip);
  const everyone = key("admin", "*");

  // `k`, not `key` — the first draft's loop variable shadowed the imported
  // `key()` helper, which compiled only because nothing inside the loop called
  // it. The next person to add a line there would not have been so lucky.
  for (const k of [narrow, wide]) {
    const v = check(k);
    // Not run through `t()`: the string carries a number, so it can never match
    // a dictionary key, and wrapping it would imply a translation that is not
    // happening.
    if (!v.ok) return waitMessage(v.retryAfter);
  }
  // Delays rather than refuses: locking out every owner of every branch because
  // somebody is hammering the form would hand an attacker the whole business.
  await slowDown(check(everyone));

  /**
   * @param known whether an account with this address exists — which decides
   * whether the address is safe to write down. Someone who tabs wrong and types
   * their *password* into the email field would otherwise have it stored in
   * plaintext, permanently, in an append-only table. An address that matches no
   * account is not worth that risk; one that does is not a secret.
   */
  const refuse = async (why: string, known: boolean) => {
    const n = fail(narrow, PASSWORD_POLICY);
    const w = fail(wide, PASSWORD_POLICY_WIDE);
    fail(everyone, GLOBAL_POLICY);
    // Admin sign-in was invisible in the audit trail — neither successes nor
    // failures were recorded, so an owner could not have seen an attack on
    // their own account even after the fact.
    if (worthLogging(n) || worthLogging(w)) {
      await logAction({
        action: "admin.signIn.failed",
        entityType: "Employee",
        after: { email: known ? email : undefined, why, ip, fails: n.fails, locked: (!n.ok || !w.ok) || undefined },
      });
    }
    return t("Incorrect email or password.");
  };

  const emp = await db.employee.findUnique({ where: { email } });
  // ერთი და იგივე შეტყობინება — არ ვამხელთ, ანგარიში არსებობს თუ არა
  if (!emp || !emp.active || !emp.passwordHash) return refuse("no such account", false);

  const ok = await bcrypt.compare(password, emp.passwordHash);
  if (!ok) return refuse("wrong password", true);

  // Their own record goes; the address they share with colleagues steps back
  // one. See `relax` in lib/rate-limit.ts for why a success must not clear a
  // shared key outright.
  succeed(narrow);
  relax(wide);
  relax(everyone);

  await createSession({
    sub: emp.id,
    name: emp.name,
    role: emp.role,
    permissions: emp.permissions,
  });

  await logAction({
    action: "admin.signIn",
    entityType: "Employee",
    entityId: emp.id,
    after: { ip },
    employeeId: emp.id,
  });

  redirect(next.startsWith("/admin") ? next : "/admin");
}

export async function logout() {
  const s = await getSession();
  if (s) {
    await logAction({ action: "admin.signOut", entityType: "Employee", entityId: s.sub, employeeId: s.sub });
  }
  await destroySession();
  redirect("/admin/login");
}
