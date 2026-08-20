import { useEffect, useRef, type CSSProperties } from "react";
import { getBridge } from "@/lib/bridge";
import { useAgentStore } from "@/lib/agentStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { useAgentMissionStore } from "../lib/agentMissionStore";
import { resolveApprovalAtSource, shouldBypassApprovalPrompt, type ApprovalDecisionStatus } from "./approvalResolution";

type AgentApprovalOverlayProps = {
  style?: CSSProperties;
  className?: string;
};

type ApprovalDecision = ApprovalDecisionStatus;

export function AgentApprovalOverlay({ style, className }: AgentApprovalOverlayProps = {}) {
  const approval = useAgentMissionStore((s) =>
    s.approvals.find((entry) => entry.status === "pending" && entry.handledAt === null)
  );
  const terminalSecurityLevel = useSettingsStore((s) => s.settings.securityLevel);
  const managedSecurityLevel = useAgentStore((s) => s.agentSettings.managed_security_level);
  const resolveApproval = useAgentMissionStore((s) => s.resolveApproval);
  const markApprovalHandled = useAgentMissionStore((s) => s.markApprovalHandled);
  const bypassingApprovalIdsRef = useRef(new Set<string>());
  const bypassApproval = approval ? shouldBypassApprovalPrompt(
    approval,
    terminalSecurityLevel,
    managedSecurityLevel,
  ) : false;
  const visibleApproval = approval && !bypassApproval ? approval : null;

  useEffect(() => {
    if (!approval || !bypassApproval || bypassingApprovalIdsRef.current.has(approval.id)) return;
    bypassingApprovalIdsRef.current.add(approval.id);
    void resolveApprovalAtSource(getBridge(), approval, "approved-once")
      .then((resolved) => {
        if (!resolved) return;
        resolveApproval(approval.id, "approved-once");
        if (approval.source !== "local-terminal") {
          markApprovalHandled(approval.id);
        }
      })
      .finally(() => {
        bypassingApprovalIdsRef.current.delete(approval.id);
      });
  }, [approval, bypassApproval, markApprovalHandled, resolveApproval]);

  async function handleDecision(status: ApprovalDecision) {
    if (!visibleApproval) return;

    const resolved = await resolveApprovalAtSource(getBridge(), visibleApproval, status);
    if (!resolved) return;
    resolveApproval(visibleApproval.id, status);
    if (visibleApproval.source !== "local-terminal") {
      markApprovalHandled(visibleApproval.id);
    }
  }

  if (!visibleApproval) return null;

  const overlayClassName = ["zorai-approval-overlay", className ?? ""].filter(Boolean).join(" ");
  const riskClassName = ["zorai-approval-risk", `zorai-approval-risk--${visibleApproval.riskLevel}`].join(" ");

  return (
    <div style={style} className={overlayClassName} role="presentation">
      <section className="zorai-approval-dialog" role="dialog" aria-modal="true" aria-labelledby="zorai-approval-title">
        <header className="zorai-approval-header">
          <div>
            <div className="zorai-approval-kicker">
              <span />
              Approval Required
            </div>
            <h2 id="zorai-approval-title">High-impact command intercepted</h2>
          </div>
          <div className={riskClassName}>{visibleApproval.riskLevel}</div>
        </header>

        <div className="zorai-approval-body">
          <div className="zorai-approval-section">
            <div className="zorai-approval-label">Command</div>
            <pre className="zorai-approval-command">{visibleApproval.command}</pre>
          </div>

          <div className="zorai-approval-grid">
            <InfoCard label="Blast Radius" value={visibleApproval.blastRadius} />
            <InfoCard label="Scope" value={visibleApproval.sessionId ?? visibleApproval.paneId} />
          </div>

          <div className="zorai-approval-section">
            <div className="zorai-approval-label">Risk Factors</div>
            <div className="zorai-approval-chip-list">
              {visibleApproval.reasons.length === 0 ? <span>No specific factors reported.</span> : visibleApproval.reasons.map((reason) => (
                <span key={reason}>{reason}</span>
              ))}
            </div>
          </div>
        </div>

        <footer className="zorai-approval-actions">
          <button type="button" className="zorai-approval-button zorai-approval-button--deny" onClick={() => void handleDecision("denied")}>
            Deny
          </button>
          <button type="button" className="zorai-approval-button" onClick={() => void handleDecision("approved-once")}>
            Allow Once
          </button>
          <button type="button" className="zorai-approval-button zorai-approval-button--primary" onClick={() => void handleDecision("approved-session")}>
            Allow For Session
          </button>
        </footer>
      </section>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="zorai-approval-info">
      <div className="zorai-approval-label">{label}</div>
      <strong>{value}</strong>
    </div>
  );
}
