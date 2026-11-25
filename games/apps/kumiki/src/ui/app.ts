/** What every screen gets to work with. */

import type { GameEvent } from "@kankyouken/mechanics/telemetry";
import type { Rng } from "@kankyouken/mechanics/util";
import type { LocalStore } from "@kankyouken/web-kit/app";
import type { AssemblyPuzzle, AssemblyState } from "@kankyouken/mechanics/components";
import type { Board } from "../board";
import type { Content } from "../content";
import type { Saved } from "../saved";
import type { Sound } from "../sound";
import type { Arming } from "./arm";

/** Read-only view of the game for the debug handle (`window.__kk`). */
export interface Probe {
  screen: string;
  puzzle: AssemblyPuzzle | null;
  state: AssemblyState | null;
  board: Board | null;
}

export interface App {
  readonly content: Content;
  readonly store: LocalStore<Saved>;
  readonly rng: Rng;
  readonly sound: Sound;
  readonly probe: Probe;
  /** Holds what a click has just brought on screen (see `armScreen`); `show` does it for every screen. */
  readonly arming: Arming;
  record(event: GameEvent): void;
  /** Replace what is on screen. `leave` runs when the next screen replaces this one. */
  show(name: string, screen: HTMLElement, leave?: () => void): void;
}
