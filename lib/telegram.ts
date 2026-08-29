import "server-only";
import { db } from "@/lib/db";
import { fmt } from "@/lib/format";

/**
 * Telegram შეტყობინებები.
 *
 * ორი წესი:
 *   • გაგზავნა **არასდროს** აჩერებს მთავარ ოპერაციას — ჩავარდნა ლოგშია
 *   • თითო ტიპი ცალკე ირთვება admin-ში (`settings` → `telegram`)
 *
 * ⚠️ რატომ არის ეს მნიშვნელოვანი: თუ ყველა მოვლენა გაიგზავნება, ჩატი
 * ხმაურად გადაიქცევა და ერთ კვირაში ყველა გამორთავს. ცოტა და საჭირო
 * შეტყობინება ჯობია ბევრს და უგულებელყოფილს.
 */

export type TgEvent = "order" | "transferRequest" | "transferSent" | "lowStock";

interface TgSettings {
  enabled: boolean;
  chatId: string;
  events: Record<TgEvent, boolean>;
}

const DEFAULTS: TgSettings = {
  enabled: false,
  chatId: "",
  events: { order: true, transferRequest: true, transferSent: true, lowStock: true },
};

export async function getTelegramSettings(): Promise<TgSettings> {
  const row = await db.setting.findUnique({ where: { key: "telegram" } });
  const v = (row?.value ?? {}) as Partial<TgSettings>;

  return {
    enabled: v.enabled ?? DEFAULTS.enabled,
    chatId: String(v.chatId ?? process.env.TELEGRAM_CHAT_ID ?? ""),
    events: { ...DEFAULTS.events, ...(v.events ?? {}) },
  };
}

/** ტექსტს HTML-ისთვის ვასუფთავებთ — სახელებში `<` ან `&` შეიძლება იყოს. */
function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * გაგზავნა. ჩავარდნისას მხოლოდ ლოგი — გამომძახებელი არაფერს გრძნობს.
 */
export async function sendTelegram(event: TgEvent, text: string): Promise<void> {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;

    const s = await getTelegramSettings();
    if (!s.enabled || !s.chatId) return;
    if (!s.events[event]) return;

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: s.chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      // ნელი პასუხი შეკვეთას არ უნდა აჩერებდეს
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`telegram: ${res.status} — ${body.slice(0, 200)}`);
    }
  } catch (e) {
    console.error("telegram: გაგზავნა ჩავარდა", e);
  }
}

// ─────────────────────────────────────────────
// მზა შეტყობინებები
// ─────────────────────────────────────────────

export async function notifyNewOrder(o: {
  orderNo: number;
  branch: string;
  total: number | string;
  itemCount: number;
  type: string;
  customer?: string | null;
  phone?: string | null;
}) {
  const kind = o.type === "pickup" ? "წაღება" : "მიწოდება";
  const f = await fmt();
  await sendTelegram(
    "order",
    `🍕 <b>ახალი შეკვეთა #${o.orderNo}</b>\n` +
      `${esc(o.branch)} · ${kind}\n` +
      `${o.itemCount} პოზიცია · <b>${f.money(Number(o.total))}</b>` +
      (o.customer ? `\n${esc(o.customer)}` : "") +
      (o.phone ? ` · ${esc(o.phone)}` : ""),
  );
}

export async function notifyTransferRequest(t: {
  no: number;
  from: string;
  to: string;
  lines: number;
  by?: string | null;
}) {
  await sendTelegram(
    "transferRequest",
    `📦 <b>შევსების მოთხოვნა #${t.no}</b>\n` +
      `${esc(t.from)} → ${esc(t.to)}\n` +
      `${t.lines} პოზიცია` +
      (t.by ? `\nმოითხოვა: ${esc(t.by)}` : "") +
      `\n\n<i>ელოდება დამტკიცებას</i>`,
  );
}

export async function notifyTransferSent(t: {
  no: number;
  from: string;
  to: string;
  by?: string | null;
}) {
  await sendTelegram(
    "transferSent",
    `🚚 <b>გზავნილი გამოვიდა #${t.no}</b>\n` +
      `${esc(t.from)} → ${esc(t.to)}` +
      (t.by ? `\nგააგზავნა: ${esc(t.by)}` : "") +
      `\n\n<i>მიღებისას დაადასტურეთ ფაქტობრივი რაოდენობა</i>`,
  );
}

export async function notifyLowStock(items: { name: string; location: string; qty: string }[]) {
  if (items.length === 0) return;
  const lines = items.slice(0, 15).map((i) => `• ${esc(i.name)} — ${esc(i.location)}: ${esc(i.qty)}`);
  const more = items.length > 15 ? `\n<i>…და კიდევ ${items.length - 15}</i>` : "";

  await sendTelegram(
    "lowStock",
    `⚠️ <b>მარაგი ამოწურვის ზღვარზე</b>\n\n${lines.join("\n")}${more}`,
  );
}
