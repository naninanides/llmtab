/** StyleGuide §7 formatting rules. */

export function compact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e9) return trim(n / 1e9) + "B";
  if (abs >= 1e6) return trim(n / 1e6) + "M";
  if (abs >= 1e3) return trim(n / 1e3) + "K";
  return String(Math.round(n));
}

function trim(v: number): string {
  const s = v >= 100 ? Math.round(v).toString() : v.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

export function cost(n: number, opts: { est?: boolean } = {}): string {
  const prefix = opts.est ? "~$" : "$";
  if (n === 0) return prefix + "0";
  if (n < 10) {
    // < $10 → 2–3 sig decimals
    const s = n.toFixed(n < 0.1 ? 4 : n < 1 ? 3 : 2);
    return prefix + s.replace(/0+$/, "").replace(/\.$/, "");
  }
  if (n >= 1000) return prefix + Math.round(n).toLocaleString("en-US");
  return prefix + n.toFixed(2);
}

export function percent(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  const p = (part / whole) * 100;
  const s = p >= 10 ? p.toFixed(0) : p.toFixed(1);
  return (s.endsWith(".0") ? s.slice(0, -2) : s) + "%";
}

export function dayLabel(isoDay: string): string {
  const d = new Date(isoDay + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function shortDayLabel(isoDay: string): string {
  const d = new Date(isoDay + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
