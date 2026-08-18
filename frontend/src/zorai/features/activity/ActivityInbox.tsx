import { useMemo } from "react";
import { useNotificationStore } from "@/lib/notificationStore";

export function ActivityInbox() {
  const notifications = useNotificationStore((state) => state.notifications);
  const unreadCount = useNotificationStore((state) => state.unreadCount);
  const markRead = useNotificationStore((state) => state.markRead);
  const markAllRead = useNotificationStore((state) => state.markAllRead);
  const archiveRead = useNotificationStore((state) => state.archiveRead);
  const archiveNotification = useNotificationStore((state) => state.archiveNotification);
  const activeNotifications = useMemo(
    () => notifications.filter((notification) => notification.archivedAt == null && notification.deletedAt == null),
    [notifications],
  );

  return (
    <div className="zorai-panel zorai-inbox">
      <div className="zorai-inbox__header">
        <div>
          <div className="zorai-section-label">Inbox</div>
          <strong>{unreadCount} unread / {activeNotifications.length} active</strong>
        </div>
        <div className="zorai-card-actions">
          <button type="button" className="zorai-ghost-button" onClick={() => markAllRead()}>Read all</button>
          <button type="button" className="zorai-ghost-button" onClick={() => archiveRead()}>Archive read</button>
        </div>
      </div>
      {activeNotifications.length === 0 ? (
        <div className="zorai-empty-state">No notifications.</div>
      ) : (
        <div className="zorai-activity-list">
          {activeNotifications.map((notification) => (
            <article
              key={notification.id}
              className={["zorai-activity-item", notification.isRead ? "zorai-inbox__item--read" : ""].filter(Boolean).join(" ")}
            >
              <div>
                <strong>{notification.title}</strong>
                <span>{formatTime(notification.updatedAt ?? notification.timestamp)}</span>
              </div>
              <p>{notification.body || notification.subtitle || "Notification"}</p>
              <div className="zorai-card-actions">
                {!notification.isRead ? (
                  <button type="button" className="zorai-ghost-button" onClick={() => markRead(notification.id)}>
                    Mark read
                  </button>
                ) : null}
                <button type="button" className="zorai-ghost-button" onClick={() => archiveNotification(notification.id)}>
                  Archive
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function formatTime(timestamp: number): string {
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : "pending";
}
