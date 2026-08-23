export type ComposerTarget =
  | { kind: "current"; id: "current"; label: string }
  | { kind: "agent"; id: string; label: string }
  | { kind: "subagent"; id: string; label: string };

export function composerTargetValue(target: ComposerTarget): string {
  return `${target.kind}:${target.id}`;
}

export function parseComposerTarget(
  value: string,
  options: ComposerTarget[],
): ComposerTarget {
  return options.find((target) => composerTargetValue(target) === value) ?? options[0];
}

export function targetAfterAcceptedDispatch(target: ComposerTarget): ComposerTarget {
  return target.kind === "subagent"
    ? { kind: "current", id: "current", label: "Current responder" }
    : target;
}

export function shouldPreserveTargetAfterFailure(target: ComposerTarget): boolean {
  return target.kind === "subagent";
}
