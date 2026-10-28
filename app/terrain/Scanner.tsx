"use client";

import jsQR from "jsqr";
import { useEffect, useRef, useState } from "react";

/**
 * Reads a printed code with the phone camera, without network (document 3, ch. 05). Uses the
 * browser's barcode reader where it exists (Android) and a bundled QR decoder elsewhere (iPhone).
 * A typed field stays available: a smudged label, a denied camera, or an RFID reader paired as a
 * Bluetooth keyboard all end there.
 */

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => Detector;
  }
}

export function Scanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState<"off" | "starting" | "on" | "denied" | "unavailable">("off");
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (camera !== "starting") return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const canvas = document.createElement("canvas");

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) return setCamera("unavailable");
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      } catch {
        return setCamera("denied");
      }
      if (stopped || !video.current) return;
      video.current.srcObject = stream;
      await video.current.play().catch(() => undefined);
      setCamera("on");
      const native = window.BarcodeDetector ? new window.BarcodeDetector({ formats: ["qr_code", "code_128", "data_matrix", "ean_13"] }) : null;

      const tick = async () => {
        if (stopped || !video.current) return;
        const v = video.current;
        let value: string | null = null;
        if (v.readyState >= 2 && v.videoWidth > 0) {
          if (native) {
            const found = await native.detect(v).catch(() => []);
            value = found[0]?.rawValue ?? null;
          } else {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
              const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
              value = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "dontInvert" })?.data ?? null;
            }
          }
        }
        if (value) {
          stopped = true;
          stream?.getTracks().forEach((t) => t.stop());
          setCamera("off");
          onCode(value);
          return;
        }
        timer = setTimeout(tick, 250);
      };
      tick();
    })();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [camera, onCode]);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-deep-forest">
        <video ref={video} playsInline muted className={camera === "on" ? "h-full w-full object-cover" : "hidden"} />
        {camera !== "on" ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center text-white">
            {camera === "denied" ? <p>Caméra refusée : autorisez-la dans les réglages du navigateur, ou saisissez le code ci-dessous.</p> : null}
            {camera === "unavailable" ? <p>Pas de caméra utilisable sur cet appareil : saisissez le code ci-dessous.</p> : null}
            {camera === "off" || camera === "starting" ? (
              <button type="button" onClick={() => setCamera("starting")} className="h-14 rounded-xl bg-gold px-6 text-base font-semibold text-deep-forest">
                {camera === "starting" ? "Ouverture de la caméra…" : "Lire un code avec la caméra"}
              </button>
            ) : null}
          </div>
        ) : (
          <div className="pointer-events-none absolute inset-10 rounded-xl border-4 border-gold/80" aria-hidden="true" />
        )}
      </div>
      {camera === "on" ? (
        <button type="button" onClick={() => setCamera("off")} className="h-12 rounded-lg border border-border bg-surface text-base">
          Fermer la caméra
        </button>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (typed.trim()) onCode(typed);
          setTyped("");
        }}
        className="flex gap-2"
      >
        <label className="sr-only" htmlFor="code-saisi">
          Code
        </label>
        <input
          id="code-saisi"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Lot, bague, puce, transfert…"
          autoCapitalize="characters"
          autoComplete="off"
          className="h-12 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-base"
        />
        <button type="submit" className="h-12 rounded-lg bg-bio-green px-4 text-base font-semibold text-white">
          Chercher
        </button>
      </form>
      <p className="text-xs text-secondary">Un lecteur RFID appairé en Bluetooth comme un clavier écrit directement dans ce champ.</p>
    </div>
  );
}
