import { expect, test, type Page } from "@playwright/test";

const BASE = "http://127.0.0.1:4312/";
const DEBUG = `${BASE}?debug&seed=e2e`;
/** Kumiki as it first was (Check below the board, every tile stays, unlimited tries in Learn), for the tests written for it. */
const CLASSIC = `${DEBUG}&rules=classic`;

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

/** Put a tile into a slot by clicking the tile and then the slot. */
async function clickTile(page: Page, tileId: string, layout: number, slot: number): Promise<void> {
  await page.locator(`.tray .tile[data-tile="${tileId}"]`).click();
  const at = await slotPoint(page, layout, slot);
  await page.mouse.click(at.x, at.y);
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
  await page.goto(CLASSIC);

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
  await expect(feedback).toContainText("Position: cannot be judged yet");
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

test("review: a double click on Check is judged once", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto(CLASSIC);
  await page.getByRole("radio", { name: /Review/ }).click();
  await page.locator(".deck").first().click();
  const info = await puzzleInfo(page);
  const strangers = info.tray.filter((tile) => !info.solution.includes(tile.shows)).map((tile) => tile.id);
  for (let slot = 0; slot < info.solution.length; slot++) {
    await page.locator(`.tray .tile[data-tile="${strangers[slot]}"]`).click();
    const at = await slotPoint(page, info.correctLayout, slot);
    await page.mouse.click(at.x, at.y);
  }
  const check = page.getByRole("button", { name: "Check" });
  await check.dblclick();
  await expect(page.locator(".lives")).toHaveAttribute("aria-label", "4 of 5 lives left");
  await expect(check).toBeDisabled();
  expect((await kk(page)).state!.attempts).toBe(1);
  expect(await events(page, "choice_attempt")).toHaveLength(1);

  // Changing the board makes it checkable again.
  await page.locator(`.tray .tile[data-tile="${strangers[info.solution.length]}"]`).click();
  const first = await slotPoint(page, info.correctLayout, 0);
  await page.mouse.click(first.x, first.y);
  await expect(check).toBeEnabled();

  // Leaving in mid-deck is recorded, and the browser's Back leads to the decks, not out of the game.
  await page.getByRole("button", { name: "Decks" }).click();
  await expect(page.locator(".home")).toBeVisible();
  expect((await events(page, "deck_abandoned"))[0]).toMatchObject({ item: info.target, data: { position: 0, score: 0 } });
  await page.locator(".deck").first().click();
  await expect(page.locator(".tray .tile")).toHaveCount(12);
  await page.goBack();
  await expect(page.locator(".home")).toBeVisible();
  expect(page.url()).toBe(CLASSIC);
  expect(await events(page, "deck_abandoned")).toHaveLength(2);

  expect(errors).toEqual([]);
});

test("after the browser's Back and Forward, Back still leads out of the next deck and then out of the game", async ({ page }) => {
  await page.goto(DEBUG);
  await page.locator(".deck").first().click();
  await expect(page.locator(".home")).toHaveCount(0);
  await page.goBack();
  await expect(page.locator(".home")).toBeVisible();
  // Forward cannot bring the deck back: the deck list stays, and history steps off the deck's entry.
  await page.goForward();
  await page.waitForFunction(() => history.state === null, undefined, { timeout: 5_000 });
  await expect(page.locator(".home")).toBeVisible();

  await page.locator(".deck").first().click();
  await expect(page.locator(".home")).toHaveCount(0);
  await page.goBack();
  await expect(page.locator(".home")).toBeVisible();
  expect(page.url()).toBe(DEBUG);
  await page.goBack();
  expect(page.url()).toBe("about:blank");
});

test("stored data of the wrong shape does not break the start", async ({ page }) => {
  const errors = watchConsole(page);
  await page.addInitScript(() => localStorage.setItem("kk.kumiki.v1", '{"best":null,"mode":"exam","volume":"loud"}'));
  await page.goto(DEBUG);
  await expect(page.locator(".deck").first()).toBeVisible();
  await expect(page.getByRole("radio", { name: /Learn/ })).toHaveAttribute("aria-checked", "true");
  // The arrow keys move within the mode group.
  await page.getByRole("radio", { name: /Learn/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: /Review/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: /Review/ })).toBeFocused();
  expect(errors).toEqual([]);
});

test("learn: the character is shown first, and a hint is counted", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto(CLASSIC);
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
  // The second click of a double click must not hand in the next character unseen.
  await page.getByRole("button", { name: "Next" }).dblclick();
  await expect(page.locator(".assembly .bar-progress")).toContainText("2 /");
  expect(await events(page, "choice_attempt")).toHaveLength(1);
  expect((await kk(page)).puzzle!.target).not.toBe(first.target);
  // Nor the third tap of a burst, which comes more than Next's 600 ms off after the first:
  // every press on Next while it is off puts the end off.
  const next = page.getByRole("button", { name: "Next" });
  await expect(next).toBeEnabled();
  await next.click();
  await page.waitForTimeout(300);
  await next.click({ force: true });
  await page.waitForTimeout(300);
  await next.click({ force: true });
  await expect(page.locator(".assembly .bar-progress")).toContainText("3 /");
  await page.waitForTimeout(200);
  expect(await events(page, "choice_attempt")).toHaveLength(2);

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
  const done = await events(page, "exam_complete");
  expect(done).toHaveLength(1);
  expect(done[0]!.data).toMatchObject({ score: first.solution.length, items: attempts.length, answered: attempts.length });

  expect(errors).toEqual([]);
});

