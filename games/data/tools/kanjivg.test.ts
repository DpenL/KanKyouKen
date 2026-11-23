import { describe, expect, it } from "vitest";
import { decodeGlyph, segmentUnits } from "@kankyouken/mechanics/glyph";
import type { GlyphSetRecord } from "@kankyouken/mechanics/glyph";
import { distanceToPolyline } from "@kankyouken/mechanics/util";
import type { Point } from "@kankyouken/mechanics/util";
import {
  KANJIVG_SIZE,
  kanjiVGFileName,
  mapKanjiVGPosition,
  parseKanjiVG,
  strokeMedian,
  treeElements,
} from "./kanjivg";
import { flatten } from "./svg-path";

/**
 * A document in KanjiVG's layout around the given stroke groups. Every shape in this
 * file is invented for the tests (straight lines and round numbers); nothing is taken
 * from KanjiVG itself.
 */
function kvgFile(body: string, hex = "0ffff"): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
Hand-written test document. Tags inside a comment are not strokes:
<g id="kvg:StrokePaths_comment"><path d="M1,1L2,2"/></g>
-->
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.0//EN" "http://www.w3.org/TR/2001/REC-SVG-20010904/DTD/svg10.dtd" [
<!ATTLIST g
xmlns:kvg CDATA #FIXED "http://kanjivg.tagaini.net"
kvg:element CDATA #IMPLIED
kvg:position CDATA #IMPLIED >
<!ATTLIST path
xmlns:kvg CDATA #FIXED "http://kanjivg.tagaini.net"
kvg:type CDATA #IMPLIED >
]>
<svg xmlns="http://www.w3.org/2000/svg" width="109" height="109" viewBox="0 0 109 109">
<g id="kvg:StrokePaths_${hex}" style="fill:none;stroke:#000000;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;">
${body}
</g>
<g id="kvg:StrokeNumbers_${hex}" style="font-size:8;fill:#808080">
	<text transform="matrix(1 0 0 1 10 20)">1</text>
	<path id="not-a-stroke" d="M0,0L109,109"/>
</g>
</svg>
`;
}

/** Person on the left, tree on the right: the shape of 休. */
const REST = kvgFile(
  `<g id="kvg:04f11" kvg:element="休">
	<g id="kvg:04f11-g1" kvg:element="亻" kvg:variant="true" kvg:original="人" kvg:position="left" kvg:radical="general">
		<path id="kvg:04f11-s1" kvg:type="㇒" d="M30,10c-2,8-8,18-16,26"/>
		<path id="kvg:04f11-s2" kvg:type="㇑" d="M22,30v60"/>
	</g>
	<g id="kvg:04f11-g2" kvg:element="木" kvg:position="right">
		<path id="kvg:04f11-s3" kvg:type="㇐" d="M40,40h56"/>
		<path id="kvg:04f11-s4" kvg:type="㇑" d="M68,12V96"/>
		<path id="kvg:04f11-s5" kvg:type="㇒" d="M68,40C60,58,50,70,38,80"/>
		<path id="kvg:04f11-s6" kvg:type="㇔/㇏" d="M68,40c8,16,18,28,30,38"/>
	</g>
</g>`,
  "04f11",
);

/** A box written in two runs around a tree: the shape of 困. */
const TROUBLE = kvgFile(
  `<g id="kvg:056f0" kvg:element="困">
	<g id="kvg:056f0-g1" kvg:element="囗" kvg:part="1" kvg:position="kamae" kvg:radical="general">
		<path id="kvg:056f0-s1" kvg:type="㇑" d="M20,15V95"/>
		<path id="kvg:056f0-s2" kvg:type="㇕a" d="M20,15H90V95"/>
	</g>
	<g id="kvg:056f0-g2" kvg:element="木">
		<path id="kvg:056f0-s3" kvg:type="㇐" d="M32,40H78"/>
		<path id="kvg:056f0-s4" kvg:type="㇑" d="M55,25V82"/>
		<path id="kvg:056f0-s5" kvg:type="㇒" d="M55,40L34,70"/>
		<path id="kvg:056f0-s6" kvg:type="㇏" d="M55,40L76,70"/>
	</g>
	<g id="kvg:056f0-g3" kvg:element="囗" kvg:part="2" kvg:position="kamae" kvg:radical="general">
		<path id="kvg:056f0-s7" kvg:type="㇐a" d="M20,95H90"/>
	</g>
