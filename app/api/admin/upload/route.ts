import { NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { getSession, can } from "@/lib/admin-auth";

// ⚠️ middleware /api-ს არ ფარავს — სესია აქ მოწმდება.
export const runtime = "nodejs";

/**
 * ⚠️ No default, deliberately.
 *
 * It used to fall back to "/var/www/ronnys/uploads". On any tenant but Ronny's
 * that is a silent cross-tenant write: a second restaurant uploads its logo and
 * the file lands in Ronny's uploads directory, served from Ronny's domain,
 * under a filename that could collide with theirs. Nothing errors. Both sites
 * look fine.
 *
 * A missing UPLOAD_DIR is a misconfigured instance, and the honest response is
 * to refuse the upload and say which variable is absent — not to pick a
 * directory belonging to a different customer.
 */
const UPLOAD_DIR = process.env.UPLOAD_DIR;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
};

export async function POST(req: Request) {
  const session = await getSession();
  if (!can(session, "can_edit_menu")) {
    return NextResponse.json({ error: "არ გაქვს უფლება" }, { status: 403 });
  }

  // Checked here rather than at module load: an instance missing this variable
  // should fail on the upload that needs it, with a message naming the
  // variable, instead of refusing to start for a feature nobody may use today.
  if (!UPLOAD_DIR) {
    console.error("[upload] UPLOAD_DIR is not set — refusing rather than guessing a directory");
    return NextResponse.json(
      { error: "ატვირთვა არ არის კონფიგურირებული (UPLOAD_DIR)" },
      { status: 500 },
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "ფაილი არ მოვიდა" }, { status: 400 });
  }

  const ext = ALLOWED[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: "დაშვებულია მხოლოდ JPG, PNG, WebP, AVIF, GIF" },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "ფაილი 5 MB-ზე დიდია" }, { status: 400 });
  }

  // სახელი: <slug>-<random>.<ext> — გადაწერას გამორიცხავს
  const base = (form.get("name") ? String(form.get("name")) : file.name)
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "image";

  const filename = `${base}-${randomBytes(4).toString("hex")}.${ext}`;

  await mkdir(UPLOAD_DIR, { recursive: true });
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(UPLOAD_DIR, filename), bytes);

  return NextResponse.json({ url: `/uploads/${filename}` });
}
