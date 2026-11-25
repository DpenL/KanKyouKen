/**
 * Component play: building a character out of its components.
 *
 * The player is told which character to build (by meaning and reading, not by shape),
 * picks one of several STRUCTURES (frames that divide the character's area into slots),
 * and fills the slots with component tiles from a tray. The tray always contains at
 * least one LOOK-ALIKE of every correct component, so progress requires noticing small
 * differences. Feedback after each attempt is partial and staged, and every option that
 * has been tried stays marked.
 *
 * Provenance. The assembly task, structure as part of the answer, the guaranteed
 * look-alike per correct component, the three-part feedback (structure right or wrong,
 * how many components are right, whether any is in the right place), per-slot marks only
 * once the structure is found, red/green memory of tried options, the learn/review
 * split and the glyph hint are mined from Zen Hanzi (Keehl, Kao & Melcer 2022).
 * Everything the paper leaves open or built by hand is our own design: deriving
 * structures and slots from stroke data, choosing distractor structures, computing
 * look-alikes from shape, generating malformed variants, and all scoring and lives rules.
 */

import type { Glyph } from "../glyph/types";

/** Axis-aligned rectangle in the unit square (x right, y down). */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Which sides the outer component of an enclosure covers.
 *  "full" 囗 · "top-left" 广 · "bottom-left" 辶 · "top-right" 勹 · "top" 冂 · "bottom" 凵 · "left" 匚
 */
export type EncloseShape = "full" | "top-left" | "bottom-left" | "top-right" | "top" | "bottom" | "left";

/** How a character's area is divided. Leaves are slots. */
export type LayoutNode =
  | { readonly kind: "slot" }
  /** Children side by side, left to right. */
  | { readonly kind: "row"; readonly children: readonly LayoutNode[] }
  /** Children stacked, top to bottom. */
  | { readonly kind: "column"; readonly children: readonly LayoutNode[] }
  /** One outer slot wrapping an inner layout. */
  | { readonly kind: "enclose"; readonly shape: EncloseShape; readonly inner: LayoutNode };

export interface LayoutSlot {
  /** Area the slot occupies. */
  readonly rect: Rect;
  /** For the outer slot of an enclosure: the area given up to what it encloses. */
  readonly hole?: Rect;
}

export interface Layout {
  readonly tree: LayoutNode;
  /**
   * Canonical text form, usable as an id and for equality:
   * "S" slot, "R(...)" row, "C(...)" column, "E:<shape>(inner)" enclosure,
   * e.g. "R(C(S,S),S)" for 胡.
   */
  readonly signature: string;
  /**
   * Slots in canonical order: depth-first through the tree; an enclosure's outer slot
   * comes before the slots it encloses.
   */
  readonly slots: readonly LayoutSlot[];
}

/** A character broken down for assembly. */
export interface Decomposition {
  readonly char: string;
  readonly layout: Layout;
  /**
   * True when `layout` is a guess: some of the parts fitted neither a row, a column nor
   * an enclosure and were lined up in a row or column by their centres as a last resort.
   * The components and their strokes are as reliable as ever; the structure is not, so
   * a host that asks the player for it should leave the character out.
   */
  readonly layoutGuessed: boolean;
  /** Component key (its character) for each slot of `layout`, in slot order. */
  readonly components: readonly string[];
  /** Glyph stroke indices drawn in each slot, in slot order. */
  readonly strokes: readonly (readonly number[])[];
}

/** For each component, the components it is easily mistaken for. */
export type LookAlikeTable = Readonly<Record<string, readonly string[]>>;

/**
 * Ways of deriving a wrong-but-plausible shape from a real component:
 *  - "drop-stroke":  one short stroke is missing.
 *  - "extra-stroke": one stroke is doubled.
 *  - "swap-lengths": two parallel strokes trade lengths (土 becomes 士).
 */
export type MutationKind = "drop-stroke" | "extra-stroke" | "swap-lengths";

/**
 * Why a tile is in the tray. Hosts must not reveal this to the player.
 *  - "correct":   a component of the target.
 *  - "lookalike": a real component that resembles a correct one.
 *  - "malformed": a made-up shape derived from a correct one (see MutationKind).
 *  - "filler":    an unrelated component.
 */
export type TileRole = "correct" | "lookalike" | "malformed" | "filler";

export interface ComponentTile {
  /** Unique within the puzzle. */
  readonly id: string;
  /**
   * What the tile shows: a component key, or `<component>~<mutation>` for malformed
   * shapes. Two tiles with the same `shows` are interchangeable.
   */
  readonly shows: string;
  /** Shape to draw, in its own glyph space. */
  readonly glyph: Glyph;
  readonly role: TileRole;
  /** For look-alikes and malformed tiles: the correct component they imitate. */
  readonly imitates?: string;
}

