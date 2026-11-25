import type { Lesson } from "@kankyouken/glyph-data";
import type { Glyph } from "@kankyouken/mechanics/glyph";
import type { GlyphMelody } from "@kankyouken/mechanics/melody";
import type { RecallItemState } from "@kankyouken/mechanics/scaffold";
import { recallListened, recallStrokeDrawn, recallUndo, startRecallItem, submitRecall } from "@kankyouken/mechanics/scaffold";
import type { DrawnStroke } from "@kankyouken/mechanics/stroke";
import { gameEvent, recallResultEvent } from "@kankyouken/mechanics/telemetry";
import { isStrayTap } from "../attempts";
import { glossOf, glyphOf } from "../content";
import type { Env, Mode } from "../env";
import { lessonAbandonedEvent } from "../left";
import type { RecallRow } from "../recall";
import { recallCueFor, recallResultData, recallRow, scoreRecall } from "../recall";
import { button, el } from "./dom";
import type { WritingUi } from "./writing-ui";

const TASK = "recall";

/**
 * The recall test: cue, then write on a blank square. Strokes stay as plain ink, nothing
 * is judged or revealed while writing; `onDone` gets the scores once every character is in.
 * Scoring uses the judging level of the settings, as the learning stages do.
 */
export function startRecallMode(env: Env, ui: WritingUi, lesson: Lesson, onDone: (rows: readonly RecallRow[]) => void): Mode {
  const cue = recallCueFor(env.audioMode());
  const order = env.rng.shuffle(lesson.chars);
  const rows: RecallRow[] = [];
  const { board } = ui;
  const { view } = board;
  let index = 0;
  let glyph: Glyph;
  let melody: GlyphMelody;
  let state: RecallItemState;
  let drawn: DrawnStroke[] = [];
  let startedAt = 0;
  /** True once the last character is handed in. */
  let over = false;

  const where = (): { ts: number; item: string; task: string } => ({ ts: Date.now(), item: state.item, task: TASK });

  /** `again`: from Listen again in the action row, rather than from the "Listen first" card. */
  const listen = (again: boolean): void => {
    state = recallListened(state);
    env.emit(gameEvent("melody_listen", where(), { audio_mode: env.audioMode(), listens: state.listens }));
    show(again);
    env.performer.perform(melody, { mode: env.audioMode(), onStroke: () => undefined });
  };

  const undo = (): void => {
    state = recallUndo(state);
    drawn = drawn.slice(0, state.strokesDrawn);
    view.clearInk();
    for (const stroke of drawn) {
      view.setInk(stroke);
      view.keepInk();
    }
    show(true);
  };

  const submit = (): void => {
    env.performer.stop();
    state = submitRecall(state);
    const { judging } = env.settings();
    const score = scoreRecall(drawn, glyph, judging);
    const responseMs = Date.now() - startedAt;
    env.emit(recallResultEvent(where(), recallResultData(score, state, responseMs, env.audioMode(), judging)));
    env.emit(gameEvent("item_complete", where(), { duration_ms: responseMs }));
    rows.push(recallRow(state.item, glossOf(env.content, state.item).meaning, score));
    index += 1;
    if (index < order.length) startItem();
    else {
      over = true;
      onDone(rows);
    }
  };

  /**
   * Bring counters, buttons and the lock in line with the item's state. `redraw`: a button of
   * the action row asked for it, and the row only shows what that press changed (`WritingUi.redrawActions`).
   */
  const show = (redraw = false): void => {
    board.enabled = state.canWrite;
    ui.setStage(cue.showStrokeCount ? `Strokes ${state.strokesDrawn} / ${glyph.strokes.length}` : "");
    if (!state.canWrite) {
      ui.setActions();
      ui.setOverlay(
        el(
          "div",
          { class: "overlay-card" },
          el("h2", { class: "overlay-title" }, "Listen first"),
          el("p", { class: "overlay-text" }, "Hear this character's melody, then write it from memory."),
          button("Listen", () => listen(false), "primary"),
        ),
      );
      return;
    }
    ui.setOverlay(null);
    const undoButton = button("Undo", undo);
    undoButton.disabled = state.strokesDrawn === 0;
    const replay = cue.melody === "off" ? [] : [button("Listen again", () => listen(true))];
    const row = [...replay, undoButton, button("Done", submit, "primary")];
    if (redraw) ui.redrawActions(...row);
    else ui.setActions(...row);
    Object.assign(env.probe, { rep: null, expected: state.strokesDrawn });
  };

  const startItem = (): void => {
    const char = order[index];
    if (char === undefined) return;
    glyph = glyphOf(env.content, char);
    melody = env.melodist().melody(glyph);
    state = startRecallItem(char, cue);
    drawn = [];
    startedAt = Date.now();
    view.setGlyph(glyph);
    view.showGhost(false);
    ui.setHeading(lesson.title, `From memory · ${index + 1} / ${order.length}`);
    ui.setGloss(cue.showMeaning ? glossOf(env.content, char) : { meaning: "", reading: "" });
    Object.assign(env.probe, {
      screen: "recall",
      stage: TASK,
      char,
      medians: glyph.strokes.map((stroke) => stroke.median),
    });
    env.emit(gameEvent("item_start", where(), { position: index, stroke_count: glyph.strokes.length, cue_melody: cue.melody }));
    show();
  };

  ui.setStatus();
  ui.setChips(null);
  ui.setMessage("");
  board.setTone(null);
  board.pen = {
    onStart: (sample) => view.setInk([sample]),
    onMove: (_sample, stroke) => view.setInk(stroke),
    onEnd(stroke) {
      if (isStrayTap(stroke, glyph.size)) {
        view.setInk(null);
        return;
      }
      // Writing ends the listening. A tap does not: the last taps of a burst on Listen land
      // here, and a melody they cut short would still be on record as listened to.
      env.performer.stop();
      view.keepInk();
      drawn.push(stroke);
      state = recallStrokeDrawn(state);
      show();
    },
    onCancel: () => view.setInk(null),
  };
  startItem();

  return {
    recordLeft(by) {
      if (over) return;
      env.emit(
        lessonAbandonedEvent(Date.now(), by, {
          lesson: lesson.id,
          mode: "recall",
          task: TASK,
          item: state.item,
          position: index,
          of: order.length,
          completed: rows.length,
          strokesDone: state.strokesDrawn,
          strokeCount: glyph.strokes.length,
          elapsedMs: Date.now() - startedAt,
          detail: { melody_listens: state.listens },
        }),
      );
    },
    stop() {
      env.performer.stop();
      board.pen = null;
      board.enabled = false;
    },
  };
}
