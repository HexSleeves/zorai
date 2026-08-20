import { useEffect } from "react";
import { getBridge } from "@/lib/bridge";
import { useOperatorQuestionStore } from "@/lib/operatorQuestionStore";

/**
 * Headless event bridge: keeps the operator question state in a store so the
 * question dock (a non-blocking layer above the input) can render it without
 * ever blocking the transcript behind a modal backdrop.
 */
export function OperatorQuestionOverlay() {
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge?.onAgentEvent) return;
    return bridge.onAgentEvent((event: any) => {
      if (event?.type === "operator_question") {
        const options = Array.isArray(event.options)
          ? event.options.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
          : [];
        const questionId = typeof event.question_id === "string" ? event.question_id : "";
        const content = typeof event.content === "string" ? event.content : "";
        if (!questionId || !content || options.length === 0) return;
        useOperatorQuestionStore.getState().setQuestion({
          question_id: questionId,
          content,
          options,
          threadId: typeof event.thread_id === "string" ? event.thread_id : null,
        });
      }
      if (event?.type === "operator_question_resolved") {
        const resolvedId = typeof event.question_id === "string" ? event.question_id : "";
        useOperatorQuestionStore.getState().resolveQuestion(resolvedId);
      }
    });
  }, []);

  return null;
}
