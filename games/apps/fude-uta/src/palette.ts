import { TIMBRES } from "@kankyouken/mechanics/melody";

/** The eight muted colours of the game, in the order of the library's timbre palette. */
export const TONE_COLOURS = ["indigo", "matcha", "persimmon", "plum", "ochre", "pine", "slate", "rose"] as const;
export type ToneColour = (typeof TONE_COLOURS)[number];

const FALLBACK: ToneColour = "slate";

const BY_TIMBRE: ReadonlyMap<string, ToneColour> = new Map(
  TIMBRES.map((timbre, i) => [timbre.id, TONE_COLOURS[i % TONE_COLOURS.length] ?? FALLBACK]),
);

/** The colour that stands for a timbre everywhere in the game (chips, tinted strokes). */
export function toneOf(timbre: string): ToneColour {
  return BY_TIMBRE.get(timbre) ?? FALLBACK;
}
