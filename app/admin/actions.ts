"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { createSession, destroySession } from "@/lib/admin-auth";
import { fdStr } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";

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

  const emp = await db.employee.findUnique({ where: { email } });
  // ერთი და იგივე შეტყობინება — არ ვამხელთ, ანგარიში არსებობს თუ არა
  if (!emp || !emp.active || !emp.passwordHash) return t("Incorrect email or password.");

  const ok = await bcrypt.compare(password, emp.passwordHash);
  if (!ok) return t("Incorrect email or password.");

  await createSession({
    sub: emp.id,
    name: emp.name,
    role: emp.role,
    permissions: emp.permissions,
  });

  redirect(next.startsWith("/admin") ? next : "/admin");
}

export async function logout() {
  await destroySession();
  redirect("/admin/login");
}
