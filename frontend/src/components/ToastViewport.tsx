import { useToastStore } from "@/lib/toastStore";

const kindColors: Record<string, { border: string; text: string; icon: string }> = {
  error: { border: "rgba(255, 118, 117, 0.55)", text: "#ff9f9c", icon: "⚠" },
  info: { border: "rgba(125, 219, 200, 0.45)", text: "#7ddbc8", icon: "ℹ" },
  success: { border: "rgba(125, 219, 200, 0.45)", text: "#7ddbc8", icon: "✓" },
};

export function ToastViewport() {
  const toasts = useToastStore((state) => state.toasts);
  const dismissToast = useToastStore((state) => state.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: "fixed",
        bottom: 20,
        right: 20,
        zIndex: 2147483646,
        display: "grid",
        gap: 8,
        maxWidth: 380,
        pointerEvents: "none",
      }}
    >
      {toasts.map((toast) => {
        const colors = kindColors[toast.kind] ?? kindColors.error;
        return (
          <div
            key={toast.id}
            className="zorai-toast"
            style={{
              pointerEvents: "auto",
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              background: "rgba(10, 14, 23, 0.96)",
              border: `1px solid ${colors.border}`,
              borderRadius: 10,
              padding: "10px 12px",
              boxShadow: "0 8px 28px rgba(0, 0, 0, 0.5)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
            }}
          >
            <span style={{ color: colors.text, fontSize: 13, lineHeight: 1.4, flexShrink: 0 }} aria-hidden="true">
              {colors.icon}
            </span>
            <span style={{ fontSize: 12, color: "var(--text-primary, #dbe4f2)", lineHeight: 1.45, minWidth: 0, overflowWrap: "anywhere" }}>
              {toast.message}
            </span>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismissToast(toast.id)}
              style={{
                flexShrink: 0,
                background: "transparent",
                border: "none",
                color: "var(--text-muted, #8a97ab)",
                cursor: "pointer",
                fontSize: 14,
                lineHeight: 1,
                padding: 2,
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
