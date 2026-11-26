/** The home screen: mode switch, decks, and the way to the exam, settings and credits. */

import type { Deck } from "../content";
import type { Mode } from "../round";
import { livesLine } from "../rules";
import { bestScore } from "../saved";
import type { App } from "./app";
import { button, h } from "./dom";
import { drawnChar } from "./shapes";

export interface HomeActions {
  play(deck: Deck, mode: Mode): void;
  exam(): void;
  /** Open Settings; `changed` is to be called when the rules were changed there. */
  settings(changed: () => void): void;
  about(): void;
}

const MODES: readonly { readonly id: Mode; readonly title: string; readonly line: string }[] = [
  { id: "learn", title: "Learn", line: "You see the character first." },
  { id: "review", title: "Review", line: "Meaning and reading only." },
];

/** The block on a deck's card: its shared component, or for the Mixed deck a mosaic of all of them. */
function emblem(app: App, deck: Deck): HTMLElement {
  const { glyphs, decks } = app.content;
  if (deck.shared !== null) return drawnChar(glyphs.get(deck.shared), deck.shared, "deck-emblem");
  const shared = decks.flatMap((other) => (other.shared === null ? [] : [other.shared])).slice(0, 4);
  return h("span", { class: "deck-emblem deck-emblem-mosaic", "aria-hidden": "true" }, ...shared.map((char) => drawnChar(glyphs.get(char), char, "deck-emblem-part")));
}

export function homeScreen(app: App, actions: HomeActions): HTMLElement {
  const decks = h("section", { class: "decks", "aria-label": "Decks" });
  const modes = h("div", { class: "modes", role: "radiogroup", "aria-label": "Mode" });

  const render = (): void => {
    const saved = app.store.get();
    const choices = app.rules.choices();
    modes.replaceChildren(
      ...MODES.map((mode) => {
        const option = h(
          "button",
          {
            type: "button",
            class: "mode",
            role: "radio",
            "data-mode": mode.id,
            "aria-checked": saved.mode === mode.id ? "true" : "false",
            // One tab stop for the group; the arrow keys move within it.
            tabindex: saved.mode === mode.id ? 0 : -1,
          },
          h("strong", {}, mode.title),
          // What the rules in force give each mode.
          h("span", {}, `${mode.line} ${livesLine(choices, mode.id)}`),
        );
        const choose = (id: Mode): void => {
          app.store.patch({ mode: id });
          render();
          modes.querySelector<HTMLElement>(`[data-mode="${id}"]`)?.focus();
        };
        option.addEventListener("click", () => choose(mode.id));
        option.addEventListener("keydown", (event) => {
          const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
          if (step === 0) return;
          event.preventDefault();
          const at = MODES.findIndex((other) => other.id === mode.id);
          choose(MODES[(at + step + MODES.length) % MODES.length]!.id);
        });
        return option;
      }),
    );
    decks.replaceChildren(
      ...app.content.decks.map((deck) => {
        // Only the classic scoring keeps a best score; the demo's has a running total and nothing to beat.
        const best = choices.scoring === "classic" ? bestScore(saved, deck.id, saved.mode) : null;
        const played = choices.scoring === "classic";
        const card = h(
          "button",
          { type: "button", class: "deck", "data-deck": deck.id },
          emblem(app, deck),
          h(
            "span",
            { class: "deck-text" },
            h("strong", { class: "deck-title" }, deck.title),
            deck.shared === null
              ? h("span", { class: "deck-note" }, "A handful from every deck")
              : h("span", { class: "deck-chars" }, ...deck.chars.map((char) => drawnChar(app.content.glyphs.get(char), char, "deck-char"))),
            played ? h("span", { class: "deck-best" }, best === null ? "Not played yet" : `Best ${best}`) : null,
          ),
        );
        card.addEventListener("click", () => actions.play(deck, app.store.get().mode));
        return card;
      }),
    );
  };
  render();

  return h(
    "main",
    { class: "screen home" },
    h(
      "header",
      { class: "home-head" },
      h("p", { class: "brand-kanji", lang: "ja", "aria-hidden": "true" }, "組木"),
      h("h1", {}, "Kumiki"),
      h("p", { class: "tagline" }, "Join the parts. Build the character."),
    ),
    modes,
    decks,
    h(
      "nav",
      { class: "home-actions", "aria-label": "More" },
      button("Exam", { class: "ghost", "data-action": "exam" }, actions.exam),
      // The mode switch and the deck cards say what the rules give; they follow a change at once.
      button("Settings", { class: "ghost", "data-action": "settings" }, () => actions.settings(render)),
      button("About", { class: "ghost", "data-action": "about" }, actions.about),
    ),
  );
}
