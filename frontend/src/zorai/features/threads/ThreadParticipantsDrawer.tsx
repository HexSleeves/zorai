import { useEffect, useRef, useState } from "react";
import type { AgentThread, ThreadParticipantState } from "@/lib/agentStore/types";
import type { ThreadMutationResult } from "@/components/agent-chat-panel/runtime/types";
import type { ThreadAgentOption } from "./threadHandoffModel";

export function ThreadParticipantsDrawer({
  thread,
  agentOptions,
  onClose,
  onUpsert,
  onDeactivate,
  onSendSuggestion,
  onDismissSuggestion,
}: {
  thread: AgentThread;
  agentOptions: ThreadAgentOption[];
  onClose: () => void;
  onUpsert: (request: { targetAgentId: string; instruction: string }) => Promise<ThreadMutationResult>;
  onDeactivate: (targetAgentId: string) => Promise<ThreadMutationResult>;
  onSendSuggestion: (threadId: string, suggestionId: string, forceSend?: boolean) => Promise<void>;
  onDismissSuggestion: (threadId: string, suggestionId: string) => Promise<void>;
}) {
  const participants = thread.threadParticipants ?? [];
  const suggestions = thread.queuedParticipantSuggestions ?? [];
  const [agentId, setAgentId] = useState(agentOptions[0]?.id ?? "");
  const [instruction, setInstruction] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingInstruction, setEditingInstruction] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    if (!agentOptions.some((option) => option.id === agentId)) {
      setAgentId(agentOptions[0]?.id ?? "");
    }
  }, [agentId, agentOptions]);

  const runMutation = async (
    key: string,
    mutation: () => Promise<ThreadMutationResult | void>,
  ) => {
    setPendingKey(key);
    setError(null);
    try {
      const result = await mutation();
      if (!mountedRef.current) return;
      if (result && !result.ok) {
        setError(result.error);
      } else if (key.startsWith("participant:")) {
        setEditingId(null);
      }
    } catch (reason) {
      if (mountedRef.current) {
        setError(reason instanceof Error ? reason.message : "Participant action failed.");
      }
    } finally {
      if (mountedRef.current) setPendingKey(null);
    }
  };

  const beginEdit = (participant: ThreadParticipantState) => {
    setEditingId(participant.agentId);
    setEditingInstruction(participant.instruction);
    setError(null);
  };

  return (
    <div className="zorai-participants-drawer__backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        className="zorai-participants-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="zorai-participants-title"
      >
        <header>
          <div>
            <div className="zorai-kicker">Collaboration</div>
            <h2 id="zorai-participants-title">Thread Participants</h2>
          </div>
          <button ref={closeRef} type="button" className="zorai-ghost-button" onClick={onClose}>
            Close
          </button>
        </header>

        {error ? <p className="zorai-inline-error" role="alert">{error}</p> : null}

        <section className="zorai-participants-drawer__section">
          <h3>Add participant</h3>
          {!thread.daemonThreadId ? (
            <p>Send the first message before adding participants.</p>
          ) : null}
          <label>
            <span>Agent</span>
            <select
              value={agentId}
              disabled={!thread.daemonThreadId || pendingKey !== null}
              onChange={(event) => setAgentId(event.target.value)}
            >
              {agentOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Instruction</span>
            <textarea
              value={instruction}
              disabled={!thread.daemonThreadId || pendingKey !== null}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="What should this participant contribute?"
            />
          </label>
          <button
            type="button"
            className="zorai-primary-button"
            disabled={!thread.daemonThreadId || !agentId || !instruction.trim() || pendingKey !== null}
            onClick={() => void runMutation("add", async () => {
              const result = await onUpsert({ targetAgentId: agentId, instruction: instruction.trim() });
              if (result.ok && mountedRef.current) setInstruction("");
              return result;
            })}
          >
            Add participant
          </button>
        </section>

        <section className="zorai-participants-drawer__section">
          <h3>Participants</h3>
          {participants.length === 0 ? <p>No participants configured.</p> : null}
          {participants.map((participant) => {
            const editing = editingId === participant.agentId;
            const key = `participant:${participant.agentId}`;
            return (
              <article key={participant.agentId} className="zorai-participant-card">
                <div>
                  <strong>{participant.agentName}</strong>
                  <span className="zorai-status-pill">{participant.status}</span>
                </div>
                {editing ? (
                  <textarea
                    value={editingInstruction}
                    disabled={pendingKey !== null}
                    onChange={(event) => setEditingInstruction(event.target.value)}
                    aria-label={`Instruction for ${participant.agentName}`}
                  />
                ) : <p>{participant.instruction || "No instruction recorded."}</p>}
                <div className="zorai-card-actions">
                  {editing ? (
                    <>
                      <button
                        type="button"
                        className="zorai-primary-button"
                        disabled={!editingInstruction.trim() || pendingKey !== null}
                        onClick={() => void runMutation(key, () => onUpsert({
                          targetAgentId: participant.agentId,
                          instruction: editingInstruction.trim(),
                        }))}
                      >
                        Save
                      </button>
                      <button type="button" className="zorai-ghost-button" disabled={pendingKey !== null} onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="zorai-ghost-button" disabled={pendingKey !== null} onClick={() => beginEdit(participant)}>
                        Edit
                      </button>
                      {participant.status === "active" ? (
                        <button
                          type="button"
                          className="zorai-ghost-button"
                          disabled={pendingKey !== null}
                          onClick={() => void runMutation(key, () => onDeactivate(participant.agentId))}
                        >
                          Deactivate
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="zorai-primary-button"
                          disabled={!participant.instruction.trim() || pendingKey !== null}
                          onClick={() => void runMutation(key, () => onUpsert({
                            targetAgentId: participant.agentId,
                            instruction: participant.instruction,
                          }))}
                        >
                          Activate
                        </button>
                      )}
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </section>

        <section className="zorai-participants-drawer__section">
          <h3>Queued suggestions</h3>
          {suggestions.length === 0 ? <p>No queued suggestions.</p> : null}
          {suggestions.map((suggestion) => {
            const key = `suggestion:${suggestion.id}`;
            const daemonThreadId = thread.daemonThreadId;
            return (
              <article key={suggestion.id} className="zorai-suggestion-card">
                <div>
                  <strong>{suggestion.targetAgentName}</strong>
                  <span className="zorai-status-pill">{suggestion.status}</span>
                </div>
                <p>{suggestion.instruction}</p>
                {suggestion.error ? <p className="zorai-inline-error">{suggestion.error}</p> : null}
                <div className="zorai-card-actions">
                  <button
                    type="button"
                    className="zorai-primary-button"
                    disabled={!daemonThreadId || pendingKey !== null}
                    onClick={() => daemonThreadId && void runMutation(key, () => onSendSuggestion(daemonThreadId, suggestion.id, false))}
                  >
                    Send
                  </button>
                  <button
                    type="button"
                    className="zorai-ghost-button"
                    disabled={!daemonThreadId || pendingKey !== null}
                    onClick={() => daemonThreadId && void runMutation(key, () => onSendSuggestion(daemonThreadId, suggestion.id, true))}
                  >
                    Force send
                  </button>
                  <button
                    type="button"
                    className="zorai-ghost-button"
                    disabled={!daemonThreadId || pendingKey !== null}
                    onClick={() => daemonThreadId && void runMutation(key, () => onDismissSuggestion(daemonThreadId, suggestion.id))}
                  >
                    Dismiss
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      </section>
    </div>
  );
}
