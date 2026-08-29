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

  let menu = null;
  try {
    menu = await getMenu();
  } catch (e) {
    // ბაზა მიუწვდომელია → lib/data.ts-ის სტატიკური მენიუ რჩება ძალაში.
    console.error("menu: ბაზიდან წამოღება ვერ მოხერხდა, ვიყენებ fallback-ს", e);
  }

  // SSR-ის დროსაც ვავსებთ, რომ სერვერზე დარენდერებული HTML სწორი იყოს
  applyMenu(menu);

  const org = await orgFormat();
  return <ClientApp lang={lang as Lang} menu={menu} org={org} />;
}
