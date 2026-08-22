import type { ComposerAttachment } from "@/components/agent-chat-panel/chat-view/types";

export type AttachmentTileModel = {
  id: string;
  kind: "image" | "audio" | "text";
  name: string;
  previewUrl?: string;
};

export function composerAttachmentToTile(attachment: ComposerAttachment): AttachmentTileModel {
  return {
    id: attachment.id,
    kind: attachment.kind,
    name: attachment.name,
    previewUrl: attachment.dataUrl,
  };
}

export function AttachmentTiles({
  items,
  onRemove,
}: {
  items: AttachmentTileModel[];
  onRemove?: (id: string) => void;
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="zorai-attachment-tiles">
      {items.map((item) => (
        <div key={item.id} className="zorai-attachment-tile">
          {item.kind === "image" && item.previewUrl ? (
            <span className="zorai-attachment-tile__preview">
              <img src={item.previewUrl} alt="" />
            </span>
          ) : (
            <span className="zorai-attachment-tile__preview zorai-attachment-tile__preview--icon" aria-hidden="true">
              <AttachmentKindIcon kind={item.kind} />
            </span>
          )}
          <span className="zorai-attachment-tile__caption" title={item.name}>{item.name}</span>
          {onRemove ? (
            <button
              type="button"
              className="zorai-attachment-tile__remove"
              title={`Remove ${item.name}`}
              aria-label={`Remove ${item.name}`}
              onClick={() => onRemove(item.id)}
            >
              ×
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function AttachmentKindIcon({ kind }: { kind: "image" | "audio" | "text" }) {
  if (kind === "audio") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
