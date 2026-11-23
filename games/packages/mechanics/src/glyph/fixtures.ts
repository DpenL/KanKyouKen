/**
 * Hand-drawn test glyphs made of straight lines in a 1000-unit square. They are NOT
 * taken from any dataset; they only imitate the structure of real characters so that
 * tests across modules can share them.
 */
import { decodeGlyphSet } from "./codec";
import type { ComponentRecord, GlyphRecord, GlyphSetRecord, StrokeRecord } from "./types";

type P = readonly [number, number];

function stroke(type: string, ...pts: P[]): StrokeRecord {
  const path = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join("");
  return [path, pts.flat(), type];
}

/** Scale and move strokes drawn in a 0..1000 square into the box (x, y, w, h). */
function place(strokes: readonly StrokeRecord[], x: number, y: number, w: number, h: number): StrokeRecord[] {
  return strokes.map(([, flat, type]) => {
    const pts: P[] = [];
    for (let i = 0; i < flat.length; i += 2) {
      pts.push([Math.round(x + (flat[i]! * w) / 1000), Math.round(y + (flat[i + 1]! * h) / 1000)]);
    }
    return stroke(type ?? "", ...pts);
  });
}

const TEN = [stroke("㇐", [100, 450], [900, 450]), stroke("㇑", [500, 100], [500, 900])];
const MOUTH = [
  stroke("㇑", [200, 200], [200, 800]),
  stroke("㇕", [200, 200], [800, 200], [800, 800]),
  stroke("㇐", [200, 800], [800, 800]),
];
const TREE = [
  stroke("㇐", [100, 350], [900, 350]),
  stroke("㇑", [500, 100], [500, 900]),
  stroke("㇒", [500, 350], [150, 800]),
  stroke("㇏", [500, 350], [850, 800]),
];
const MOON = [
  stroke("㇓", [250, 100], [250, 600], [150, 900]),
  stroke("㇆", [250, 100], [750, 100], [750, 900], [650, 850]),
  stroke("㇐", [250, 370], [750, 370]),
  stroke("㇐", [250, 630], [750, 630]),
];
const WATER3 = [
  stroke("㇔", [300, 150], [500, 300]),
  stroke("㇔", [200, 400], [400, 550]),
  stroke("㇀", [200, 900], [500, 600]),
];
const ENCLOSURE_OPEN = [stroke("㇑", [100, 100], [100, 900]), stroke("㇕", [100, 100], [900, 100], [900, 900])];
const ENCLOSURE_CLOSE = [stroke("㇐", [100, 900], [900, 900])];

const range = (from: number, count: number): number[] => Array.from({ length: count }, (_, i) => from + i);
const leaf = (e: string, from: number, count: number, extra: Partial<ComponentRecord> = {}): ComponentRecord => ({
  e,
  s: range(from, count),
  ...extra,
});

const glyphs: GlyphRecord[] = [
  { char: "十", strokes: TEN, tree: { s: [0, 1] } },
  { char: "口", strokes: MOUTH, tree: { s: [0, 1, 2] } },
  { char: "木", strokes: TREE, tree: { s: [0, 1, 2, 3] } },
  { char: "月", strokes: MOON, tree: { s: [0, 1, 2, 3] } },
  { char: "氵", strokes: WATER3, tree: { s: [0, 1, 2], o: "水" } },
  {
    char: "古",
    strokes: [...place(TEN, 0, 0, 1000, 550), ...place(MOUTH, 150, 500, 700, 500)],
    tree: { c: [leaf("十", 0, 2, { p: "top" }), leaf("口", 2, 3, { p: "bottom", r: true })] },
  },
  {
    char: "胡",
    strokes: [
      ...place(TEN, 0, 50, 500, 500),
      ...place(MOUTH, 50, 500, 400, 450),
      ...place(MOON, 500, 0, 500, 1000),
    ],
    tree: {
      c: [
        { e: "古", p: "left", c: [leaf("十", 0, 2), leaf("口", 2, 3)] },
        leaf("月", 5, 4, { p: "right", r: true }),
      ],
    },
  },
  {
    char: "沐",
    strokes: [...place(WATER3, 0, 0, 350, 1000), ...place(TREE, 300, 0, 700, 1000)],
    tree: { c: [leaf("氵", 0, 3, { p: "left", o: "水", r: true }), leaf("木", 3, 4, { p: "right" })] },
  },
  {
    char: "困",
    strokes: [...ENCLOSURE_OPEN, ...place(TREE, 250, 250, 500, 500), ...ENCLOSURE_CLOSE],
    tree: {
      c: [
        leaf("囗", 0, 2, { p: "enclosure", n: 1, r: true }),
        leaf("木", 2, 4, { p: "inside" }),
        leaf("囗", 6, 1, { p: "enclosure", n: 2 }),
      ],
    },
  },
  {
    char: "林",
    strokes: [...place(TREE, 0, 0, 500, 1000), ...place(TREE, 500, 0, 500, 1000)],
    tree: { c: [leaf("木", 0, 4, { p: "left", r: true }), leaf("木", 4, 4, { p: "right" })] },
  },
];

export const FIXTURE_SET: GlyphSetRecord = {
  format: "kankyouken-glyphs",
  version: 1,
  script: "ja",
  size: 1000,
  pathKind: "centerline",
  source: {
    name: "fixtures",
    license: "MIT",
    attribution: "Synthetic test shapes, KanKyouKen contributors",
    url: "about:blank",
  },
  glyphs,
};

/** Decoded fixture glyphs by character: 十 口 木 月 氵 古 胡 沐 困 林. */
export const FIXTURES = decodeGlyphSet(FIXTURE_SET);

export function fixture(char: string) {
  const glyph = FIXTURES.get(char);
  if (!glyph) throw new Error(`no fixture glyph for ${char}`);
  return glyph;
}
