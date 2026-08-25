import { CodeIcon } from "./CodeIcon";
import { codeCommandById, displayCodeBinding, type CodeCommandId, type CodeIconId } from "./codeCommands";
import { useCodeEditorSettingsStore } from "./codeEditorSettingsStore";

export function CodeIconButton({ commandId, icon, label, disabled = false, disabledReason, danger = false, onClick }: {
  commandId?: CodeCommandId;
  icon?: CodeIconId;
  label?: string;
  disabled?: boolean;
  disabledReason?: string;
  danger?: boolean;
  onClick: () => void;
}) {
  const command = commandId ? codeCommandById(commandId) : undefined;
  const bindingOverride = commandId ? useCodeEditorSettingsStore.getState().settings.keybindings[commandId] : undefined;
  const title = label ?? command?.title ?? commandId ?? "Code action";
  const currentBinding = bindingOverride === undefined ? command?.defaultKeybinding : bindingOverride;
  const binding = currentBinding ? displayCodeBinding(currentBinding) : null;
  const tooltip = disabled && disabledReason ? `${title} — ${disabledReason}` : binding ? `${title} (${binding})` : title;
  const resolvedIcon = icon ?? command?.icon ?? "file";
  return <button type="button" className={["zorai-code-icon-button", danger ? "is-danger" : ""].filter(Boolean).join(" ")} aria-label={title} title={tooltip} disabled={disabled} onClick={onClick}><CodeIcon icon={resolvedIcon} /></button>;
}
