import type { GlyphMelody } from "@kankyouken/mechanics/melody";
import type { Gloss } from "../content";
import { toneOf } from "../palette";
import type { Pip } from "../progress";
import type { Board } from "./board";
import { createBoard } from "./board";
import { el } from "./dom";

/** The writing screen's furniture; the learning, timed and recall modes fill it in. */
export interface WritingUi {
  readonly root: HTMLElement;
  readonly board: Board;
  setHeading(title: string, count: string): void;
  /** Right-hand side of the top bar (timer, score). */
  setStatus(...content: (Node | string)[]): void;
  setGloss(gloss: Gloss, emphasis?: "large"): void;
  /** What the player is asked to do now, with one pip per step when there are steps. */
  setStage(label: string, pips?: readonly Pip[]): void;
  /** One chip per melody unit of the character; null removes them. */
  setChips(melody: GlyphMelody | null): void;
  /** What tapping a chip does (it gets the unit's index); null makes the chips inert. */
  setChipAction(action: ((unit: number) => void) | null): void;
  highlightUnit(unit: number | null): void;
  setMessage(text: string): void;
  setActions(...buttons: HTMLElement[]): void;
  /** A card over the writing square (round intro, "listen first"); null removes it. */
  setOverlay(content: HTMLElement | null): void;
  setSeal(visible: boolean): void;
  destroy(): void;
}

const NOTE_ICON =
  '<svg class="chip-note" viewBox="0 0 12 14" aria-hidden="true"><path d="M4.6 10.6V2.2l5.6-1.4v8.1" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><ellipse cx="3" cy="10.8" rx="2" ry="1.5" fill="currentColor"/><ellipse cx="8.6" cy="9.2" rx="2" ry="1.5" fill="currentColor"/></svg>';

const BACK_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function createWritingUi(onBack: () => void): WritingUi {
  const board = createBoard();

  const back = el("button", { type: "button", class: "icon-btn", "aria-label": "Back to lessons" });
  back.innerHTML = BACK_ICON;
  back.addEventListener("click", onBack);
  const title = el("span", { class: "heading-title" });
  const count = el("span", { class: "heading-count" });
  const status = el("div", { class: "status" });
  const top = el("header", { class: "topbar" }, back, el("div", { class: "heading" }, title, count), status);

  const meaning = el("p", { class: "meaning" });
  const reading = el("p", { class: "reading", lang: "ja" });
  const gloss = el("div", { class: "gloss" }, meaning, reading);

  const overlay = el("div", { class: "overlay", hidden: "" });
  const seal = el("div", { class: "seal", lang: "ja", "aria-hidden": "true", hidden: "" }, "筆歌");
  const frame = el("div", { class: "board-frame" }, board.el, seal, overlay);

  const pips = el("span", { class: "pips", "aria-hidden": "true" });
  const stageLabel = el("span", { class: "stage-label" });
  const stage = el("div", { class: "stage" }, pips, stageLabel);
  const chips = el("ul", { class: "chips", "aria-label": "Parts of this character" });
  const message = el("p", { class: "message", role: "status" });
  const actions = el("div", { class: "actions" });
  const side = el("div", { class: "side" }, gloss, stage, chips, message, actions);

  const root = el("section", { class: "screen writing" }, top, frame, side);
  let chipAction: ((unit: number) => void) | null = null;

  return {
    root,
    board,
    setHeading(text, position) {
      title.textContent = text;
      count.textContent = position;
    },
    setStatus(...content) {
      status.replaceChildren(...content);
    },
    setGloss(value, emphasis) {
      meaning.textContent = value.meaning;
      reading.textContent = value.reading;
      gloss.classList.toggle("gloss-large", emphasis === "large");
    },
    setStage(label, steps = []) {
      stageLabel.textContent = label;
      pips.replaceChildren(
        ...steps.map((pip) => el("i", { class: "pip", "data-state": pip.state, "data-starts-stage": String(pip.startsStage) })),
      );
    },
    setChips(melody) {
      chips.replaceChildren(
        ...(melody?.units ?? []).map((unit, index) => {
          const timbre = melody?.strokes[unit.strokes[0] ?? -1]?.timbre ?? "";
          const name = unit.component ?? "loose strokes";
          const chip = el(
            "button",
            { type: "button", class: "chip", "data-tone": toneOf(timbre), "data-unit": String(index), "aria-label": `Play ${name}` },
            el("span", { class: "chip-glyph", lang: "ja" }, unit.component ?? "・"),
          );
          chip.insertAdjacentHTML("beforeend", NOTE_ICON);
          chip.disabled = chipAction === null;
          chip.addEventListener("click", () => chipAction?.(index));
          return el("li", {}, chip);
        }),
      );
      chips.hidden = melody === null;
    },
    setChipAction(action) {
      chipAction = action;
      for (const chip of chips.querySelectorAll("button")) chip.disabled = action === null;
    },
    highlightUnit(unit) {
      for (const chip of chips.querySelectorAll(".chip")) chip.toggleAttribute("data-current", chip.getAttribute("data-unit") === String(unit));
    },
    setMessage(text) {
      message.textContent = text;
    },
    setActions(...buttons) {
      actions.replaceChildren(...buttons);
    },
    setOverlay(content) {
      overlay.replaceChildren(...(content === null ? [] : [content]));
      overlay.hidden = content === null;
    },
    setSeal(visible) {
      seal.hidden = !visible;
    },
    destroy() {
      board.destroy();
      root.remove();
    },
  };
}
