export const FIXED_END_PLIES = Object.freeze([6, 8, 10, 12, 14, 16]);
export const MANUAL_END_VALUE = "manual";

export function parseEndCondition(value) {
  if (value === MANUAL_END_VALUE) return { kind: "manual" };
  const ply = Number(value);
  if (!Number.isInteger(ply) || !FIXED_END_PLIES.includes(ply) || String(value) !== String(ply)) {
    throw new Error(`지원하지 않는 종료 조건: ${value}`);
  }
  return { kind: "ply", ply };
}

export function shouldAutoFinish(endCondition, currentPly) {
  if (!Number.isInteger(currentPly) || currentPly < 0) {
    throw new Error(`현재 수순은 0 이상의 정수여야 합니다: ${currentPly}`);
  }
  if (endCondition?.kind === "manual") return false;
  if (endCondition?.kind !== "ply" || !FIXED_END_PLIES.includes(endCondition.ply)) {
    throw new Error("잘못된 연습 종료 조건입니다");
  }
  return currentPly >= endCondition.ply;
}

export function automaticCompletionReason(endCondition, currentPly, isTerminal) {
  if (typeof isTerminal !== "boolean") {
    throw new Error("종국 여부는 boolean이어야 합니다");
  }
  if (!Number.isInteger(currentPly) || currentPly < 0) {
    throw new Error(`현재 수순은 0 이상의 정수여야 합니다: ${currentPly}`);
  }
  if (isTerminal) return "game-terminal";
  return shouldAutoFinish(endCondition, currentPly) ? "ply-limit" : null;
}

export function endConditionLabel(endCondition) {
  if (endCondition?.kind === "manual") return "직접 종료할 때까지";
  if (endCondition?.kind === "ply" && FIXED_END_PLIES.includes(endCondition.ply)) {
    return `${endCondition.ply}수까지`;
  }
  throw new Error("잘못된 연습 종료 조건입니다");
}
