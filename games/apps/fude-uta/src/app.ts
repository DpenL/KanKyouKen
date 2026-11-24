import type { Lesson } from "@kankyouken/glyph-data";
import type { Melodist, StrokeAudioMode } from "@kankyouken/mechanics/melody";
import { gameEvent } from "@kankyouken/mechanics/telemetry";
import { createRng } from "@kankyouken/mechanics/util";
import { createLocalStore, readLaunchParams } from "@kankyouken/web-kit/app";
import { installGlyphCss } from "@kankyouken/web-kit/render";
import { buildMelodist, loadContent } from "./content";
import type { Env, Mode } from "./env";
import { IDLE_PROBE } from "./env";
import { createPerformer } from "./performer";
import type { Stars } from "./progress";
import { sanitizeStars, starsFor, withStars } from "./progress";
import type { Settings } from "./settings";
import { DEFAULT_SETTINGS, conditionAudioMode, effectiveAudioMode, sanitizeSettings } from "./settings";
import { createSound } from "./sound";
import { APP_VERSION, createTelemetry } from "./telemetry";
import { openAbout, openSettings } from "./ui/dialogs";
import { renderHome } from "./ui/home";
import { startLearnMode } from "./ui/learn-mode";
import { startRecallMode } from "./ui/recall-mode";
import { renderRecallSummary, renderResults } from "./ui/results";
import { startTimedMode } from "./ui/timed-mode";
import type { WritingUi } from "./ui/writing-ui";
import { createWritingUi } from "./ui/writing-ui";

interface Saved {
  readonly settings: Settings;
  readonly stars: Readonly<Record<string, Stars>>;
}

const STORE_KEY = "kk.fude-uta.v1";

export function startApp(root: HTMLElement): void {
  installGlyphCss();
  const params = readLaunchParams(location.search, location.hash);
  const seed = params.seed ?? Math.random().toString(36).slice(2, 10);
  const rng = createRng(seed);
  const telemetry = createTelemetry(params);
  const store = createLocalStore<Saved>(STORE_KEY, { settings: DEFAULT_SETTINGS, stars: {} });
  const content = loadContent();
  const startedAt = Date.now();

  let settings = sanitizeSettings(store.get().settings);
  let melodist: Melodist = buildMelodist(content, settings.timbreMode);
  const audioMode = (): StrokeAudioMode => effectiveAudioMode(settings, params.condition);

  const sound = createSound({ volume: () => settings.volume, cuesEnabled: () => audioMode() !== "silent" });
  const env: Env = {
    content,
    rng,
    audioRng: rng.fork("audio"),
    sound,
    performer: createPerformer(sound, () => melodist.config.tuning, rng.fork("performer")),
    probe: { screen: "home", ...IDLE_PROBE },
    settings: () => settings,
    audioMode,
    melodist: () => melodist,
    emit: (event) => telemetry.sink.record(event),
  };

  let mode: Mode | null = null;
  let teardown: (() => void) | null = null;

  const leave = (): void => {
    mode?.stop();
    mode = null;
    env.performer.stop();
    teardown?.();
    teardown = null;
    root.replaceChildren();
  };

  const changeSettings = (change: Partial<Settings>): void => {
    const timbreChanged = change.timbreMode !== undefined && change.timbreMode !== settings.timbreMode;
    settings = { ...settings, ...change };
    store.patch({ settings });
    if (timbreChanged) melodist = buildMelodist(content, settings.timbreMode);
    if (change.volume !== undefined) {
      sound.setVolume(settings.volume);
      sound.cue("hint");
    }
    env.emit(gameEvent("settings_change", { ts: Date.now() }, { ...change }));
  };

  const showHome = (): void => {
    leave();
    Object.assign(env.probe, { screen: "home", ...IDLE_PROBE });
    root.append(
      renderHome(content.lessons, sanitizeStars(store.get().stars), {
        onLesson: startLesson,
        onSettings: () =>
          openSettings({ settings, audioModeFixed: conditionAudioMode(params.condition) !== null, onChange: changeSettings }),
        onAbout: () => openAbout(content.attribution),
      }),
    );
  };

  /** Swap whatever is on screen for a writing screen that leads back home. */
  const showWriting = (): WritingUi => {
    leave();
    const ui = createWritingUi(showHome);
    teardown = () => ui.destroy();
    root.append(ui.root);
    return ui;
  };

  const startRecall = (lesson: Lesson): void => {
    mode = startRecallMode(env, showWriting(), lesson, (rows) => {
      leave();
      Object.assign(env.probe, { screen: "recall-summary", ...IDLE_PROBE });
      root.append(renderRecallSummary(lesson, rows, showHome));
    });
  };

  const startLesson = (lesson: Lesson): void => {
    const ui = showWriting();
    mode = startLearnMode(env, ui, lesson, () => {
      mode?.stop();
      mode = startTimedMode(env, ui, lesson, (round) => {
        const stars = starsFor(round.results);
        store.patch({ stars: withStars(sanitizeStars(store.get().stars), lesson.id, stars) });
        leave();
        Object.assign(env.probe, { screen: "results", ...IDLE_PROBE });
        root.append(renderResults(lesson, round, stars, { onRecall: () => startRecall(lesson), onHome: showHome }));
      });
    });
  };

  document.addEventListener("pointerdown", () => sound.unlock(), { capture: true });
  document.addEventListener("keydown", () => sound.unlock(), { capture: true });
  window.addEventListener("pagehide", () => {
    env.emit(gameEvent("session_end", { ts: Date.now() }, { duration_ms: Date.now() - startedAt }));
    void telemetry.sink.flush?.();
  });

  env.emit(
    gameEvent(
      "session_start",
      { ts: startedAt },
      {
        seed,
        app_version: APP_VERSION,
        condition: params.condition ?? null,
        condition_fixes_audio: conditionAudioMode(params.condition) !== null,
        audio_mode: audioMode(),
        timbre_mode: settings.timbreMode,
        judging: settings.judging,
        plan: settings.plan,
      },
    ),
  );

  if (params.debug) {
    Object.defineProperty(window, "__kk", {
      value: Object.freeze({
        events: telemetry.events,
        seed,
        get state() {
          return { ...env.probe };
        },
      }),
    });
  }

  showHome();
}
