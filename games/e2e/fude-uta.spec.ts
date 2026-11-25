import { expect, test, type Locator, type Page } from "@playwright/test";

const BASE = "http://127.0.0.1:4311/";
const DEBUG = `${BASE}?debug&seed=e2e`;

interface GameEvent {
  type: string;
  ts: number;
  item?: string;
  task?: string;
  data?: Record<string, unknown>;
}

/** What the game tells tests about the writing task on screen (`window.__kk.state`). */
interface GameState {
  screen: string;
  stage: string | null;
  char: string | null;
  rep: number | null;
  expected: number | null;
  medians: { x: number; y: number }[][] | null;
}

interface DebugHandle {
  readonly events: readonly GameEvent[];
  readonly state: GameState;
}

const state = (page: Page): Promise<GameState> =>
  page.evaluate(() => (window as unknown as { __kk: DebugHandle }).__kk.state);

const events = (page: Page, type: string): Promise<GameEvent[]> =>
  page.evaluate(
    (wanted) => (window as unknown as { __kk: DebugHandle }).__kk.events.filter((event) => event.type === wanted).map((event) => ({ ...event })),
    type,
  );

const waitForStage = (page: Page, stage: string, char: string): Promise<unknown> =>
  page.waitForFunction(
    ([wantedStage, wantedChar]) => {
      const now = (window as unknown as { __kk: DebugHandle }).__kk.state;
      return now.stage === wantedStage && now.char === wantedChar;
    },
    [stage, char],
    { timeout: 15_000 },
  );

/** Draw stroke `index` of the character on the board with the mouse, along its median (or against it). */
async function drawStroke(page: Page, index: number, direction: "forward" | "backward" = "forward"): Promise<void> {
  const points = await page.evaluate((stroke) => {
    const svg = document.querySelector<SVGSVGElement>(".board svg");
    const matrix = svg?.getScreenCTM();
    const median = (window as unknown as { __kk: DebugHandle }).__kk.state.medians?.[stroke];
    if (!matrix || !median) throw new Error(`no stroke ${stroke} to draw`);
    return median.map((p) => ({ x: matrix.a * p.x + matrix.c * p.y + matrix.e, y: matrix.b * p.x + matrix.d * p.y + matrix.f }));
  }, index);
  if (direction === "backward") points.reverse();
  const [first, ...rest] = points;
  if (first === undefined) throw new Error("empty median");
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const point of rest) await page.mouse.move(point.x, point.y, { steps: 8 });
  await page.mouse.up();
}

/** Write every remaining stroke of the current repetition, checking each one lands as written ink. */
async function writeRepetition(page: Page): Promise<void> {
  const start = await state(page);
  const count = start.medians?.length ?? 0;
  for (let stroke = start.expected ?? 0; stroke < count; stroke++) {
    await drawStroke(page, stroke);
    await expect(page.locator(`.board .kk-stroke[data-stroke="${stroke}"]`)).toHaveAttribute("data-state", "done");
  }
}

let consoleErrors: string[] = [];

test.beforeEach(({ page }) => {
  consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
});

test.afterEach(() => {
  expect(consoleErrors).toEqual([]);
});

