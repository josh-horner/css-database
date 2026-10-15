/** Printable labels: confirmation number (large), school color, CSS branding, and name (docs/domain-model.md). */
export function LabelSheet({ label, count = 12 }: { label: { confirmationNumber: number; name: string; school: string | null; color: string; season: string }; count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 print:gap-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="break-inside-avoid overflow-hidden rounded-lg border-2 border-slate-800">
          <div className="flex items-center justify-between px-3 py-1 text-xs font-bold uppercase tracking-wide text-white print:[print-color-adjust:exact]" style={{ background: label.color }}>
            <span>College Student Storage</span>
            <span>{label.school}</span>
          </div>
          <div className="px-3 py-2 text-center">
            <div className="text-5xl font-black tabular-nums leading-none">{label.confirmationNumber}</div>
            <div className="mt-1 truncate text-sm font-medium">{label.name}</div>
            <div className="text-[10px] uppercase text-slate-500">{label.season}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
