import { notFound } from "next/navigation";
import { isLocale } from "@/lib/locales";
import ClientApp from "@/components/ClientApp";
import { getMenu } from "@/lib/menu-db";
import { applyMenu, type Lang } from "@/lib/data";
import { orgFormat } from "@/lib/format";

// მენიუ ბაზიდან. `revalidate` აჩერებს ყოველ ვიზიტზე მოთხოვნას;
// admin-ში შენახვისას revalidatePath("/") მაშინვე განაახლებს.
export const revalidate = 60;

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  /**
   * ⚠️ A failed read and an empty menu are two different facts.
   *
   * They used to produce the same screen, because a failure fell through to the
   * hardcoded menu in lib/data.ts and so did an empty database. That hid both:
   * a restaurant whose menu was never entered looked open for business, and a
   * database outage looked like a normal Tuesday at prices nobody had checked
   * in months.
   *
   * Now they are told apart and say different things. "We cannot reach the
   * kitchen's system, please call" is true and useful. "The menu is being set
   * up" is also true, and useful to a different person.
   */
  let menu = null;
  let menuFailed = false;
  try {
    menu = await getMenu();
  } catch (e) {
    menuFailed = true;
    console.error("menu: could not be read from the database", e);
  }

  // Filled during SSR too, so the server-rendered HTML is correct rather than
  // briefly wrong until the browser catches up.
  applyMenu(menu);

  const org = await orgFormat();
  return <ClientApp lang={lang as Lang} menu={menu} menuFailed={menuFailed} org={org} />;
}