test("a character is learned stage by stage, and writing it performs it", async ({ page }) => {
  await page.goto(DEBUG);
  await expect(page.getByRole("heading", { name: "Fude Uta" })).toBeVisible();
  await expect(page.locator(".lesson-card")).toHaveCount(6);
  expect((await events(page, "session_start"))[0]?.data).toMatchObject({
    seed: "e2e",
    audio_mode: "melody",
    sound_on: true,
    volume: 0.6,
    audio_available: true,
  });

  await page.locator(".lesson-card").first().click();

  // The demonstration draws the character by itself, then hands over.
  await waitForStage(page, "demo", "一");
  await expect(page.locator(".meaning")).toHaveText("one");
  await expect(page.locator(".chip")).toHaveCount(1);
  await expect(page.locator(".chip .chip-glyph")).toHaveText("一");
  await expect(page.getByRole("button", { name: "Skip" })).toBeVisible();
  await waitForStage(page, "trace:dotted", "一");
  expect((await events(page, "demo_watched"))[0]?.data).toMatchObject({ skipped: false });

  // Two traces over the dotted stroke, then three on a blank square.
  for (const [stage, reps, label] of [
    ["trace:dotted", 2, "Trace the dotted stroke"],
    ["trace:none", 3, "Write it on your own"],
  ] as const) {
    for (let rep = 0; rep < reps; rep++) {
      await page.waitForFunction(
        ([wantedStage, wantedRep]) => {
          const now = (window as unknown as { __kk: DebugHandle }).__kk.state;
          return now.stage === wantedStage && now.rep === wantedRep && now.expected === 0;
        },
        [stage, rep] as const,
      );
      await expect(page.locator(".stage-label")).toHaveText(`${label} · ${rep + 1} of ${reps}`);
      await expect(page.locator(".board .kk-dotted-line")).toHaveCount(stage === "trace:dotted" ? 1 : 0);
      // No Hint where the dotted stroke already shows all a hint could.
      await expect(page.getByRole("button", { name: "Hint" })).toHaveCount(stage === "trace:dotted" ? 0 : 1);
      await expect(page.locator(".chip[data-current]")).toHaveCount(1);
      await writeRepetition(page);
    }
  }

  // Completion: the seal, the gloss writ large, the way on.
  await waitForStage(page, "complete", "一");
  await expect(page.locator(".seal")).toBeVisible();
  await expect(page.locator(".stage-label")).toHaveText("Well written");
  await expect(page.locator(".gloss.gloss-large .meaning")).toHaveText("one");
  await expect(page.locator(".board .kk-stroke[data-tone]")).toHaveCount(1);
  await expect(page.locator('.pip[data-state="done"]')).toHaveCount(6);
  await expect(page.getByRole("button", { name: "Next character" })).toBeVisible();

  const attempts = await events(page, "stroke_attempt");
  expect(attempts).toHaveLength(5);
  expect(attempts.map((event) => event.task)).toEqual(["trace:dotted", "trace:dotted", "trace:none", "trace:none", "trace:none"]);
  for (const attempt of attempts) {
    expect(attempt.item).toBe("一");
    expect(attempt.data).toMatchObject({ correct: true, verdict: "correct", stroke_index: 0, attempt: 1, component: "一", audio_mode: "melody" });
    expect(typeof attempt.data?.["response_time_ms"]).toBe("number");
    expect(typeof attempt.data?.["draw_ms"]).toBe("number");
  }
  const stages = await events(page, "stage_enter");
  expect(stages.map((event) => event.task)).toEqual(["demo", "trace:dotted", "trace:none"]);
  expect((await events(page, "item_complete"))[0]).toMatchObject({ item: "一", data: { mistakes: 0 } });

  // Response times count from the moment the stroke could be written: not the demonstration
  // before the first stroke, not the pause before the first stroke of a later repetition.
  const responseTime = (index: number): number => Number(attempts[index]?.data?.["response_time_ms"]);
  expect(responseTime(0)).toBeLessThanOrEqual((attempts[0]?.ts ?? 0) - (stages[1]?.ts ?? 0));
  expect(responseTime(1)).toBeLessThanOrEqual((attempts[1]?.ts ?? 0) - (attempts[0]?.ts ?? 0) - 600);

  // The next character: a stroke written backwards, or too early, is turned down and asked for again.
  await page.getByRole("button", { name: "Next character" }).click();
  await waitForStage(page, "demo", "十");
  await page.getByRole("button", { name: "Skip" }).click();
  await waitForStage(page, "trace:dotted", "十");
  expect((await events(page, "demo_watched"))[1]?.data).toMatchObject({ skipped: true });

  await drawStroke(page, 0, "backward");
  await expect(page.locator(".message")).toContainText("Other way round");
  await expect(page.locator('.board .kk-stroke[data-stroke="0"]')).toHaveAttribute("data-state", "hidden");
  expect((await state(page)).expected).toBe(0);

  await drawStroke(page, 1);
  await expect(page.locator(".message")).toContainText("Not this stroke yet");
  expect((await state(page)).expected).toBe(0);

  const rejected = (await events(page, "stroke_attempt")).filter((event) => event.item === "十");
  expect(rejected.map((event) => event.data?.["verdict"])).toEqual(["wrong-direction", "wrong-order"]);
  expect(rejected.map((event) => event.data?.["correct"])).toEqual([false, false]);
  expect(rejected.map((event) => event.data?.["attempt"])).toEqual([1, 2]);

  await drawStroke(page, 0);
  await expect(page.locator('.board .kk-stroke[data-stroke="0"]')).toHaveAttribute("data-state", "done");
  await expect(page.locator(".message")).toHaveText("");
  expect((await state(page)).expected).toBe(1);
  expect((await events(page, "stroke_attempt")).at(-1)?.data).toMatchObject({ correct: true, attempt: 3, stroke_index: 0 });
  await drawStroke(page, 1);

  // While the finished repetition rests on the board, nothing can be asked for.
  const resting = await page.waitForFunction(() => {
    if ((window as unknown as { __kk: DebugHandle }).__kk.state.stage !== "rest") return null;
    return [...document.querySelectorAll<HTMLButtonElement>(".actions button")].map((button) => `${button.textContent}:${button.disabled}`);
  });
  expect(await resting.jsonValue()).toEqual(["Listen:true"]);

  // On a blank square, hints show first where the stroke starts, then the stroke itself.
  await page.waitForFunction(() => {
    const now = (window as unknown as { __kk: DebugHandle }).__kk.state;
    return now.stage === "trace:dotted" && now.rep === 1 && now.expected === 0;
  });
  await writeRepetition(page);
  await waitForStage(page, "trace:none", "十");
  await expect(page.locator(".board .kk-dot, .board .kk-dotted-line")).toHaveCount(0);
  await page.getByRole("button", { name: "Hint" }).click();
  await expect(page.locator('.board .kk-dot[data-start="true"]')).toHaveCount(1);
  await expect(page.locator(".board .kk-dotted-line")).toHaveCount(0);
  await page.getByRole("button", { name: "Hint" }).click();
  await expect(page.locator(".board .kk-dotted-line")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Hint" })).toBeDisabled();
  expect((await events(page, "hint_shown")).map((event) => event.data)).toMatchObject([
    { level: 1, stroke_index: 0, auto: false },
    { level: 2, stroke_index: 0, auto: false },
  ]);
  await drawStroke(page, 0);
  await expect(page.locator(".board .kk-dot, .board .kk-dotted-line")).toHaveCount(0);
  expect((await events(page, "stroke_attempt")).at(-1)?.data).toMatchObject({ correct: true, hint_level: 2, guide: "none" });

  // Listening is recorded, and going back leads home.
  await page.getByRole("button", { name: "Listen" }).click();
  await page.getByRole("button", { name: "Play 十" }).click();
  expect((await events(page, "melody_listen")).map((event) => event.data)).toMatchObject([
    { part: "all", audio_mode: "melody" },
    { part: "unit", unit: 0, component: "十" },
  ]);
  await page.getByRole("button", { name: "Back to lessons" }).click();
  await expect(page.locator(".lesson-card")).toHaveCount(6);

  // Leaving in mid-lesson is recorded with where the player stood.
  expect(await events(page, "lesson_abandoned")).toMatchObject([
    {
      item: "十",
      task: "trace:none",
      data: { lesson: "lines-and-boxes", mode: "learn", left_by: "back", position: 1, of: 10, completed: 1, strokes_done: 1, stroke_count: 2 },
    },
  ]);

  // The browser's Back leads to the lessons, not out of the game; a demonstration it cut short was not watched.
  const watched = (await events(page, "demo_watched")).length;
  await page.locator(".lesson-card").first().click();
  await waitForStage(page, "demo", "一");
  await page.goBack();
  await expect(page.locator(".lesson-card")).toHaveCount(6);
  expect(page.url()).toBe(DEBUG);
  expect((await events(page, "lesson_abandoned")).at(-1)).toMatchObject({ item: "一", task: "demo", data: { position: 0, completed: 0 } });
  expect(await events(page, "demo_watched")).toHaveLength(watched);
});

/** Where a click on `target` lands; a later click at the same point meets whatever stands there by then. */
async function centre(target: Locator): Promise<{ x: number; y: number }> {
  const box = await target.boundingBox();
  if (box === null) throw new Error("nothing to click");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("the second click of a double click does not act on what the first one brought on screen", async ({ page }) => {
  await page.goto(DEBUG);
  const controls = (selector: string): Promise<string[]> =>
    page.locator(selector).evaluateAll((all) => all.map((each) => `${each.textContent}:${(each as HTMLButtonElement).disabled}`));

  // About: the second click falls on the backdrop of the sheet the first one opened, and must not close it.
  const about = page.locator('dialog[data-sheet="about"]');
  const aboutButton = await centre(page.getByRole("button", { name: "About" }));
  await page.mouse.click(aboutButton.x, aboutButton.y);
  await page.waitForTimeout(120);
  await page.mouse.click(aboutButton.x, aboutButton.y);
  await page.waitForTimeout(200);
  await expect(about).toBeVisible();
  // A click on the backdrop that is no part of a double click still closes it.
  await page.waitForTimeout(500);
  await page.mouse.click(5, 5);
  await expect(about).toHaveCount(0);

  // Skip: Listen comes up where Skip was. It is off until the double click is over, then works.
  await page.locator(".lesson-card").first().click();
  await waitForStage(page, "demo", "一");
  const skip = page.getByRole("button", { name: "Skip" });
  await expect(skip).toBeEnabled();
  const skipButton = await centre(skip);
  await page.mouse.click(skipButton.x, skipButton.y);
  expect(await controls(".actions button")).toEqual(["Listen:true"]);
  await page.waitForTimeout(150);
  await page.mouse.click(skipButton.x, skipButton.y);
  expect((await state(page)).stage).toBe("trace:dotted");
  expect(await events(page, "melody_listen")).toEqual([]);
  const listen = page.getByRole("button", { name: "Listen" });
  await expect(listen).toBeEnabled();
  await listen.click();
  expect(await events(page, "melody_listen")).toHaveLength(1);

  // A whole screen: the lesson cards that Back to lessons brings up cannot be picked at once.
  await page.getByRole("button", { name: "Back to lessons" }).click();
  const cards = await controls(".lesson-card");
  expect(cards).toHaveLength(6);
  expect(cards.every((card) => card.endsWith(":true"))).toBe(true);
  await expect(page.locator(".lesson-card").first()).toBeEnabled();
});

test("a burst of taps acts once, however long it goes on", async ({ page }) => {
  await page.goto(DEBUG);
  await page.locator(".lesson-card").first().click();
  await waitForStage(page, "demo", "一");

  // Skip, then three more taps 300 ms apart on the Listen that comes up in its place: the last one 900 ms after the first.
  await expect(page.getByRole("button", { name: "Skip" })).toBeEnabled();
  const skip = await centre(page.getByRole("button", { name: "Skip" }));
  for (let tap = 0; tap < 4; tap++) {
    if (tap > 0) await page.waitForTimeout(300);
    await page.mouse.click(skip.x, skip.y);
  }
  expect(await events(page, "melody_listen")).toEqual([]);
  // Every tap on the button while it is off keeps it off; half a second after the last one it works.
  const listen = page.getByRole("button", { name: "Listen" });
  await expect(listen).toBeDisabled();
  await expect(listen).toBeEnabled();
  await listen.click();
  expect(await events(page, "melody_listen")).toHaveLength(1);
});

test("a sheet holds only what lies where the click that opened it came down", async ({ page }) => {
  // On a phone held sideways, the Settings button lies under a setting once the sheet is open.
  await page.setViewportSize({ width: 664, height: 390 });
  await page.goto(DEBUG);
  const settings = page.locator('dialog[data-sheet="settings"]');
  const opener = page.getByRole("button", { name: "Settings" });
  await opener.scrollIntoViewIfNeeded();
  const point = await centre(opener);
  const settingAt = (): Promise<string | null> =>
    page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest(".option")?.querySelector("input")?.value ?? null, point);

  // A burst of taps: the first one opens the sheet, the others fall on that setting and must not pick it.
  for (let tap = 0; tap < 4; tap++) {
    if (tap > 0) await page.waitForTimeout(150);
    await page.mouse.click(point.x, point.y);
  }
  expect(await settingAt()).not.toBeNull();
  expect(await events(page, "settings_change")).toEqual([]);
  await expect(settings.locator(`input[value="${await settingAt()}"]`)).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
  await page.waitForTimeout(500);

  // Everything else in the sheet can be chosen at once, and the backdrop closes it right after a choice.
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(300);
  const chalk = settings.getByText("Chalk sound", { exact: true });
  await chalk.scrollIntoViewIfNeeded();
  const choice = await centre(chalk);
  await page.mouse.click(choice.x, choice.y);
  expect((await events(page, "settings_change")).map((event) => event.data)).toEqual([{ audioMode: "sfx", sound_on: true }]);
  await page.waitForTimeout(300);
  await page.mouse.click(5, 5);
  await expect(settings).toHaveCount(0);
});

test("a quick second press on a button that only redraws its own row is taken", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("kk.fude-uta.v1", JSON.stringify({ settings: { plan: "quick" } }));
  });
  await page.goto(DEBUG);
  await page.locator(".lesson-card").first().click();
  await waitForStage(page, "demo", "一");
  await page.getByRole("button", { name: "Skip" }).click();
  await waitForStage(page, "trace:dotted", "一");
  await drawStroke(page, 0);
  await waitForStage(page, "trace:none", "一");

  // Hint twice, 300 ms apart: the row it redraws keeps it where it was, and the second press shows the second level.
  const hint = page.getByRole("button", { name: "Hint" });
  await expect(hint).toBeEnabled();
  const point = await centre(hint);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(300);
  await page.mouse.click(point.x, point.y);
  expect((await events(page, "hint_shown")).map((event) => event.data?.["level"])).toEqual([1, 2]);
});