</g>`,
  "056f0",
);

const SET: Pick<GlyphSetRecord, "script" | "size" | "pathKind" | "source"> = {
  script: "ja",
  size: 1000,
  pathKind: "centerline",
  source: { name: "test", license: "MIT", attribution: "invented shapes", url: "about:blank" },
};

const k = 1000 / KANJIVG_SIZE;
const r = (v: number): number => Math.round(v * k);

describe("kanjiVGFileName", () => {
  it("is the code point as five lowercase hex digits", () => {
    expect(kanjiVGFileName("困")).toBe("056f0.svg");
    expect(kanjiVGFileName("A")).toBe("00041.svg");
    expect(kanjiVGFileName("⻌")).toBe("02ecc.svg");
    expect(kanjiVGFileName("𠂉")).toBe("20089.svg");
  });

  it("rejects anything but one character", () => {
    expect(() => kanjiVGFileName("")).toThrow(/one character/);
    expect(() => kanjiVGFileName("木木")).toThrow(/one character/);
  });
});

describe("mapKanjiVGPosition", () => {
  it("passes the plain positions through", () => {
    for (const label of ["left", "right", "top", "bottom", "middle"] as const) {
      expect(mapKanjiVGPosition(label)).toBe(label);
    }
  });

  it("maps every wrapping label to enclosure", () => {
    for (const label of ["kamae", "tare", "nyo", "kamae2", "⿵A", "⿶1", "⿴"]) {
      expect(mapKanjiVGPosition(label)).toBe("enclosure");
    }
  });

  it("maps the content of a wrap to inside", () => {
    for (const label of ["kamaec", "tarec", "nyoc", "⿵B", "⿶2"]) {
      expect(mapKanjiVGPosition(label)).toBe("inside");
    }
  });

  it("maps anything unknown to other", () => {
    for (const label of ["", "centre", "Left", "⿰A", "c"]) expect(mapKanjiVGPosition(label)).toBe("other");
  });
});

describe("strokeMedian", () => {
  it("gives the two end points of a straight stroke, in writing direction", () => {
    expect(strokeMedian("M22,30v60", 1, 0.5, 14)).toEqual([22, 30, 22, 90]);
    expect(strokeMedian("M22,90V30", 1, 0.5, 14)).toEqual([22, 90, 22, 30]);
    expect(strokeMedian("M22,30v60", k, 4, 14)).toEqual([r(22), r(30), r(22), r(90)]);
  });

  it("keeps corners and both end points", () => {
    expect(strokeMedian("M20,15H90V95", 1, 0.5, 14)).toEqual([20, 15, 90, 15, 90, 95]);
  });

  it("follows a curve to within the tolerance, with integer coordinates", () => {
    const d = "M10,100C10,40,40,10,100,10";
    const epsilon = 4;
    const flat = strokeMedian(d, 10, epsilon, 100);
    expect(flat.every(Number.isInteger)).toBe(true);
    expect(flat.slice(0, 2)).toEqual([100, 1000]);
    expect(flat.slice(-2)).toEqual([1000, 100]);
    expect(flat.length / 2).toBeGreaterThan(3);
    expect(flat.length / 2).toBeLessThan(30);
    const median: Point[] = [];
    for (let i = 0; i < flat.length; i += 2) median.push({ x: flat[i]!, y: flat[i + 1]! });
    // Tolerance, plus what rounding can add (half a unit diagonally) and the sag of the sampled chords.
    for (const pt of flatten(d, 200)) {
      expect(distanceToPolyline({ x: pt.x * 10, y: pt.y * 10 }, median)).toBeLessThanOrEqual(epsilon + Math.SQRT1_2 + 0.25);
    }
  });

  it("widens the tolerance until the point limit holds", () => {
    const arc = "M10,100C10,40,40,10,100,10";
    const free = strokeMedian(arc, 10, 4, 100);
    const capped = strokeMedian(arc, 10, 4, 14);
    expect(free.length / 2).toBeGreaterThan(14);
    expect(capped.length / 2).toBeLessThanOrEqual(14);
    expect(capped.slice(0, 2)).toEqual(free.slice(0, 2));
    expect(capped.slice(-2)).toEqual(free.slice(-2));

    const zigzag = `M0,50${Array.from({ length: 20 }, (_, i) => `L${(i + 1) * 5},${i % 2 === 0 ? 60 : 40}`).join("")}`;
    expect(strokeMedian(zigzag, 1, 0.5, 100)).toHaveLength(42);
    for (const limit of [14, 5, 2]) {
      const flat = strokeMedian(zigzag, 1, 0.5, limit);
      expect(flat.length / 2).toBeLessThanOrEqual(limit);
      expect(flat.slice(0, 2)).toEqual([0, 50]);
      expect(flat.slice(-2)).toEqual([100, 40]);
    }
    expect(strokeMedian(zigzag, 1, 0.5, 0)).toEqual([0, 50, 100, 40]);
  });

  it("drops points that round onto their predecessor", () => {
    expect(strokeMedian("M10,10L10.2,10.1L50,10", 1, 0, 14)).toEqual([10, 10, 50, 10]);
  });

  it("nudges a stroke that collapses to one spot into two points one unit apart", () => {
    expect(strokeMedian("M50,50", 1, 0.5, 14)).toEqual([50, 50, 51, 50]);
    expect(strokeMedian("M50,50l0.1,0.3", 1, 0.5, 14)).toEqual([50, 50, 50, 51]);
    expect(strokeMedian("M50,50l-0.3,0.1", 1, 0.5, 14)).toEqual([50, 50, 49, 50]);
    expect(strokeMedian("M50,50l0.1,-0.3", 1, 0.5, 14)).toEqual([50, 50, 50, 49]);
  });

  it("keeps a closed loop open enough to have a direction", () => {
    const flat = strokeMedian("M10,10H30V30H10Z", 1, 0.5, 14);
    expect(flat).toEqual([10, 10, 30, 10, 30, 30, 10, 30, 10, 10]);
  });

  it("refuses path data without a point", () => {
    expect(() => strokeMedian("", 1, 0.5, 14)).toThrow(/no points/);
  });
});

describe("parseKanjiVG", () => {
  it("converts a left-right character", () => {
    const record = parseKanjiVG(REST, "休");
    expect(record.char).toBe("休");
    expect(record.strokes).toHaveLength(6);
    expect(record.tree).toEqual({
      c: [
        { e: "亻", o: "人", p: "left", r: true, s: [0, 1] },
        { e: "木", p: "right", s: [2, 3, 4, 5] },
      ],
    });
  });

  it("scales paths to 1000 units with at most one decimal and keeps the stroke type", () => {
    const { strokes } = parseKanjiVG(REST, "休");
    expect(strokes[1]).toEqual(["M201.8,275.2L201.8,825.7", [r(22), r(30), r(22), r(90)], "㇑"]);
    expect(strokes[2]![0]).toBe("M367,367L880.7,367");
    expect(strokes[5]![2]).toBe("㇔/㇏");
    for (const [path] of strokes) {
      expect(path).toMatch(/^M[0-9.,LCQZ-]+$/);
      expect(path).not.toMatch(/\.\d\d/);
    }
  });

  it("extracts medians that start where the pen lands and stay inside the square", () => {
    const { strokes } = parseKanjiVG(REST, "休");
    expect(strokes[0]![1].slice(0, 2)).toEqual([r(30), r(10)]);
    expect(strokes[0]![1].slice(-2)).toEqual([r(14), r(36)]);
    for (const [, median] of strokes) {
      expect(median.length).toBeGreaterThanOrEqual(4);
      expect(median.length % 2).toBe(0);
      expect(median.every((v) => Number.isInteger(v) && v >= 0 && v <= 1000)).toBe(true);
    }
  });

  it("honours size, tolerance and point limit", () => {
    const same = parseKanjiVG(REST, "休", { size: KANJIVG_SIZE });
    expect(same.strokes[1]).toEqual(["M22,30L22,90", [22, 30, 22, 90], "㇑"]);
    expect(same.strokes[4]![0]).toBe("M68,40C60,58,50,70,38,80");

    const curve = parseKanjiVG(REST, "休").strokes[4]![1];
    const loose = parseKanjiVG(REST, "休", { medianEpsilon: 200 }).strokes[4]![1];
    const capped = parseKanjiVG(REST, "休", { medianEpsilon: 0, maxMedianPoints: 3 }).strokes[4]![1];
    expect(curve.length).toBeGreaterThan(4);
    expect(loose).toEqual([r(68), r(40), r(38), r(80)]);
    expect(capped.length).toBeLessThanOrEqual(6);
    expect(capped.slice(0, 2)).toEqual([r(68), r(40)]);
  });

  it("marks enclosure parts, numbers their runs and puts the unlabelled sibling inside", () => {
    expect(parseKanjiVG(TROUBLE, "困").tree).toEqual({
      c: [
        { e: "囗", p: "enclosure", pd: "kamae", r: true, n: 1, s: [0, 1] },
        { e: "木", p: "inside", s: [2, 3, 4, 5] },
        { e: "囗", p: "enclosure", pd: "kamae", r: true, n: 2, s: [6] },
      ],
    });
  });

  it("produces records the glyph decoder accepts and the unit segmenter understands", () => {
    const glyph = decodeGlyph(parseKanjiVG(TROUBLE, "困"), SET);
    expect(glyph.root.element).toBe("困");
    expect(glyph.root.strokes).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(segmentUnits(glyph).map((u) => [u.component, u.strokes, u.offset])).toEqual([
      ["囗", [0, 1], 0],
      ["木", [2, 3, 4, 5], 0],
      ["囗", [6], 2],
    ]);
    const rest = decodeGlyph(parseKanjiVG(REST, "休"), SET);
    expect(segmentUnits(rest).map((u) => u.component)).toEqual(["亻", "木"]);
    expect(rest.strokes[3]!.median[0]).toEqual({ x: r(68), y: r(12) });
  });

  it("labels wrap contents that KanjiVG marks itself and keeps the raw label", () => {
    const svg = kvgFile(`<g id="kvg:x" kvg:element="返">
	<g id="kvg:x-g1" kvg:element="反" kvg:position="nyoc" kvg:phon="反">
		<path id="kvg:x-s1" d="M40,20H80"/>
	</g>
	<g id="kvg:x-g2" kvg:element="⻌" kvg:original="辶" kvg:position="nyo" kvg:radical="general">
		<path id="kvg:x-s2" d="M20,30L28,38"/>
		<path id="kvg:x-s3" d="M15,85H95"/>
	</g>
