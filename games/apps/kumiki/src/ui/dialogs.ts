/** Modal dialogs: credits, settings, and choosing a deck for the exam. */

import { STARTER_JA_GLYPHS } from "@kankyouken/glyph-data";
import type { Deck } from "../content";
import {
  CHOICES,
  CHOICE_GROUPS,
  PRESETS,
  choiceApplies,
  formatRuleSpec,
  isPlainPreset,
  presetById,
  resolveChoices,
  withChoice,
  type ChoiceKey,
  type RuleChoices,
} from "../rules";
import type { App } from "./app";
import { armOverlay, noteClick, type Switchable } from "./arm";
import { button, h } from "./dom";

const CREDITS =
  "Mechanics based on published research by Oleksandra Keehl, Edward Melcer and Dominic Kao (Radical Tunes, 2019/2021; Zen Hanzi, 2022). Independent implementation; not affiliated with the authors.";

/**
 * Show a modal dialog; it removes itself when closed. What a tap brings under the
 * finger by opening or closing it is held (see `armOverlay`): on a phone the rest of
 * a double tap on Exam would otherwise pick a deck in the chooser, or close the dialog
 * again from its backdrop, and the rest of one on Close would open the deck card behind it.
 */
function open(app: App, name: string, title: string, ...body: (Node | string)[]): HTMLDialogElement {
  const heading = h("h2", { id: `dialog-${name}` }, title);
  const dialog = h("dialog", { class: "dialog", "data-dialog": name, "aria-labelledby": heading.id });
  dialog.append(heading, ...body, h("div", { class: "dialog-actions" }, button("Close", { class: "primary", "data-action": "close" }, () => dialog.close())));
  dialog.addEventListener("close", () => {
    dialog.remove();
    armOverlay(app.arming, document.body);
  });
  // The backdrop is no button, so it is held through a stand-in, and presses on it are passed on by hand.
  const backdrop: Switchable = { disabled: false };
  dialog.addEventListener("pointerdown", (event) => {
    if (event.target === dialog) app.arming.pressed(backdrop);
  });
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog || backdrop.disabled) return;
    // Counted before closing, so that the close listener holds what the rest of the tap would land on.
    noteClick(app.arming, event);
    dialog.close();
  });
  document.body.append(dialog);
  dialog.showModal();
  app.arming.hold([backdrop]);
  armOverlay(app.arming, dialog);
  return dialog;
}

export function openAbout(app: App): void {
  open(
    app,
    "about",
    "About Kumiki",
    h("p", {}, "Kumiki (組木) is wooden joinery: parts cut to fit each other without nails. Here the parts are the components of kanji."),
    h("p", { "data-credit": "data" }, `Character shapes: ${STARTER_JA_GLYPHS.source.attribution}, licensed CC BY-SA 3.0.`),
    h("p", { "data-credit": "research" }, CREDITS),
  );
}

/**
 * The rules of the game in Settings: a preset, then every single rule under it. While a
 * study link or condition fixes the rules they are shown switched off. A change is
 * stored (and recorded) at once and applies from the next deck; `changed` runs after it.
 */
