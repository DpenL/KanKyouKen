/**
 * Putting an assembly round together: the structures and the tray of tiles.
 *
 * Mined from Zen Hanzi: several structures to choose from, and a tray that holds the
 * needed components plus at least one look-alike of each. Observed in its public demo
 * and offered as options: decoy structures from a catalogue, 18 tiles in three rows,
 * identical copies of right parts (`ZEN_HANZI_PUZZLE`). Our own design: where the right
 * structure, the look-alikes and the malformed shapes come from, and the other ways of
 * choosing structures.
 */

import { extractStrokes } from "../glyph/tree";
import type { Glyph } from "../glyph/types";
import type { Rng } from "../util/rng";
import { decompose, decomposeByPosition } from "./decompose";
import { DEMO_FRAMES, alternativeLayouts, catalogueDecoys, fixedFrames, layoutCatalogue } from "./layout";
import { tellApart } from "./lookalike";
import { mutationsFor } from "./mutate";
import type { AssemblyPuzzle, ComponentTile, Layout, LookAlikeTable, PuzzleOptions, StructureMode } from "./types";

/** What a puzzle is built from besides the target itself. */
export interface PuzzleContext {
  /** Stand-alone glyphs of components, by component key. Tiles without one are cut out of the target. */
  readonly glyphs: ReadonlyMap<string, Glyph>;
  /** Which components pass for which; see `buildLookAlikeTable`. */
  readonly lookAlikes: LookAlikeTable;
  /** Unrelated components that may top up the tray. Only those with a glyph are used. */
  readonly fillers?: readonly string[];
  /** Components a learner can be expected to recognise; limits how finely the target is split (see `decompose`). */
  readonly known?: ReadonlySet<string>;
  /**
   * Components that are one shape at another size or proportion (口 and 囗). Such a
   * pair never shares a tray: on tiles of equal size nobody can tell which is which.
   * Listed once per pair; the relation is symmetric.
   */
  readonly sameShape?: LookAlikeTable;
}

/**
 * A puzzle as the Zen Hanzi demo was seen to lay it out: four frames, the right one and
 * three drawn from the catalogue of nine; 18 tiles in three rows of six, among them
 * identical copies of right parts. Two look-alikes per part and two copies are our
 * numbers (the demo showed one to three of each).
 */
export const ZEN_HANZI_PUZZLE: PuzzleOptions = {
  layoutChoices: 4,
  structures: "catalogue",
  lookAlikesPerComponent: 2,
  trayRows: 3,
  traySize: 18,
  copies: 2,
};

/** Kumiki's puzzles before the demo could be played: wrong structures made for the character, 12 tiles in three rows, no copies. */
export const CLASSIC_PUZZLE: PuzzleOptions = {
  layoutChoices: 4,
  structures: "alternatives",
  lookAlikesPerComponent: 2,
  trayRows: 3,
  traySize: 12,
  copies: 0,
};

type TileDraft = Omit<ComponentTile, "id">;

/**
 * Least visible difference (fraction of the tile) between a made-up shape and any other
 * tile, the component it imitates included. Below this a player cannot see what is wrong
 * with the tile, or cannot tell it from a real component next to it (氵 with a stroke
 * dropped beside 冫).
 */
export const MIN_MALFORMED_DIFFERENCE = 0.1;

/**
 * Least visible difference between two real components in one tray. Lower than for
 * made-up shapes on purpose: genuine near-twins (夂 and 攵, 鳥 and 烏) are what the
 * player is meant to learn to tell apart.
 */
export const MIN_TILE_DIFFERENCE = 0.06;

const STRUCTURE_MODES: readonly StructureMode[] = ["alternatives", "catalogue", "fixed", "positions"];

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`createAssemblyPuzzle: ${name} must be a positive integer, got ${value}`);
  }
  return value;
}

/**
 * Give as many components as possible one look-alike each, no look-alike used twice
 * (augmenting paths over the candidate lists, tried in the order given).
 */
function matchLookAlikes(components: readonly string[], pools: ReadonlyMap<string, readonly string[]>): Map<string, string> {
  const holder = new Map<string, string>();
  const place = (component: string, visited: Set<string>): boolean => {
    for (const candidate of pools.get(component) ?? []) {
      if (visited.has(candidate)) continue;
      visited.add(candidate);
      const current = holder.get(candidate);
      if (current === undefined || place(current, visited)) {
        holder.set(candidate, component);
        return true;
      }
    }
    return false;
  };
  for (const component of components) place(component, new Set());
  const matched = new Map<string, string>();
  for (const [candidate, component] of holder) matched.set(component, candidate);
  return matched;
}

