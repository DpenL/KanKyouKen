/**
 * Glyph build: converts the KanjiVG files for every character of a set definition into
 * generated/<set>.glyphs.json, and writes the license notice next to it.
 *
 *   npm run build -w @kankyouken/glyph-data
 *
 * KanjiVG files come from the directory in KANJIVG_DIR (a checkout's "kanji" folder)
 * when it is set. Otherwise each file is downloaded once from the pinned revision on
 * GitHub into <workspace>/.cache/kanjivg/<revision>/ and reused from there. Behind a
 * proxy, run with NODE_USE_ENV_PROXY=1 so that Node's fetch honours HTTPS_PROXY.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeGlyphSet } from "@kankyouken/mechanics/glyph";
import type { GlyphSetRecord } from "@kankyouken/mechanics/glyph";
import { collectGlyphs, kanjiVGGlyphSet, noticeText, serializeGlyphSet } from "./tools/glyph-set";
import type { SvgLoader } from "./tools/glyph-set";
import { kanjiVGFileName } from "./tools/kanjivg";
import { setCharacters } from "./tools/set-types";
import type { SetDefinition } from "./tools/set-types";

/** KanjiVG commit every build converts, so that the output is reproducible. */
const KANJIVG_REF = "9d7220dfca09107dca2e0b0e45f90f696185e3c3";
const SET_ID = "starter-ja";
const SIZE = 1000;

const here = dirname(fileURLToPath(import.meta.url));
const workspace = dirname(here);

const isNotFound = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT";

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

function fromDirectory(dir: string): SvgLoader {
  return (char) => readIfPresent(join(dir, kanjiVGFileName(char)));
}

function fromGitHub(cacheDir: string): SvgLoader {
  return async (char) => {
    const name = kanjiVGFileName(char);
    const cached = join(cacheDir, name);
    const absent = `${cached}.missing`;
    const hit = await readIfPresent(cached);
    if (hit !== null) return hit;
    if ((await readIfPresent(absent)) !== null) return null;

    const url = `https://raw.githubusercontent.com/KanjiVG/kanjivg/${KANJIVG_REF}/kanji/${name}`;
    let response: Response;
    try {
      response = await fetch(url);
    } catch (cause) {
      throw new Error(`cannot download ${url} (set KANJIVG_DIR to a local checkout to build offline)`, { cause });
    }
    if (response.status === 404) {
      await writeFile(absent, "");
      return null;
    }
    if (!response.ok) throw new Error(`cannot download ${url}: HTTP ${response.status} ${response.statusText}`);
    const text = await response.text();
    if (!text.includes("kvg:StrokePaths")) throw new Error(`${url} did not return a KanjiVG file`);
    await writeFile(`${cached}.part`, text);
    await rename(`${cached}.part`, cached);
    return text;
  };
}

const list = (chars: readonly string[]): string => (chars.length === 0 ? "none" : `${chars.join(" ")} (${chars.length})`);

async function main(): Promise<void> {
  const set = JSON.parse(await readFile(join(here, "sets", `${SET_ID}.json`), "utf8")) as SetDefinition;
  const requested = setCharacters(set);

  const localDir = process.env.KANJIVG_DIR;
  let load: SvgLoader;
  if (localDir) {
    load = fromDirectory(localDir);
    console.log(`KanjiVG source: ${localDir}`);
  } else {
    const cacheDir = join(workspace, ".cache", "kanjivg", KANJIVG_REF);
    await mkdir(cacheDir, { recursive: true });
    load = fromGitHub(cacheDir);
    console.log(`KanjiVG source: github.com/KanjiVG/kanjivg@${KANJIVG_REF.slice(0, 7)}, cached in ${relative(workspace, cacheDir)}`);
  }

  const result = await collectGlyphs(requested, load, { size: SIZE });
  if (result.glyphs.length === 0) throw new Error("no glyph could be converted; is the KanjiVG source reachable?");

  const record = kanjiVGGlyphSet(result.glyphs, { script: set.script, size: SIZE, revision: KANJIVG_REF });
  const json = serializeGlyphSet(record);
  const decoded = decodeGlyphSet(JSON.parse(json) as GlyphSetRecord);
  if (decoded.size !== result.glyphs.length) {
    throw new Error(`validation: wrote ${result.glyphs.length} glyphs but ${decoded.size} decode`);
  }

  const outDir = join(here, "generated");
  const outFile = join(outDir, `${SET_ID}.glyphs.json`);
  await mkdir(outDir, { recursive: true });
  await writeFile(outFile, json);
  await writeFile(join(outDir, "NOTICE.md"), noticeText(KANJIVG_REF));

  const strokes = result.glyphs.reduce((sum, glyph) => sum + glyph.strokes.length, 0);
  const bytes = Buffer.byteLength(json);
  console.log(`${SET_ID}: ${result.glyphs.length} glyphs, ${strokes} strokes`);
  console.log(`  requested by the set: ${requested.length}, added as components: ${result.added.length}`);
  console.log(`  wrote ${relative(workspace, outFile)}: ${bytes} bytes (${(bytes / 1024).toFixed(1)} KiB)`);
  console.log(`  requested but not in KanjiVG: ${list(result.missing)}`);
  console.log(`  components without a stand-alone file: ${list(result.missingComponents)}`);
  console.log(`  no named component in the tree: ${list(result.unsegmented)}`);
}

try {
  await main();
} catch (error) {
  console.error(`glyph build failed: ${error instanceof Error ? error.message : String(error)}`);
  if (error instanceof Error && error.cause !== undefined) console.error(error.cause);
  process.exitCode = 1;
}