</g>`);
    expect(parseKanjiVG(svg, "返").tree).toEqual({
      c: [
        { e: "反", p: "inside", pd: "nyoc", s: [0] },
        { e: "⻌", o: "辶", p: "enclosure", pd: "nyo", r: true, s: [1, 2] },
      ],
    });
  });

  it("maps unknown positions to other and keeps middle", () => {
    const svg = kvgFile(`<g id="kvg:x" kvg:element="X">
	<g id="kvg:x-g1" kvg:element="A" kvg:position="diagonal"><path id="s1" d="M1,1L9,9"/></g>
	<g id="kvg:x-g2" kvg:element="B" kvg:position="middle"><path id="s2" d="M1,9L9,1"/></g>
</g>`);
    expect(parseKanjiVG(svg, "X").tree).toEqual({
      c: [
        { e: "A", p: "other", pd: "diagonal", s: [0] },
        { e: "B", p: "middle", s: [1] },
      ],
    });
  });

  it("counts only the dictionary radical", () => {
    const svg = kvgFile(`<g id="kvg:x" kvg:element="X">
	<g id="g1" kvg:element="A" kvg:radical="general"><path id="s1" d="M1,1L9,1"/></g>
	<g id="g2" kvg:element="B" kvg:radical="tradit"><path id="s2" d="M1,2L9,2"/></g>
	<g id="g3" kvg:element="C" kvg:radical="nelson"><path id="s3" d="M1,3L9,3"/></g>
	<g id="g4" kvg:element="D" kvg:radical="jis"><path id="s4" d="M1,4L9,4"/></g>
