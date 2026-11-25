import type { Option, Settings } from "../settings";
import { AUDIO_MODE_OPTIONS, JUDGING_OPTIONS, PLAN_OPTIONS, TIMBRE_MODE_OPTIONS } from "../settings";
import { armUnderPointer, createGuard, el } from "./dom";

const CLOSE_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

const CREDITS =
  "Mechanics based on published research by Oleksandra Keehl, Edward Melcer and Dominic Kao (Radical Tunes, 2019/2021; Zen Hanzi, 2022). Independent implementation; not affiliated with the authors.";

let nextId = 0;

/** A modal sheet with a title and a close button; it removes itself from the page when closed. */
function openSheet(name: string, title: string, ...body: HTMLElement[]): void {
  const titleId = `sheet-title-${nextId++}`;
  const close = el("button", { type: "button", class: "icon-btn", "aria-label": "Close" });
  close.innerHTML = CLOSE_ICON;
  const sheet = el(
    "dialog",
    { class: "sheet", "data-sheet": name, "aria-labelledby": titleId },
    el("div", { class: "sheet-header" }, el("h2", { class: "sheet-title", id: titleId }, title), close),
    el("div", { class: "sheet-body" }, ...body),
  );
  close.addEventListener("click", () => sheet.close());
  // A click on the backdrop closes the sheet, but not one that still belongs to the click that
  // opened it. Choices made in the sheet meanwhile do not hold it: they are clicks of their own.
  const backdrop = createGuard();
  sheet.addEventListener("pointerdown", (event) => {
    if (event.target === sheet) backdrop.pressed();
  });
  sheet.addEventListener("click", (event) => {
    if (event.target === sheet && !backdrop.held()) sheet.close();
  });
  sheet.addEventListener("close", () => sheet.remove());
  document.body.append(sheet);
  backdrop.hold();
  sheet.showModal();
  armUnderPointer(sheet);
}

function radioField<T extends string>(
  legend: string,
  name: string,
  options: readonly Option<T>[],
  selected: T,
  onPick: (value: T) => void,
): HTMLElement {
  const choices = options.map((option) => {
    const input = el("input", { type: "radio", name, value: option.value });
    input.checked = option.value === selected;
    input.addEventListener("change", () => onPick(option.value));
    return el(
      "label",
      { class: "option" },
      input,
      el("span", { class: "option-label" }, option.label),
      el("span", { class: "option-note" }, option.note),
    );
  });
  return el(
    "fieldset",
    { class: "field", "data-field": name },
    el("legend", { class: "field-label" }, legend),
    el("div", { class: "options" }, ...choices),
  );
}

export interface SettingsSheetOptions {
  readonly settings: Settings;
  /** A study condition fixes the sound mode; the choice is then not offered. */
  readonly audioModeFixed: boolean;
  onChange(change: Partial<Settings>): void;
}

export function openSettings(options: SettingsSheetOptions): void {
  const { settings, onChange } = options;
  const volume = el("input", {
    type: "range",
    class: "volume",
    id: "setting-volume",
    min: "0",
    max: "100",
    step: "5",
    value: String(Math.round(settings.volume * 100)),
  });
  volume.addEventListener("change", () => onChange({ volume: Number(volume.value) / 100 }));
  const fields = [
    radioField("Sound", "audioMode", AUDIO_MODE_OPTIONS, settings.audioMode, (audioMode) => onChange({ audioMode })),
    radioField("Instruments", "timbreMode", TIMBRE_MODE_OPTIONS, settings.timbreMode, (timbreMode) => onChange({ timbreMode })),
    el("div", { class: "field", "data-field": "volume" }, el("label", { class: "field-label", for: "setting-volume" }, "Volume"), volume),
    radioField("Judging", "judging", JUDGING_OPTIONS, settings.judging, (judging) => onChange({ judging })),
    radioField("Learning plan", "plan", PLAN_OPTIONS, settings.plan, (plan) => onChange({ plan })),
  ];
  openSheet("settings", "Settings", ...(options.audioModeFixed ? fields.slice(1) : fields));
}

export function openAbout(attribution: string): void {
  openSheet(
    "about",
    "About Fude Uta",
    el(
      "p",
      {},
      "Fude Uta (筆歌, “brush song”) teaches the stroke order of kanji. Every part of a character has a short melody of its own, and every stroke is one gesture of it: write the character correctly and you have played its tune.",
    ),
    el("p", { "data-about": "data" }, `Character shapes: ${attribution}, licensed CC BY-SA 3.0.`),
    el("p", { "data-about": "credits" }, CREDITS),
  );
}
