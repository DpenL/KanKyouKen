/**
 * A small SVG path-data toolkit for the glyph build: just enough to read the centre-line
 * paths of a stroke dataset, turn them into polylines and write them back rescaled.
 *
 * Written from the SVG path grammar, not taken from any library or dataset. Elliptical
 * arcs (A/a) are deliberately not supported: no stroke source we convert uses them, and
 * an unsupported command is reported rather than guessed at.
 */

import { distanceToSegment } from "@kankyouken/mechanics/util";
import type { Point } from "@kankyouken/mechanics/util";

export type PathCommand =
  | "M" | "m" | "L" | "l" | "H" | "h" | "V" | "v"
  | "C" | "c" | "S" | "s" | "Q" | "q" | "T" | "t" | "Z" | "z";

/** One command with the arguments of ONE repetition, exactly as written (relative stays relative). */
export interface PathSegment {
  readonly command: PathCommand;
  readonly args: readonly number[];
}

/** A path reduced to the five absolute commands that are enough to draw anything we read. */
export type AbsoluteSegment =
  | { readonly command: "M"; readonly to: Point }
  | { readonly command: "L"; readonly to: Point }
  | { readonly command: "C"; readonly c1: Point; readonly c2: Point; readonly to: Point }
  | { readonly command: "Q"; readonly c1: Point; readonly to: Point }
  | { readonly command: "Z" };

const ARITY: Readonly<Record<PathCommand, number>> = {
  M: 2, m: 2, L: 2, l: 2, H: 1, h: 1, V: 1, v: 1,
  C: 6, c: 6, S: 4, s: 4, Q: 4, q: 4, T: 2, t: 2, Z: 0, z: 0,
};

const isCommand = (ch: string): ch is PathCommand => Object.hasOwn(ARITY, ch);

/**
 * Split path data into commands.
 *
 * Supports M L H V C S Q T Z in both cases. Implicit repetitions are expanded into one
 * segment each ("L1,2 3,4" is two L segments); extra coordinate pairs after a moveto
 * become linetos, as the SVG grammar says. Numbers may run together ("1.5-2" is 1.5 and
 * -2, "1.5.5" is 1.5 and 0.5) and may carry an exponent ("3e-1").
 *
 * Edge cases: an empty or blank string gives an empty list. Anything else must start
 * with a moveto. An unknown command (including the arc command A), a number before the
 * first command, arguments after Z, or an argument count that does not fill the last
 * repetition throws an Error naming the offending position.
 */
export function parsePath(d: string): PathSegment[] {
  const out: PathSegment[] = [];
  const number = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
  const separators = /[\s,]*/y;
  let i = 0;
  const skip = (): void => {
    separators.lastIndex = i;
    separators.exec(d);
    i = separators.lastIndex;
  };
  const readNumber = (): number | undefined => {
    skip();
    number.lastIndex = i;
    const m = number.exec(d);
    if (!m) return undefined;
    i = number.lastIndex;
    return Number(m[0]);
  };

  skip();
  while (i < d.length) {
    const ch = d[i]!;
    if (!isCommand(ch)) {
      throw new Error(`parsePath: unsupported command or stray character ${JSON.stringify(ch)} at offset ${i}`);
    }
    if (out.length === 0 && ch !== "M" && ch !== "m") {
      throw new Error(`parsePath: path data must start with a moveto, found ${JSON.stringify(ch)}`);
    }
    i++;
    const arity = ARITY[ch];
    if (arity === 0) {
      out.push({ command: ch, args: [] });
      skip();
      continue;
    }
    let repetition = 0;
    for (;;) {
      const args: number[] = [];
      for (let k = 0; k < arity; k++) {
        const v = readNumber();
        if (v === undefined) break;
        args.push(v);
      }
      if (args.length === 0 && repetition > 0) break;
      if (args.length !== arity) {
        throw new Error(`parsePath: command ${ch} needs ${arity} numbers per repetition, got ${args.length} near offset ${i}`);
      }
      const command: PathCommand = repetition === 0 ? ch : ch === "M" ? "L" : ch === "m" ? "l" : ch;
      out.push({ command, args });
      repetition++;
    }
    skip();
  }
  return out;
}

/**
 * Resolve every command to absolute coordinates and reduce the command set to M, L, C,
 * Q and Z: H and V become L, S and T get their reflected control point written out.
 *
 * Follows the SVG rules for the corner cases: a relative moveto at the very start is
 * absolute; S (or T) that does not follow a cubic (or quadratic) command uses the
 * current point as its first control point; after Z the current point is the start of
 * the subpath that was closed. An empty list gives an empty list.
 */