test("after the browser's Back and Forward, Back still leads out of the next lesson and then out of the game", async ({ page }) => {
  await page.goto(DEBUG);
  await page.locator(".lesson-card").first().click();
  await waitForStage(page, "demo", "一");
  await page.goBack();
  await expect(page.locator(".lesson-card")).toHaveCount(6);
  // Forward cannot bring the lesson back: the lesson list stays, and history steps off the lesson's entry.
  await page.goForward();
  await page.waitForFunction(() => history.state === null, undefined, { timeout: 5_000 });
  await expect(page.locator(".lesson-card")).toHaveCount(6);

  await page.locator(".lesson-card").first().click();
  await waitForStage(page, "demo", "一");
  await page.goBack();
  await expect(page.locator(".lesson-card")).toHaveCount(6);
  expect(page.url()).toBe(DEBUG);
  await page.goBack();
  expect(page.url()).toBe("about:blank");
});

test("the timed round's time starts when the square can first take a stroke, not at Start", async ({ page }) => {
  // The round comes after every character of the lesson has been learned.
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    localStorage.setItem("kk.fude-uta.v1", JSON.stringify({ settings: { plan: "quick" } }));
  });
  await page.goto(DEBUG);
  await page.locator(".lesson-card").first().click();
  const start = page.getByRole("button", { name: "Start", exact: true });
  for (let step = 0; step < 600 && !(await start.isVisible()); step++) {
    const now = await state(page);
    if (now.stage === "demo") await page.getByRole("button", { name: "Skip" }).click();
    else if (now.stage?.startsWith("trace:") === true) await writeRepetition(page);
    else if (now.stage === "complete") await page.locator(".actions .btn-primary").click();
    else await page.waitForTimeout(100);
  }
  await start.click();
  // Half a second after Start the square takes strokes (the rest of a double click is over); write a while after that.
  await page.waitForTimeout(900);
  await writeRepetition(page);
  await expect.poll(async () => (await events(page, "item_complete")).filter((event) => event.task === "timed").length).toBe(1);

  const timed = async (type: string): Promise<GameEvent> => (await events(page, type)).find((event) => event.task === "timed")!;
  const shown = await timed("item_start");
  const first = await timed("stroke_attempt");
  const done = await timed("item_complete");
  // The character is shown at Start; its first response time and its duration count from half a second later.
  const heldBeforeFirst = first.ts - shown.ts - Number(first.data?.["response_time_ms"]);
  const heldBeforeDone = done.ts - shown.ts - Number(done.data?.["duration_ms"]);
  expect(heldBeforeFirst).toBeGreaterThanOrEqual(400);
  expect(heldBeforeFirst).toBeLessThan(800);
  expect(heldBeforeDone).toBe(heldBeforeFirst);
});

