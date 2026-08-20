import { useState } from "react";
import { getBridge } from "@/lib/bridge";
import { useOperatorQuestionStore } from "@/lib/operatorQuestionStore";

/**
 * Non-blocking question dock. Renders as a bottom-anchored layer above the
 * input so the operator can read the transcript behind it while answering.
 * There is intentionally no backdrop and no focus trap.
 */
export function OperatorQuestionDock() {
  const question = useOperatorQuestionStore((state) => state.question);
  const [busyAnswer, setBusyAnswer] = useState<string | null>(null);

  if (!question) {
    return null;
  }

  const submit = async (answer: string) => {
    if (busyAnswer) return;
    setBusyAnswer(answer);
    const bridge = getBridge();
    try {
      await bridge?.agentAnswerQuestion?.(question.question_id, answer);
    } finally {
      setBusyAnswer(null);
    }
  };

  return (
    <div className="zorai-question-dock" role="dialog" aria-label="Operator question">
      <div className="zorai-question-dock__eyebrow">Question · answer to continue</div>
      <div className="zorai-question-dock__content">{question.content}</div>
      <div className="zorai-question-dock__options">
        {question.options.map((option) => {
          const active = busyAnswer === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => void submit(option)}
              disabled={Boolean(busyAnswer)}
              className={
                "zorai-question-dock__option"
                + (active ? " zorai-question-dock__option--active" : "")
              }
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}
