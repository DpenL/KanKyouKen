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
 * What the paper leaves open (when an attempt is judged, lives, hint cost, scoring, which
 * structures and how many tiles are offered) defaults to what the public demo of Zen
 * Hanzi was seen to do, each with our own alternatives as options; see MECHANICS.md
 * Part 2, "The options". Our own design throughout: deriving structures and slots from
 * stroke data, computing look-alikes from shape, and generating malformed variants.
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
 *  - "copy":      an identical copy of a correct tile; accepted wherever the original is.
 *  - "lookalike": a real component that resembles a correct one.
 *  - "malformed": a made-up shape derived from a correct one (see MutationKind).
 *  - "filler":    an unrelated component.
 */
export type TileRole = "correct" | "copy" | "lookalike" | "malformed" | "filler";

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
  /** Strokes of the target (indices into its glyph) drawn in each slot of the right structure. */
  readonly parts: readonly (readonly number[])[];
  /** Tiles on offer, shuffled. Hosts lay them out in `trayRows` rows. */
  readonly tray: readonly ComponentTile[];
  readonly trayRows: number;
}

/**
 * Which structures are offered next to the right one. The right structure of a character
 * is the same under all of them (but see "positions").
 *  - "alternatives" (Kumiki classic, our own design): wrong structures chosen for the
 *    character, near misses first, with as many slots as it has parts
 *    (`alternativeLayouts`). The number of slots gives the number of parts away.
 *  - "catalogue" (observed in the Zen Hanzi demo): decoys drawn afresh for every puzzle
 *    from a fixed catalogue of frames (`frames`), whatever their number of slots
 *    (`catalogueDecoys`).
 *  - "fixed" (our own, the simplest version): one set of frames for every character,
 *    always in the same places; only the character and its parts change (`fixedFrames`).
 *  - "positions" (our own): the character is split once, where its source labels the
 *    positions of its two top-level parts (left and right, top and bottom, an enclosing
 *    part and what it holds; `decomposeByPosition`), and the frames are those position
 *    classes, one fixed set as under "fixed". `maxSlots` plays no part.
 */
export type StructureMode = "alternatives" | "catalogue" | "fixed" | "positions";