test("a failing sound layer does not hold back the lesson", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("kk.fude-uta.v1", JSON.stringify({ settings: { plan: "quick" } }));
    AudioContext.prototype.createOscillator = () => {
      throw new DOMException("boom", "InvalidStateError");
    };
  });
  await page.goto(DEBUG);
  await page.locator(".lesson-card").first().click();

  // The demonstration draws and ends by itself, in silence, and the data says that nothing was heard.
  await waitForStage(page, "demo", "一");
  await waitForStage(page, "trace:dotted", "一");
  expect((await events(page, "demo_watched"))[0]?.data).toMatchObject({ skipped: false });
  expect(await events(page, "audio_unavailable")).toMatchObject([{ data: { audio_mode: "melody" } }]);

  // Messages, hints and the way on are all there.
  await drawStroke(page, 0, "backward");
  await expect(page.locator(".message")).toContainText("Other way round");
  await writeRepetition(page);
  await waitForStage(page, "trace:none", "一");
  await page.getByRole("button", { name: "Hint" }).click();
  await expect(page.locator('.board .kk-dot[data-start="true"]')).toHaveCount(1);
  await writeRepetition(page);
  await waitForStage(page, "complete", "一");
  await expect(page.getByRole("button", { name: "Next character" })).toBeEnabled();
});

