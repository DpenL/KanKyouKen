import { describe, expect, it } from "vitest";
import type { Motif } from "@kankyouken/mechanics/melody";
import { hasMotif, motifNotes } from "./notes";

const motif: Motif = {
  component: "木",
  timbre: "koto",
  origin: "generated",
  elements: [
    { contour: [{ p: 0, pitch: 60 }, { p: 1, pitch: 60 }], beats: 1, pan: -0.2 },
    { contour: [{ p: 0, pitch: 64 }, { p: 1, pitch: 62 }], beats: 0.5, pan: 0.3 },
  ],
};

describe("motifNotes", () => {
  it("lays the elements out one after another in the motif's timbre", () => {
    const notes = motifNotes(motif, 120);
    expect(notes.map((note) => [note.start, note.duration, note.stroke])).toEqual([
      [0, 0.5, 0],
      [0.5, 0.25, 1],
    ]);
    expect(notes[1]!.voice).toEqual({ kind: "tone", timbre: "koto", contour: motif.elements[1]!.contour, pan: 0.3, beats: 0.5 });
  });

  it("gives no notes for an empty motif", () => {
    expect(motifNotes({ ...motif, elements: [] })).toEqual([]);
  });
});

describe("hasMotif", () => {
  const known = (component: string): boolean => component === "木";

  it("accepts real components with a glyph of their own", () => {
    expect(hasMotif("木", known)).toBe(true);
  });

  it("rejects made-up variants and shapes without a glyph", () => {
    expect(hasMotif("木~drop-stroke", known)).toBe(false);
    expect(hasMotif("林", known)).toBe(false);
  });
});
