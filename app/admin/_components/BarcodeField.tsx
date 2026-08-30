"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { parseGtin, displayGtin, packagingLevel } from "@/lib/gtin";
import type { DupHit, DupModel } from "@/lib/action-state";
import { checkDuplicateBarcode } from "./dup-actions";
import { useT } from "./AdminLang";

/**
 * The barcode box, and the camera behind it.
 *
 * Typing a fourteen-digit number off a packet is a job nobody does twice. So
 * the field has a Scan button that opens the phone's back camera and reads the
 * code — the same gesture the person already makes at a supermarket till, and
 * the reason this is worth building at all: an identifier that is *never typed*
 * is an identifier that is never mistyped.
 *
 * Three things it does that a plain input cannot:
 *
 *  1. **Checks the number as you type.** A GTIN's last digit is a checksum over
 *     the others, so a wrong digit can be caught at the keyboard rather than
 *     becoming a bad row somebody has to find in six months.
 *
 *  2. **Says which product already has it.** The barcode is unique in the
 *     database, so a collision is not a judgement call — better to say so here
 *     than to let the save fail.
 *
 *  3. **Tells a case apart from a unit.** A GTIN-14 beginning with 1–8 is the
 *     outer box, not the item. Scanning the case barcode onto a unit is how a
 *     stock count ends up twelve times too small, and the field says so before
 *     that happens.
 *
 * On the camera: `BarcodeDetector` is native in Chrome and Android WebView and
 * absent in Safari, which is most iPhones. There is no polyfill here on purpose
 * — a barcode-reading library is a large download for a page that already works
 * without it. When the API is missing the button explains, in one line, what to
 * do instead. Being told "your browser can't, type it in" is a fine outcome;
 * a button that silently does nothing is not.
 */

// The DOM lib does not know about BarcodeDetector yet.
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

/** The 1-D retail formats. QR and friends are deliberately not read: nothing in
 *  a kitchen carries a product identity in a QR code, and accepting one would
 *  put a URL in a field that must hold a GTIN. */
const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "itf"];

export default function BarcodeField({
  model,
  name = "barcode",
  label,
  defaultValue,
  excludeId,
  hint,
}: {
  model: DupModel;
  name?: string;
  label: string;
  /** The stored GTIN-14; shown in its short printed form. */
  defaultValue?: string | null;
  excludeId?: string;
  hint?: string;
}) {
  const t = useT();
  const [value, setValue] = useState(displayGtin(defaultValue));
  const [hits, setHits] = useState<DupHit[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const seq = useRef(0);

  const parsed = value.trim() ? parseGtin(value) : null;
  const stored = parsed?.ok ? (parsed.normalized as string) : null;
  const level = stored ? packagingLevel(stored) : null;

  // ── the camera ─────────────────────────────────────────────────────────────

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScanning(false);
  };

  // A camera left running is a light on the phone and a battery going flat.
  // This must fire on unmount whatever else happened.
  useEffect(() => () => stopCamera(), []);

  async function startCamera() {
    setScanError(null);

    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!Detector) {
      setScanError(
        t(
          "This browser cannot read barcodes with the camera — Safari on iPhone is the usual one. Type the number under the bars instead; it is checked as you type.",
        ),
      );
      return;
    }

    try {
      // `environment` is the back camera. Asking for the front one to read a
      // barcode is a very quick way to look silly.
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
      });
    } catch {
      setScanError(t("The camera could not be opened. Check that this site is allowed to use it."));
      return;
    }

    setScanning(true);

    const video = videoRef.current;
    if (!video) return stopCamera();
    video.srcObject = streamRef.current;
    await video.play().catch(() => {});

    const detector = new Detector({ formats: FORMATS });
    let stop = false;

    const tick = async () => {
      if (stop || !streamRef.current) return;
      try {
        const codes = await detector.detect(video);
        const first = codes.find((c) => parseGtin(c.rawValue).ok);
        if (first) {
          stop = true;
          const r = parseGtin(first.rawValue);
          setValue(displayGtin(r.normalized));
          stopCamera();
          // A scan that produces no sign of having worked feels broken, and a
          // phone that is not looked at needs to be felt.
          navigator.vibrate?.(60);
          return;
        }
      } catch {
        // A frame that cannot be read is normal — the code is out of focus, or
        // the hand moved. Keep looking rather than reporting a failure.
      }
      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }

  // ── is this barcode already on something? ──────────────────────────────────

  useEffect(() => {
    if (!stored || stored === defaultValue) {
      setHits([]);
      return;
    }
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      startTransition(async () => {
        try {
          const found = await checkDuplicateBarcode(model, stored, excludeId);
          if (mine === seq.current) setHits(found);
        } catch {
          if (mine === seq.current) setHits([]);
        }
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [stored, model, excludeId, defaultValue]);

  // The message itself rather than a flag, so the JSX below has nothing left to
  // check. TypeScript would follow the flag version too — it narrows through an
  // aliased condition — but a value that is either a sentence or null is one
  // fewer thing for a reader to hold.
  const problem = value.trim().length > 0 && parsed && !parsed.ok ? parsed.problem : null;

  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>

      <div className="barcode-row">
        <input
          id={name}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={t("scan or type")}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="button" className="btn btn-ghost" onClick={scanning ? stopCamera : startCamera}>
          {scanning ? t("Stop") : t("Scan")}
        </button>
      </div>

      {/* What is submitted is the 14-digit canonical form, so that the UPC-A on
          an American can and the EAN-13 on the same can in Europe are one value.

          When the typed value does NOT check out, the raw text is submitted
          rather than an empty string. That looks backwards, and it is the
          important part: an empty string reads on the server as "no barcode
          given", so a single mistyped digit on an item that already had one
          would quietly wipe it — a warning on screen and a deletion in the
          database. Sending the bad value makes the server reject it with the
          message it already has, and nothing is lost. */}
      <input
        type="hidden"
        name={name}
        value={value.trim() === "" ? "" : (stored ?? value.trim())}
      />

      <video
        ref={videoRef}
        className="barcode-cam"
        style={{ display: scanning ? "block" : "none" }}
        muted
        playsInline
      />

      {scanning && <div className="hint">{t("Hold the barcode inside the frame.")}</div>}

      {scanError && <div className="dup-live">{scanError}</div>}

      {problem && <div className="dup-live">{problem}</div>}

      {parsed?.ok && level === "case" && (
        <div className="dup-live">
          <b>{t("That is a case barcode, not a single item.")}</b>{" "}
          {t(
            "It is the code on the outer box. If you count this ingredient by the unit, scan the barcode on the unit instead — otherwise your stock count will be out by however many are in a case.",
          )}
        </div>
      )}

      {hits.length > 0 && (
        <div className="dup-live">
          <b>{t("Another item already has this barcode")}</b>
          {hits.map((h) => (
            <div key={h.id} style={{ marginTop: 4 }}>
              <Link href={h.href}>{h.name}</Link>
              {h.usage.length > 0 && <span> · {h.usage.join(" · ")}</span>}
            </div>
          ))}
          <div style={{ marginTop: 6 }}>
            {t("A barcode identifies one product worldwide, so this has to be that item — or the barcode is on the wrong one.")}
          </div>
        </div>
      )}

      {hint && !scanning && <span className="hint">{hint}</span>}
    </div>
  );
}
