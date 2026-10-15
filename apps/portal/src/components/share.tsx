"use client";
/** Referral sharing: native share sheet plus direct buttons for the platforms families use; each link carries ?via=. */
import { useState } from "react";
import { Button } from "@css/ui/kit";

const PLATFORMS = [
  { via: "sms", label: "Text", href: (text: string) => `sms:?&body=${encodeURIComponent(text)}` },
  { via: "whatsapp", label: "WhatsApp", href: (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}` },
  { via: "facebook", label: "Facebook", href: (_: string, link: string) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}` },
  { via: "email", label: "Email", href: (text: string) => `mailto:?subject=${encodeURIComponent("College Student Storage")}&body=${encodeURIComponent(text)}` },
] as const;

export function ShareReferral({ link, text }: { link: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const withVia = (via: string) => `${link}&via=${via}`;
  const textFor = (via: string) => text.replace(link, withVia(via));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {typeof navigator !== "undefined" && "share" in navigator && (
          <Button size="sm" onClick={() => navigator.share({ text: textFor("share"), url: withVia("share") }).catch(() => {})}>
            Share…
          </Button>
        )}
        {PLATFORMS.map((p) => (
          <a key={p.via} href={p.href(textFor(p.via), withVia(p.via))} target="_blank" rel="noreferrer" className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-slate-50">
            {p.label}
          </a>
        ))}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard.writeText(withVia("copy"));
            setCopied(true);
          }}
        >
          {copied ? "Copied!" : "Copy link"}
        </Button>
      </div>
      <p className="break-all text-xs text-slate-500">{link}</p>
    </div>
  );
}

/** An .ics file for an appointment (add to calendar). */
export function icsFor(appts: { type: string; date: string; window: string; address: string }[], confirmationNumber: number | null) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CSS//Booking//EN"];
  for (const a of appts) {
    const d = a.date.replace(/-/g, "");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${d}-${a.type}-${confirmationNumber}@csstorage.com`,
      `DTSTART;VALUE=DATE:${d}`,
      `SUMMARY:CSS ${a.type} (#${confirmationNumber})`,
      `DESCRIPTION:${a.window}. Label everything with #${confirmationNumber}.`,
      `LOCATION:${a.address.replace(/,/g, "\\,")}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