test.describe("the default rules, close to the Zen Hanzi demo", () => {
  /** A structure filled with the solving tiles but for the last slot, which gets a tile that does not belong. */
  async function fillAlmostRight(page: Page, info: PuzzleInfo): Promise<string> {
    const stranger = info.tray.find((tile) => !info.solution.includes(tile.shows))!.id;
    const tiles = solvingTiles(info);
    const board = (await kk(page)).board;
    for (const [slot, tileId] of tiles.entries()) {
      const wanted = slot === tiles.length - 1 ? stranger : tileId;
      // What a wrong check left in its right slot stays there.
      if (board?.layout === info.correctLayout && board.slots[slot] === wanted) continue;
      await clickTile(page, wanted, info.correctLayout, slot);
    }
    return stranger;
  }

  test("Check by the full structure, a panel with counts, lives in halves, a hint that stays, a running total", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto(DEBUG);
    expect((await events(page, "session_start"))[0]!.data).toMatchObject({
      rules: "zen-hanzi",
      rules_from: "player",
      choices: { check: "frame", feedback: "panel", lives: "3", livesScope: "run", hint: "life", scoring: "demo", tray: "3x6", structures: "catalogue", board: "compact" },
    });

    await page.getByRole("radio", { name: /Review/ }).click();
    await expect(page.getByRole("radio", { name: /Review/ })).toContainText("3 lives for the run.");
    // The demo keeps a running total and no best score.
    await expect(page.locator(".deck-best")).toHaveCount(0);
    await page.locator(".deck").first().click();
    const screen = page.locator(".assembly");
    await expect(screen).toHaveAttribute("data-board", "compact");
    await expect(page.locator(".tray .tile")).toHaveCount(18);
    await expect(page.locator(".structure")).toHaveCount(4);
    const lives = page.locator(".lives");
    await expect(lives).toHaveAttribute("aria-label", "3 of 3 lives left");

    // 18 tiles in 3 rows of 6 under 4 structures two by two, all on screen without scrolling.
    const shape = await page.evaluate(() => {
      const rowsOf = (selector: string): number[] => {
        const tops = [...document.querySelectorAll(selector)].map((element) => Math.round(element.getBoundingClientRect().top));
        return [...new Set(tops)].map((top) => tops.filter((other) => other === top).length);
      };
      return {
        tray: rowsOf(".tray .tile"),
        frames: rowsOf(".structure"),
        scrolls: document.documentElement.scrollHeight > window.innerHeight || document.documentElement.scrollWidth > window.innerWidth,
        hintAbove: document.querySelector('[data-action="hint"]')!.getBoundingClientRect().bottom <= document.querySelector(".frames")!.getBoundingClientRect().top,
      };
    });
    expect(shape).toEqual({ tray: [6, 6, 6], frames: [2, 2], scrolls: false, hintAbove: true });

    const info = await puzzleInfo(page);
    const parts = info.solution.length;
    // The tray holds identical copies of right parts.
    expect(info.tray.filter((tile) => tile.role === "copy")).toHaveLength(2);
    // No Check anywhere until a structure is full.
    await expect(page.locator('[data-action="check"]')).toHaveCount(0);
    const stranger = await fillAlmostRight(page, info);
    const check = page.locator(".frame-check");
    await expect(check).toBeVisible();
    await expect(page.locator('.structure[data-dim="true"]')).toHaveCount(3);
    // It lies beside the structure, over its neighbour, not over the structure itself.
    const overlap = await page.evaluate((layout) => {
      const button = document.querySelector(".frame-check")!.getBoundingClientRect();
      const own = document.querySelector(`.structure[data-layout="${layout}"]`)!.getBoundingClientRect();
      return button.left < own.right && button.right > own.left && button.top < own.bottom && button.bottom > own.top;
    }, info.correctLayout);
    expect(overlap).toBe(false);
    await check.click();

    const panel = page.locator(".feedback-panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".panel-title")).toHaveText("Not yet");
    await expect(panel.locator('[data-line="structure"]')).toContainText("right");
    await expect(panel.locator('[data-line="parts that belong"]')).toContainText(`${parts - 1} of ${parts}`);
    await expect(panel.locator('[data-line="in their place"]')).toContainText(`${parts - 1} of ${parts}`);
    // 100 for the structure, 10 per part that belongs, 10 per part in its place; half a life gone.
    const partial = 100 + 20 * (parts - 1);
    await expect(panel.locator(".panel-points")).toHaveText(`+${partial} points`);
    await expect(lives).toHaveAttribute("aria-label", "2½ of 3 lives left");
    // While the panel is up nothing can be placed under it.
    await expect(page.locator(".tray .tile").first()).toBeDisabled();
    await panel.getByRole("button", { name: "Continue" }).click();
    await expect(panel).toBeHidden();

    // The tiles in their right slot stay; the other is back in the tray, marked.
    const solving = solvingTiles(info);
    expect((await kk(page)).board).toEqual({ layout: info.correctLayout, slots: [...solving.slice(0, -1), null] });
    await expect(page.locator(`.tray .tile[data-tile="${stranger}"]`)).toHaveAttribute("data-mark", "wrong");
    await expect(page.locator(`.tray .tile[data-tile="${stranger}"]`)).toHaveAttribute("data-placed", "false");
    await expect(page.locator(`.structure[data-layout="${info.correctLayout}"]`)).toHaveAttribute("data-mark", "right");
    // Every tile showing a part that belongs is marked with it, its copies too.
    const marks = (await kk(page)).state!.memory.tiles;
    for (const tile of info.tray.filter((candidate) => candidate.shows === info.solution[0])) expect(marks[tile.id]).toBe("right");

    // A hint costs half a life and no points, and stays until Continue.
    const hintButton = page.getByRole("button", { name: /Hint/ });
    await expect(hintButton).toContainText("½ life");
    await hintButton.click();
    const hint = page.locator(".hint-overlay");
    await expect(hint).toBeVisible();
    await expect(lives).toHaveAttribute("aria-label", "2 of 3 lives left");
    await page.waitForTimeout(3000);
    await expect(hint).toBeVisible();
    await hint.getByRole("button", { name: "Continue" }).click();
    await expect(hint).toBeHidden();

    // The last part in place: solved at the second attempt, one life back.
    await clickTile(page, solving.at(-1)!, info.correctLayout, parts - 1);
    await page.locator(".frame-check").click();
    const solve = 100 + parts * (120 - 20 * 2) + 200;
    await expect(panel.locator(".panel-title")).toHaveText("Joined!");
    await expect(panel.locator(".panel-points")).toHaveText(`+${solve} points`);
    await expect(lives).toHaveAttribute("aria-label", "3 of 3 lives left");
    await panel.getByRole("button", { name: "Continue" }).click();
    const reveal = page.locator(".reveal");
    await expect(reveal).toBeVisible();
    await expect(reveal.locator(".points")).toHaveText(`+${partial + solve} points`);

    const attempts = await events(page, "choice_attempt");
    expect(attempts).toHaveLength(2);
    expect(attempts[0]!.data).toMatchObject({ correct: false, attempt: 1, lives_left: 2.5, lives_max: 3, lives_lost: 0.5, lives_gained: 0, points: partial, score: partial });
    expect(attempts[0]!.data!.options).toHaveLength(18);
    expect(attempts[1]!.data).toMatchObject({ correct: true, attempt: 2, lives_left: 3, lives_lost: 0, lives_gained: 1, points: solve, score: partial + solve });
    expect((await events(page, "hint_shown"))[0]!.data).toMatchObject({
      hint: "character",
      hints_used: 1,
      policy: "life",
      lives_lost: 0.5,
      points_lost: 0,
      tokens_spent: 0,
      consequence: null,
      lives_left: 2,
      out_of_lives: false,
    });
    expect((await events(page, "item_complete"))[0]!.data).toMatchObject({
      solved: true,
      attempts: 2,
      hints: 1,
      score: partial + solve,
      mastered: true,
      returns: false,
      ends_run: false,
      hint_policy: "life",
      lives_left: 3,
      lives_max: 3,
      lives_rule: "fixed",
    });

    // The next character: the lives and the total go on, and the right structure sits among other frames.
    await reveal.getByRole("button", { name: "Next" }).click();
    await expect(page.locator(".assembly .bar-progress")).toContainText("2 /");
    await expect(lives).toHaveAttribute("aria-label", "3 of 3 lives left");
    await expect(page.locator('[data-stat="score"] strong')).toHaveText(String(partial + solve));

    expect(errors).toEqual([]);
  });

  test("out of lives the whole run ends, and nothing comes back", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto(DEBUG);
    await page.getByRole("radio", { name: /Review/ }).click();
    await page.locator(".deck").first().click();
    const info = await puzzleInfo(page);
    const panel = page.locator(".feedback-panel");
    // Six wrong checks of the same answer empty three hearts: the demo charges for each.
    for (let attempt = 1; attempt <= 6; attempt++) {
      await fillAlmostRight(page, info);
      await page.locator(".frame-check").click();
      await expect(panel.locator(".panel-title")).toHaveText(attempt < 6 ? "Not yet" : "Out of lives");
      await panel.getByRole("button", { name: "Continue" }).click();
    }
    const reveal = page.locator(".reveal");
    await expect(reveal).toHaveAttribute("data-outcome", "failed");
    await expect(reveal.locator(".points")).toContainText("The run ends here.");
    await reveal.getByRole("button", { name: "See the run" }).click();

    const summary = page.locator(".summary");
    await expect(summary).toHaveAttribute("data-ended", "out-of-lives");
    await expect(summary.locator('[data-total="solved"]')).toContainText("0 of");
    await expect(summary.locator(".best-line")).toHaveCount(0);
    const completed = await events(page, "item_complete");
    expect(completed).toHaveLength(1);
    expect(completed[0]!.data).toMatchObject({ solved: false, attempts: 6, ends_run: true, returns: false, lives_left: 0 });
    expect((await events(page, "deck_complete"))[0]!.data).toMatchObject({ out_of_lives: true, solved: 0, chars: 1 });
    // Trying again starts from three lives and no points.
    await summary.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator(".lives")).toHaveAttribute("aria-label", "3 of 3 lives left");
    await expect(page.locator('[data-stat="score"] strong')).toHaveText("0");

    expect(errors).toEqual([]);
  });

  test("a run that the lives ended is recorded as complete, also when the player leaves before its summary", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto(DEBUG);
    await page.getByRole("radio", { name: /Review/ }).click();
    await page.locator(".deck").first().click();
    const info = await puzzleInfo(page);
    const panel = page.locator(".feedback-panel");
    for (let attempt = 1; attempt <= 6; attempt++) {
      await fillAlmostRight(page, info);
      await page.locator(".frame-check").click();
      await expect(panel.locator(".panel-title")).toHaveText(attempt < 6 ? "Not yet" : "Out of lives");
      await panel.getByRole("button", { name: "Continue" }).click();
    }
    await expect(page.locator(".reveal")).toHaveAttribute("data-outcome", "failed");
    // Only the first five wrong checks on a character earn points: 5 x (100 + 10 per part that belongs + 10 per part in place).
    const checks = await events(page, "choice_attempt");
    expect(checks).toHaveLength(6);
    expect(checks[4]!.data.points).toBeGreaterThan(0);
    expect(checks[5]!.data).toMatchObject({ points: 0, score: checks[4]!.data.score });
    // The browser's Back from the reveal: nothing is left to play, so the run is complete, not abandoned.
    await page.goBack();
    await expect(page.locator(".home")).toBeVisible();
    expect(await events(page, "deck_abandoned")).toEqual([]);
    const complete = await events(page, "deck_complete");
    expect(complete).toHaveLength(1);
    expect(complete[0]!.data).toMatchObject({ out_of_lives: true, solved: 0, chars: 1 });

    expect(errors).toEqual([]);
  });
});

