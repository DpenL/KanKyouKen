/**
 * Minimum-cost one-to-one assignment (the Hungarian method, O(n^3)).
 *
 * `cost[r][c]` is the cost of pairing row r with column c; the matrix may be
 * rectangular. Returns, for every row, the column it is paired with, or -1 when there
 * are more rows than columns and the row is left over. The pairing minimises the total
 * cost over min(rows, columns) pairs.
 *
 * Throws a RangeError when rows differ in length or a cost is not a finite number: with
 * NaN or an all-infinite row the search below would never end.
 */
export function minCostAssignment(cost: readonly (readonly number[])[]): number[] {
  const rows = cost.length;
  const cols = rows === 0 ? 0 : cost[0]!.length;
  for (const row of cost) {
    if (row.length !== cols) throw new RangeError("minCostAssignment: rows differ in length");
    for (const value of row) {
      if (!Number.isFinite(value)) throw new RangeError("minCostAssignment: costs must be finite numbers");
    }
  }
  if (rows === 0 || cols === 0) return new Array<number>(rows).fill(-1);
  // The algorithm needs rows <= columns; transpose when that is not the case.
  if (rows > cols) {
    const transposed = Array.from({ length: cols }, (_, c) => cost.map((row) => row[c]!));
    const byColumn = minCostAssignment(transposed);
    const out = new Array<number>(rows).fill(-1);
    byColumn.forEach((r, c) => {
      if (r >= 0) out[r] = c;
    });
    return out;
  }
  const u = new Array<number>(rows + 1).fill(0);
  const v = new Array<number>(cols + 1).fill(0);
  const match = new Array<number>(cols + 1).fill(0); // match[c] = row (1-based) paired with column c
  const way = new Array<number>(cols + 1).fill(0);
  for (let r = 1; r <= rows; r++) {
    match[0] = r;
    let c0 = 0;
    const minv = new Array<number>(cols + 1).fill(Infinity);
    const used = new Array<boolean>(cols + 1).fill(false);
    do {
      used[c0] = true;
      const r0 = match[c0]!;
      let delta = Infinity;
      let c1 = 0;
      for (let c = 1; c <= cols; c++) {
        if (used[c]) continue;
        const cur = cost[r0 - 1]![c - 1]! - u[r0]! - v[c]!;
        if (cur < minv[c]!) {
          minv[c] = cur;
          way[c] = c0;
        }
        if (minv[c]! < delta) {
          delta = minv[c]!;
          c1 = c;
        }
      }
      for (let c = 0; c <= cols; c++) {
        if (used[c]) {
          u[match[c]!]! += delta;
          v[c]! -= delta;
        } else {
          minv[c]! -= delta;
        }
      }
      c0 = c1;
    } while (match[c0] !== 0);
    do {
      const c1 = way[c0]!;
      match[c0] = match[c1]!;
      c0 = c1;
    } while (c0 !== 0);
  }
  const out = new Array<number>(rows).fill(-1);
  for (let c = 1; c <= cols; c++) if (match[c]! > 0) out[match[c]! - 1] = c - 1;
  return out;
}