export function toAbsolute(segments: readonly PathSegment[]): AbsoluteSegment[] {
  const out: AbsoluteSegment[] = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let cubicControl: Point | undefined;
  let quadControl: Point | undefined;

  for (const { command, args } of segments) {
    const relative = command === command.toLowerCase();
    const ox = relative ? x : 0;
    const oy = relative ? y : 0;
    const a = (k: number): number => args[k] ?? 0;
    let nextCubic: Point | undefined;
    let nextQuad: Point | undefined;

    switch (command) {
      case "M":
      case "m":
        x = ox + a(0);
        y = oy + a(1);
        startX = x;
        startY = y;
        out.push({ command: "M", to: { x, y } });
        break;
      case "L":
      case "l":
        x = ox + a(0);
        y = oy + a(1);
        out.push({ command: "L", to: { x, y } });
        break;
      case "H":
      case "h":
        x = ox + a(0);
        out.push({ command: "L", to: { x, y } });
        break;
      case "V":
      case "v":
        y = oy + a(0);
        out.push({ command: "L", to: { x, y } });
        break;
      case "C":
      case "c": {
        const c1 = { x: ox + a(0), y: oy + a(1) };
        const c2 = { x: ox + a(2), y: oy + a(3) };
        x = ox + a(4);
        y = oy + a(5);
        out.push({ command: "C", c1, c2, to: { x, y } });
        nextCubic = c2;
        break;
      }
      case "S":
      case "s": {
        const c1 = cubicControl ? { x: 2 * x - cubicControl.x, y: 2 * y - cubicControl.y } : { x, y };
        const c2 = { x: ox + a(0), y: oy + a(1) };
        x = ox + a(2);
        y = oy + a(3);
        out.push({ command: "C", c1, c2, to: { x, y } });
        nextCubic = c2;
        break;
      }
      case "Q":
      case "q": {
        const c1 = { x: ox + a(0), y: oy + a(1) };
        x = ox + a(2);
        y = oy + a(3);
        out.push({ command: "Q", c1, to: { x, y } });
        nextQuad = c1;
        break;
      }
      case "T":
      case "t": {
        const c1 = quadControl ? { x: 2 * x - quadControl.x, y: 2 * y - quadControl.y } : { x, y };
        x = ox + a(0);
        y = oy + a(1);
        out.push({ command: "Q", c1, to: { x, y } });
        nextQuad = c1;
        break;
      }
      case "Z":
      case "z":
        x = startX;
        y = startY;
        out.push({ command: "Z" });
        break;
    }
    cubicControl = nextCubic;
    quadControl = nextQuad;
  }
  return out;
}

const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;

/**
 * Turn path data into one polyline per subpath. Straight commands contribute their end
 * point, every curve contributes `samplesPerCurve` points at equal parameter steps (its
 * end point included), and Z walks back to the start of its subpath. Points that repeat
 * the previous one exactly are dropped, so a zero-length command adds nothing.
 *
 * Edge cases: empty path data gives no subpaths; a lone moveto gives a one-point
 * subpath. `samplesPerCurve` must be an integer of at least 1 (RangeError otherwise).
 */
export function flattenSubpaths(d: string, samplesPerCurve = 16): Point[][] {
  if (!Number.isInteger(samplesPerCurve) || samplesPerCurve < 1) {
    throw new RangeError(`flatten: samplesPerCurve must be an integer >= 1, got ${samplesPerCurve}`);
  }
  const subpaths: Point[][] = [];
  let line: Point[] | undefined;
  let start: Point = { x: 0, y: 0 };
  let cur: Point = start;
  const push = (p: Point): void => {
    if (!line) {
      line = [cur];
      subpaths.push(line);
    }
    if (!samePoint(line[line.length - 1]!, p)) line.push(p);
    cur = p;
  };

  for (const seg of toAbsolute(parsePath(d))) {
    switch (seg.command) {
      case "M":
        line = [seg.to];
        subpaths.push(line);
        start = seg.to;
        cur = seg.to;
        break;
      case "L":
        push(seg.to);
        break;
      case "C": {
        const p0 = cur;
        for (let k = 1; k <= samplesPerCurve; k++) {
          const t = k / samplesPerCurve;
          const u = 1 - t;
          const b0 = u * u * u;
          const b1 = 3 * u * u * t;
          const b2 = 3 * u * t * t;
          const b3 = t * t * t;
          push(
            k === samplesPerCurve
              ? seg.to
              : {
                  x: b0 * p0.x + b1 * seg.c1.x + b2 * seg.c2.x + b3 * seg.to.x,
                  y: b0 * p0.y + b1 * seg.c1.y + b2 * seg.c2.y + b3 * seg.to.y,
                },
          );
        }
        break;
      }
      case "Q": {
        const p0 = cur;
        for (let k = 1; k <= samplesPerCurve; k++) {
          const t = k / samplesPerCurve;
          const u = 1 - t;
          push(
            k === samplesPerCurve
              ? seg.to
              : {
                  x: u * u * p0.x + 2 * u * t * seg.c1.x + t * t * seg.to.x,
                  y: u * u * p0.y + 2 * u * t * seg.c1.y + t * t * seg.to.y,
                },
          );
        }
        break;
      }
      case "Z":
        push(start);
        line = undefined;
        break;
    }
  }
  return subpaths;
}

