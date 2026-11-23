import { segmentUnits, type GlyphUnit } from "../glyph/tree";
import type { Glyph } from "../glyph/types";
import type { Box } from "../util/geometry";
import { hashString } from "../util/rng";
import { componentFrame, elementForStroke, generateElements } from "./generate";
import { NEUTRAL_TIMBRE } from "./timbres";
import { resolveMelodyConfig, type PartialMelodyConfig } from "./tuning";
import type {
  GlyphMelody,
  MelodicElement,
  MelodyConfig,
  MelodyStroke,
  MelodyUnit,
  Motif,
  MotifBook,
  PrefixTable,
  TimbreId,
} from "./types";

/** A component as it occurs inside some glyph: the glyph and ALL strokes of the component there, in writing order. */
export interface ComponentInstance {
  readonly glyph: Glyph;
  readonly strokes: readonly number[];
}

export interface MelodistOptions {
  /** Stand-alone glyphs by component key; a component's motif is generated from its glyph here when there is one. */
  readonly glyphs: ReadonlyMap<string, Glyph>;
  /** Overrides for `DEFAULT_MELODY_CONFIG`. */
  readonly config?: PartialMelodyConfig;
  /** Hand-written motifs; they win over the generator. */
  readonly book?: MotifBook;
  /** Which component starts with which, typically from `detectPrefixes`. */
  readonly prefixes?: PrefixTable;
  /** Components that count as units when a glyph is segmented; omitted = every named group. */
  readonly alphabet?: ReadonlySet<string>;
}

export interface Melodist {
  /**
   * The motif of a component. `instance` is where the component occurs; it is only
   * consulted when the component has no hand-written motif and no stand-alone glyph with
   * the same number of strokes. Throws when the motif can be taken from nowhere.
   */
  motif(component: string, instance?: ComponentInstance): Motif;
  /** The melody of a whole character: its components' motifs in stroke order. */
  melody(glyph: Glyph): GlyphMelody;
  /** The configuration in effect, defaults filled in. */
  readonly config: MelodyConfig;
}

interface Entry {
  readonly motif: Motif;
  /** Register shift the motif was generated with; elements generated for it later use the same. */
  readonly shift: number;
}

/**
 * For every unit, all strokes of the component instance it is a run of. A component
 * written in several runs (囗 around 木) gets the strokes of all its runs; a later run is
 * recognised by its offset continuing where an earlier run of the same component stopped.
 */
function instanceStrokes(units: readonly GlyphUnit[]): number[][] {
  const open = new Map<string, number[][]>();
  return units.map((unit) => {
    if (unit.component === null) return [...unit.strokes];
    let instances = open.get(unit.component);
    if (!instances) open.set(unit.component, (instances = []));
    let instance: number[] | undefined;
    if (unit.offset > 0) {
      for (let i = instances.length - 1; i >= 0 && !instance; i--) {
        if (instances[i]!.length === unit.offset) instance = instances[i];
      }
    }
    if (!instance) instances.push((instance = []));
    instance.push(...unit.strokes);
    return instance;
  });
}

/**
 * The composer: hands out one motif per component and assembles the melody of any glyph
 * from them, so that a component sounds the same in every character it occurs in.
 * Stroke -> element, component -> motif and "a composite starts with the motif of the
 * component it starts with" are from Radical Tunes; generating the motifs by rule, the
 * register shift and the timbre assignment are our own design.
 *
 * Where a motif comes from, in order:
 *  1. the book (origin "authored"), whatever the stroke count of the instance;
 *  2. the stand-alone glyph `glyphs.get(component)`, unless an instance is given and
 *     has a different stroke count (a variant form);
 *  3. the instance's own strokes; the first instance seen with a given stroke count
 *     defines the motif for every later instance with that count;
 *  4. otherwise `motif` throws.
 * A generated motif of a component with an entry in `prefixes` starts with the
 * elements of that prefix's motif, unchanged, and continues with generated elements for
 * the remaining strokes, heard in the frame of the whole component and in the prefix's
 * register. The entry is ignored when the prefix has no motif of its own (neither book
 * nor stand-alone glyph) or is not shorter than the component.
 *
 * Register: a component without prefix is shifted up by `hashString(component) %
 * (registerSpread + 1)` scale steps. Timbre: `timbre.assigned[component]`; else, in
 * "single" mode, the first palette entry; else the timbre the book gives; else a palette
 * entry picked by the component's rank in the sorted alphabet, or by its hash when
 * there is no alphabet or the component is not in it. An empty palette yields the
 * neutral timbre.
 *
 * Results are cached: motifs per component, melodies per `glyph.char` (a different
 * glyph object with the same character replaces the cached melody). Two melodists
 * made from equal options return equal results. An invalid tuning throws here.
 */
