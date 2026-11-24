import { expect, test, type Page } from "@playwright/test";

const BASE = "http://127.0.0.1:4311/";
const DEBUG = `${BASE}?debug&seed=e2e`;

interface GameEvent {
  type: string;
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
  expect((await events(page, "session_start"))[0]?.data).toMatchObject({ seed: "e2e", audio_mode: "melody" });

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
  expect((await events(page, "stage_enter")).map((event) => event.task)).toEqual(["demo", "trace:dotted", "trace:none"]);
  expect((await events(page, "item_complete"))[0]).toMatchObject({ item: "一", data: { mistakes: 0 } });

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
  expect((await events(page, "session_start"))[0]?.data).toMatchObject({ condition: "silent", audio_mode: "silent" });
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.locator('dialog[data-sheet="settings"]');
  await expect(settings).toBeVisible();
  await expect(settings.locator('[data-field="audioMode"]')).toHaveCount(0);
  await expect(settings.locator('[data-field="timbreMode"]')).toHaveCount(1);
});
