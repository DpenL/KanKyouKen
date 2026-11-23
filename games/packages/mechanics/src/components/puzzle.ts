/**
 * Putting an assembly round together: the structures and the tray of tiles.
 *
 * Mined from Zen Hanzi: several structures to choose from, and a tray that holds the
 * needed components plus at least one look-alike of each. Our own design: where the
 * structures, look-alikes and malformed shapes come from, and how the tray is filled.
 */

import { extractStrokes } from "../glyph/tree";
import type { Glyph } from "../glyph/types";
import type { Rng } from "../util/rng";
import { decompose } from "./decompose";
import { alternativeLayouts } from "./layout";
import { mutationsFor } from "./mutate";
import type { AssemblyPuzzle, ComponentTile, LookAlikeTable, PuzzleOptions } from "./types";

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
}

type TileDraft = Omit<ComponentTile, "id">;

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
 *    structure is offered among `layoutChoices` structures (`alternativeLayouts`
 *    supplies the wrong ones), shuffled.
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
 *  - Fillers from `context.fillers` (random, each shape once, never one already in the
 *    tray) top the tray up to `traySize`; by default that is the tile count so far
 *    rounded up to full rows. `traySize` never removes needed tiles, and the tray stays
 *    short when the fillers run out.
 *  - The tray is shuffled and tiles are numbered "t0", "t1", ... in tray order.
 *
 * The same glyph, context, options and seed give the same puzzle. Throws a RangeError
 * when `maxSlots`, `layoutChoices` or `trayRows` is not a positive integer, or
 * `lookAlikesPerComponent` is negative.
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

  const decomposition = decompose(glyph, context.known ? { maxSlots, known: context.known } : { maxSlots });
  const layouts = rng.shuffle([
    decomposition.layout,
    ...alternativeLayouts(decomposition.layout, layoutChoices - 1, rng),
  ]);
  const correctLayout = layouts.findIndex((layout) => layout.signature === decomposition.layout.signature);

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
    const picked: string[] = [];
    const first = firstPick.get(component);
    if (first !== undefined) picked.push(first);
    for (const candidate of pools.get(component)!) {
      if (picked.length >= perComponent) break;
      if (shown.has(candidate)) continue;
      shown.add(candidate);
      picked.push(candidate);
    }
    for (const lookAlike of picked) {
      tiles.push({ shows: lookAlike, glyph: context.glyphs.get(lookAlike)!, role: "lookalike", imitates: component });
    }
    let missing = perComponent - picked.length;
    if (missing > 0 && allowMalformed) {
      const original = { ...tiles[solution.indexOf(component)]!.glyph, char: component };
      for (const mutated of rng.shuffle(mutationsFor(original, rng))) {
        if (missing === 0) break;
        if (shown.has(mutated.char)) continue;
        shown.add(mutated.char);
        tiles.push({ shows: mutated.char, glyph: mutated, role: "malformed", imitates: component });
        missing--;
      }
    }
  }

  const traySize = options?.traySize ?? Math.ceil(tiles.length / trayRows) * trayRows;
  if (tiles.length < traySize) {
    const fillers = [...new Set(context.fillers ?? [])].filter(
      (filler) => !shown.has(filler) && context.glyphs.has(filler),
    );
    for (const filler of rng.shuffle(fillers)) {
      if (tiles.length >= traySize) break;
      tiles.push({ shows: filler, glyph: context.glyphs.get(filler)!, role: "filler" });
    }
  }

  const tray = rng.shuffle(tiles).map((tile, index): ComponentTile => ({ id: `t${index}`, ...tile }));
  return { target: glyph.char, layouts, correctLayout, solution, tray, trayRows };
}