export function createMelodist(options: MelodistOptions): Melodist {
  const { glyphs, alphabet } = options;
  const book: MotifBook = options.book ?? {};
  const prefixes: PrefixTable = options.prefixes ?? {};
  const config = resolveMelodyConfig(options.config);
  const { tuning } = config;
  const { mode, palette, assigned } = config.timbre;

  const alphabetRank = new Map<string, number>();
  if (alphabet) [...alphabet].sort().forEach((component, rank) => alphabetRank.set(component, rank));

  const timbreFor = (component: string, authored?: TimbreId): TimbreId => {
    if (assigned && Object.hasOwn(assigned, component)) return assigned[component]!;
    if (palette.length === 0) return authored !== undefined && mode !== "single" ? authored : NEUTRAL_TIMBRE;
    if (mode === "single") return palette[0]!;
    if (authored !== undefined) return authored;
    return palette[(alphabetRank.get(component) ?? hashString(component)) % palette.length]!;
  };
  const looseTimbre = mode === "single" ? (palette[0] ?? NEUTRAL_TIMBRE) : NEUTRAL_TIMBRE;

  const ownShift = (component: string): number => hashString(component) % (tuning.registerSpread + 1);

  const authoredOrCanonical = new Map<string, Entry>();
  const fromInstances = new Map<string, Map<number, Entry>>();
  const melodies = new Map<string, { readonly glyph: Glyph; readonly melody: GlyphMelody }>();

  /** Length of the motif a component has without any instance, or undefined when it has none. */
  const standaloneLength = (component: string): number | undefined => {
    if (Object.hasOwn(book, component)) return book[component]!.elements.length;
    const length = glyphs.get(component)?.strokes.length;
    return length === undefined || length === 0 ? undefined : length;
  };

  const generate = (component: string, source: ComponentInstance): Entry => {
    let shift = ownShift(component);
    let head: readonly MelodicElement[] = [];
    let prefix: Motif["prefix"];
    const parent = Object.hasOwn(prefixes, component) ? prefixes[component] : undefined;
    if (parent !== undefined) {
      const parentLength = standaloneLength(parent);
      // A strictly shorter parent at every link is also what keeps a hand-written table with a loop from recursing forever.
      if (parentLength !== undefined && parentLength > 0 && parentLength < source.strokes.length) {
        const base = resolve(parent);
        head = base.motif.elements;
        shift = base.shift;
        prefix = { component: parent, count: head.length };
      }
    }
    const frame = componentFrame(source.glyph, source.strokes);
    const tail = generateElements(source.glyph, source.strokes.slice(head.length), tuning, shift, frame);
    const motif: Motif = {
      component,
      timbre: timbreFor(component),
      elements: [...head, ...tail],
      ...(prefix ? { prefix } : {}),
      origin: "generated",
    };
    return { motif, shift };
  };

  const resolve = (component: string, instance?: ComponentInstance): Entry => {
    const known = authoredOrCanonical.get(component);
    if (Object.hasOwn(book, component)) {
      if (known) return known;
      const authored = book[component]!;
      const entry: Entry = {
        motif: {
          component,
          timbre: timbreFor(component, authored.timbre),
          elements: authored.elements,
          origin: "authored",
        },
        shift: ownShift(component),
      };
      authoredOrCanonical.set(component, entry);
      return entry;
    }
    if (instance && instance.strokes.length === 0) {
      throw new Error(`melodist: the instance of "${component}" in ${instance.glyph.char} has no strokes`);
    }
    const canonical = glyphs.get(component);
    if (canonical && canonical.strokes.length > 0 && (!instance || canonical.strokes.length === instance.strokes.length)) {
      if (known) return known;
      const entry = generate(component, { glyph: canonical, strokes: canonical.strokes.map((_, i) => i) });
      authoredOrCanonical.set(component, entry);
      return entry;
    }
    if (!instance) {
      throw new Error(
        `melodist: no motif for "${component}": it is not in the book, has no stand-alone glyph and no instance was given`,
      );
    }
    let byCount = fromInstances.get(component);
    if (!byCount) fromInstances.set(component, (byCount = new Map()));
    let entry = byCount.get(instance.strokes.length);
    if (!entry) byCount.set(instance.strokes.length, (entry = generate(component, instance)));
    return entry;
  };

  const compose = (glyph: Glyph): GlyphMelody => {
    const units = segmentUnits(glyph, { alphabet });
    const instances = instanceStrokes(units);
    const strokes: MelodyStroke[] = [];
    units.forEach((unit, u) => {
      const { component } = unit;
      if (component === null) {
        const elements = generateElements(glyph, unit.strokes, tuning, 0);
        unit.strokes.forEach((stroke, i) => {
          strokes.push({
            stroke,
            element: elements[i]!,
            timbre: looseTimbre,
            component: null,
            indexInComponent: i,
            unit: u,
            startsUnit: i === 0,
          });
        });
        return;
      }
      const instance: ComponentInstance = { glyph, strokes: instances[u]! };
      const entry = resolve(component, instance);
      let frame: Box | undefined;
      unit.strokes.forEach((stroke, i) => {
        const indexInComponent = unit.offset + i;
        let element = entry.motif.elements[indexInComponent];
        if (!element) {
          frame ??= componentFrame(glyph, instance.strokes);
          element = elementForStroke(glyph.strokes[stroke]!.median, frame, tuning, entry.shift);
        }
        strokes.push({
          stroke,
          element,
          timbre: entry.motif.timbre,
          component,
          indexInComponent,
          unit: u,
          startsUnit: i === 0,
        });
      });
    });
    const melodyUnits: MelodyUnit[] = units.map(({ component, nodeIds, strokes: run, offset }) => ({
      component,
      nodeIds,
      strokes: run,
      offset,
    }));
    return { char: glyph.char, strokes, units: melodyUnits };
  };

  return {
    config,
    motif: (component, instance) => resolve(component, instance).motif,
    melody(glyph) {
      const cached = melodies.get(glyph.char);
      if (cached && cached.glyph === glyph) return cached.melody;
      const melody = compose(glyph);
      melodies.set(glyph.char, { glyph, melody });
      return melody;
    },
  };
}