export interface PuzzleOptions {
  /** Most slots a character is broken into; finer components are merged upward. Default 4. */
  readonly maxSlots?: number;
  /** Structures on offer, including the right one. Default 4. */
  readonly layoutChoices?: number;
  /** Where the structures beside the right one come from. Default "alternatives". */
  readonly structures?: StructureMode;
  /**
   * The frames of "catalogue", "fixed" and "positions". Default: the nine frames of the
   * Zen Hanzi demo (`DEMO_FRAMES`), and under "positions" every two-slot structure
   * (`layoutCatalogue(2)`: side by side, stacked, and the seven enclosures).
   */
  readonly frames?: readonly Layout[];
  /** Look-alikes added for each distinct correct component. Default 1. */
  readonly lookAlikesPerComponent?: number;
  /** Allow made-up malformed shapes when a component has too few real look-alikes. Default true. */
  readonly allowMalformed?: boolean;
  /** Tray rows. Default 3. */
  readonly trayRows?: number;
  /** Tiles in the tray; unrelated fillers top it up. Default: just enough for correct tiles and look-alikes, rounded up to full rows. */
  readonly traySize?: number;
  /**
   * Identical copies of right parts dealt on top of the needed tiles, as the Zen Hanzi
   * demo was seen to do (three tiles of one part, any of which was accepted). Up to this
   * many, one per distinct part in turn. Default 0.
   */
  readonly copies?: number;
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

/**
 * How many hearts a character starts with (see `heartsFor`). Our own design; the Zen
 * Hanzi demo only has "fixed".
 *  - "fixed": `lives` hearts, whatever the character.
 *  - "parts": scaled to the number of parts: `lives` is what a character of three parts
 *    gets, others get proportionally more or fewer (rounded to half a heart, at least one).
 *    The hearts on show then give away how many parts the character has.
 *  - "adaptive": `lives` for the first character of a run; one more after a character
 *    that took two or more wrong attempts or was lost, one fewer after a first-try solve
 *    (see `nextRoundStart`), within two hearts of `lives` and never below one.
 */
export type LivesRule = "fixed" | "parts" | "adaptive";

/**
 * How points are earned.
 *  - "classic" (Kumiki, our own numbers): only a solve earns: `baseScore` less
 *    `attemptCost` per wrong attempt, at least `minScore`.
 *  - "demo" (observed in the Zen Hanzi demo, the formula inferred from the values seen):
 *    a wrong attempt still earns 100 for the right structure, 10 per placed part that
 *    belongs and 10 per part in its own slot; a solve of n parts at attempt k earns
 *    100 + n x (120 - 20k), plus 500 at the first attempt and 200 at the second
 *    (`DEMO_SCORING`). The points of a round add up, solved or not.
 * Under either, hints take `hintCost` points each off a solve only under the hint policy
 * "points".
 */
export type Scoring = "classic" | "demo";

/**
 * What a look at the whole character costs.
 *  - "life": `hintLives` hearts (the demo: half a heart, and no points). Free when the
 *    rules have no lives. The last hearts can be spent on it, which loses the round.
 *  - "points": `hintCost` points off what solving the character is worth (Kumiki classic).
 *  - "token": an up-front cost: one hint token, earned by solving a character at the
 *    first attempt without a hint (`tokenStart` to begin with, never more than `tokenMax`).
 *  - "return": a consequence: the character comes back later in the run (`roundOutcome`).
 *  - "unmastered": a consequence: the character is solved but does not count as mastered.
 *  - "free": nothing.
 *  - "off": there are no hints.
 * All but "life" are our own design.
 */
export type HintPolicy = "life" | "points" | "token" | "return" | "unmastered" | "free" | "off";

export interface AssemblyRules {
  /** When an attempt is judged. */
  readonly check: CheckTrigger;
  /** What stays on the board after an attempt that did not solve the puzzle. */
  readonly afterCheck: AfterCheck;
  /**
   * Hearts to start with (see `livesRule`); null for no lives at all, i.e. unlimited
   * tries. Whole or half hearts.
   */
  readonly lives: number | null;
  readonly livesRule: LivesRule;
  /** Hearts a wrong attempt costs: 0, 0.5 (the demo) or 1 (Kumiki classic). */
  readonly wrongCost: number;
  /** Hearts a solve gives back (the demo: 1), never beyond what the round started out of. */
  readonly solveGain: number;
  readonly scoring: Scoring;
  /** "classic" scoring: points for solving at the first attempt. */
  readonly baseScore: number;
  /** "classic" scoring: points lost per wrong attempt. */
  readonly attemptCost: number;
  /** Points a hint takes off a solve under the hint policy "points". */
  readonly hintCost: number;
  /** A solve is never worth less than this. */
  readonly minScore: number;
  readonly hint: HintPolicy;
  /** Hearts a hint costs under the hint policy "life". */
  readonly hintLives: number;
  /** Hint tokens a run starts with, and the most that can be held, under the hint policy "token". */
  readonly tokenStart: number;
  readonly tokenMax: number;
}

/**
 * What a round is given by the run it is part of (see `nextRoundStart`); everything left
 * out comes from the rules.
 */
export interface RoundStart {
  /** Hearts left over from the round before. */
  readonly livesLeft?: number | null;
  /** The most hearts the round can hold, instead of `heartsFor`. */
  readonly livesMax?: number | null;
  /** Hint tokens in hand. */
  readonly hintTokens?: number;
}

export interface AssemblyState {
  readonly attempts: number;
  readonly hintsUsed: number;
  /** Hearts left (whole or half), or null when there are no lives. */
  readonly livesLeft: number | null;
  /** The most hearts this round can hold, or null when there are no lives. */
  readonly livesMax: number | null;
  /** Hint tokens in hand (only spent and earned under the hint policy "token"). */
  readonly hintTokens: number;
  readonly memory: AssemblyMemory;
  readonly solved: boolean;
  /** Out of lives. */
  readonly failed: boolean;
  /** Points earned so far: under "classic" scoring 0 until solved; under "demo" the partial points of wrong attempts too. */
  readonly score: number;
  readonly history: readonly { readonly attempt: AssemblyAttempt; readonly feedback: AssemblyFeedback }[];
}

/**
 * What the rules of a run add to those of a round (see `roundOutcome`, `nextRoundStart`).
 *  - `livesScope` "run": the hearts left go from one character to the next (the demo);
 *    "character": every character starts with its full hearts (Kumiki classic). The
 *    dynamic lives rules ("parts", "adaptive") count per character whatever this says.
 *  - `atZero` "end-run": out of hearts, the whole run is over (the demo);
 *    "fail-character": only the character is lost, and it comes back later (Kumiki classic).
 */
export interface RunRules {
  readonly livesScope: "run" | "character";
  readonly atZero: "end-run" | "fail-character";
}

/** How a finished round counts in its run. */
export interface RoundOutcome {
  readonly solved: boolean;
  /** Solved, and no hint was taken under the hint policy "unmastered". */
  readonly mastered: boolean;
  /**
   * The character should be played again later in the run: lost under "fail-character",
   * or solved with a hint under the hint policy "return".
   */
  readonly returns: boolean;
  /** Out of hearts under "end-run": the run is over. */
  readonly endsRun: boolean;
}

/** "learn": the character is shown before assembly. "review": only meaning and reading are given. */
export type AssemblyMode = "learn" | "review";
