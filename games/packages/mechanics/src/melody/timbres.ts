import type { TimbreConfig, TimbreSpec } from "./types";

/**
 * The built-in sound colours. Each is a handful of sine partials with an envelope, so
 * any engine can render them without samples. They are chosen to be easy to tell apart
 * (bright vs hollow vs breathy, plucked vs bowed), because component identity rides on
 * timbre. Every timbre sustains: a voice must be able to last as long as a pen is down.
 */
export const TIMBRES: readonly TimbreSpec[] = [
  {
    id: "koto",
    label: "Plucked string",
    partials: [
      { ratio: 1, gain: 1 },
      { ratio: 2, gain: 0.5 },
      { ratio: 3, gain: 0.3 },
      { ratio: 4, gain: 0.15 },
      { ratio: 5, gain: 0.08 },
    ],
    envelope: { attack: 0.005, decay: 0.35, sustain: 0.35, release: 0.25 },
    gain: 0.8,
  },
  {
    id: "flute",
    label: "Breathy flute",
    partials: [
      { ratio: 1, gain: 1 },
      { ratio: 2, gain: 0.12 },
      { ratio: 3, gain: 0.05 },
    ],
    envelope: { attack: 0.07, decay: 0.1, sustain: 0.85, release: 0.18 },
    vibrato: { cents: 12, hz: 5 },
    breath: 0.12,
    gain: 0.9,
  },
  {
    id: "glass",
    label: "Glass bell",
    partials: [
      { ratio: 1, gain: 1 },
      { ratio: 2.76, gain: 0.45 },
      { ratio: 5.4, gain: 0.22 },
      { ratio: 8.93, gain: 0.08 },
    ],
    envelope: { attack: 0.003, decay: 0.6, sustain: 0.25, release: 0.5 },
    gain: 0.7,
  },
  {
    id: "reed",
    label: "Hollow reed",
    partials: [
      { ratio: 1, gain: 1 },
      { ratio: 3, gain: 0.55 },
      { ratio: 5, gain: 0.3 },
      { ratio: 7, gain: 0.14 },
      { ratio: 9, gain: 0.06 },
    ],
    envelope: { attack: 0.03, decay: 0.08, sustain: 0.8, release: 0.12 },
    gain: 0.6,
  },
  {
    id: "marimba",
    label: "Wooden bar",
    partials: [
      { ratio: 1, gain: 1 },
      { ratio: 4, gain: 0.35 },
      { ratio: 10, gain: 0.08 },
    ],
    envelope: { attack: 0.002, decay: 0.22, sustain: 0.3, release: 0.2 },
    gain: 0.9,
  },
  {
    id: "strings",
    label: "Bowed strings",
    partials: [
      { ratio: 1, gain: 1 },
      { ratio: 2, gain: 0.7 },
      { ratio: 3, gain: 0.5 },
      { ratio: 4, gain: 0.35 },
      { ratio: 5, gain: 0.25 },
      { ratio: 6, gain: 0.15 },
    ],
    envelope: { attack: 0.12, decay: 0.15, sustain: 0.8, release: 0.3 },
    vibrato: { cents: 18, hz: 5.5 },
    gain: 0.5,
  },
  {
    id: "organ",
    label: "Soft organ",
    partials: [
      { ratio: 0.5, gain: 0.5 },
      { ratio: 1, gain: 1 },
      { ratio: 2, gain: 0.6 },
      { ratio: 4, gain: 0.25 },
    ],
    envelope: { attack: 0.02, decay: 0.05, sustain: 0.9, release: 0.1 },
    gain: 0.55,
  },
  {
    id: "whistle",
    label: "Whistle",
    partials: [{ ratio: 2, gain: 1 }],
    envelope: { attack: 0.04, decay: 0.05, sustain: 0.9, release: 0.1 },
    vibrato: { cents: 25, hz: 6.5 },
    breath: 0.05,
    gain: 0.6,
  },
];

export const TIMBRE_IDS: readonly string[] = TIMBRES.map((t) => t.id);

/** Timbre used for strokes that belong to no component, and for everything in "single" mode. */
export const NEUTRAL_TIMBRE = "koto";

export const DEFAULT_TIMBRE_CONFIG: TimbreConfig = {
  mode: "per-component",
  palette: TIMBRE_IDS,
};

export function timbreById(id: string, timbres: readonly TimbreSpec[] = TIMBRES): TimbreSpec {
  const found = timbres.find((t) => t.id === id);
  if (!found) throw new Error(`unknown timbre "${id}"`);
  return found;
}
