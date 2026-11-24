/**
 * Everything audible. The audio port and the melodist are created on first use, after a
 * user gesture has unlocked audio; until then, and while sound is off, calls do nothing.
 */

import { collectUnitComponents, type Glyph } from "@kankyouken/mechanics/glyph";
import {
  createMelodist,
  detectPrefixes,
  scheduleMelody,
  type CueName,
  type Melodist,
  type ScheduledNote,
} from "@kankyouken/mechanics/melody";
import type { Rng } from "@kankyouken/mechanics/util";
import { createWebAudioPort, type WebAudioPort } from "@kankyouken/web-kit/audio";
import { hasMotif, motifNotes } from "./notes";

/** Level of a tile's motif relative to the solved melody: tiles are handled often, so they stay in the background. */
const TILE_LEVEL = 0.45;

export interface SoundSettings {
  readonly sound: boolean;
  /** 0..1. */
  readonly volume: number;
}

export interface Sound {
  /** Call from a user gesture: lets audio start. */
  unlock(): void;
  /** The motif of the component a tile shows; silent for made-up shapes. */
  tile(shows: string): void;
  /**
   * The timeline of a character's melody, one note per stroke, and a way to start it.
   * The timeline is returned even when sound is off, so the drawing can keep its rhythm.
   */
  melody(glyph: Glyph): { readonly notes: readonly ScheduledNote[]; play(): { stop(): void } };
  cue(name: CueName): void;
  apply(settings: SoundSettings): void;
}

export function createSound(glyphs: ReadonlyMap<string, Glyph>, rng: Rng, initial: SoundSettings): Sound {
  let settings = initial;
  let port: WebAudioPort | null = null;
  let unlocked = false;
  let melodist: Melodist | null = null;
  let playing: { stop(): void } | null = null;

  const getMelodist = (): Melodist => {
    if (melodist === null) {
      const alphabet = collectUnitComponents(glyphs.values());
      melodist = createMelodist({ glyphs, prefixes: detectPrefixes(glyphs, [...alphabet]), alphabet });
    }
    return melodist;
  };

  /** The port, or null while sound is off, audio is locked or the browser has no Web Audio. */
  const audible = (): WebAudioPort | null => {
    if (!settings.sound || !unlocked) return null;
    if (port === null) {
      try {
        port = createWebAudioPort({ masterGain: settings.volume });
      } catch {
        return null;
      }
    }
    void port.resume();
    return port;
  };

  const start = (notes: readonly ScheduledNote[], level: number): { stop(): void } => {
    const out = audible();
    playing?.stop();
    playing = null;
    if (out === null || notes.length === 0) return { stop: () => undefined };
    out.setMasterGain(settings.volume * level);
    playing = out.play(notes);
    return playing;
  };

  return {
    unlock() {
      unlocked = true;
      audible();
    },
    tile(shows) {
      if (!settings.sound || !unlocked || !hasMotif(shows, (component) => glyphs.has(component))) return;
      try {
        start(motifNotes(getMelodist().motif(shows)), TILE_LEVEL);
      } catch {
        // A component without a usable motif stays silent.
      }
    },
    melody(glyph) {
      let notes: ScheduledNote[] = [];
      try {
        const melodist = getMelodist();
        notes = scheduleMelody(melodist.melody(glyph), "melody", melodist.config.tuning, rng);
      } catch {
        notes = [];
      }
      return { notes, play: () => start(notes, 1) };
    },
    cue(name) {
      const out = audible();
      if (out === null) return;
      out.setMasterGain(settings.volume);
      out.cue(name);
    },
    apply(next) {
      settings = next;
      if (!next.sound) {
        playing?.stop();
        playing = null;
      }
      port?.setMasterGain(next.volume);
    },
  };
}
