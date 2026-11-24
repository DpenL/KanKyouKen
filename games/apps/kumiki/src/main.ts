import { loadStarterJa } from "@kankyouken/glyph-data";
import { gameEvent, type GameEvent } from "@kankyouken/mechanics/telemetry";
import { createRng } from "@kankyouken/mechanics/util";
import { createLocalStore, readLaunchParams, storeKeyFor } from "@kankyouken/web-kit/app";
import { installGlyphCss } from "@kankyouken/web-kit/render";
import { buildContent } from "./content";
import { DEFAULT_SAVED, STORE_KEY, cleanSaved, type Saved } from "./saved";
import { createSound } from "./sound";
import { APP_VERSION, createTelemetry } from "./telemetry";
import type { App, Probe } from "./ui/app";
import { startFlow } from "./ui/flow";
import "./styles.css";

declare global {
  interface Window {
    /** Debug handle, present with `?debug`. */
    __kk?: Readonly<Probe> & { readonly events: readonly GameEvent[]; readonly seed: string };
  }
}

function freshSeed(): string {
  const words = new Uint32Array(2);
  crypto.getRandomValues(words);
  return [...words].map((word) => word.toString(36)).join("");
}

function start(root: HTMLElement): void {
  installGlyphCss();
  const params = readLaunchParams(location.search, location.hash);
  const seed = params.seed ?? freshSeed();
  const rng = createRng(seed);
  const { glyphs, set } = loadStarterJa();
  const content = buildContent(glyphs, set);
  // A study participant gets settings and best scores of their own, whoever used the device before.
  const store = createLocalStore<Saved>(storeKeyFor(STORE_KEY, params), DEFAULT_SAVED, undefined, cleanSaved);
  const telemetry = createTelemetry(params);
  const sound = createSound(glyphs, rng.fork("sound"), store.get());
  const probe: Probe = { screen: "", puzzle: null, state: null, board: null };
  let leave: (() => void) | undefined;

  const app: App = {
    content,
    store,
    rng,
    sound,
    probe,
    record: (event) => telemetry.sink.record(event),
    show(name, screen, onLeave) {
      leave?.();
      leave = onLeave;
      probe.screen = name;
      root.replaceChildren(screen);
      root.setAttribute("data-screen", name);
      window.scrollTo(0, 0);
      // Keyboard and screen-reader users continue from the new screen, not from the page top.
      screen.tabIndex = -1;
      screen.focus({ preventScroll: true });
    },
  };

  // Browsers only let audio start from a user gesture.
  const unlock = (): void => sound.unlock();
  window.addEventListener("pointerdown", unlock, { capture: true });
  window.addEventListener("keydown", unlock, { capture: true });

  if (params.debug && telemetry.events !== null) {
    const events = telemetry.events;
    window.__kk = {
      events,
      seed,
      get screen() {
        return probe.screen;
      },
      get puzzle() {
        return probe.puzzle;
      },
      get state() {
        return probe.state;
      },
      get board() {
        return probe.board;
      },
    };
  }

  app.record(
    gameEvent("session_start", { ts: Date.now() }, {
      app_version: APP_VERSION,
      seed,
      ...(params.condition === undefined ? {} : { condition: params.condition }),
    }),
  );
  const startedAt = Date.now();
  window.addEventListener("pagehide", () => {
    app.record(gameEvent("session_end", { ts: Date.now() }, { duration_ms: Date.now() - startedAt }));
    void telemetry.sink.flush?.();
  });

  startFlow(app);
}

const root = document.getElementById("app");
if (root !== null) start(root);