</g>`);
    expect(parseKanjiVG(svg, "X").tree.c).toEqual([
      { e: "A", r: true, s: [0] },
      { e: "B", r: true, s: [1] },
      { e: "C", s: [2] },
      { e: "D", s: [3] },
    ]);
  });

  it("leaves the element off the root but keeps its other attributes", () => {
    const svg = kvgFile(`<g id="kvg:06728" kvg:element="木" kvg:radical="general">
	<path id="s1" kvg:type="㇐" d="M10,40H99"/>
	<path id="s2" kvg:type="㇑" d="M55,10V99"/>
</g>`);
    const record = parseKanjiVG(svg, "木");
    expect(record.tree).toEqual({ r: true, s: [0, 1] });
    expect(decodeGlyph(record, SET).root.element).toBe("木");
  });

  it("dissolves groups without a kept attribute into their parent", () => {
    const svg = kvgFile(`<g id="kvg:x" kvg:element="X">
	<g id="kvg:x-g1">
		<path id="s1" d="M10,10H90"/>
		<g id="kvg:x-g2" kvg:element="口"><path id="s2" d="M10,20H90"/></g>
	</g>
	<g id="kvg:x-g3" kvg:phon="口"><path id="s3" d="M10,30H90"/></g>
	<g id="kvg:x-g4" kvg:radical="nelson" kvg:variant="true"><path id="s4" d="M10,40H90"/></g>
	<g id="kvg:x-g5" kvg:position="bottom"><path id="s5" d="M10,50H90"/></g>
	<path id="s6" d="M10,60H90"/>
