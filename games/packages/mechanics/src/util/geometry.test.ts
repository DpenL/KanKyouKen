import { describe, expect, it } from "vitest";
import {
  boundingBox,
  cosine,
  distanceToPolyline,
  frechetDistance,
  mapBetweenBoxes,
  point,
  pointAt,
  polylineLength,
  projectOntoPolyline,
  resample,
  reversed,
} from "./geometry";

const L = [point(0, 0), point(10, 0), point(10, 10)];

describe("geometry", () => {
  it("measures polyline length", () => {
    expect(polylineLength(L)).toBe(20);
    expect(polylineLength([point(1, 1)])).toBe(0);
  });

  it("finds points by arc-length fraction", () => {
    expect(pointAt(L, 0)).toEqual(point(0, 0));
    expect(pointAt(L, 0.25)).toEqual(point(5, 0));
    expect(pointAt(L, 0.75)).toEqual(point(10, 5));
    expect(pointAt(L, 2)).toEqual(point(10, 10));
  });

  it("resamples evenly and keeps the endpoints", () => {
    const r = resample(L, 5);
    expect(r).toHaveLength(5);
    expect(r[0]).toEqual(point(0, 0));
    expect(r[4]).toEqual(point(10, 10));
    expect(r[1]!.x).toBeCloseTo(5);
    expect(r[2]!.x).toBeCloseTo(10);
    expect(r[2]!.y).toBeCloseTo(0);
    expect(r[3]!.y).toBeCloseTo(5);
    for (let i = 1; i < r.length; i++) {
      expect(Math.hypot(r[i]!.x - r[i - 1]!.x, r[i]!.y - r[i - 1]!.y)).toBeCloseTo(5);
    }
  });

  it("resamples degenerate input without NaN", () => {
    const r = resample([point(3, 4), point(3, 4)], 4);
    expect(r).toEqual([point(3, 4), point(3, 4), point(3, 4), point(3, 4)]);
    expect(() => resample(L, 1)).toThrow();
  });

  it("handles repeated vertices when resampling", () => {
    const r = resample([point(0, 0), point(0, 0), point(4, 0), point(4, 0)], 3);
    expect(r[1]!.x).toBeCloseTo(2);
  });

  it("computes bounding boxes and box mapping", () => {
    const b = boundingBox(L);
    expect(b).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    const mapped = mapBetweenBoxes(L, b, { minX: 0, minY: 0, maxX: 1, maxY: 2 });
    expect(mapped[2]).toEqual(point(1, 2));
  });

  it("projects points onto a polyline", () => {
    expect(distanceToPolyline(point(5, 3), L)).toBeCloseTo(3);
    expect(projectOntoPolyline(point(5, 3), L)).toBeCloseTo(0.25);
    expect(projectOntoPolyline(point(12, 5), L)).toBeCloseTo(0.75);
  });

  it("frechet distance is zero for identical curves and large for reversed ones", () => {
    const a = resample(L, 16);
    expect(frechetDistance(a, a)).toBe(0);
    expect(frechetDistance(a, reversed(a))).toBeGreaterThan(10);
    const shifted = a.map((p) => point(p.x + 1, p.y));
    expect(frechetDistance(a, shifted)).toBeCloseTo(1);
  });

  it("cosine handles zero vectors", () => {
    expect(cosine(point(0, 0), point(1, 0))).toBe(0);
    expect(cosine(point(1, 0), point(-2, 0))).toBeCloseTo(-1);
  });
});
