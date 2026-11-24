import type { StrokeAudioMode } from "@kankyouken/mechanics/melody";
import type { LearnPlan } from "@kankyouken/mechanics/scaffold";
import { PLAN_ARROWS, PLAN_GUIDED_FADE, PLAN_QUICK } from "@kankyouken/mechanics/scaffold";

export type Judging = "gentle" | "normal" | "strict";
export type PlanChoice = "guided-fade" | "arrows" | "quick";
export type TimbreMode = "per-component" | "single";

export interface Settings {
  readonly audioMode: StrokeAudioMode;
  readonly timbreMode: TimbreMode;
  /** Master level, 0..1. */
  readonly volume: number;
  readonly judging: Judging;
  readonly plan: PlanChoice;
}

export const DEFAULT_SETTINGS: Settings = {
  audioMode: "melody",
  timbreMode: "per-component",
  volume: 0.6,
  judging: "normal",
  plan: "guided-fade",
};

export interface Option<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly note: string;
}

export const AUDIO_MODE_OPTIONS: readonly Option<StrokeAudioMode>[] = [
  { value: "melody", label: "Melodies", note: "Each part of a character keeps its own tune." },
  { value: "changing-melody", label: "Random notes", note: "Musical, but different every time." },
  { value: "sfx", label: "Chalk sound", note: "A plain writing noise." },
  { value: "silent", label: "Silent", note: "No sound at all." },
];

export const TIMBRE_MODE_OPTIONS: readonly Option<TimbreMode>[] = [
  { value: "per-component", label: "One per part", note: "Every component has its own instrument." },
  { value: "single", label: "Single", note: "One instrument plays everything." },
];

export const JUDGING_OPTIONS: readonly Option<Judging>[] = [
  { value: "gentle", label: "Gentle", note: "Forgives wobbly strokes." },
  { value: "normal", label: "Normal", note: "A fair match is enough." },
  { value: "strict", label: "Strict", note: "Strokes must sit close to the model." },
];

export const PLAN_OPTIONS: readonly Option<PlanChoice>[] = [
  { value: "guided-fade", label: "Guided fade", note: "Watch, trace dotted strokes twice, then write three times unaided." },
  { value: "arrows", label: "Arrows", note: "Watch, follow numbered arrows, then trace the outline." },
  { value: "quick", label: "Quick", note: "Watch, trace once, write once." },
];

/** How forgiving stroke matching is, as the `leniency` of the stroke matcher. */
export const LENIENCY: Readonly<Record<Judging, number>> = { gentle: 1.6, normal: 1.3, strict: 1.0 };

export const PLANS: Readonly<Record<PlanChoice, LearnPlan>> = {
  "guided-fade": PLAN_GUIDED_FADE,
  arrows: PLAN_ARROWS,
  quick: PLAN_QUICK,
};

const oneOf = <T extends string>(options: readonly Option<T>[], value: unknown, fallback: T): T =>
  options.find((o) => o.value === value)?.value ?? fallback;

/** Settings read back from storage: anything missing or unknown falls back to its default. */
export function sanitizeSettings(raw: unknown): Settings {
  const source = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const volume = source["volume"];
  return {
    audioMode: oneOf(AUDIO_MODE_OPTIONS, source["audioMode"], DEFAULT_SETTINGS.audioMode),
    timbreMode: oneOf(TIMBRE_MODE_OPTIONS, source["timbreMode"], DEFAULT_SETTINGS.timbreMode),
    volume: typeof volume === "number" && Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_SETTINGS.volume,
    judging: oneOf(JUDGING_OPTIONS, source["judging"], DEFAULT_SETTINGS.judging),
    plan: oneOf(PLAN_OPTIONS, source["plan"], DEFAULT_SETTINGS.plan),
  };
}

/** The sound mode a study condition fixes, or null when the launch link names none we know. */
export function conditionAudioMode(condition: string | undefined): StrokeAudioMode | null {
  return AUDIO_MODE_OPTIONS.find((o) => o.value === condition)?.value ?? null;
}

/** The sound mode in effect: a study condition wins over the player's own setting. */
export function effectiveAudioMode(settings: Settings, condition: string | undefined): StrokeAudioMode {
  return conditionAudioMode(condition) ?? settings.audioMode;
}
