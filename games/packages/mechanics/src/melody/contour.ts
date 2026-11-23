import type { ContourPoint, Pitch } from "./types";

/** Frequency in hertz of a MIDI pitch (A4 = 69 = 440 Hz). */
export function pitchToFrequency(pitch: Pitch): number {
  return 440 * 2 ** ((pitch - 69) / 12);
}

/**
 * Pitch of a contour at stroke progress `p`, by linear interpolation between vertices.
 * `p` outside 0..1 is clamped. An empty contour is a programming error.
 */
export function contourPitchAt(contour: readonly ContourPoint[], p: number): Pitch {
  if (contour.length === 0) throw new Error("contourPitchAt: empty contour");
  const first = contour[0]!;
  if (p <= first.p) return first.pitch;
  for (let i = 1; i < contour.length; i++) {
    const a = contour[i - 1]!;
    const b = contour[i]!;
    if (p <= b.p) {
      const span = b.p - a.p;
      return span <= 0 ? b.pitch : a.pitch + ((b.pitch - a.pitch) * (p - a.p)) / span;
    }
  }
  return contour[contour.length - 1]!.pitch;
}

/** Net pitch movement of a contour: positive rises, negative falls, 0 is steady. */
export function contourTravel(contour: readonly ContourPoint[]): number {
  if (contour.length === 0) return 0;
  return contour[contour.length - 1]!.pitch - contour[0]!.pitch;
}
