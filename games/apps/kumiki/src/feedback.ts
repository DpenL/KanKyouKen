/** The three-part feedback after a check, in words. All three lines are always shown. */

import type { AssemblyFeedback, HintPrice } from "@kankyouken/mechanics/components";

export type Tone = "good" | "bad" | "partial" | "unknown";

export interface FeedbackLine {
  readonly label: string;
  readonly text: string;
  readonly tone: Tone;
}

export function feedbackLines(feedback: AssemblyFeedback): FeedbackLine[] {
  const { structureCorrect, correctComponents, componentCount, anyInCorrectPosition } = feedback;
  const components: Tone =
    correctComponents === componentCount ? "good" : correctComponents === 0 ? "bad" : "partial";
  return [
    { label: "Structure", text: structureCorrect ? "right" : "wrong", tone: structureCorrect ? "good" : "bad" },
    { label: "Components", text: `${correctComponents} of ${componentCount} belong`, tone: components },
    structureCorrect
      ? {
          label: "Position",
          text: anyInCorrectPosition ? "at least one in place" : "none in place",
          tone: anyInCorrectPosition ? (feedback.solved ? "good" : "partial") : "bad",
        }
      : { label: "Position", text: "cannot be judged yet", tone: "unknown" },
  ];
}

/** Icon per tone, so that the lines do not rely on colour alone. */
export const TONE_ICON: Readonly<Record<Tone, string>> = { good: "✓", bad: "✕", partial: "~", unknown: "?" };

/**
 * The feedback panel's lines (the counts of the Zen Hanzi demo, in our own words): the
 * structure right or wrong, how many placed parts belong to the character, and how many
 * sit in their own slot, both out of the slots of the structure that was tried. Counting
 * against the tried structure, not the character, keeps the number of parts secret.
 */
export function feedbackCounts(feedback: AssemblyFeedback): FeedbackLine[] {
  const { structureCorrect, correctComponents, correctPositions, slotCount } = feedback;
  const tone = (count: number): Tone => (count === slotCount ? "good" : count === 0 ? "bad" : "partial");
  return [
    { label: "Structure", text: structureCorrect ? "right" : "wrong", tone: structureCorrect ? "good" : "bad" },
    { label: "Parts that belong", text: `${correctComponents} of ${slotCount}`, tone: tone(correctComponents) },
    { label: "In their place", text: `${correctPositions} of ${slotCount}`, tone: tone(correctPositions) },
  ];
}

/** Hearts in words: 3, 2½, ½. */
export function heartsText(hearts: number): string {
  const whole = Math.floor(hearts);
  return hearts === whole ? String(whole) : `${whole === 0 ? "" : whole}½`;
}

/**
 * What the next hint costs, in a few words for the Hint button; empty when it costs
 * nothing. `tokens` is the number of hint tokens in hand.
 */
export function hintCostNote(price: HintPrice, tokens: number): string {
  switch (price.policy) {
    case "life":
      return price.lives === 0 ? "" : `${heartsText(price.lives)} ${price.lives > 1 ? "lives" : "life"}`;
    case "points":
      return price.points === 0 ? "" : `−${price.points}`;
    case "token":
      return `${tokens} ${tokens === 1 ? "token" : "tokens"}`;
    case "return":
      return "comes back later";
    case "unmastered":
      return "not mastered";
    default:
      return "";
  }
}

/** How a round ended, as the reveal needs it. */
export interface RevealFacts {
  readonly solved: boolean;
  readonly score: number;
  /** Solved in a way that counts as mastered. */
  readonly mastered: boolean;
  /** The character comes back at the end of the deck. */
  readonly returns: boolean;
  /** The run is over. */
  readonly endsRun: boolean;
}

/** The line under the revealed character: what the round earned and what follows from how it went. */
export function outcomeNote(facts: RevealFacts): string {
  if (facts.solved) {
    const points = `+${facts.score} points`;
    if (facts.returns) return `${points}. You looked, so it comes back at the end of the deck.`;
    return facts.mastered ? points : `${points}. You looked, so it does not count as mastered yet.`;
  }
  const points = facts.score > 0 ? `+${facts.score} points for what was right.` : "No points this time.";
  return facts.endsRun ? `${points} The run ends here.` : facts.returns ? `${points} It comes back at the end of the deck.` : points;
}
