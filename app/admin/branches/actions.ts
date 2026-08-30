"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/admin-auth";
import { fdBool, fdNum, fdStr } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";
import { ActionError, failTo, formAction, isConfirmed } from "@/lib/action-state";
import { guardDuplicate } from "@/lib/dup";
import { nameKey } from "@/lib/name-key";

export const createBranch = formAction(async (fd: FormData) => {
  const session = await requirePermission("can_edit_menu");
  const t = await tr();

  const code = fdStr(fd, "code").toUpperCase();
  const nameEn = fdStr(fd, "name_en");
  if (!code) throw new ActionError(t("A branch code is required"), "code");
  if (!nameEn) throw new ActionError(t("The English name is required"), "name_en");

  const clash = await db.branch.findUnique({ where: { code } });
  if (clash) throw new ActionError(`${t("Code")} "${code}" ${t("is already in use")}`, "code");

  const org = await db.organization.findFirst();
  if (!org) throw new ActionError(t("Organization not found"));

  await guardDuplicate("branch", nameEn, { confirmed: isConfirmed(fd), t });

  const b = await db.branch.create({
    data: {
      orgId: org.id,
      code,
      name: { en: nameEn, ka: fdStr(fd, "name_ka") || nameEn },
      nameKey: nameKey(nameEn),
      address: { en: fdStr(fd, "address_en"), ka: fdStr(fd, "address_ka") || fdStr(fd, "address_en") },
      phone: fdStr(fd, "phone") || null,
      active: false,
      sortOrder: 999,
    },
  });

  const posCount = fdNum(fd, "posCount") ?? 1;
  for (let i = 1; i <= posCount; i++) {
    await db.terminal.create({
      data: {
        branchId: b.id,
        posId: `${code}-POS-${i}`,
        label: { en: `POS ${i}`, ka: `POS ${i}` },
        active: true,
        hasCardTerminal: true,
      },
    });
  }

  await db.auditLog.create({
    data: { action: "branch.create", entityType: "Branch", entityId: b.id, employeeId: session.sub },
  });

  revalidatePath("/admin/branches");
  redirect(`/admin/branches/${b.id}`);
}, tr);

export const updateBranch = formAction(async (fd: FormData, id: string) => {
  const session = await requirePermission("can_edit_menu");
  const t = await tr();

  const code = fdStr(fd, "code").toUpperCase();
  const nameEn = fdStr(fd, "name_en");
  if (!code) throw new ActionError(t("A branch code is required"), "code");
  if (!nameEn) throw new ActionError(t("The English name is required"), "name_en");

  const clash = await db.branch.findFirst({ where: { code, NOT: { id } } });
  if (clash) throw new ActionError(`${t("Code")} "${code}" ${t("is already used by another branch")}`, "code");

  const hoursText = fdStr(fd, "hours");

  await guardDuplicate("branch", nameEn, { excludeId: id, confirmed: isConfirmed(fd), t });

  await db.branch.update({
    where: { id },
    data: {
      code,
      name: { en: nameEn, ka: fdStr(fd, "name_ka") || nameEn },
      nameKey: nameKey(nameEn),
      address: { en: fdStr(fd, "address_en"), ka: fdStr(fd, "address_ka") || fdStr(fd, "address_en") },
      phone: fdStr(fd, "phone") || null,
      hours: hoursText ? { display: { en: hoursText, ka: fdStr(fd, "hours_ka") || hoursText } } : undefined,
      lat: fdNum(fd, "lat"),
      lng: fdNum(fd, "lng"),
      active: fdBool(fd, "active"),
      sortOrder: fdNum(fd, "sortOrder") ?? 0,
    },
  });

  const terminals = await db.terminal.findMany({ where: { branchId: id } });
  for (const term of terminals) {
    if (fd.get(`term_${term.id}_del`) !== null) {
      // ტერმინალიც არ იშლება — უბრალოდ დეაქტივირდება, რომ POS ID ისტორიაში დარჩეს
      await db.terminal.update({ where: { id: term.id }, data: { active: false } });
      continue;
    }
    if (fd.get(`term_${term.id}_present`) === null) continue;
    const labelEn = fdStr(fd, `term_${term.id}_label_en`);
    await db.terminal.update({
      where: { id: term.id },
      data: {
        label: labelEn ? { en: labelEn, ka: fdStr(fd, `term_${term.id}_label_ka`) || labelEn } : undefined,
        active: fdBool(fd, `term_${term.id}_active`),
        hasCardTerminal: fdBool(fd, `term_${term.id}_card`),
      },
    });
  }

  await db.auditLog.create({
    data: {
      action: "branch.update",
      entityType: "Branch",
      entityId: id,
      branchId: id,
      employeeId: session.sub,
    },
  });

  revalidatePath("/admin/branches");
  redirect("/admin/branches?saved=1");
}, tr);

export async function addTerminal(branchId: string) {
  await requirePermission("can_edit_menu");
  const t = await tr();

  const branch = await db.branch.findUnique({
    where: { id: branchId },
    include: { terminals: true },
  });
  if (!branch) failTo("/admin/branches", t("Branch not found"));

  // თავისუფალი ნომერი — უკვე წაშლილების გამო რაოდენობა არ გამოდგება
  let n = branch.terminals.length + 1;
  const taken = new Set(branch.terminals.map((term) => term.posId));
  while (taken.has(`${branch.code}-POS-${n}`)) n++;

  await db.terminal.create({
    data: {
      branchId,
      posId: `${branch.code}-POS-${n}`,
      label: { en: `POS ${n}`, ka: `POS ${n}` },
      active: true,
      hasCardTerminal: true,
    },
  });

  revalidatePath(`/admin/branches/${branchId}`);
}

/** არქივში გადატანა — ფიზიკურად არაფერი იშლება, შეკვეთების ისტორია რჩება. */
export async function archiveBranch(id: string) {
  const session = await requirePermission("can_edit_menu");

  await db.branch.update({ where: { id }, data: { deletedAt: new Date() } });

  await db.auditLog.create({
    data: { action: "branch.archive", entityType: "Branch", entityId: id, employeeId: session.sub },
  });

  revalidatePath("/admin/branches");
  redirect("/admin/branches?archived=1");
}
