import { getDriverSession } from "@/lib/driver-auth";
import { orgFormat } from "@/lib/format";
import DriverApp from "./DriverApp";

export const dynamic = "force-dynamic";

export default async function DriverPage() {
  const session = await getDriverSession();
  const org = await orgFormat();
  return <DriverApp session={session} org={org} />;
}
