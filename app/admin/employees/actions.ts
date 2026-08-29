"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requirePermission, getSession } from "@/lib/admin-auth";
import { hashPin, isValidPin } from "@/lib/pin";
import { fdBool, fdNum, fdStr } from "@/lib/admin-utils";
import { PERMISSIONS } from "@/lib/permissions";
import { tr } from "@/lib/admin-i18n";
void PERMISSIONS;

const ROLES = ["super_admin", "branch_manager", "cashier", "kitchen", "driver"] as const;
type Role = (typeof ROLES)[number];


function roleOf(v: string): Role {
  return (ROLES as readonly string[]).includes(v) ? (v as Role) : "cashier";
}

/** super_admin-ს მხოლოდ super_admin ქმნის/ცვლის. */
async function guardRole(target: Role) {
  const t = await tr();
  const s = await getSession();
  if (target === "super_admin" && s?.role !== "super_admin") {
    throw new Error(t("Only a super_admin can assign the super_admin role"));
  }
}

export async function createEmployee(fd: FormData) {
  const session = await requirePermission("can_manage_staff");
  const t = await tr();

  const name = fdStr(fd, "name");
  if (!name) throw new Error(t("A name is required"));

  const role = roleOf(fdStr(fd, "role"));
  await guardRole(role);

  const email = fdStr(fd, "email").toLowerCase() || null;
  const password = fdStr(fd, "password");
  if (email && password && password.length < 10) {
    throw new Error(t("The password must be at least 10 characters"));
  }

  const emp = await db.employee.create({
    data: {
      name,
      email,
      phone: fdStr(fd, "phone") || null,
      passwordHash: email && password ? await bcrypt.hash(password, 12) : null,
      role,
      permissions: fd.getAll("perm").map(String),
      title: fdStr(fd, "title") || null,
      hourlyRate: fdNum(fd, "hourlyRate"),
      homeBranchId: fdStr(fd, "homeBranchId") || null,
      active: true,
    },
  });

  const branches = fd.getAll("branch").map(String);
  for (const branchId of branches) {
    await db.employeeBranch.create({ data: { employeeId: emp.id, branchId } });
  }

  await db.auditLog.create({
    data: { action: "employee.create", entityType: "Employee", entityId: emp.id, employeeId: session.sub },
  });

  revalidatePath("/admin/employees");
  redirect(`/admin/employees/${emp.id}`);
}

export async function updateEmployee(id: string, fd: FormData) {
  const session = await requirePermission("can_manage_staff");
  const t = await tr();

  const name = fdStr(fd, "name");
  if (!name) throw new Error(t("A name is required"));

  const role = roleOf(fdStr(fd, "role"));
  await guardRole(role);

  const current = await db.employee.findUnique({ where: { id } });
  if (!current) throw new Error(t("Employee not found"));
  if (current.role === "super_admin") await guardRole("super_admin");

  const email = fdStr(fd, "email").toLowerCase() || null;
  const active = fdBool(fd, "active");

  // ბოლო აქტიური super_admin-ის გამორთვა დაბლოკილია
  if (current.role === "super_admin" && (!active || role !== "super_admin")) {
    const others = await db.employee.count({
      where: { role: "super_admin", active: true, deletedAt: null, NOT: { id } },
    });
    if (others === 0) throw new Error(t("This is the only active super_admin — appoint another one first"));
  }

  await db.employee.update({
    where: { id },
    data: {
      name,
      email,
      phone: fdStr(fd, "phone") || null,
      role,
      permissions: fd.getAll("perm").map(String),
      title: fdStr(fd, "title") || null,
      hourlyRate: fdNum(fd, "hourlyRate"),
      homeBranchId: fdStr(fd, "homeBranchId") || null,
      active,
    },
  });

  // ფილიალები
  if (fd.get("branches_present") !== null) {
    const picked = fd.getAll("branch").map(String);
    await db.employeeBranch.deleteMany({
      where: { employeeId: id, branchId: { notIn: picked.length ? picked : ["__none__"] } },
    });
    for (const branchId of picked) {
      const exists = await db.employeeBranch.findUnique({
        where: { employeeId_branchId: { employeeId: id, branchId } },
      });
      if (!exists) await db.employeeBranch.create({ data: { employeeId: id, branchId } });
    }
  }

  await db.auditLog.create({
    data: { action: "employee.update", entityType: "Employee", entityId: id, employeeId: session.sub },
  });

  revalidatePath("/admin/employees");
  redirect("/admin/employees?saved=1");
}

/** ადმინ-პანელის პაროლის დაყენება/შეცვლა. */
export async function setPassword(id: string, fd: FormData) {
  const session = await requirePermission("can_manage_staff");
  const t = await tr();

  const password = fdStr(fd, "newPassword");
  if (password.length < 10) throw new Error(t("The password must be at least 10 characters"));

  const emp = await db.employee.findUnique({ where: { id } });
  if (!emp?.email) throw new Error(t("Add an email first — without one they cannot sign in"));

  await db.employee.update({ where: { id }, data: { passwordHash: await bcrypt.hash(password, 12) } });

  await db.auditLog.create({
    data: { action: "employee.setPassword", entityType: "Employee", entityId: id, employeeId: session.sub },
  });

  revalidatePath(`/admin/employees/${id}`);
  redirect(`/admin/employees/${id}?pw=1`);
}

/** POS PIN. */
export async function setPin(id: string, fd: FormData) {
  const session = await requirePermission("can_manage_staff");
  const t = await tr();

  const pin = fdStr(fd, "newPin");
  if (!isValidPin(pin)) throw new Error(t("The PIN must be 4–8 digits"));

  const hash = hashPin(pin);
  const clash = await db.employee.findFirst({ where: { posPinHash: hash, NOT: { id } } });
  if (clash) throw new Error(t("Another employee already has this PIN — pick a different one"));

  await db.employee.update({ where: { id }, data: { posPinHash: hash } });

  await db.auditLog.create({
    data: { action: "employee.setPin", entityType: "Employee", entityId: id, employeeId: session.sub },
  });

  revalidatePath(`/admin/employees/${id}`);
  redirect(`/admin/employees/${id}?pin=1`);
}

export async function clearPin(id: string) {
  await requirePermission("can_manage_staff");
  await db.employee.update({ where: { id }, data: { posPinHash: null } });
  revalidatePath(`/admin/employees/${id}`);
}

export async function archiveEmployee(id: string) {
  const session = await requirePermission("can_manage_staff");
  const t = await tr();

  const emp = await db.employee.findUnique({ where: { id } });
  if (emp?.role === "super_admin") {
    const others = await db.employee.count({
      where: { role: "super_admin", active: true, deletedAt: null, NOT: { id } },
    });
    if (others === 0) throw new Error(t("This is the only active super_admin — it cannot be archived"));
  }
  if (session.sub === id) throw new Error(t("You cannot archive yourself"));

  await db.employee.update({ where: { id }, data: { deletedAt: new Date(), posPinHash: null } });

  await db.auditLog.create({
    data: { action: "employee.archive", entityType: "Employee", entityId: id, employeeId: session.sub },
  });

  revalidatePath("/admin/employees");
  redirect("/admin/employees?archived=1");
}
