"use client";

import { useRef, useState } from "react";
import { useT } from "./AdminLang";

interface Props {
  name: string;
  label?: string;
  defaultValue?: string | null;
  hint?: string;
}

/** ფოტოს ველი: ატვირთვა ფაილიდან ან URL-ის ჩასმა. მნიშვნელობა hidden input-ში ჯდება. */
export default function ImageField({ name, label, defaultValue, hint }: Props) {
  const t = useT();
  const [url, setUrl] = useState(defaultValue ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("Upload failed"));
      setUrl(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Upload failed"));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="field">
      <label>{label ?? t("Photo")}</label>

      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <div
          style={{
            width: 92,
            height: 92,
            flex: "0 0 92px",
            border: "1px solid var(--a-line)",
            borderRadius: 8,
            background: "#f5f5f4",
            display: "grid",
            placeItems: "center",
            overflow: "hidden",
          }}
        >
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
          ) : (
            <span className="hint">{t("Empty")}</span>
          )}
        </div>

        <div style={{ flex: 1, display: "grid", gap: 8 }}>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("https://… or upload a file")}
          />
          <input type="hidden" name={name} value={url} />

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
              }}
            />
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? t("Uploading…") : t("Upload a file")}
            </button>
            {url && (
              <button type="button" className="btn btn-ghost" onClick={() => setUrl("")}>
                {t("Remove")}
              </button>
            )}
          </div>

          {error && <span style={{ color: "var(--a-danger)", fontSize: 13 }}>{error}</span>}
          {hint && <span className="hint">{hint}</span>}
          <span className="hint">{t("JPG · PNG · WebP · AVIF · GIF, max 5 MB")}</span>
        </div>
      </div>
    </div>
  );
}
