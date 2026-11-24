import type { Lesson } from "@kankyouken/glyph-data";
import type { Melodist, StrokeAudioMode } from "@kankyouken/mechanics/melody";
import { gameEvent } from "@kankyouken/mechanics/telemetry";
import { createRng } from "@kankyouken/mechanics/util";
import { createLocalStore, readLaunchParams, storeKeyFor } from "@kankyouken/web-kit/app";
import { installGlyphCss } from "@kankyouken/web-kit/render";
import { buildMelodist, loadContent } from "./content";
import type { Env, Mode } from "./env";
import { IDLE_PROBE } from "./env";
import { createPerformer } from "./performer";
import { starsFor, withStars } from "./progress";
import type { Saved } from "./saved";
import { DEFAULT_SAVED, STORE_KEY, cleanSaved } from "./saved";
import type { Settings } from "./settings";
import { conditionAudioMode, effectiveAudioMode, soundOn } from "./settings";
import { createSound } from "./sound";
import { APP_VERSION, createTelemetry } from "./telemetry";
import { openAbout, openSettings } from "./ui/dialogs";
import { arm, watchClicks } from "./ui/dom";
import { renderHome } from "./ui/home";
import { startLearnMode } from "./ui/learn-mode";
import { startRecallMode } from "./ui/recall-mode";
import { renderRecallSummary, renderResults } from "./ui/results";
import { startTimedMode } from "./ui/timed-mode";
import type { WritingUi } from "./ui/writing-ui";
import { createWritingUi } from "./ui/writing-ui";

export function startApp(root: HTMLElement): void {
  installGlyphCss();
  watchClicks();
  const params = readLaunchParams(location.search, location.hash);
  const seed = params.seed ?? Math.random().toString(36).slice(2, 10);
  const rng = createRng(seed);
  const telemetry = createTelemetry(params);
  // A study participant gets settings and stars of their own, whoever used the device before.
  const store = createLocalStore<Saved>(storeKeyFor(STORE_KEY, params), DEFAULT_SAVED, undefined, cleanSaved);
  const content = loadContent();
  const startedAt = Date.now();

  let { settings } = store.get();
  let melodist: Melodist = buildMelodist(content, settings.timbreMode);
  const audioMode = (): StrokeAudioMode => effectiveAudioMode(settings, params.condition);

  const sound = createSound({
    volume: () => settings.volume,
    cuesEnabled: () => audioMode() !== "silent",
    // From here on nothing is heard, whatever the settings say; the data must show it.
    onUnavailable: () => telemetry.sink.record(gameEvent("audio_unavailable", { ts: Date.now() }, { audio_mode: audioMode() })),
  });
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

  /** Take down whatever is on screen. A lesson part that is still running is recorded as abandoned. */
  const leave = (): void => {
    mode?.recordLeft("back");
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
    // With the change goes whether anything can be heard after it (a volume of zero is silence).
    env.emit(gameEvent("settings_change", { ts: Date.now() }, { ...change, sound_on: soundOn(settings, params.condition) }));
    if (change.volume !== undefined) {
      sound.setVolume(settings.volume);
      sound.cue("hint");
    }
  };

  /** Put a screen up in place of the one `leave` took down. Controls a click brought here are held for the rest of a double click. */
  const show = (screen: HTMLElement): void => {
    root.append(screen);
    arm(root);
  };

  const showHome = (): void => {
    leave();
    Object.assign(env.probe, { screen: "home", ...IDLE_PROBE });
    show(
      renderHome(content.lessons, store.get().stars, {
        onLesson: startLesson,
        onSettings: () =>
          openSettings({ settings, audioModeFixed: conditionAudioMode(params.condition) !== null, onChange: changeSettings }),
        onAbout: () => openAbout(content.attribution),
      }),
    );
  };

  /**
   * A lesson (learning, the timed round, its results and the from-memory round) adds one
   * entry to the browser history, so that the browser's Back, or the back gesture on a
   * phone, returns to the lesson list instead of leaving the game.
   */
  let inLesson = false;
  /** Steps back in history that the game asked for itself and must not act on. */
  let ownSteps = 0;
  const enterLesson = (): void => {
    if (inLesson) return;
    try {
      history.pushState({ fudeUta: "lesson" }, "");
      inLesson = true;
    } catch {
      // No history to add to (some embedded pages): Back then leaves the game as before.
    }
  };
  window.addEventListener("popstate", () => {
    if (ownSteps > 0) {
      ownSteps--;
      return;
    }
    if (!inLesson) return;
    inLesson = false;
    showHome();
  });

  /** Back to the lesson list from inside the game (the Back button, the end of a lesson). */
  const home = (): void => {
    if (inLesson) {
      inLesson = false;
      ownSteps++;
      history.back();
    }
    showHome();
  };

  /** Swap whatever is on screen for a writing screen that leads back home. */
  const showWriting = (): WritingUi => {
    leave();
    const ui = createWritingUi(home);
    teardown = () => ui.destroy();
    show(ui.root);
    return ui;
  };

  const startRecall = (lesson: Lesson): void => {
    mode = startRecallMode(env, showWriting(), lesson, (rows) => {
      leave();
      Object.assign(env.probe, { screen: "recall-summary", ...IDLE_PROBE });
      show(renderRecallSummary(lesson, rows, home));
    });
  };

  const startLesson = (lesson: Lesson): void => {
    enterLesson();
    const ui = showWriting();
    mode = startLearnMode(env, ui, lesson, () => {
      mode?.stop();
      mode = startTimedMode(env, ui, lesson, (round) => {
        const stars = starsFor(round.results);
        store.patch({ stars: withStars(store.get().stars, lesson.id, stars) });
        leave();
        Object.assign(env.probe, { screen: "results", ...IDLE_PROBE });
        show(renderResults(lesson, round, stars, { onRecall: () => startRecall(lesson), onHome: home }));
      });
    });
  };

  document.addEventListener("pointerdown", () => sound.unlock(), { capture: true });
  document.addEventListener("keydown", () => sound.unlock(), { capture: true });
  window.addEventListener("pagehide", () => {
    // The page may come back (the browser keeps it for Back and Forward), so the lesson is left standing.
    mode?.recordLeft("page-closed");
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
        sound_on: soundOn(settings, params.condition),
        volume: settings.volume,
        audio_available: sound.available(),
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
