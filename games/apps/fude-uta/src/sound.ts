import type { CueName, ScheduledNote, VoiceHandle, VoiceSpec } from "@kankyouken/mechanics/melody";
import type { WebAudioPort } from "@kankyouken/web-kit/audio";
import { createWebAudioPort } from "@kankyouken/web-kit/audio";

/**
 * The game's sound: the Web Audio port, created only once the player has touched the page.
 *
 * Sound is never worth a broken lesson. Nothing here throws: when the audio layer does
 * (or the browser has none), the game goes on in silence and `available` says so.
 */
export interface Sound {
  /** Call from a user gesture: creates the audio port on first use and lets it run. */
  unlock(): void;
  setVolume(volume: number): void;
  /** A voice that sounds until stopped; a null spec (silent mode) gives a voice that does nothing. */
  startVoice(spec: VoiceSpec | null): VoiceHandle;
  play(notes: readonly ScheduledNote[]): { stop(): void };
  cue(name: CueName): void;
  /** False when the browser has no Web Audio, and from the moment the audio layer failed. */
  available(): boolean;
}

/** Where the sound comes from. Tests put a port of their own here. */
export interface AudioBackend {
  /** Whether the browser has Web Audio at all. */
  readonly supported: boolean;
  open(options: { readonly masterGain: number }): WebAudioPort;
}

export interface SoundOptions {
  readonly volume: () => number;
  readonly cuesEnabled: () => boolean;
  /** Called once if sound that was thought available turns out not to be. */
  readonly onUnavailable?: () => void;
}

const SILENT_VOICE: VoiceHandle = { setProgress: () => undefined, stop: () => undefined };
const SILENT_PLAYBACK: { stop(): void } = { stop: () => undefined };

const webAudio = (): AudioBackend => ({ supported: typeof AudioContext !== "undefined", open: createWebAudioPort });

export function createSound(options: SoundOptions, backend: AudioBackend = webAudio()): Sound {
  let port: WebAudioPort | null = null;
  let unavailable = !backend.supported;

  /** The audio layer threw: from here on the session is silent, and the port is not asked again. */
  const giveUp = (): void => {
    const broken = port;
    port = null;
    if (unavailable) return;
    unavailable = true;
    try {
      void broken?.close().catch(() => undefined);
    } catch {
      // It is broken already.
    }
    try {
      options.onUnavailable?.();
    } catch {
      // Whoever listens must not turn a sound failure into a game failure either.
    }
  };

  /** Ask the port for something; without a port, or when it throws, the fallback stands in. */
  const ask = <T>(request: (out: WebAudioPort) => T, fallback: T): T => {
    if (port === null) return fallback;
    try {
      return request(port);
    } catch {
      giveUp();
      return fallback;
    }
  };

  return {
    unlock() {
      if (port === null && !unavailable) {
        try {
          port = backend.open({ masterGain: options.volume() });
        } catch {
          giveUp();
        }
      }
      // A browser may refuse to start audio for now, in whatever way; the next gesture asks again.
      try {
        void Promise.resolve(port?.resume()).catch(() => undefined);
      } catch {
        // Not now.
      }
    },
    setVolume(volume) {
      ask((out) => out.setMasterGain(volume), undefined);
    },
    startVoice(spec) {
      if (spec === null) return SILENT_VOICE;
      const voice = ask((out) => out.startVoice(spec), SILENT_VOICE);
      return {
        setProgress: (progress) => ask(() => voice.setProgress(progress), undefined),
        stop: () => ask(() => voice.stop(), undefined),
      };
    },
    play(notes) {
      if (notes.length === 0) return SILENT_PLAYBACK;
      const playback = ask((out) => out.play(notes), SILENT_PLAYBACK);
      return { stop: () => ask(() => playback.stop(), undefined) };
    },
    cue(name) {
      if (options.cuesEnabled()) ask((out) => out.cue(name), undefined);
    },
    available: () => !unavailable,
  };
}
