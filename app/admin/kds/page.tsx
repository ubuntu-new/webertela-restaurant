import Link from "next/link";
import { db } from "@/lib/db";
import { i18nText } from "@/lib/admin-utils";
import KdsBoard from "./KdsBoard";
import "./kds.css";

export const dynamic = "force-dynamic";

export default async function KdsPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const sp = await searchParams;

  const branches = await db.branch.findMany({
    where: { deletedAt: null, active: true },
    orderBy: { sortOrder: "asc" },
  });

  const branch = branches.find((b) => b.id === sp.branch) ?? null;

  if (!branch) {
    return (
      <>
        <div className="admin-head">
          <div>
            <h1>Kitchen display</h1>
            <p>Pick the branch this screen belongs to</p>
          </div>
        </div>

        <div className="admin-panel">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {branches.map((b) => (
              <Link key={b.id} className="btn" href={`/admin/kds?branch=${b.id}`}>
                {i18nText(b.name)}
              </Link>
            ))}
          </div>
          <p className="hint" style={{ marginTop: 14 }}>
            Bookmark the link after choosing — the screen will open straight onto the board.
          </p>
        </div>

        <div className="admin-panel">
          <h2>How to use it</h2>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.8, color: "var(--a-muted)" }}>
            <li>
              Any browser works — a tablet, an old PC, a TV with a browser. Nothing to install.
            </li>
            <li>
              <b>Paper tickets keep printing as they do now.</b> This screen is added alongside,
              not instead — if the kitchen doesn’t take to it, nothing is lost.
            </li>
            <li>
              The clock on each order turns amber at 10 minutes and red at 20. That number is the
              whole point of the screen.
            </li>
            <li>
              Sound plays for new orders. Browsers block audio until someone clicks once on the
              page — tap anywhere after opening.
            </li>
          </ul>
        </div>
      </>
    );
  }

  return <KdsBoard branchId={branch.id} branchName={i18nText(branch.name)} />;
}
