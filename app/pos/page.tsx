import { db } from "@/lib/db";
import { getMenu } from "@/lib/menu-db";
import { getPosSession } from "@/lib/pos-auth";
import { i18nText } from "@/lib/admin-utils";
import { orgFormat } from "@/lib/format";
import PosTerminal from "./PosTerminal";

export const dynamic = "force-dynamic";

export default async function PosPage() {
  const [session, branches, terminals, menu, org] = await Promise.all([
    getPosSession(),
    db.branch.findMany({ where: { deletedAt: null, active: true }, orderBy: { sortOrder: "asc" } }),
    db.terminal.findMany({ where: { active: true }, orderBy: { posId: "asc" } }),
    getMenu().catch(() => null),
    orgFormat(),
  ]);

  // ── რა არ იყიდება ამ ფილიალში ──
  // ⚠️ ამის გარეშე მოლარე გაყიდიდა იმას, რაც სწორედ იმ ფილიალში გათავდა.
  // საიტი ამას ითვალისწინებდა, POS — არა.
  let unavailable: number[] = [];
  let unavailableItems: string[] = [];

  if (session?.branchId) {
    const off = await db.branchProduct.findMany({
      where: { branchId: session.branchId, available: false },
      include: { product: { select: { id: true, type: true, legacyId: true } } },
    });
    unavailable = off
      .filter((o) => o.product.type === "pizza" && o.product.legacyId != null)
      .map((o) => o.product.legacyId as number);
    unavailableItems = off
      .filter((o) => o.product.type !== "pizza")
      .map((o) => o.product.id.replace(/^(side|drink)-/, ""));
  }

  return (
    <PosTerminal
      unavailable={unavailable}
      unavailableItems={unavailableItems}
      session={session}
      menu={menu}
      org={org}
      branches={branches.map((b) => ({ id: b.id, name: i18nText(b.name), code: b.code }))}
      terminals={terminals.map((t) => ({
        posId: t.posId,
        branchId: t.branchId,
        label: i18nText(t.label),
      }))}
    />
  );
}
