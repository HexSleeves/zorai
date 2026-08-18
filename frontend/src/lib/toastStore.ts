import { create } from "zustand";

export type ToastKind = "error" | "info" | "success";

export interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
  createdAt: number;
}

interface ToastStoreState {
  toasts: ToastItem[];
  pushToast: (message: string, kind?: ToastKind) => void;
  dismissToast: (id: string) => void;
}

const TOAST_AUTO_DISMISS_MS = 6000;
let toastSerial = 0;

export const useToastStore = create<ToastStoreState>((set, get) => ({
  toasts: [],
  pushToast: (message, kind = "error") => {
    const trimmed = message.trim();
    if (!trimmed) return;
    toastSerial += 1;
    const id = "toast_" + String(Date.now()) + "_" + String(toastSerial);
    set((state) => ({
      toasts: [...state.toasts.slice(-4), { id, kind, message: trimmed, createdAt: Date.now() }],
    }));
    setTimeout(() => {
      get().dismissToast(id);
    }, TOAST_AUTO_DISMISS_MS);
  },
  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },
}));

/** Convenience helper for non-React call sites. */
export function pushToast(message: string, kind: ToastKind = "error"): void {
  useToastStore.getState().pushToast(message, kind);
}
