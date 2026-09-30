// Mirrors api/util.py format_inr so live (client-side) TLC math renders the
// same way the server-rendered board does.
export function formatINR(value: number | null | undefined, symbol = "₹"): string {
  if (value == null || isNaN(value)) return "—";
  const v = Number(value);
  if (v >= 1_00_00_000) return `${symbol}${(v / 1_00_00_000).toFixed(2)} Cr`;
  if (v >= 1_00_000) return `${symbol}${(v / 1_00_000).toFixed(2)} L`;
  if (v >= 1_000) return `${symbol}${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  return `${symbol}${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export const GST_RATE = 0.18;

// Total landed cost: unit*qty + tooling + freight, + 18% GST if included.
export function computeTLC(
  unit: number,
  qty: number,
  tooling: number,
  freight: number,
  gstIncluded: boolean,
): number {
  const subtotal = unit * qty + tooling + freight;
  return gstIncluded ? subtotal * (1 + GST_RATE) : subtotal;
}

export function deadlineLabel(days: number | null | undefined): string {
  if (days == null) return "No fixed deadline";
  if (days <= 0) return "Closes today";
  if (days === 1) return "1 day left";
  return `${days} days left`;
}