/**
 * Build an assembly puzzle for a character.
 *
 *  - The character is decomposed into at most `maxSlots` parts (`decompose`). Its
 *    structure is offered among `layoutChoices` structures. Where the others come from
 *    is up to `structures` (see `StructureMode`): made for the character and shuffled
 *    ("alternatives", the default), drawn from the catalogue `frames` and shuffled
 *    ("catalogue", as in the Zen Hanzi demo), or one fixed set of frames in fixed places
 *    ("fixed"). Under "positions" the character is split once by its source's position
 *    labels instead (`decomposeByPosition`; where they are missing, in two by `decompose`)
 *    and the fixed set is the position classes. No two structures on offer look alike.
 *  - The tray gets one "correct" tile per slot, so a component needed twice is there
 *    twice. A tile shows the component's stand-alone glyph from `context.glyphs` when
 *    there is one with as many strokes as the part; otherwise the part's strokes cut
 *    out of the target (still in the target's glyph space).
 *  - Every distinct correct component gets `lookAlikesPerComponent` distractors: real
 *    look-alikes from the table that have a glyph and are not needed by this target,
 *    chosen at random; when the table has too few and `allowMalformed` is on, made-up
 *    shapes from `mutationsFor` (shown as `<component>~<kind>`). Look-alikes are shared
 *    out so that as many components as possible get at least one, and no shape appears
 *    on two distractor tiles. A component is left without a distractor only when its
 *    look-alikes are all taken or missing and no mutation applies (or is allowed).
 *  - No tile may look like another. A made-up shape must differ visibly from every
 *    other tile, the component it imitates included (`MIN_MALFORMED_DIFFERENCE`); two
 *    real components may be closer (`MIN_TILE_DIFFERENCE`). Candidates that fail are
 *    skipped. So a mutation whose extra stroke lands on an existing one, or that
 *    happens to equal a real component on offer, never reaches the player.
 *  - `copies` identical copies of right parts follow (role "copy"), one per distinct part
 *    in turn, in random order, as long as an explicit `traySize` has room. A copy shows
 *    what its original shows, so it is accepted in its place; being right, it is exempt
 *    from the rule that no tile may look like another.
 *  - Fillers from `context.fillers` (random, each shape once, never one already in the
 *    tray) top the tray up to `traySize`; by default that is the tile count so far
 *    rounded up to full rows. `traySize` never removes needed tiles, and the tray stays
 *    short when the fillers run out.
 *  - The tray is shuffled and tiles are numbered "t0", "t1", ... in tray order.
 *
 * The same glyph, context, options and seed give the same puzzle. Throws a RangeError
 * when `maxSlots`, `layoutChoices` or `trayRows` is not a positive integer,
 * `lookAlikesPerComponent` or `copies` is negative, or `structures` names no mode.
 */