test("settings and the about sheet open and close", async ({ page }) => {
  await page.goto(DEBUG);

  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.locator('dialog[data-sheet="settings"]');
  await expect(settings).toBeVisible();
  for (const label of ["Melodies", "Random notes", "Chalk sound", "Silent"]) await expect(settings.getByText(label, { exact: true })).toBeVisible();
  await expect(settings.getByRole("radio", { name: /Melodies/ })).toBeChecked();
  await settings.getByText("Strict", { exact: true }).click();
  await settings.getByText("Quick", { exact: true }).click();
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(settings).toHaveCount(0);
  // Every change is recorded, with whether anything can be heard after it.
  expect((await events(page, "settings_change")).map((event) => event.data)).toEqual([
    { judging: "strict", sound_on: true },
    { plan: "quick", sound_on: true },
  ]);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("kk.fude-uta.v1") ?? "{}") as { settings?: Record<string, unknown> });
  expect(stored.settings).toMatchObject({ judging: "strict", plan: "quick", audioMode: "melody" });

  // The choice survives a reload.
  await page.reload();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(settings.getByRole("radio", { name: /Quick/ })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);

  await page.getByRole("button", { name: "About" }).click();
  const about = page.locator('dialog[data-sheet="about"]');
  await expect(about).toBeVisible();
  await expect(about).toContainText("KanjiVG");
  await expect(about).toContainText("licensed CC BY-SA 3.0");
  await expect(about).toContainText(
    "Mechanics based on published research by Oleksandra Keehl, Edward Melcer and Dominic Kao (Radical Tunes, 2019/2021; Zen Hanzi, 2022). Independent implementation; not affiliated with the authors.",
  );
  await about.getByRole("button", { name: "Close" }).click();
  await expect(about).toHaveCount(0);
});

