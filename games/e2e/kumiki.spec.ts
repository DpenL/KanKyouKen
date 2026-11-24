import { expect, test, type Page } from "@playwright/test";

const BASE = "http://127.0.0.1:4312/";
const DEBUG = `${BASE}?debug&seed=e2e`;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The parts of the game's debug handle (`window.__kk`) the tests read. */
interface DebugHandle {
  readonly screen: string;
  readonly events: readonly { type: string; item?: string; task?: string; data?: Record<string, unknown> }[];
  readonly puzzle: {
    readonly target: string;
    readonly layouts: readonly { signature: string; slots: readonly { rect: Rect; hole?: Rect }[] }[];
    readonly correctLayout: number;
    readonly solution: readonly string[];
    readonly tray: readonly { id: string; shows: string; role: string }[];
  } | null;
  readonly state: { attempts: number; livesLeft: number | null; solved: boolean; memory: { tiles: Record<string, string> } } | null;
  readonly board: { layout: number | null; slots: readonly (string | null)[] } | null;
}

interface PuzzleInfo {
  target: string;
  slotCounts: number[];
  correctLayout: number;
  solution: string[];
  tray: { id: string; shows: string; role: string }[];
}

function kk(page: Page): Promise<DebugHandle> {
  return page.evaluateHandle(() => (window as unknown as { __kk: DebugHandle }).__kk).then((handle) => handle.jsonValue());
}

async function puzzleInfo(page: Page): Promise<PuzzleInfo> {
  return page.evaluate(() => {
    const puzzle = (window as unknown as { __kk: DebugHandle }).__kk.puzzle!;
    return {
      target: puzzle.target,
      slotCounts: puzzle.layouts.map((layout) => layout.slots.length),
      correctLayout: puzzle.correctLayout,
      solution: [...puzzle.solution],
      tray: puzzle.tray.map((tile) => ({ id: tile.id, shows: tile.shows, role: tile.role })),
    };
  });
}

function events(page: Page, type: string): Promise<{ type: string; item?: string; task?: string; data?: Record<string, unknown> }[]> {
  return page.evaluate(
    (wanted) => (window as unknown as { __kk: DebugHandle }).__kk.events.filter((event) => event.type === wanted).map((event) => ({ ...event })),
    type,
  );
}

/** A point of the viewport that lies on a slot (an enclosure's outer slot is not under its own centre). */
async function slotPoint(page: Page, layout: number, slot: number): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(
    ([layoutIndex, slotIndex]) => {
      const group = document.querySelector(`.slot[data-layout="${layoutIndex}"][data-slot="${slotIndex}"]`);
      const shape = group?.querySelector(".slot-shape");
      if (!group || !shape) return null;
      const box = shape.getBoundingClientRect();
      const tries = [
        [0.5, 0.5],
        [0.5, 0.08],
        [0.08, 0.5],
        [0.92, 0.5],
        [0.5, 0.92],
      ] as const;
      for (const [fx, fy] of tries) {
        const x = box.left + box.width * fx;
        const y = box.top + box.height * fy;
        if (document.elementFromPoint(x, y)?.closest(".slot") === group) return { x, y };
      }
      return null;
    },
    [layout, slot] as const,
  );
  if (point === null) throw new Error(`No reachable point on slot ${slot} of structure ${layout}`);
  return point;
}

