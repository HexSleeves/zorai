import { useMemo } from "react";
import type { AgentTodoItem } from "../../../lib/agentStore";
import { todoStatusColor } from "./helpers";

export function TodoPanel({
  todos,
  todoPreview,
  expanded,
  onToggle,
}: {
  todos: AgentTodoItem[];
  todoPreview: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const sortedTodos = useMemo(
    () => todos.slice().sort((a, b) => a.position - b.position),
    [todos],
  );

  if (todos.length === 0) {
    return null;
  }

  return (
    <div className="acp-todo">
      <button type="button" className="acp-todo__toggle" onClick={onToggle}>
        <span className="acp-todo__title">Todo</span>
        <span className="acp-todo__preview">
          {todos.length} item{todos.length === 1 ? "" : "s"}{todoPreview ? ` · ${todoPreview}` : ""}
        </span>
      </button>
      {expanded && (
        <div className="acp-todo__list">
          {sortedTodos.map((item) => (
            <div key={item.id} className="acp-todo__item">
              <span
                className="acp-todo__dot"
                style={{ background: todoStatusColor(item.status) }}
              />
              <span className="acp-todo__content">{item.content}</span>
              <span className="acp-todo__status">{item.status.replace(/_/g, " ")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