test("a study condition fixes the sound mode and hides its setting", async ({ page }) => {
  await page.goto(`${DEBUG}&condition=silent`);
  expect((await events(page, "session_start"))[0]?.data).toMatchObject({ condition: "silent", audio_mode: "silent", sound_on: false });
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.locator('dialog[data-sheet="settings"]');
  await expect(settings).toBeVisible();
  await expect(settings.locator('[data-field="audioMode"]')).toHaveCount(0);
  await expect(settings.locator('[data-field="timbreMode"]')).toHaveCount(1);
});

test("a study participant does not inherit the settings of the one before on the same device", async ({ page }) => {
  // Same origin as the game, so no CORS preflight; the collector is played by the test.
  const link = (participant: string): string =>
    `${DEBUG}&study=S1&participant=${participant}&api=${encodeURIComponent(`${BASE}platform/functions/v1`)}#token=t`;
  await page.route("**/event-collector", (route) => route.fulfill({ status: 201, contentType: "application/json", body: '{"event_id":"e"}' }));
  const stored = (key: string): Promise<string | null> => page.evaluate((name) => localStorage.getItem(name), key);
  const settings = page.locator('dialog[data-sheet="settings"]');

  await page.goto(link("P1"));
  await page.getByRole("button", { name: "Settings" }).click();
  await settings.getByText("Gentle", { exact: true }).click();
  await settings.getByText("Quick", { exact: true }).click();
  expect(JSON.parse((await stored("kk.fude-uta.v1:S1:P1")) ?? "{}")).toMatchObject({ settings: { judging: "gentle", plan: "quick" } });
  expect(await stored("kk.fude-uta.v1")).toBeNull();

  // The next participant starts from the defaults; the first one finds their own choices again.
  await page.goto(link("P2"));
  expect((await events(page, "session_start"))[0]?.data).toMatchObject({ judging: "normal", plan: "guided-fade" });
  await page.goto(link("P1"));
  expect((await events(page, "session_start"))[0]?.data).toMatchObject({ judging: "gentle", plan: "quick" });
});