async function centre(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).boundingBox();
  if (box === null) throw new Error(`${selector} is not on screen`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drag a tile from the tray into a slot with real mouse movement. */
async function dragTile(page: Page, tileId: string, layout: number, slot: number): Promise<void> {
  const from = await centre(page, `.tray .tile[data-tile="${tileId}"]`);
  const to = await slotPoint(page, layout, slot);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await expect(page.locator(".drag-ghost")).toBeVisible();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await expect(page.locator(`.slot[data-layout="${layout}"][data-slot="${slot}"]`)).toHaveAttribute("data-hover", "true");
  await page.mouse.up();
  await expect(page.locator(".drag-ghost")).toHaveCount(0);
  await expect(page.locator(`.slot[data-layout="${layout}"][data-slot="${slot}"]`)).toHaveAttribute("data-tile", tileId);
}

/** Tile ids that solve the puzzle, one per slot of the right structure. */
function solvingTiles(info: PuzzleInfo): string[] {
  const used = new Set<string>();
  return info.solution.map((shows) => {
    const tile = info.tray.find((candidate) => candidate.shows === shows && !used.has(candidate.id));
    if (!tile) throw new Error(`No tile shows ${shows}`);
    used.add(tile.id);
    return tile.id;
  });
}

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("review: a wrong check is marked, then the character is assembled by dragging", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto(DEBUG);

  // About opens and closes.
  await page.getByRole("button", { name: "About" }).click();
  const about = page.getByRole("dialog");
  await expect(about).toContainText("KanjiVG");
  await expect(about).toContainText("licensed CC BY-SA 3.0");
  await expect(about).toContainText("Independent implementation; not affiliated with the authors.");
  await about.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("radio", { name: /Review/ }).click();
  await page.locator(".deck").first().click();
  await expect(page.locator(".tray .tile")).toHaveCount(12);
  await expect(page.locator(".structure")).toHaveCount(4);
  await expect(page.locator(".lives")).toHaveAttribute("aria-label", "5 of 5 lives left");
  const check = page.getByRole("button", { name: "Check" });
  await expect(check).toBeDisabled();

  const info = await puzzleInfo(page);
  const meaning = await page.locator(".meaning").innerText();
  expect(meaning.length).toBeGreaterThan(0);

  // (a) A deliberately wrong check: a wrong structure, filled with tiles that do not belong.
  const wrongLayout = info.slotCounts.findIndex((_, index) => index !== info.correctLayout);
  const strangers = info.tray.filter((tile) => !info.solution.includes(tile.shows)).map((tile) => tile.id);
  const wrongSlots = info.slotCounts[wrongLayout]!;
  // (c) The first tile is placed by tapping it and then the slot.
  await page.locator(`.tray .tile[data-tile="${strangers[0]}"]`).click();
  await expect(page.locator(`.tray .tile[data-tile="${strangers[0]}"]`)).toHaveAttribute("data-selected", "true");
  const tapAt = await slotPoint(page, wrongLayout, 0);
  await page.mouse.click(tapAt.x, tapAt.y);
  await expect(page.locator(`.slot[data-layout="${wrongLayout}"][data-slot="0"]`)).toHaveAttribute("data-tile", strangers[0]!);
  await expect(page.locator(`.tray .tile[data-tile="${strangers[0]}"]`)).toHaveAttribute("data-placed", "true");
  await expect(page.locator(`.structure[data-layout="${wrongLayout}"]`)).toHaveAttribute("data-active", "true");
  for (let slot = 1; slot < wrongSlots; slot++) await dragTile(page, strangers[slot]!, wrongLayout, slot);

  await expect(check).toBeEnabled();
  await check.click();
  const feedback = page.locator(".feedback");
  await expect(feedback).toContainText("Structure: wrong");
  await expect(feedback).toContainText(`Components: 0 of ${info.solution.length} belong`);
  await expect(feedback).toContainText("Position: cannot be judged until the structure is right");
  await expect(page.locator(`.structure[data-layout="${wrongLayout}"]`)).toHaveAttribute("data-mark", "wrong");
  await expect(page.locator(`.structure[data-layout="${wrongLayout}"] .mark-badge`)).toHaveText("✕");
  await expect(page.locator(`.structure[data-layout="${info.correctLayout}"]`)).toHaveAttribute("data-mark", "untried");
  await expect(page.locator(`.tray .tile[data-tile="${strangers[0]}"]`)).toHaveAttribute("data-mark", "wrong");
  await expect(page.locator(".lives")).toHaveAttribute("aria-label", "4 of 5 lives left");

  const firstAttempts = await events(page, "choice_attempt");
  expect(firstAttempts).toHaveLength(1);
  expect(firstAttempts[0]).toMatchObject({
    item: info.target,
    task: "assembly:review",
    data: { correct: false, target: info.target, attempt: 1, structure_correct: false, correct_components: 0, lives_left: 4 },
  });
  expect(typeof firstAttempts[0]!.data!.response_time_ms).toBe("number");
  expect(firstAttempts[0]!.data!.options).toHaveLength(12);

  // (b) The right tiles into the right slots of the right structure.
  const solving = solvingTiles(info);
  for (const [slot, tileId] of solving.entries()) await dragTile(page, tileId, info.correctLayout, slot);
  // Moving to another structure sent the old placements back to the tray.
  await expect(page.locator(`.structure[data-layout="${wrongLayout}"] .slot[data-filled="true"]`)).toHaveCount(0);
  await expect(page.locator(`.tray .tile[data-tile="${strangers[0]}"]`)).toHaveAttribute("data-placed", "false");
  await check.click();
  await expect(feedback).toContainText("Structure: right");
  await expect(feedback).toContainText(`Components: ${info.solution.length} of ${info.solution.length} belong`);
  await expect(feedback).toContainText("Position: at least one in place");

  const reveal = page.locator(".reveal");
  await expect(reveal).toBeVisible();
  await expect(reveal).toHaveAttribute("data-outcome", "solved");
  await expect(reveal.locator(".eyebrow")).toHaveText("Joined");
  await expect(reveal.locator(".meaning")).toHaveText(meaning);
  await expect(reveal.locator(".points")).toHaveText("+85 points");
  // The real character is written out stroke by stroke.
  await expect(reveal.locator('.kk-stroke[data-state="done"]').first()).toBeVisible();

  const attempts = await events(page, "choice_attempt");
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toMatchObject({
    item: info.target,
    data: { correct: true, attempt: 2, structure_correct: true, correct_positions: info.solution.length },
  });
  expect(String(attempts[1]!.data!.chosen)).toContain(info.solution.join("+"));
  const completed = await events(page, "item_complete");
  expect(completed[0]).toMatchObject({ item: info.target, data: { solved: true, attempts: 2, hints: 0, score: 85 } });
  expect((await events(page, "session_start"))[0]!.data).toMatchObject({ seed: "e2e" });

  // Next brings the following character of the deck.
  await reveal.getByRole("button", { name: "Next" }).click();
  await expect(page.locator(".assembly .bar-progress")).toContainText("2 /");
  expect((await kk(page)).puzzle!.target).not.toBe(info.target);

  expect(errors).toEqual([]);
});