test.describe("choosing the rules", () => {
  test("Settings: a preset and single rules; the choice is recorded, kept, and played from the next deck", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto(DEBUG);
    await page.getByRole("button", { name: "Settings" }).click();
    const dialog = page.getByRole("dialog");
    const preset = dialog.locator("#setting-preset");
    const link = dialog.locator('[data-setting="rules-link"]');
    await expect(preset).toHaveValue("zen-hanzi");
    await expect(preset.locator("option")).toHaveText(["Close to the paper", "Kumiki classic", "Gentle", "Study: no hints"]);
    await expect(dialog.locator('[data-setting="rules-fixed"]')).toHaveCount(0);
    await expect(link).toHaveText("?rules=zen-hanzi");

    await preset.selectOption("classic");
    await expect(dialog.locator('[data-setting="preset-note"]')).toContainText("Kumiki as it first was");
    await expect(link).toHaveText("?rules=classic");
    // The mode switch behind the dialog says what the rules give.
    await expect(page.locator('.mode[data-mode="review"]')).toContainText("5 lives per character.");

    // Every single rule is there, showing the preset's value.
    const details = dialog.locator('[data-setting="single-rules"]');
    await details.locator("summary").click();
    await expect(details.locator("select")).toHaveCount(16);
    await expect(dialog.locator("#rule-hint")).toHaveValue("points");
    await expect(dialog.locator("#rule-tray")).toHaveValue("3x4");
    await expect(dialog.getByRole("button", { name: "Back to the preset" })).toBeHidden();
    await dialog.locator("#rule-hint").selectOption("free");
    await expect(dialog.locator('[data-rule-row="hint"]')).toHaveAttribute("data-changed", "");
    await expect(details.locator("summary")).toHaveText("Single rules (1 changed)");
    await expect(link).toHaveText("?rules=classic,hint:free");
    // Without lives, what they cost is switched off.
    await dialog.locator("#rule-lives").selectOption("none");
    await expect(dialog.locator("#rule-wrongCost")).toBeDisabled();
    await expect(page.locator('.mode[data-mode="review"]')).toContainText("Unlimited tries.");
    await dialog.locator("#rule-lives").selectOption("5");
    await expect(dialog.locator("#rule-wrongCost")).toBeEnabled();
    await expect(link).toHaveText("?rules=classic,hint:free");

    const changes = await events(page, "rules_change");
    expect(changes.map((event) => event.data!.rules)).toEqual(["classic", "classic,hint:free", "classic,lives:none,hint:free", "classic,hint:free"]);
    expect(changes[0]!.data).toMatchObject({ from: "zen-hanzi", choices: { check: "bar", tray: "3x4", structures: "alternatives" } });
    expect(changes[1]!.data).toMatchObject({ from: "classic", choices: { hint: "free" } });
    await dialog.getByRole("button", { name: "Close" }).click();

    // The next deck plays by them: Kumiki's board, with a hint that costs nothing.
    await page.getByRole("radio", { name: /Review/ }).click();
    await page.locator(".deck").first().click();
    await expect(page.locator(".assembly")).toHaveAttribute("data-board", "wide");
    await expect(page.locator(".assembly")).toHaveAttribute("data-check", "bar");
    await expect(page.locator(".tray .tile")).toHaveCount(12);
    await expect(page.locator(".lives")).toHaveAttribute("aria-label", "5 of 5 lives left");
    await expect(page.locator('[data-stat="worth"]')).toContainText("+100");
    await page.getByRole("button", { name: "Hint" }).click();
    await expect(page.locator('[data-stat="worth"]')).toContainText("+100");
    expect((await events(page, "hint_shown"))[0]!.data).toMatchObject({ policy: "free", points_lost: 0, lives_lost: 0 });

    // They are kept for the next visit, and the session says so.
    await page.goto(DEBUG);
    expect((await events(page, "session_start"))[0]!.data).toMatchObject({ rules: "classic,hint:free", rules_from: "player", choices: { hint: "free", check: "bar" } });
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(preset).toHaveValue("classic");
    await details.locator("summary").click();
    await expect(dialog.locator("#rule-hint")).toHaveValue("free");
    await dialog.getByRole("button", { name: "Back to the preset" }).click();
    await expect(dialog.locator("#rule-hint")).toHaveValue("points");
    await expect(link).toHaveText("?rules=classic");
    expect((await events(page, "rules_change")).map((event) => event.data!.rules)).toEqual(["classic"]);

    expect(errors).toEqual([]);
  });

  test("a link that names the rules fixes them: Settings shows them but cannot change them", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto(`${DEBUG}&rules=study-no-hints,tray:2x4,colour:red`);
    expect((await events(page, "session_start"))[0]!.data).toMatchObject({
      rules: "study-no-hints,tray:2x4",
      rules_from: "link",
      rules_ignored: ["colour:red"],
      choices: { hint: "off", tray: "2x4", check: "frame" },
    });
    await page.getByRole("button", { name: "Settings" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator('[data-setting="rules-fixed"]')).toContainText("set by the link");
    await expect(dialog.locator("#setting-preset")).toBeDisabled();
    await expect(dialog.locator("#setting-preset")).toHaveValue("study-no-hints");
    await dialog.locator('[data-setting="single-rules"] summary').click();
    await expect(dialog.locator("#rule-tray")).toHaveValue("2x4");
    await expect(dialog.locator("#rule-hint")).toHaveValue("off");
    await expect(dialog.locator("select:enabled")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Back to the preset" })).toBeHidden();
    await expect(dialog.locator('[data-setting="rules-link"]')).toHaveText("?rules=study-no-hints,tray:2x4");
    // Sound stays the player's own.
    await expect(dialog.locator("#setting-sound")).toBeEnabled();
    await dialog.getByRole("button", { name: "Close" }).click();
    expect(await events(page, "rules_change")).toEqual([]);

    // The deck plays by them: no Hint, eight tiles in two rows.
    await page.getByRole("radio", { name: /Review/ }).click();
    await page.locator(".deck").first().click();
    await expect(page.locator(".tray .tile")).toHaveCount(8);
    await expect(page.locator('[data-action="hint"]')).toHaveCount(0);
    expect(await page.evaluate(() => new Set([...document.querySelectorAll(".tray .tile")].map((tile) => Math.round(tile.getBoundingClientRect().top))).size)).toBe(2);

    // The link's rules are not stored as the player's own.
    await page.goto(DEBUG);
    expect((await events(page, "session_start"))[0]!.data).toMatchObject({ rules: "zen-hanzi", rules_from: "player" });

    expect(errors).toEqual([]);
  });

  test("a link whose preset is mistyped still fixes the rules, on the default preset and not on what the device has stored", async ({ page }) => {
    const errors = watchConsole(page);
    // The device has rules of its own: Kumiki classic, chosen in Settings.
    await page.goto(DEBUG);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("dialog").locator("#setting-preset").selectOption("classic");
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

    // A typo in the preset, and upper case in a rule: the link still sets the rules, and says what it passed over.
    await page.goto(`${DEBUG}&rules=Clasic,LIVES:1,hint:free,hint:off`);
    expect((await events(page, "session_start"))[0]!.data).toMatchObject({
      rules: "zen-hanzi,lives:1,hint:off",
      rules_from: "link",
      rules_ignored: ["Clasic", "hint:free"],
      choices: { check: "frame", lives: "1", hint: "off", tray: "3x6" },
    });
    await page.getByRole("button", { name: "Settings" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator('[data-setting="rules-fixed"]')).toContainText("set by the link");
    await expect(dialog.locator("#setting-preset")).toHaveValue("zen-hanzi");
    await expect(dialog.locator("select:enabled")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close" }).click();
    await page.getByRole("radio", { name: /Review/ }).click();
    await page.locator(".deck").first().click();
    await expect(page.locator(".tray .tile")).toHaveCount(18);
    await expect(page.locator(".lives")).toHaveAttribute("aria-label", "1 of 1 lives left");

    // A preset in upper case is that preset.
    await page.goto(`${DEBUG}&rules=GENTLE`);
    expect((await events(page, "session_start"))[0]!.data).toMatchObject({ rules: "gentle", rules_from: "link" });
    // The device's own rules are as they were.
    await page.goto(DEBUG);
    expect((await events(page, "session_start"))[0]!.data).toMatchObject({ rules: "classic", rules_from: "player" });

    expect(errors).toEqual([]);
  });

  test("a study condition that names a preset fixes the rules too: gentle judges a full structure by itself", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto(`${DEBUG}&condition=gentle`);
    expect((await events(page, "session_start"))[0]!.data).toMatchObject({
      condition: "gentle",
      rules: "gentle",
      rules_from: "condition",
      choices: { lives: "none", hint: "free", check: "auto", structures: "fixed", tray: "2x4" },
    });
    await page.getByRole("button", { name: "Settings" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator('[data-setting="rules-fixed"]')).toContainText("study condition");
    await expect(dialog.locator("#setting-preset")).toBeDisabled();
    await dialog.getByRole("button", { name: "Close" }).click();

    await page.getByRole("radio", { name: /Review/ }).click();
    await expect(page.getByRole("radio", { name: /Review/ })).toContainText("Unlimited tries.");
    await page.locator(".deck").first().click();
    await expect(page.locator(".assembly")).toHaveAttribute("data-check", "auto");
    await expect(page.locator(".lives")).toHaveAttribute("aria-label", "Unlimited tries");
    await expect(page.locator(".tray .tile")).toHaveCount(8);
    const first = await kk(page);
    const frames = first.puzzle!.layouts.map((layout) => layout.signature);
    expect(frames).toHaveLength(4);

    // No Check button: the structure is judged once its last slot is filled.
    const info = await puzzleInfo(page);
    for (const [slot, tileId] of solvingTiles(info).entries()) await clickTile(page, tileId, info.correctLayout, slot);
    await expect(page.locator('[data-action="check"]')).toHaveCount(0);
    const panel = page.locator(".feedback-panel");
    await expect(panel.locator(".panel-title")).toHaveText("Joined!");
    await panel.getByRole("button", { name: "Continue" }).click();
    await page.locator(".reveal").getByRole("button", { name: "Next" }).click();
    // The same frames in the same places for the next character of the deck.
    await expect(page.locator(".assembly .bar-progress")).toContainText("2 /");
    expect((await kk(page)).puzzle!.layouts.map((layout) => layout.signature)).toEqual(frames);

    expect(errors).toEqual([]);
  });

  test("structures by position: every character in two parts, the same four frames", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto(`${DEBUG}&rules=zen-hanzi,structures:positions`);
    await page.getByRole("radio", { name: /Review/ }).click();
    await page.locator(".deck").first().click();
    const info = await puzzleInfo(page);
    expect(info.solution).toHaveLength(2);
    expect(info.slotCounts).toEqual([2, 2, 2, 2]);
    expect((await kk(page)).puzzle!.layouts.map((layout) => layout.signature)).toEqual(["R(S,S)", "E:top(S)", "C(S,S)", "E:bottom-left(S)"]);
    for (const [slot, tileId] of solvingTiles(info).entries()) await clickTile(page, tileId, info.correctLayout, slot);
    await page.locator(".frame-check").click();
    await expect(page.locator(".feedback-panel .panel-title")).toHaveText("Joined!");
    await page.locator(".feedback-panel").getByRole("button", { name: "Continue" }).click();
    // The reveal shows the two parts the puzzle had.
    await expect(page.locator(".reveal .part")).toHaveCount(2);

    expect(errors).toEqual([]);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

  // Written for Kumiki's classic board of 12 tiles; the default board (the demo's 18 tiles in rows of six) has to pass it too.
  for (const [label, url, tiles] of [
    ["", DEBUG, 18],
    [" (Kumiki classic)", CLASSIC, 12],
  ] as const) {
    test(`nothing scrolls sideways and tiles can be tapped or dragged into place by touch${label}`, async ({ page }) => {
      const errors = watchConsole(page);
      await page.goto(url);
      const fits = (): Promise<boolean> => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      expect(await fits()).toBe(true);

      await page.getByRole("radio", { name: /Review/ }).tap();
      await page.locator(".deck").first().tap();
      await expect(page.locator(".tray .tile")).toHaveCount(tiles);
      expect(await fits()).toBe(true);

      // Everything that is tapped is at least 44 px in both directions.
      const smallest = await page.evaluate(() =>
        Math.min(
          ...[...document.querySelectorAll(".slot-shape, .tray .tile, .screen button")].map((element) => {
            const box = element.getBoundingClientRect();
            return Math.min(box.width, box.height);
          }),
        ),
      );
      expect(smallest).toBeGreaterThanOrEqual(44);

      const info = await puzzleInfo(page);
      const tile = solvingTiles(info)[0]!;
      await page.locator(`.tray .tile[data-tile="${tile}"]`).tap();
      const at = await slotPoint(page, info.correctLayout, 0);
      await page.touchscreen.tap(at.x, at.y);
      await expect(page.locator(`.slot[data-layout="${info.correctLayout}"][data-slot="0"]`)).toHaveAttribute("data-tile", tile);

      // A finger drags the next tile into its slot.
      const second = solvingTiles(info)[1]!;
      const from = await centre(page, `.tray .tile[data-tile="${second}"]`);
      const to = await slotPoint(page, info.correctLayout, 1);
      const client = await page.context().newCDPSession(page);
      const touch = (type: "touchStart" | "touchMove" | "touchEnd", points: { x: number; y: number }[]): Promise<unknown> =>
        client.send("Input.dispatchTouchEvent", { type, touchPoints: points });
      await touch("touchStart", [from]);
      for (let step = 1; step <= 6; step++) {
        await touch("touchMove", [{ x: from.x + ((to.x - from.x) * step) / 6, y: from.y + ((to.y - from.y) * step) / 6 }]);
      }
      await expect(page.locator(".drag-ghost")).toBeVisible();
      await touch("touchEnd", []);
      await expect(page.locator(`.slot[data-layout="${info.correctLayout}"][data-slot="1"]`)).toHaveAttribute("data-tile", second);
      await expect(page.locator(".drag-ghost")).toHaveCount(0);
      expect(await fits()).toBe(true);

      expect(errors).toEqual([]);
    });
  }
});

test.describe("on a phone with the browser's toolbars showing", () => {
  test.use({ viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true });

  for (const [label, url, classic] of [
    // The default board: the demo's 18 tiles in three rows of six under four structures.
    ["", DEBUG, false],
    // A study link without its api and token: the notice that the session is not being recorded stays for good.
    [", also with the recording notice showing", `${DEBUG}&study=S1&participant=P1`, false],
    // Kumiki's classic board, which these tests were written for: 12 tiles and a bar with Hint and Check.
    [" (Kumiki classic)", CLASSIC, true],
    [" (Kumiki classic), also with the recording notice showing", `${CLASSIC}&study=S1&participant=P1`, true],
  ] as const) {
    test(`the whole board fits: nothing lies under the Check bar or below the screen${label}`, async ({ page }) => {
      const errors = watchConsole(page);
      await page.goto(url);
      const notice = page.locator("[data-kk-recording-notice]");
      if (!url.includes("study=")) await expect(notice).toHaveCount(0);
      else await expect(notice).toContainText("Not being recorded");
      await page.getByRole("radio", { name: /Review/ }).tap();
      await page.locator(".deck").first().tap();
      await expect(page.locator(".tray .tile")).toHaveCount(classic ? 12 : 18);
      await expect(page.locator(".structure")).toHaveCount(4);

      const layout = await page.evaluate(() => {
        const onTop = (element: Element): boolean => {
          const box = element.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return hit !== null && (hit === element || element.contains(hit));
        };
        return {
          scrolls: document.documentElement.scrollHeight > window.innerHeight,
          hidden: [...document.querySelectorAll(".tray .tile, .structure, .assembly button:not(.tile), .assembly .status")].filter(
            (element) => !onTop(element),
          ).length,
          worth: document.querySelector('[data-stat="worth"]')?.getBoundingClientRect().width ?? 0,
          // No control sits in the rows the notice takes, whatever is drawn on top there (the
          // test above only looks at what is on top at each control's centre).
          underNotice: [...document.querySelectorAll(".assembly button, .assembly .status, .tray .tile")].filter((element) => {
            const notice = document.querySelector("[data-kk-recording-notice]")?.getBoundingClientRect();
            const box = element.getBoundingClientRect();
            return notice !== undefined && notice.height > 0 && box.top < notice.bottom && box.bottom > notice.top;
          }).length,
          trayRows: new Set([...document.querySelectorAll(".tray .tile")].map((tile) => Math.round(tile.getBoundingClientRect().top))).size,
          below: [...document.querySelectorAll(".tray .tile, .assembly button")].filter((element) => element.getBoundingClientRect().bottom > window.innerHeight)
            .length,
        };
      });
      expect(layout.scrolls).toBe(false);
      expect(layout.hidden).toBe(0);
      expect(layout.underNotice).toBe(0);
      expect(layout.below).toBe(0);
      // What the round is worth stays visible, so the cost of a hint shows.
      expect(layout.worth).toBeGreaterThan(10);

      const info = await puzzleInfo(page);
      const last = info.tray.at(-1)!.id;
      if (classic) {
        // The short screen turns the three rows of four into two of six.
        expect(layout.trayRows).toBe(2);
        await expect(page.locator('[data-stat="worth"]')).toContainText("+100");
        // A tile of the bottom row can be tapped, and Hint lowers what the round is worth.
        await page.locator(`.tray .tile[data-tile="${last}"]`).tap();
        await expect(page.locator(`.tray .tile[data-tile="${last}"]`)).toHaveAttribute("data-selected", "true");
        await page.getByRole("button", { name: "Hint" }).tap();
        await expect(page.locator('[data-stat="worth"]')).toContainText("+75");
      } else {
        expect(layout.trayRows).toBe(3);
        // A tile of the bottom row can be tapped, and Hint costs half a life and stays until Continue.
        await page.locator(`.tray .tile[data-tile="${last}"]`).tap();
        await expect(page.locator(`.tray .tile[data-tile="${last}"]`)).toHaveAttribute("data-selected", "true");
        await page.getByRole("button", { name: /Hint/ }).tap();
        await expect(page.locator(".lives")).toHaveAttribute("aria-label", "2½ of 3 lives left");
        const proceed = page.locator(".hint-overlay").getByRole("button", { name: "Continue" });
        await expect(proceed).toBeVisible();
        expect((await proceed.boundingBox())!.y + (await proceed.boundingBox())!.height).toBeLessThanOrEqual(664);
        await proceed.tap();
        await expect(page.locator(".hint-overlay")).toBeHidden();
        // The Check button of a full structure lies beside it, on screen, and the result panel with its Continue too.
        const tiles = solvingTiles(info);
        for (const [slot, tileId] of tiles.entries()) {
          await page.locator(`.tray .tile[data-tile="${tileId}"]`).tap();
          const at = await slotPoint(page, info.correctLayout, slot);
          await page.touchscreen.tap(at.x, at.y);
        }
        const check = page.locator(".frame-check");
        await expect(check).toBeVisible();
        const box = (await check.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await check.tap();
        const done = page.locator(".feedback-panel").getByRole("button", { name: "Continue" });
        await expect(done).toBeVisible();
        const doneBox = (await done.boundingBox())!;
        expect(doneBox.y + doneBox.height).toBeLessThanOrEqual(664);
      }

      expect(errors).toEqual([]);
    });
  }

  test("a burst of taps on the exam's Finish leaves the results on screen and starts no deck", async ({ page }) => {
    const errors = watchConsole(page);
    // Written for the classic tray of 12 tiles: with it Finish, the results' Decks and a deck card share one spot.
    await page.goto(CLASSIC);
    await page.getByRole("button", { name: "Exam" }).tap();
    await page.getByRole("dialog").locator("[data-deck]").first().tap();
    const finish = page.getByRole("button", { name: "Finish" });
    while (!(await finish.isVisible())) await page.getByRole("button", { name: "Next" }).tap();
    await expect(finish).toBeEnabled();
    await finish.scrollIntoViewIfNeeded();
    const at = await centre(page, '[data-action="next"]');
    const starts = (await events(page, "item_start")).length;
    const underFinger = (): Promise<string | null> =>
      page.evaluate(([x, y]) => {
        const control = document.elementFromPoint(x, y)?.closest("button");
        return control ? `${control.getAttribute("data-action") ?? control.getAttribute("data-deck")} ${control.disabled ? "off" : "on"}` : null;
      }, [at.x, at.y] as const);

    // Three taps 300 ms apart: the results' Decks comes up under the finger, and behind it
    // the deck list with a deck card on the same spot. Neither may take the later taps.
    await page.touchscreen.tap(at.x, at.y);
    await expect(page.locator(".exam-results")).toBeVisible();
    expect(await underFinger()).toBe("home off");
    for (let tap = 1; tap < 3; tap++) {
      await page.waitForTimeout(300);
      await page.touchscreen.tap(at.x, at.y);
    }
    await page.waitForTimeout(800);
    await expect(page.locator(".exam-results")).toBeVisible();
    expect(await events(page, "exam_complete")).toHaveLength(1);
    expect(await events(page, "item_start")).toHaveLength(starts);
    // Once the burst is over, Decks is on and leads to the deck list.
    expect(await underFinger()).toBe("home on");
    await page.getByRole("button", { name: "Decks" }).tap();
    await expect(page.locator(".home")).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("a burst of taps that opens or closes a dialog neither closes it again nor starts the deck under the finger", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto(DEBUG);
    const burst = async (name: string): Promise<void> => {
      const control = page.getByRole("button", { name });
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeEnabled();
      const box = (await control.boundingBox())!;
      for (let tap = 0; tap < 3; tap++) {
        if (tap > 0) await page.waitForTimeout(300);
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      }
      await page.waitForTimeout(800);
    };

    // The chooser opens under the finger: the later taps pick no deck and do not close it from its backdrop.
    await burst("Exam");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Close" }).tap();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Closing Settings leaves a deck card under the finger.
    await page.getByRole("button", { name: "Settings" }).tap();
    await expect(page.getByRole("dialog")).toBeVisible();
    await burst("Close");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".home")).toBeVisible();
    // Closing it from its backdrop with a double tap leaves the deck card under the finger alone too.
    await page.getByRole("button", { name: "Settings" }).tap();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.waitForTimeout(900);
    // A point on the backdrop, outside the dialog's box, with a deck card under it.
    const spot = await page.evaluate(() => {
      const box = document.querySelector("dialog[open]")!.getBoundingClientRect();
      for (const card of document.querySelectorAll(".deck")) {
        const r = card.getBoundingClientRect();
        for (const fy of [0.5, 0.25, 0.75]) {
          const x = r.left + r.width / 2;
          const y = r.top + r.height * fy;
          const outside = y < box.top - 4 || y > box.bottom + 4 || x < box.left - 4 || x > box.right + 4;
          if (y > 0 && y < innerHeight && outside) return { x, y };
        }
      }
      return null;
    });
    expect(spot).not.toBeNull();
    for (let tap = 0; tap < 2; tap++) {
      if (tap > 0) await page.waitForTimeout(300);
      await page.touchscreen.tap(spot!.x, spot!.y);
    }
    await page.waitForTimeout(800);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".home")).toBeVisible();
    expect(await events(page, "item_start")).toEqual([]);

    expect(errors).toEqual([]);
  });
});

test.describe("a session that belongs to a study", () => {
  // Same origin as the game, so no CORS preflight; every request is answered by the test, not by a server.
  const API = `${BASE}platform/functions/v1`;
  const link = (participant: string, extra = ""): string =>
    `${BASE}?debug&seed=e2e&study=S1&participant=${participant}&api=${encodeURIComponent(API)}${extra}`;
  const notice = (page: Page) => page.locator("[data-kk-recording-notice]");

  interface Received {
    readonly token: string;
    readonly type: string;
    readonly id: unknown;
  }

  /** Answer every request to the collector with what `answer()` gives at that moment: a status, or null for a network failure. */
  async function stubCollector(page: Page, answer: () => number | null): Promise<Received[]> {
    const received: Received[] = [];
    await page.route("**/event-collector", async (route) => {
      const status = answer();
      const body = route.request().postDataJSON() as { event_type: string; payload: Record<string, unknown> | null };
      received.push({
        token: (route.request().headers().authorization ?? "").replace("Bearer ", ""),
        type: body.event_type,
        id: body.payload?.client_event_id,
      });
      if (status === null) await route.abort("connectionfailed");
      else await route.fulfill({ status, contentType: "application/json", body: status === 201 ? '{"event_id":"e"}' : '{"title":"refused"}' });
    });
    return received;
  }

  const stored = (page: Page, key: string): Promise<string | null> => page.evaluate((k) => localStorage.getItem(k), key);

  test("plain play shows no notice; a study link that lost its token says the session is not recorded", async ({ page }) => {
    await page.goto(DEBUG);
    await expect(page.locator(".deck").first()).toBeVisible();
    await expect(notice(page)).toHaveCount(0);

    await page.goto(link("P1"));
    await expect(notice(page)).toBeVisible();
    await expect(notice(page)).toHaveAttribute("role", "status");
    await expect(notice(page)).toContainText("Not being recorded: the study link is incomplete (no token)");

    // The notice lies over the page without getting in the way: a deck under it can still be started.
    await expect(page.locator("#app")).toHaveAttribute("data-screen", "home");
    await page.locator(".deck").first().click();
    await expect(page.locator("#app")).not.toHaveAttribute("data-screen", "home");
    await expect(notice(page)).toBeVisible();
  });

  test("a refused token and an outage are announced, and no event is lost to either", async ({ page }) => {
    let answer: number | null = 401;
    const received = await stubCollector(page, () => answer);

    await page.goto(link("P1", "#token=stale"));
    await expect(notice(page)).toContainText("Not being recorded: the study link was not accepted");
    const backlog = JSON.parse((await stored(page, "kankyouken:events:S1:P1"))!) as { events: { event_type: string; payload: { client_event_id: string } }[] };
    expect(backlog.events.map((event) => event.event_type)).toEqual(["session_start"]);
    expect(backlog.events[0]!.payload.client_event_id).toMatch(/^[0-9a-f-]{36}$/);
    await page.waitForTimeout(1500);
    // One attempt, and none after it: the refused token is not tried again.
    expect(received).toEqual([{ token: "stale", type: "session_start", id: backlog.events[0]!.payload.client_event_id }]);

    // The next launch has a token that works: the backlog goes out first, under the id it had.
    answer = 201;
    await page.goto(link("P1", "&session=2#token=fresh"));
    await expect.poll(() => received.filter((r) => r.token === "fresh").map((r) => r.type)).toEqual(["session_start", "session_end", "session_start"]);
    expect(received[1]).toEqual({ token: "fresh", type: "session_start", id: backlog.events[0]!.payload.client_event_id });
    await expect(notice(page)).toBeHidden();
    await expect.poll(() => stored(page, "kankyouken:events:S1:P1")).toBeNull();

    // The connection drops while playing: the player is told, the events wait.
    answer = null;
    await page.locator(".deck").first().click();
    await expect(notice(page)).toContainText("Results cannot be sent right now");
    expect((await stored(page, "kankyouken:events:S1:P1"))!).toContain("item_start");

    // It comes back: everything is delivered and the notice goes away.
    const before = received.length;
    answer = 201;
    await expect(notice(page)).toBeHidden({ timeout: 15_000 });
    await expect.poll(() => stored(page, "kankyouken:events:S1:P1")).toBeNull();
    const delivered = received.slice(before).filter((r) => r.type === "item_start");
    expect(delivered.length).toBeGreaterThan(0);
    // Every event has an id of its own; a repeated id is the same event sent again.
    const ids = new Map<unknown, string>();
    for (const r of received) {
      expect(typeof r.id).toBe("string");
      expect(ids.get(r.id) ?? r.type).toBe(r.type);
      ids.set(r.id, r.type);
    }
  });

  test("a participant does not inherit the settings of the one before on the same device", async ({ page }) => {
    await stubCollector(page, () => 201);
    const learn = page.getByRole("radio", { name: /Learn/ });
    const review = page.getByRole("radio", { name: /Review/ });

    await page.goto(link("P1", "#token=t"));
    await expect(learn).toBeChecked();
    await review.click();
    await expect(review).toBeChecked();
    expect(JSON.parse((await stored(page, "kk.kumiki.v1:S1:P1"))!)).toMatchObject({ mode: "review" });
    expect(await stored(page, "kk.kumiki.v1")).toBeNull();

    // The next participant starts from the defaults.
    await page.goto(link("P2", "#token=t"));
    await expect(learn).toBeChecked();
    expect(await stored(page, "kk.kumiki.v1:S1:P2")).toBeNull();

    // The first one finds their own choice again, and plain play has a place of its own.
    await page.goto(link("P1", "&session=2#token=t"));
    await expect(review).toBeChecked();
    await page.goto(DEBUG);
    await expect(learn).toBeChecked();
  });
});