export function createAssemblyPuzzle(
  glyph: Glyph,
  context: PuzzleContext,
  options: PuzzleOptions | undefined,
  rng: Rng,
): AssemblyPuzzle {
  const maxSlots = positiveInteger(options?.maxSlots ?? 4, "maxSlots");
  const layoutChoices = positiveInteger(options?.layoutChoices ?? 4, "layoutChoices");
  const trayRows = positiveInteger(options?.trayRows ?? 3, "trayRows");
  const perComponent = Math.floor(options?.lookAlikesPerComponent ?? 1);
  if (!(perComponent >= 0)) {
    throw new RangeError(`createAssemblyPuzzle: lookAlikesPerComponent must not be negative, got ${perComponent}`);
  }
  const allowMalformed = options?.allowMalformed ?? true;
  const copies = Math.floor(options?.copies ?? 0);
  if (!(copies >= 0)) throw new RangeError(`createAssemblyPuzzle: copies must not be negative, got ${copies}`);

  const structures = options?.structures ?? "alternatives";
  if (!STRUCTURE_MODES.includes(structures)) {
    throw new RangeError(`createAssemblyPuzzle: unknown structures ${JSON.stringify(structures)}`);
  }

  const split = (most: number): ReturnType<typeof decompose> =>
    decompose(glyph, context.known ? { maxSlots: most, known: context.known } : { maxSlots: most });
  const decomposition = structures === "positions" ? (decomposeByPosition(glyph) ?? split(2)) : split(maxSlots);
  let layouts: Layout[];
  let correctLayout: number;
  if (structures === "fixed" || structures === "positions") {
    const frames = options?.frames ?? (structures === "positions" ? layoutCatalogue(2) : DEMO_FRAMES);
    ({ layouts, correct: correctLayout } = fixedFrames(decomposition.layout, frames, layoutChoices));
  } else {
    const wrong =
      structures === "catalogue"
        ? catalogueDecoys(decomposition.layout, options?.frames ?? DEMO_FRAMES, layoutChoices - 1, rng)
        : alternativeLayouts(decomposition.layout, layoutChoices - 1, rng);
    layouts = rng.shuffle([decomposition.layout, ...wrong]);
    correctLayout = layouts.findIndex((layout) => layout.signature === decomposition.layout.signature);
  }

  const solution = decomposition.components;
  const tileGlyph = (slot: number): Glyph => {
    const component = solution[slot]!;
    const strokes = decomposition.strokes[slot]!;
    const canonical = context.glyphs.get(component);
    return canonical !== undefined && canonical.strokes.length === strokes.length
      ? canonical
      : extractStrokes(glyph, strokes, component);
  };
  const tiles: TileDraft[] = solution.map((component, slot) => ({
    shows: component,
    glyph: tileGlyph(slot),
    role: "correct",
  }));
  const shown = new Set(solution);
  const twins = new Set<string>();
  for (const [key, list] of Object.entries(context.sameShape ?? {})) {
    for (const other of list) {
      twins.add(`${key}\n${other}`);
      twins.add(`${other}\n${key}`);
    }
  }
  // Correct tiles may repeat (a component needed twice); every other tile must be told apart from all tiles.
  const distinctFromTray = (shows: string, shape: Glyph, madeUp = false): boolean =>
    tiles.every(
      (tile) =>
        !twins.has(`${tile.shows}\n${shows}`) &&
        tellApart(tile.glyph, shape, madeUp || tile.role === "malformed" ? MIN_MALFORMED_DIFFERENCE : MIN_TILE_DIFFERENCE),
    );

  const distinct = [...shown];
  const pools = new Map<string, string[]>();
  for (const component of distinct) {
    const candidates = [...new Set(context.lookAlikes[component] ?? [])].filter(
      (candidate) => !shown.has(candidate) && context.glyphs.has(candidate),
    );
    pools.set(component, rng.shuffle(candidates));
  }
  const firstPick = perComponent > 0 ? matchLookAlikes(distinct, pools) : new Map<string, string>();
  for (const candidate of firstPick.values()) shown.add(candidate);

  for (const component of distinct) {
    const first = firstPick.get(component);
    const pool = pools.get(component)!;
    let missing = perComponent;
    for (const candidate of first === undefined ? pool : [first, ...pool]) {
      if (missing === 0) break;
      if (shown.has(candidate) && candidate !== first) continue;
      shown.add(candidate);
      const shape = context.glyphs.get(candidate)!;
      if (!distinctFromTray(candidate, shape)) continue;
      tiles.push({ shows: candidate, glyph: shape, role: "lookalike", imitates: component });
      missing--;
    }
    if (missing > 0 && allowMalformed) {
      const original = { ...tiles[solution.indexOf(component)]!.glyph, char: component };
      for (const mutated of rng.shuffle(mutationsFor(original, rng))) {
        if (missing === 0) break;
        if (shown.has(mutated.char)) continue;
        if (!distinctFromTray(mutated.char, mutated, true)) continue;
        shown.add(mutated.char);
        tiles.push({ shows: mutated.char, glyph: mutated, role: "malformed", imitates: component });
        missing--;
      }
    }
  }

  // Copies of right parts: tiles that are right like their originals, so nothing has to tell them apart.
  const room = options?.traySize === undefined ? copies : Math.min(copies, options.traySize - tiles.length);
  const copied = room > 0 ? rng.shuffle(distinct) : [];
  for (let dealt = 0; dealt < room; dealt++) {
    const original = tiles[solution.indexOf(copied[dealt % copied.length]!)]!;
    tiles.push({ shows: original.shows, glyph: original.glyph, role: "copy" });
  }

  const traySize = options?.traySize ?? Math.ceil(tiles.length / trayRows) * trayRows;
  if (tiles.length < traySize) {
    const fillers = [...new Set(context.fillers ?? [])].filter(
      (filler) => !shown.has(filler) && context.glyphs.has(filler),
    );
    for (const filler of rng.shuffle(fillers)) {
      if (tiles.length >= traySize) break;
      const shape = context.glyphs.get(filler)!;
      if (!distinctFromTray(filler, shape)) continue;
      tiles.push({ shows: filler, glyph: shape, role: "filler" });
    }
  }

  const tray = rng.shuffle(tiles).map((tile, index): ComponentTile => ({ id: `t${index}`, ...tile }));
  return { target: glyph.char, layouts, correctLayout, solution, parts: decomposition.strokes, tray, trayRows };
}
