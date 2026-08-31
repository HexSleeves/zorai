import { queuedComposerLabel, type QueuedComposerMessage } from "./composerQueue";

export function ThreadComposerQueue({
  items,
  editingId,
  onEdit,
  onSendNow,
  onCancel,
}: {
  items: QueuedComposerMessage[];
  editingId: string | null;
  onEdit: (item: QueuedComposerMessage) => void;
  onSendNow: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="zorai-composer-queue">
      {items.map((queued, index) => {
        const label = queuedComposerLabel(queued);
        const editing = queued.id === editingId;
        return (
          <div
            key={queued.id}
            className={["zorai-composer-queue__chip", editing ? "zorai-composer-queue__chip--editing" : ""]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="zorai-composer-queue__header">
              <span className="zorai-composer-queue__label">{editing ? "Editing" : `Queued ${index + 1}`}</span>
              <div className="zorai-composer-queue__actions">
                <button
                  type="button"
                  className="zorai-composer-queue__send-now"
                  title="Edit this queued message"
                  onClick={() => onEdit(queued)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="zorai-composer-queue__send-now"
                  title="Interrupt the current response and send this message now"
                  onClick={() => onSendNow(queued.id)}
                >
                  Send now
                </button>
                <button
                  type="button"
                  className="zorai-composer-queue__remove"
                  aria-label="Cancel queued message"
                  onClick={() => onCancel(queued.id)}
                >
                  ×
                </button>
              </div>
            </div>
            <div className="zorai-composer-queue__content">
              <span className="zorai-composer-queue__text">{label.slice(0, 100)}</span>
              {label.length > 100 ? <span className="zorai-composer-queue__text-ellipsis">…</span> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
