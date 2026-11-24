/** The three-part feedback after a check, in words. All three lines are always shown. */

import type { AssemblyFeedback } from "@kankyouken/mechanics/components";

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