</g>`);
    expect(parseKanjiVG(svg, "X").tree).toEqual({
      s: [0, 2, 3, 5],
      c: [
        { e: "口", s: [1] },
        { p: "bottom", s: [4] },
      ],
    });
  });

  it("applies the inside rule to siblings that surface from a dissolved group", () => {
    const svg = kvgFile(`<g id="kvg:x" kvg:element="X">
	<g id="g1" kvg:element="冂" kvg:position="kamae"><path id="s1" d="M10,10V90"/><path id="s2" d="M10,10H90V90"/></g>
	<g id="g2">
		<g id="g3" kvg:element="一"><path id="s3" d="M30,40H70"/></g>
		<g id="g4" kvg:element="口" kvg:position="bottom"><path id="s4" d="M30,60H70"/></g>
	</g>
</g>`);
    expect(parseKanjiVG(svg, "X").tree.c).toEqual([
      { e: "冂", p: "enclosure", pd: "kamae", s: [0, 1] },
      { e: "一", p: "inside", s: [2] },
      { e: "口", p: "bottom", s: [3] },
    ]);
  });

  it("does not hand out inside when nothing encloses", () => {
    const svg = kvgFile(`<g id="kvg:x" kvg:element="X">
	<g id="g1" kvg:element="A" kvg:position="top"><path id="s1" d="M10,10H90"/></g>
	<g id="g2" kvg:element="B"><path id="s2" d="M10,90H90"/></g>