export interface AssemblyPuzzle {
  readonly target: string;
  /** Structures on offer, shuffled. */
  readonly layouts: readonly Layout[];
  /** Index into `layouts` of the right one. */
  readonly correctLayout: number;
  /** What each slot of the right structure must show (`ComponentTile.shows` values). */
  readonly solution: readonly string[];
  /** Tiles on offer, shuffled. Hosts lay them out in `trayRows` rows. */
  readonly tray: readonly ComponentTile[];
  readonly trayRows: number;
}

export interface PuzzleOptions {
  /** Most slots a character is broken into; finer components are merged upward. Default 4. */
  readonly maxSlots?: number;
  /** Structures on offer, including the right one. Default 4. */
  readonly layoutChoices?: number;
  /** Look-alikes added for each distinct correct component. Default 1. */
  readonly lookAlikesPerComponent?: number;
  /** Allow made-up malformed shapes when a component has too few real look-alikes. Default true. */
  readonly allowMalformed?: boolean;
  /** Tray rows. Default 3. */
  readonly trayRows?: number;
  /** Tiles in the tray; unrelated fillers top it up. Default: just enough for correct tiles and look-alikes, rounded up to full rows. */
  readonly traySize?: number;
}

/** One submission: a structure and, for each of its slots, a tile id (or null for empty). */
export interface AssemblyAttempt {
  readonly layout: number;
  readonly placements: readonly (string | null)[];
}

export interface AssemblyFeedback {
  readonly structureCorrect: boolean;
  /**
   * How many placed tiles belong to the target, counted with multiplicity (two 木 tiles
   * count twice only if the target has two 木).
   */
  readonly correctComponents: number;
  /** Total components the target has. */
  readonly componentCount: number;
  /**
   * Slots of the structure the attempt was made in. Differs from `componentCount` when
   * a wrong structure with more or fewer slots was chosen; the Zen Hanzi demo counts
   * against this ("3/3 Correct" for a four-part character tried in a three-slot frame),
   * which does not give away how many parts the target has.
   */
  readonly slotCount: number;
  /**
   * Tiles sitting in exactly the right slot. Only counted when the structure is right
   * (slots of a wrong structure have no counterpart); otherwise 0.
   */
  readonly correctPositions: number;
  readonly anyInCorrectPosition: boolean;
  readonly solved: boolean;
}

export type TriedMark = "untried" | "wrong" | "right";

/** What the player has learned so far, for tinting options. */
export interface AssemblyMemory {
  /** Per entry of `puzzle.layouts`. */
  readonly layouts: readonly TriedMark[];
  /** Per tile id: "right" if the tile belongs to the target, "wrong" if not, once it has been used in an attempt. */
  readonly tiles: Readonly<Record<string, TriedMark>>;
  /**
   * Per slot of the right structure: tile ids that were tried there and were wrong for
   * that slot. Stays empty until the right structure has been used in an attempt.
   */
  readonly slotMisses: readonly (readonly string[])[];
  readonly structureFound: boolean;
}

/**
 * When an attempt is judged.
 *  - "button": once every slot of a structure holds a tile, the player asks for it
 *    (a Check button). Zen Hanzi's demo and Kumiki both do this.
 *  - "auto": as soon as every slot of a structure holds a tile. Our own option, for
 *    players who should not have to find a button.
 */
export type CheckTrigger = "button" | "auto";

/**
 * What stays in the structure after an attempt that did not solve the puzzle.
 *  - "keep": every tile stays where it was, to be adjusted (Kumiki).
 *  - "keep-correct": only tiles in exactly the right slot of the right structure stay;
 *    the others go back to the tray (observed in the Zen Hanzi demo; the paper's Figure 9
 *    shows a right tile staying).
 *  - "clear": everything goes back to the tray.
 */
export type AfterCheck = "keep" | "keep-correct" | "clear";

export interface AssemblyRules {
  /** When an attempt is judged. */
  readonly check: CheckTrigger;
  /** What stays on the board after an attempt that did not solve the puzzle. */
  readonly afterCheck: AfterCheck;
  /** Wrong attempts allowed before the round is lost; null for unlimited. */
  readonly lives: number | null;
  /** Points for solving at the first attempt without hints. */
  readonly baseScore: number;
  /** Points lost per wrong attempt and per hint. */
  readonly attemptCost: number;
  readonly hintCost: number;
  /** A solved round is never worth less than this. */
  readonly minScore: number;
}

export interface AssemblyState {
  readonly attempts: number;
  readonly hintsUsed: number;
  /** Lives left, or null when unlimited. */
  readonly livesLeft: number | null;
  readonly memory: AssemblyMemory;
  readonly solved: boolean;
  /** Out of lives. */
  readonly failed: boolean;
  /** Points earned; 0 until solved. */
  readonly score: number;
  readonly history: readonly { readonly attempt: AssemblyAttempt; readonly feedback: AssemblyFeedback }[];
}

/** "learn": the character is shown before assembly. "review": only meaning and reading are given. */
export type AssemblyMode = "learn" | "review";
