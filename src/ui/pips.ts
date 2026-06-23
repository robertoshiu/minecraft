/** A single pip's fill state. */
export type Fill = "full" | "half" | "empty";
/**
 * Decompose a stat `value` into `pips` fill states, each pip covering
 * `pointsPerPip` points: >= full threshold → full, >= half → half, else empty.
 */
export function pipFills(value: number, pips: number, pointsPerPip: number): Fill[] {
  const fills: Fill[] = [];
  for (let i = 0; i < pips; i++) {
    const base = i * pointsPerPip;
    if (value >= base + pointsPerPip) fills.push("full");
    else if (value >= base + 1) fills.push("half");
    else fills.push("empty");
  }
  return fills;
}
