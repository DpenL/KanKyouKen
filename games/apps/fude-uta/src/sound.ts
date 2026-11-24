import type { CueName, ScheduledNote, VoiceHandle, VoiceSpec } from "@kankyouken/mechanics/melody";
import type { WebAudioPort } from "@kankyouken/web-kit/audio";
import { createWebAudioPort } from "@kankyouken/web-kit/audio";

/** The game's sound: the Web Audio port, created only once the player has touched the page. */
export interface Sound {
  /** Call from a user gesture: creates the audio port on first use and lets it run. */
  unlock(): void;
  setVolume(volume: number): void;
  /** A voice that sounds until stopped; a null spec (silent mode) gives a voice that does nothing. */
  startVoice(spec: VoiceSpec | null): VoiceHandle;
  play(notes: readonly ScheduledNote[]): { stop(): void };
  cue(name: CueName): void;
}

const SILENT_VOICE: VoiceHandle = { setProgress: () => undefined, stop: () => undefined };
const SILENT_PLAYBACK = { stop: () => undefined };

export function createSound(options: { readonly volume: () => number; readonly cuesEnabled: () => boolean }): Sound {
  let port: WebAudioPort | null = null;
  let unavailable = false;
  return {
    unlock() {
      if (port === null && !unavailable) {
        try {
          port = createWebAudioPort({ masterGain: options.volume() });
        } catch {
          unavailable = true;
        }
      }
      port?.resume().catch(() => undefined);
    },
    setVolume(volume) {
      port?.setMasterGain(volume);
    },
    startVoice(spec) {
      return port !== null && spec !== null ? port.startVoice(spec) : SILENT_VOICE;
    },
    play(notes) {
      return port !== null && notes.length > 0 ? port.play(notes) : SILENT_PLAYBACK;
    },
    cue(name) {
      if (options.cuesEnabled()) port?.cue(name);
    },
  };
}