</g>`);
    expect(parseKanjiVG(svg, "X").tree.c).toEqual([
      { e: "A", p: "top", s: [0] },
      { e: "B", s: [1] },
    ]);
  });

  it("keeps nested groups nested and stroke indices in file order", () => {
    const svg = kvgFile(`<g id="kvg:x" kvg:element="X">
	<g id="g1" kvg:element="A" kvg:position="left">
		<path id="s1" d="M10,10H40"/>
		<g id="g2" kvg:element="B"><path id="s2" d="M10,20H40"/></g>
		<path id="s3" d="M10,30H40"/>
		<g id="g3" kvg:element="C" kvg:part="3"><g id="g4" kvg:element="D"><path id="s4" d="M10,40H40"/></g></g>
	</g>
</g>`);
    const record = parseKanjiVG(svg, "X");
    expect(record.tree).toEqual({
      c: [
        {
          e: "A",
          p: "left",
          s: [0, 2],
          c: [
            { e: "B", s: [1] },
            { e: "C", n: 3, c: [{ e: "D", s: [3] }] },
          ],
        },
      ],
    });
    expect(treeElements(record.tree)).toEqual(["A", "B", "C", "D"]);
  });

  it("drops groups that hold no stroke and ignores a non-numeric part", () => {
    const svg = kvgFile(`<g id="kvg:x" kvg:element="X">
	<g id="g1" kvg:element="A"></g>
	<g id="g2" kvg:element="B" kvg:position="top"/>
	<g id="g3" kvg:element="C" kvg:part="second"><path id="s1" d="M10,10H40"/></g>
</g>`);
    expect(parseKanjiVG(svg, "X").tree).toEqual({ c: [{ e: "C", s: [0] }] });
  });

  it("reads single-quoted attributes, character references and explicitly closed paths", () => {
    const svg = kvgFile(`<g id='kvg:x' kvg:element='X'>
	<g id="g1" kvg:element="&#x6728;" kvg:original = "&#26408;&amp;"><path id='s1' kvg:type='㇐' d='M10,10H40'></path></g>
</g>`);
    const record = parseKanjiVG(svg, "X", { size: KANJIVG_SIZE });
    expect(record.tree).toEqual({ c: [{ e: "木", o: "木&", s: [0] }] });
    expect(record.strokes).toEqual([["M10,10L40,10", [10, 10, 40, 10], "㇐"]]);
  });

  it("leaves the type out when the path has none", () => {
    const svg = kvgFile(`<g id="kvg:x" kvg:element="X"><path id="s1" d="M10,10H40"/></g>`);
    const [stroke] = parseKanjiVG(svg, "X", { size: KANJIVG_SIZE }).strokes;
    expect(stroke).toEqual(["M10,10L40,10", [10, 10, 40, 10]]);
    expect(stroke).toHaveLength(2);
  });

  it("gathers several top-level groups and loose paths under an anonymous root", () => {
    const svg = kvgFile(`<g id="kvg:x-a" kvg:element="A"><path id="s1" d="M10,10H40"/></g>
