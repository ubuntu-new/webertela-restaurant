// scripts/create-admin.mjs
// პირველი super_admin-ის შექმნა (ან არსებულის პაროლის შეცვლა).
//
// გაშვება:
//   node scripts/create-admin.mjs "სახელი" email@example.com "პაროლი"

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const [, , name, emailRaw, password] = process.argv;

if (!name || !emailRaw || !password) {
  console.error('გამოყენება: node scripts/create-admin.mjs "სახელი" email@example.com "პაროლი"');
  process.exit(1);
}
if (password.length < 10) {
  console.error("პაროლი მინიმუმ 10 სიმბოლო უნდა იყოს.");
  process.exit(1);
}

const email = emailRaw.toLowerCase();

// Same normalisation as lib/name-key.ts. Without it this row has no key, and
// the duplicate check would never see the owner when someone later adds a
// second employee with the same name.
const nameKey = (v) =>
  String(v ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const db = new PrismaClient();

const passwordHash = await bcrypt.hash(password, 12);

const emp = await db.employee.upsert({
  where: { email },
  update: { name, nameKey: nameKey(name), passwordHash, role: "super_admin", active: true },
  create: {
    name,
    nameKey: nameKey(name),
    email,
    passwordHash,
    role: "super_admin",
    permissions: [
      "can_refund",
      "can_void",
      "can_edit_menu",
      "can_manage_staff",
      "can_view_reports",
      "can_discount",
      "can_transfer_branch",
    ],
    active: true,
  },
});

console.log(`✓ super_admin მზადაა: ${emp.name} <${emp.email}>`);
console.log("  შესვლა: https://ronnys.webertela.online/admin/login");

await db.$disconnect();
