import type { ScheduledNote, VoiceSpec } from "@kankyouken/mechanics/melody";
import type { WebAudioPort } from "@kankyouken/web-kit/audio";
import { describe, expect, it } from "vitest";
import type { AudioBackend } from "./sound";
import { createSound } from "./sound";

const boom = (): never => {
  throw new Error("boom");
};

/** A port that works unless a method is replaced; only what the game calls is there. */
function fakePort(overrides: Partial<WebAudioPort> = {}): { port: WebAudioPort; calls: string[] } {
  const calls: string[] = [];
  const port = {
    resume: () => Promise.resolve(),
    setMasterGain: () => void calls.push("gain"),
    startVoice: () => ({ setProgress: () => void calls.push("progress"), stop: () => void calls.push("voice-stop") }),
    play: () => ({ stop: () => void calls.push("play-stop") }),
    cue: (name: string) => void calls.push(`cue:${name}`),
    close: () => Promise.resolve(),
    ...overrides,
  } as unknown as WebAudioPort;
  return { port, calls };
}

const backendOf = (port: WebAudioPort): AudioBackend => ({ supported: true, open: () => port });

const VOICE = {} as VoiceSpec;
const NOTES = [{}] as unknown as ScheduledNote[];

function soundOn(backend: AudioBackend): { sound: ReturnType<typeof createSound>; failures: () => number } {
  let failures = 0;
  const sound = createSound({ volume: () => 0.6, cuesEnabled: () => true, onUnavailable: () => void failures++ }, backend);
  return { sound, failures: () => failures };
}

describe("the game's sound", () => {
  it("passes requests on to the audio port once unlocked", () => {
    const { port, calls } = fakePort();
    const { sound, failures } = soundOn(backendOf(port));
    sound.cue("hint");
    expect(calls).toEqual([]);
    sound.unlock();
    sound.cue("hint");
    const voice = sound.startVoice(VOICE);
    voice.setProgress(0.5);
    voice.stop();
    sound.play(NOTES).stop();
    sound.setVolume(0.2);
    expect(calls).toEqual(["cue:hint", "progress", "voice-stop", "play-stop", "gain"]);
    expect(sound.available()).toBe(true);
    expect(failures()).toBe(0);
  });

  it("never throws, whatever the audio port throws, and reports once that sound is gone", () => {
    for (const broken of ["startVoice", "play", "cue", "setMasterGain"] as const) {
      const { port } = fakePort({ [broken]: boom });
      const { sound, failures } = soundOn(backendOf(port));
      sound.unlock();
      expect(() => {
        sound.setVolume(0.3);
        sound.cue("error");
        sound.startVoice(VOICE).setProgress(0.5);
        sound.play(NOTES).stop();
        sound.cue("complete");
      }).not.toThrow();
      expect(sound.available()).toBe(false);
      expect(failures()).toBe(1);
    }
  });

  it("survives a voice or a playback that throws after it started", () => {
    const { port } = fakePort({
      startVoice: () => ({ setProgress: boom, stop: boom }),
      play: () => ({ stop: boom, finished: Promise.resolve() }),
    });
    const { sound } = soundOn(backendOf(port));
    sound.unlock();
    const voice = sound.startVoice(VOICE);
    expect(() => {
      voice.setProgress(0.2);
      voice.stop();
      sound.play(NOTES).stop();
    }).not.toThrow();
  });

  it("goes on when audio cannot be started: resume() throwing, returning nothing or rejecting is not a failure", () => {
    for (const resume of [boom, () => undefined, () => Promise.reject(new Error("not allowed"))]) {
      const { port, calls } = fakePort({ resume: resume as unknown as WebAudioPort["resume"] });
      const { sound, failures } = soundOn(backendOf(port));
      expect(() => sound.unlock()).not.toThrow();
      sound.cue("tick");
      expect(calls).toEqual(["cue:tick"]);
      expect(failures()).toBe(0);
    }
  });

  it("is silent and says so when the port cannot be created or the browser has no Web Audio", () => {
    const failing = soundOn({ supported: true, open: boom });
    expect(failing.sound.available()).toBe(true);
    expect(() => failing.sound.unlock()).not.toThrow();
    failing.sound.unlock();
    expect(failing.sound.available()).toBe(false);
    expect(failing.failures()).toBe(1);

    const none = soundOn({ supported: false, open: boom });
    expect(none.sound.available()).toBe(false);
    none.sound.unlock();
    none.sound.cue("hint");
    expect(none.failures()).toBe(0);
  });
});