<path id="s2" d="M10,50H40"/>
<g id="kvg:x-b" kvg:element="B"><path id="s3" d="M10,90H40"/></g>`);
    expect(parseKanjiVG(svg, "X").tree).toEqual({
      s: [1],
      c: [
        { e: "A", s: [0] },
        { e: "B", s: [2] },
      ],
    });
  });

  it("nudges a dot too small to have a direction", () => {
    const svg = kvgFile(`<g id="kvg:x" kvg:element="X"><path id="s1" kvg:type="㇔" d="M50,50l0.01,0.02"/></g>`);
    expect(parseKanjiVG(svg, "X").strokes[0]![1]).toEqual([459, 459, 459, 460]);
  });

  it("reads nothing outside the stroke group", () => {
    expect(parseKanjiVG(TROUBLE, "困").strokes).toHaveLength(7);
  });

  it("throws a descriptive error for a file without strokes", () => {
    const empty = kvgFile(`<g id="kvg:x" kvg:element="X"></g>`);
    expect(() => parseKanjiVG(empty, "X")).toThrow(/KanjiVG X: the file contains no strokes/);
    expect(() => parseKanjiVG(kvgFile(""), "X")).toThrow(/no strokes/);
    expect(() => parseKanjiVG("", "X")).toThrow(/KanjiVG X: no "kvg:StrokePaths" group/);
    expect(() => parseKanjiVG("<html><body>404: Not Found</body></html>", "X")).toThrow(/StrokePaths/);
    expect(() => parseKanjiVG(`<svg><g id="other"><path d="M1,1L2,2"/></g></svg>`, "X")).toThrow(/StrokePaths/);
    expect(() => parseKanjiVG(`<svg><g id="kvg:StrokePaths_x"/></svg>`, "X")).toThrow(/no strokes/);
  });

  it("throws for a truncated file and for unreadable paths", () => {
    const truncated = REST.slice(0, REST.indexOf("</g>"));
    expect(() => parseKanjiVG(truncated, "休")).toThrow(/KanjiVG 休: .*not closed/);
    const noData = kvgFile(`<g id="kvg:x" kvg:element="X"><path id="kvg:x-s1" kvg:type="㇐"/></g>`);
    expect(() => parseKanjiVG(noData, "X")).toThrow(/path kvg:x-s1 has no "d" attribute/);
    const arc = kvgFile(`<g id="kvg:x" kvg:element="X"><path id="s1" d="M1,1L5,5"/><path id="s2" d="M1,1A5,5,0,0,1,9,9"/></g>`);
    expect(() => parseKanjiVG(arc, "X")).toThrow(/KanjiVG X: stroke 2 cannot be read \(.*unsupported/);
  });

  it("rejects bad arguments", () => {
    expect(() => parseKanjiVG(REST, "")).toThrow(RangeError);
    expect(() => parseKanjiVG(REST, "休む")).toThrow(RangeError);
    expect(() => parseKanjiVG(REST, "休", { size: 0 })).toThrow(RangeError);
    expect(() => parseKanjiVG(REST, "休", { size: Number.NaN })).toThrow(RangeError);
    expect(() => parseKanjiVG(REST, "休", { medianEpsilon: -1 })).toThrow(RangeError);
    expect(() => parseKanjiVG(REST, "休", { maxMedianPoints: 1 })).toThrow(RangeError);
    expect(() => parseKanjiVG(REST, "休", { maxMedianPoints: 2.5 })).toThrow(RangeError);
  });

  it("accepts a character outside the basic plane", () => {
    const svg = kvgFile(`<g id="kvg:20089" kvg:element="𠂉"><path id="s1" d="M10,10H40"/></g>`, "20089");
    expect(parseKanjiVG(svg, "𠂉").char).toBe("𠂉");
  });
});

describe("treeElements", () => {
  it("lists each named component once, in tree order", () => {
    expect(treeElements({ c: [{ e: "古", c: [{ e: "十" }, { e: "口" }] }, { e: "口" }, { p: "top", c: [{ e: "月" }] }] })).toEqual([
      "古",
      "十",
      "口",
      "月",
    ]);
  });

  it("is empty for a character written in one piece and includes an explicit root name", () => {
    expect(treeElements({ s: [0, 1] })).toEqual([]);
    expect(treeElements({ e: "木", s: [0] })).toEqual(["木"]);
    expect(treeElements(parseKanjiVG(TROUBLE, "困").tree)).toEqual(["囗", "木"]);
  });
});