function rulesSection(app: App, changed: () => void): HTMLElement {
  const fixed = app.rules.from !== "player";
  const preset = h("select", { id: "setting-preset", "data-setting": "preset", disabled: fixed });
  for (const option of PRESETS) preset.append(h("option", { value: option.id }, option.title));
  const presetNote = h("p", { class: "setting-note", "data-setting": "preset-note" });
  const summary = h("summary", {});
  const link = h("code", { "data-setting": "rules-link" });
  const reset = button("Back to the preset", { class: "ghost small", "data-action": "reset-rules" }, () => {
    app.rules.choose({ preset: app.rules.spec().preset, changes: {} });
    sync();
    changed();
  });

  const selects = new Map<ChoiceKey, { readonly row: HTMLElement; readonly select: HTMLSelectElement }>();
  const row = <K extends ChoiceKey>(key: K): HTMLElement => {
    const select = h("select", { id: `rule-${key}`, "data-rule": key });
    for (const option of CHOICES[key].options) select.append(h("option", { value: String(option.value) }, option.label));
    select.addEventListener("change", () => {
      app.rules.choose(withChoice(app.rules.spec(), key, select.value as RuleChoices[K]));
      sync();
      changed();
    });
    const element = h("div", { class: "setting rule", "data-rule-row": key }, h("label", { for: select.id }, CHOICES[key].label), select);
    selects.set(key, { row: element, select });
    return element;
  };
  const groups = CHOICE_GROUPS.map((group) => h("fieldset", { class: "rule-group" }, h("legend", {}, group.title), ...group.keys.map((key) => row(key))));

  /** Show what is in force now. */
  function sync(): void {
    const spec = app.rules.spec();
    const choices = resolveChoices(spec);
    const own = presetById(spec.preset)!;
    preset.value = spec.preset;
    presetNote.textContent = own.note;
    const count = Object.keys(spec.changes).length;
    summary.textContent = count === 0 ? "Single rules" : `Single rules (${count} changed)`;
    for (const [key, { row: element, select }] of selects) {
      select.value = String(choices[key]);
      // A rule that changes nothing under the others (what lives cost when there are none) is switched off.
      select.disabled = fixed || !choiceApplies(choices, key);
      element.toggleAttribute("data-changed", key in spec.changes);
      element.toggleAttribute("data-idle", !choiceApplies(choices, key));
    }
    link.textContent = `?rules=${formatRuleSpec(spec)}`;
    reset.hidden = fixed || isPlainPreset(spec);
  }

  preset.addEventListener("change", () => {
    const chosen = presetById(preset.value);
    if (chosen === undefined) return;
    app.rules.choose({ preset: chosen.id, changes: {} });
    sync();
    changed();
  });
  sync();

  return h(
    "section",
    { class: "rules", "data-rules-from": app.rules.from, "aria-labelledby": "settings-rules" },
    h("h3", { id: "settings-rules" }, "Rules"),
    fixed
      ? h(
          "p",
          { class: "setting-note rules-fixed", "data-setting": "rules-fixed" },
          app.rules.from === "link"
            ? "These rules are set by the link this session was opened with and cannot be changed here."
            : "These rules are set by the study condition of this session and cannot be changed here.",
        )
      : null,
    h("div", { class: "setting" }, h("label", { for: preset.id }, "Preset"), preset),
    presetNote,
    h("details", { class: "rule-details", "data-setting": "single-rules" }, summary, ...groups, reset),
    h("p", { class: "setting-note" }, fixed ? "As a link: " : "A change applies from the next deck. As a link: ", link),
  );
}

/** Settings: sound, and the rules of the game. `changed` runs when a rule was changed, so that what is behind the dialog can follow. */
export function openSettings(app: App, changed: () => void = () => {}): void {
  const saved = app.store.get();
  const sound = h("input", { type: "checkbox", id: "setting-sound", checked: saved.sound });
  const volume = h("input", {
    type: "range",
    id: "setting-volume",
    min: 0,
    max: 100,
    step: 5,
    value: Math.round(saved.volume * 100),
    disabled: !saved.sound,
  });
  const apply = (): void => {
    const next = app.store.patch({ sound: sound.checked, volume: Number(volume.value) / 100 });
    volume.disabled = !next.sound;
    app.sound.apply(next);
  };
  sound.addEventListener("change", apply);
  volume.addEventListener("input", apply);
  // Let the player hear the level they picked.
  volume.addEventListener("change", () => app.sound.cue("tick"));
  open(
    app,
    "settings",
    "Settings",
    h("div", { class: "setting" }, h("label", { for: sound.id }, "Sound"), sound),
    h("div", { class: "setting" }, h("label", { for: volume.id }, "Volume"), volume),
    rulesSection(app, changed),
  );
}

export function openExamChooser(app: App, start: (deck: Deck) => void): void {
  // The choices are in place before the dialog opens, so that the one under the finger can be held.
  const choices = app.content.decks.map((deck) => {
    const choice = button(deck.title, { class: "ghost", "data-deck": deck.id }, () => {
      dialog.close();
      start(deck);
    });
    if (deck.shared !== null) choice.append(" ", h("span", { lang: "ja" }, deck.shared));
    return choice;
  });
  const dialog = open(
    app,
    "exam",
    "Exam",
    h("p", {}, "Build every character of a deck from memory. Only the right structure is shown and nothing is marked until the end."),
    h("div", { class: "chooser" }, ...choices),
  );
}