/**
 * Turn path data into a single polyline in drawing direction; see `flattenSubpaths` for
 * the sampling rules. A path with several subpaths is read as one pen movement: the
 * subpaths are joined in order (a stroke's centre line never lifts the pen, so for our
 * sources the jump does not occur). Empty path data gives an empty polyline.
 */
export function flatten(d: string, samplesPerCurve = 16): Point[] {
  const out: Point[] = [];
  for (const line of flattenSubpaths(d, samplesPerCurve)) {
    for (const p of line) {
      const last = out[out.length - 1];
      if (!last || !samePoint(last, p)) out.push(p);
    }
  }
  return out;
}

/**
 * Ramer-Douglas-Peucker simplification: keep the first and last point, and of the
 * points in between only those that lie farther than `epsilon` from the simplified
 * line. Distances are measured to the SEGMENT between the kept neighbours, so a closed
 * loop (first point equals last) keeps its far side instead of collapsing.
 *
 * Edge cases: lines of up to two points are returned as a copy; `epsilon` of 0 removes
 * only points that lie exactly on the line; a negative or non-finite `epsilon` throws a
 * RangeError.
 */
export function simplify(polyline: readonly Point[], epsilon: number): Point[] {
  if (!(epsilon >= 0) || !Number.isFinite(epsilon)) {
    throw new RangeError(`simplify: epsilon must be a finite number >= 0, got ${epsilon}`);
  }
  if (polyline.length <= 2) return [...polyline];
  const keep = new Array<boolean>(polyline.length).fill(false);
  keep[0] = true;
  keep[polyline.length - 1] = true;
  const pending: [number, number][] = [[0, polyline.length - 1]];
  while (pending.length > 0) {
    const [from, to] = pending.pop()!;
    const a = polyline[from]!;
    const b = polyline[to]!;
    let farthest = -1;
    let worst = epsilon;
    for (let k = from + 1; k < to; k++) {
      const dist = distanceToSegment(polyline[k]!, a, b);
      if (dist > worst) {
        worst = dist;
        farthest = k;
      }
    }
    if (farthest !== -1) {
      keep[farthest] = true;
      pending.push([from, farthest], [farthest, to]);
    }
  }
  return polyline.filter((_, k) => keep[k]);
}

/**
 * Write a number with at most `decimals` decimal places, without trailing zeros and
 * without a negative zero.
 */
export function formatNumber(value: number, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new RangeError(`formatNumber: decimals must be an integer >= 0, got ${decimals}`);
  }
  if (!Number.isFinite(value)) throw new RangeError(`formatNumber: cannot write ${value}`);
  const k = 10 ** decimals;
  const rounded = Math.round(value * k) / k;
  return rounded === 0 ? "0" : String(rounded);
}

/**
 * Write absolute segments back as compact path data: command letters with
 * comma-separated numbers and no whitespace ("M10,20C30,40,50,60,70,80Z").
 */
export function formatPath(segments: readonly AbsoluteSegment[], decimals: number): string {
  const n = (v: number): string => formatNumber(v, decimals);
  const xy = (p: Point): string => `${n(p.x)},${n(p.y)}`;
  let out = "";
  for (const seg of segments) {
    switch (seg.command) {
      case "M":
      case "L":
        out += seg.command + xy(seg.to);
        break;
      case "C":
        out += `C${xy(seg.c1)},${xy(seg.c2)},${xy(seg.to)}`;
        break;
      case "Q":
        out += `Q${xy(seg.c1)},${xy(seg.to)}`;
        break;
      case "Z":
        out += "Z";
        break;
    }
  }
  return out;
}

/**
 * Re-emit path data multiplied by `scale` about the origin, as an absolute path (only
 * M L C Q Z, see `toAbsolute`) whose numbers are rounded to at most `decimals` places.
 * Each number is rounded on its own from the exact absolute value, so rounding errors
 * do not accumulate along the path the way they would with relative commands.
 *
 * Edge cases: empty path data gives an empty string; a non-finite scale or a negative
 * or fractional `decimals` throws a RangeError; unsupported path data throws as in
 * `parsePath`.
 */
export function transformPath(d: string, scale: number, decimals: number): string {
  if (!Number.isFinite(scale)) throw new RangeError(`transformPath: scale must be finite, got ${scale}`);
  const k = (p: Point): Point => ({ x: p.x * scale, y: p.y * scale });
  const scaled = toAbsolute(parsePath(d)).map((seg): AbsoluteSegment => {
    switch (seg.command) {
      case "M":
      case "L":
        return { command: seg.command, to: k(seg.to) };
      case "C":
        return { command: "C", c1: k(seg.c1), c2: k(seg.c2), to: k(seg.to) };
      case "Q":
        return { command: "Q", c1: k(seg.c1), to: k(seg.to) };
      case "Z":
        return seg;
    }
  });
  return formatPath(scaled, decimals);
}
