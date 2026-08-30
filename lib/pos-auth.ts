import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { hashPin } from "@/lib/pin";

/**
 * POS session — separate from the admin session on purpose.
 *
 * A terminal sits on a counter all day. It must NOT carry an admin cookie
 * that could reach staff records or settings. This session only ever proves
 * "employee X is on terminal Y", and it is short-lived.
 */

const COOKIE = "ronnys_pos";
const TTL_HOURS = 14; // one long shift

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(s);
}

export interface PosSession {
  sub: string; // employeeId
  name: string;
  role: string;
  branchId: string;
  posId: string;
  /**
   * This sign-in, distinct from every other.
   *
   * The till stamps each queued sale with it, so that a sale rung up before a
   * handover cannot be sent under the cookie of whoever came next. The client
   * used to mint this itself and decide "same person?" by comparing displayed
   * names — which fails silently for two employees called Ana, and fails the
   * other way while the name is still empty on boot.
   *
   * Minted here because only the server knows whether a sign-in is a handover.
   * It identifies a session, not a person: it is random, it changes on every
   * sign-in by the same employee, and it says nothing about who they are.
   */
  sid: string;
}

export async function signInWithPin(pin: string, branchId: string, posId: string) {
  const employee = await db.employee.findFirst({
    where: { posPinHash: hashPin(pin), active: true, deletedAt: null },
    select: { id: true, name: true, role: true, branches: { select: { branchId: true } } },
  });
  if (!employee) return null;

  // A cashier assigned to Vake shouldn't be able to open the till in Gldani
  const allowed =
    employee.role === "super_admin" ||
    employee.branches.length === 0 ||
    employee.branches.some((b) => b.branchId === branchId);
  if (!allowed) return { error: "not_assigned_to_branch" as const };

  const sid = randomUUID();

  const token = await new SignJWT({
    name: employee.name,
    role: employee.role,
    branchId,
    posId,
    sid,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(employee.id)
    .setIssuedAt()
    .setExpirationTime(`${TTL_HOURS}h`)
    .sign(secret());

  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: TTL_HOURS * 3600,
  });

  return { employee, sid };
}

export async function getPosSession(): Promise<PosSession | null> {
  try {
    const jar = await cookies();
    const token = jar.get(COOKIE)?.value;
    if (!token) return null;

    const { payload } = await jwtVerify(token, secret());
    return {
      sub: String(payload.sub),
      name: String(payload.name ?? ""),
      role: String(payload.role ?? ""),
      branchId: String(payload.branchId ?? ""),
      posId: String(payload.posId ?? ""),
      sid: String(payload.sid ?? ""),
    };
  } catch {
    return null;
  }
}

export async function posSignOut() {
  const jar = await cookies();
  jar.delete(COOKIE);
}