test("learn: the character is shown first, and a hint is counted", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto(DEBUG);
  await page.getByRole("radio", { name: /Learn/ }).click();
  await page.locator(".deck").first().click();

  await expect(page.locator(".preview .glyph-board")).toBeVisible();
  await expect(page.locator(".preview .meaning")).not.toBeEmpty();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".lives")).toHaveText("Unlimited tries");

  await page.getByRole("button", { name: "Hint" }).click();
  await expect(page.locator(".hint-overlay .glyph-board")).toBeVisible();
  expect(await events(page, "hint_shown")).toHaveLength(1);
  await expect(page.locator(".hint-overlay")).toBeHidden({ timeout: 5000 });
  await expect(page.locator('[data-stat="score"]')).toContainText("75");

  // A tile dragged out of its slot and dropped on nothing returns to the tray.
  const info = await puzzleInfo(page);
  const tile = info.tray[0]!.id;
  await dragTile(page, tile, info.correctLayout, 0);
  const from = await slotPoint(page, info.correctLayout, 0);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 300, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(`.tray .tile[data-tile="${tile}"]`)).toHaveAttribute("data-placed", "false");
  expect((await kk(page)).board!.slots.every((id) => id === null)).toBe(true);

  expect(errors).toEqual([]);
});

test("exam: no feedback until the end, then a score per character", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto(DEBUG);
  await page.getByRole("button", { name: "Exam" }).click();
  await page.getByRole("dialog").locator("[data-deck]").first().click();

  await expect(page.locator(".exam .structure")).toHaveCount(1);
  const first = await puzzleInfo(page);
  for (const [slot, tileId] of solvingTiles(first).entries()) {
    await page.locator(`.tray .tile[data-tile="${tileId}"]`).click();
    const at = await slotPoint(page, first.correctLayout, slot);
    await page.mouse.click(at.x, at.y);
  }
  await expect(page.locator(".structure")).toHaveAttribute("data-mark", "untried");
  await page.getByRole("button", { name: "Next" }).click();

  // Every other character is left empty.
  for (;;) {
    const finish = page.getByRole("button", { name: "Finish" });
    if (await finish.isVisible()) {
      await finish.click();
      break;
    }
    await page.getByRole("button", { name: "Next" }).click();
  }
  const results = page.locator(".exam-results");
  await expect(results).toBeVisible();
  await expect(results.locator(".result")).not.toHaveCount(0);
  await expect(results.locator(".result").first()).toContainText(`${first.solution.length} of ${first.solution.length}`);
  await expect(results.locator('[data-total="exam"]')).toContainText(`${first.solution.length} of `);

  const attempts = await events(page, "choice_attempt");
  expect(attempts.every((event) => event.task === "exam")).toBe(true);
  expect(attempts[0]!.data).toMatchObject({ correct: true, slots_correct: first.solution.length, slots_total: first.solution.length });
  expect(attempts[1]!.data).toMatchObject({ correct: false, slots_correct: 0 });

  expect(errors).toEqual([]);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

  test("nothing scrolls sideways and tiles can be placed by touch", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto(DEBUG);
    const fits = (): Promise<boolean> => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(await fits()).toBe(true);

    await page.getByRole("radio", { name: /Review/ }).tap();
    await page.locator(".deck").first().tap();
    await expect(page.locator(".tray .tile")).toHaveCount(12);
    expect(await fits()).toBe(true);

    const info = await puzzleInfo(page);
    const tile = solvingTiles(info)[0]!;
    await page.locator(`.tray .tile[data-tile="${tile}"]`).tap();
    const at = await slotPoint(page, info.correctLayout, 0);
    await page.touchscreen.tap(at.x, at.y);
    await expect(page.locator(`.slot[data-layout="${info.correctLayout}"][data-slot="0"]`)).toHaveAttribute("data-tile", tile);

    expect(errors).toEqual([]);
  });
});
