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

test.describe("on a phone", () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

  test("nothing scrolls sideways and tiles can be tapped or dragged into place by touch", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto(DEBUG);
    const fits = (): Promise<boolean> => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(await fits()).toBe(true);

    await page.getByRole("radio", { name: /Review/ }).tap();
    await page.locator(".deck").first().tap();
    await expect(page.locator(".tray .tile")).toHaveCount(12);
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
});

test.describe("on a phone with the browser's toolbars showing", () => {
  test.use({ viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true });

  for (const [label, url] of [
    ["", DEBUG],
    // A study link without its api and token: the notice that the session is not being recorded stays for good.
    [", also with the recording notice showing", `${DEBUG}&study=S1&participant=P1`],
  ] as const) {
    test(`the whole board fits: nothing lies under the Check bar or below the screen${label}`, async ({ page }) => {
      const errors = watchConsole(page);
      await page.goto(url);
      const notice = page.locator("[data-kk-recording-notice]");
      if (url === DEBUG) await expect(notice).toHaveCount(0);
      else await expect(notice).toContainText("Not being recorded");
      await page.getByRole("radio", { name: /Review/ }).tap();
      await page.locator(".deck").first().tap();
      await expect(page.locator(".tray .tile")).toHaveCount(12);

      const layout = await page.evaluate(() => {
        const onTop = (element: Element): boolean => {
          const box = element.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return hit !== null && (hit === element || element.contains(hit));
        };
        return {
          scrolls: document.documentElement.scrollHeight > window.innerHeight,
          hidden: [...document.querySelectorAll(".tray .tile, .structure, .assembly .actions button, .assembly .back, .assembly .status")].filter(
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
        };
      });
      expect(layout.scrolls).toBe(false);
      expect(layout.hidden).toBe(0);
      expect(layout.underNotice).toBe(0);
      // What the round is worth stays visible, so the cost of a hint shows.
      expect(layout.worth).toBeGreaterThan(10);
      await expect(page.locator('[data-stat="worth"]')).toContainText("+100");

      // A tile of the bottom row can be tapped, and Hint lowers what the round is worth.
      const info = await puzzleInfo(page);
      const last = info.tray.at(-1)!.id;
      await page.locator(`.tray .tile[data-tile="${last}"]`).tap();
      await expect(page.locator(`.tray .tile[data-tile="${last}"]`)).toHaveAttribute("data-selected", "true");
      await page.getByRole("button", { name: "Hint" }).tap();
      await expect(page.locator('[data-stat="worth"]')).toContainText("+75");

      expect(errors).toEqual([]);
    });
  }

  test("a burst of taps on the exam's Finish leaves the results on screen and starts no deck", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto(DEBUG);
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
