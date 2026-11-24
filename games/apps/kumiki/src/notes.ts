/** Timelines for the sounds the game makes, as data; `sound.ts` plays them. */

import { DEFAULT_PLAYBACK, type Motif, type ScheduledNote } from "@kankyouken/mechanics/melody";

/** A component's motif as consecutive notes in its own timbre. */
export function motifNotes(motif: Motif, tempo: number = DEFAULT_PLAYBACK.tempo): ScheduledNote[] {
  const secondsPerBeat = 60 / tempo;
  const notes: ScheduledNote[] = [];
  let start = 0;
  motif.elements.forEach((element, stroke) => {
    const duration = element.beats * secondsPerBeat;
    notes.push({
      start,
      duration,
      voice: { kind: "tone", timbre: motif.timbre, contour: element.contour, pan: element.pan, beats: element.beats },
      stroke,
    });
    start += duration;
  });
  return notes;
}

/** True for a tile that shows a real component (not a made-up variant), which therefore has a motif. */
export function hasMotif(shows: string, hasGlyph: (component: string) => boolean): boolean {
  return !shows.includes("~") && hasGlyph(shows);
}
