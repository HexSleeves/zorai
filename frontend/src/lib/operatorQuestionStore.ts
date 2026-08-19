import { create } from "zustand";

export type OperatorQuestion = {
  question_id: string;
  content: string;
  options: string[];
  threadId: string | null;
};

type OperatorQuestionStoreState = {
  question: OperatorQuestion | null;
  setQuestion: (question: OperatorQuestion | null) => void;
  resolveQuestion: (questionId: string) => void;
};

export const useOperatorQuestionStore = create<OperatorQuestionStoreState>((set) => ({
  question: null,
  setQuestion: (question) => set({ question }),
  resolveQuestion: (questionId) =>
    set((state) =>
      state.question && state.question.question_id === questionId
        ? { question: null }
        : state,
    ),
}));
