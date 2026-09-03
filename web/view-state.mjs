const MODES = new Set(["practice", "analysis"]);
const LEGALITY_STATES = new Set(["pending", "ready", "error"]);
const ENGINE_STATES = new Set([
  "unknown", "starting", "ready", "analyzing", "restarting", "stopping", "stopped", "error",
]);
const TRAINING_CONTRACT_STATES = new Set(["pending", "ready", "error"]);
const ANALYSIS_STATES = new Set([
  "requested",
  "streaming",
  "final",
  "canceled",
  "interrupted",
  "failed",
]);
const LIVE_ANALYSIS_STATES = new Set(["requested", "streaming"]);
const BUSY_PRACTICE_PHASES = new Set([
  "starting",
  "applying_user",
  "undoing",
  "analyzing_user",
  "analyzing_ai",
  "finalizing",
  "ai_wait",
  "finishing",
]);

export const VIEW_STATE_VERSION = 2;
export const PRIMARY_ACTION_IDS = Object.freeze([
  "practice-start",
  "analyze",
  "cancel",
  "board",
  "continue-practice",
  "new-opening",
  "reset",
  "review-start-practice",
  "retry-legality",
  "retry-training",
]);

function fail(message) {
  throw new Error(message);
}

function requireBoolean(value, field) {
  if (typeof value !== "boolean") fail(`${field}는 boolean이어야 합니다`);
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function playerName(player) {
  if (player === "B") return "흑";
  if (player === "W") return "백";
  return "사용자";
}

function normalizeInput(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    fail("view state 입력은 객체여야 합니다");
  }

  const mode = input.mode ?? "practice";
  if (!MODES.has(mode)) fail("mode는 practice 또는 analysis여야 합니다");

  const legalityState = input.legalityState ?? "pending";
  if (!LEGALITY_STATES.has(legalityState)) {
    fail("legalityState는 pending, ready 또는 error여야 합니다");
  }

  const engineState = input.engineState ?? "unknown";
  if (!ENGINE_STATES.has(engineState)) {
    fail("engineState가 잘못되었습니다");
  }

  const trainingContractState = input.trainingContractState ?? "pending";
  if (!TRAINING_CONTRACT_STATES.has(trainingContractState)) {
    fail("trainingContractState는 pending, ready 또는 error여야 합니다");
  }

  const rawPosition = input.positionState ?? null;
  if (rawPosition !== null
    && (typeof rawPosition !== "object" || Array.isArray(rawPosition))) {
    fail("positionState는 객체 또는 null이어야 합니다");
  }
  if (rawPosition !== null && typeof rawPosition.isTerminal !== "boolean") {
    fail("positionState.isTerminal은 boolean이어야 합니다");
  }

  const rawPractice = input.practice ?? {};
  if (rawPractice === null || typeof rawPractice !== "object" || Array.isArray(rawPractice)) {
    fail("practice는 객체여야 합니다");
  }
  const practice = {
    active: rawPractice.active ?? false,
    ended: rawPractice.ended ?? false,
    summaryPending: rawPractice.summaryPending ?? false,
    phase: rawPractice.phase ?? "setup",
    userColor: rawPractice.userColor ?? null,
    completionTerminal: rawPractice.completionTerminal ?? false,
  };
  for (const field of ["active", "ended", "summaryPending", "completionTerminal"]) {
    requireBoolean(practice[field], `practice.${field}`);
  }
  if (practice.active && practice.ended) fail("practice.active와 practice.ended는 동시에 true일 수 없습니다");
  if (typeof practice.phase !== "string" || practice.phase === "") {
    fail("practice.phase는 비어 있지 않은 문자열이어야 합니다");
  }
  if (practice.userColor !== null && !["B", "W"].includes(practice.userColor)) {
    fail("practice.userColor는 B, W 또는 null이어야 합니다");
  }

  const rawAnalysis = input.analysis ?? null;
  if (rawAnalysis !== null
    && (typeof rawAnalysis !== "object" || Array.isArray(rawAnalysis))) {
    fail("analysis는 객체 또는 null이어야 합니다");
  }
  const analysis = rawAnalysis === null ? null : {
    state: rawAnalysis.state,
    insufficient: rawAnalysis.insufficient ?? false,
  };
  if (analysis !== null) {
    if (!ANALYSIS_STATES.has(analysis.state)) fail("analysis.state가 잘못되었습니다");
    requireBoolean(analysis.insufficient, "analysis.insufficient");
  }

  return {
    mode,
    connected: requireBoolean(input.connected ?? false, "connected"),
    engineState,
    trainingContractState,
    legalityState,
    positionState: rawPosition,
    practice,
    analysis,
    reviewActive: requireBoolean(input.reviewActive ?? false, "reviewActive"),
    reviewCanStartPractice: requireBoolean(
      input.reviewCanStartPractice ?? true,
      "reviewCanStartPractice",
    ),
  };
}

function terminalPresentation(positionState) {
  if (!positionState?.isTerminal) {
    return {
      visible: false,
      outcome: null,
      title: "",
      message: "",
    };
  }

  let title = "대국 종료";
  let result = "공식 종국 결과입니다.";
  if (positionState.outcome === "black_win") {
    title = "흑 승";
    result = "흑이 오목을 완성했습니다.";
  } else if (positionState.outcome === "white_win") {
    title = "백 승";
    result = positionState.terminalReason === "black_forbidden"
      ? "흑의 금수 착수로 백이 승리했습니다."
      : "백이 오목을 완성했습니다.";
  } else if (positionState.outcome === "draw") {
    title = "무승부";
    result = "보드가 가득 찼습니다.";
  }

  const moveContext = Number.isInteger(positionState.moveCount)
    ? `${positionState.moveCount}수${positionState.terminalMove ? ` ${positionState.terminalMove}` : ""}에서 `
    : positionState.terminalMove ? `${positionState.terminalMove}에서 ` : "";
  return {
    visible: true,
    outcome: positionState.outcome ?? null,
    title,
    message: `${moveContext}${result} KataGomo의 공식 Renju 종국 판정이며 종국 위치는 MCTS 분석하지 않습니다.`,
  };
}

function isAnalysisLive(analysis) {
  return analysis !== null && LIVE_ANALYSIS_STATES.has(analysis.state);
}

function practiceIsBusy(practice) {
  return practice.summaryPending || BUSY_PRACTICE_PHASES.has(practice.phase);
}

function boardIsInteractive(state) {
  if (state.positionState?.isTerminal || state.reviewActive
    || state.legalityState !== "ready" || isAnalysisLive(state.analysis)
    || state.practice.summaryPending || state.practice.ended) return false;
  if (!state.practice.active) return true;
  return state.connected && state.engineState === "ready"
    && state.practice.phase === "user_turn";
}

function baseActions(state, boardInteractive) {
  const terminal = Boolean(state.positionState?.isTerminal);
  const live = isAnalysisLive(state.analysis);
  const busyPractice = state.practice.active && practiceIsBusy(state.practice);
  const completed = state.practice.ended && !state.practice.summaryPending;
  const canStartAnalysis = state.connected && state.engineState === "ready";
  const canUseTraining = canStartAnalysis && state.trainingContractState === "ready";

  return {
    "practice-start": {
      visible: state.mode === "practice" && !state.practice.active && !state.practice.ended
        && !state.reviewActive && !terminal,
      enabled: canUseTraining && state.legalityState === "ready" && !live && !busyPractice,
    },
    analyze: {
      visible: !state.reviewActive && !terminal && !state.practice.ended,
      enabled: canStartAnalysis && state.legalityState === "ready" && !live && !busyPractice,
    },
    cancel: {
      visible: live && !terminal && !state.reviewActive,
      enabled: live && !terminal && !state.reviewActive,
    },
    board: { visible: !terminal && !state.reviewActive, enabled: boardInteractive },
    "continue-practice": {
      visible: completed && !state.practice.completionTerminal && !state.reviewActive,
      enabled: canUseTraining && !terminal,
    },
    "new-opening": {
      visible: completed && !state.reviewActive,
      enabled: canUseTraining,
    },
    // A live official terminal result outranks review state, so reset remains
    // available even if an impossible/stale reviewActive flag is also present.
    reset: { visible: terminal || !state.reviewActive, enabled: true },
    "review-start-practice": {
      visible: state.reviewActive,
      enabled: state.reviewActive && state.reviewCanStartPractice && canUseTraining,
    },
    "retry-legality": {
      visible: state.legalityState === "error" && !state.reviewActive && !terminal,
      enabled: state.connected && state.legalityState === "error" && !live,
    },
    "retry-training": {
      visible: state.mode === "practice" && state.trainingContractState === "error"
        && !state.practice.active && !state.reviewActive && !terminal,
      enabled: state.connected && state.trainingContractState === "error" && !live,
    },
  };
}

function selectState(state, terminal, boardInteractive, actions) {
  const actionEnabled = (id) => Boolean(actions[id]?.visible && actions[id]?.enabled);
  const result = (key, tone, title, message, preferredAction = null) => ({
    key,
    task: { tone, title, message },
    primaryAction: preferredAction && actionEnabled(preferredAction) ? preferredAction : null,
  });

  // Official BoardHistory is authoritative and dominates review, network,
  // practice, and search state. No MCTS value may survive this branch.
  if (terminal.visible) {
    return result(
      "terminal",
      "neutral",
      terminal.title,
      "종국 결과를 확인한 뒤 무르거나 새 판을 시작하세요.",
      "reset",
    );
  }
  if (state.reviewActive) {
    return result(
      "review",
      "neutral",
      "저장된 연습을 복기하고 있습니다.",
      "수순을 이동해 당시 지표와 PV를 확인하세요. 실전 보드는 바뀌지 않습니다.",
      "review-start-practice",
    );
  }
  if (!state.connected) {
    return result(
      "disconnected",
      "error",
      "분석 서버 연결이 끊겼습니다.",
      boardInteractive
        ? "보드 편집은 가능하지만 KataGomo 분석과 AI 연습은 연결이 복구될 때까지 사용할 수 없습니다."
        : "연결이 자동으로 복구될 때까지 착수와 분석을 기다려 주세요.",
    );
  }
  if (state.legalityState === "error") {
    return result(
      "legality-error",
      "error",
      "공식 금수 판정을 불러오지 못했습니다.",
      "안전을 위해 착수를 차단했습니다. 공식 금수 판정을 다시 시도하세요.",
      "retry-legality",
    );
  }
  if (state.legalityState === "pending") {
    return result(
      "legality-pending",
      "busy",
      "공식 금수 정보를 확인하고 있습니다.",
      "KataGomo의 금수 판정 결과가 도착하면 착수할 수 있습니다.",
    );
  }
  if (state.practice.summaryPending) {
    return result(
      "practice-summarizing",
      "busy",
      "연습 결과를 정리하고 있습니다.",
      "수별 평가와 가장 큰 실수를 계산하는 중입니다.",
    );
  }
  if (state.practice.ended) {
    const primary = state.practice.completionTerminal ? "new-opening" : "continue-practice";
    return result(
      "practice-completed",
      "neutral",
      "연습이 완료되었습니다.",
      state.practice.completionTerminal
        ? "종국 결과를 복기하거나 새 판에서 다시 연습하세요."
        : "결과를 복기하거나 현재 판을 이어서 연습할 수 있습니다.",
      primary,
    );
  }
  if (isAnalysisLive(state.analysis)) {
    return result(
      "analyzing",
      "busy",
      state.practice.active ? "KataGomo가 다음 단계를 분석하고 있습니다." : "KataGomo가 현재 위치를 분석하고 있습니다.",
      "검색 중간 결과가 들어올 때마다 Raw policy, Visits, Winrate와 PV를 갱신합니다.",
      "cancel",
    );
  }
  if (["unknown", "starting", "restarting", "stopping", "analyzing"].includes(state.engineState)) {
    return result(
      "engine-pending",
      "busy",
      "KataGomo 엔진을 준비하고 있습니다.",
      state.practice.active
        ? "엔진이 준비될 때까지 연습 착수를 기다려 주세요."
        : "보드는 편집할 수 있으며, 엔진이 준비되면 분석을 시작할 수 있습니다.",
    );
  }
  if (["stopped", "error"].includes(state.engineState)) {
    return result(
      "engine-unavailable",
      "error",
      "KataGomo 엔진을 사용할 수 없습니다.",
      "엔진 진단에서 오류와 자동 재시작 상태를 확인하세요. 보드 편집 내용은 유지됩니다.",
    );
  }
  if (state.practice.active) {
    if (state.practice.phase === "user_turn") {
      const color = playerName(state.practice.userColor);
      return result(
        "practice-user-turn",
        "neutral",
        `보드에 ${color} 수를 두세요.`,
        "공식 합법 수 안에서 후보 지표와 PV를 참고해 착수하세요.",
        "board",
      );
    }
    if (state.practice.phase === "error") {
      return result(
        "practice-error",
        "error",
        "연습 분석이 중단되었습니다.",
        "현재 위치 분석을 다시 실행해 같은 연습을 계속할 수 있습니다.",
        "analyze",
      );
    }
    return result(
      "practice-transition",
      "busy",
      state.practice.phase === "ai_wait" ? "AI 착수를 준비하고 있습니다." : "연습 상태를 갱신하고 있습니다.",
      "최종 분석과 공식 합법성 확인이 끝날 때까지 기다려 주세요.",
    );
  }
  if (["failed", "interrupted"].includes(state.analysis?.state)) {
    return result(
      "analysis-error",
      "error",
      "분석 결과를 완료하지 못했습니다.",
      "현재 위치 분석을 다시 실행하세요. 중단된 결과를 승패로 해석하지 않습니다.",
      "analyze",
    );
  }
  if (state.analysis?.state === "canceled") {
    return result(
      "analysis-canceled",
      "neutral",
      "분석을 취소했습니다.",
      "보드를 계속 편집하거나 현재 위치를 다시 분석할 수 있습니다.",
      "analyze",
    );
  }
  if (state.analysis?.state === "final") {
    const insufficient = state.analysis.insufficient;
    const preferred = state.mode === "practice" ? "practice-start" : "analyze";
    return result(
      insufficient ? "analysis-insufficient" : "analysis-final",
      insufficient ? "insufficient" : "neutral",
      insufficient ? "최종 응답을 받았지만 분석량이 부족합니다." : "현재 위치의 최종 분석입니다.",
      insufficient
        ? "Raw policy와 검색 결과는 참고용으로 보고, 확정적인 평가로 해석하지 마세요."
        : state.mode === "practice"
          ? "이 위치를 시작점으로 AI와 연습할 수 있습니다."
          : "흑·백을 직접 착수하거나 같은 위치를 다시 분석할 수 있습니다.",
      preferred,
    );
  }
  if (state.mode === "analysis") {
    return result(
      "free-analysis",
      "neutral",
      "흑·백을 직접 두거나 현재 위치를 분석하세요.",
      "AI 자동 착수 없이 양쪽 수를 자유롭게 시험할 수 있습니다.",
      "analyze",
    );
  }
  if (state.trainingContractState === "error") {
    return result(
      "practice-contract-error",
      "error",
      "연습 설정을 불러오지 못했습니다.",
      "현재 위치 분석은 가능하며, AI 연습 설정만 다시 확인할 수 있습니다.",
      "retry-training",
    );
  }
  if (state.trainingContractState === "pending") {
    return result(
      "practice-contract-pending",
      "busy",
      "연습 설정 계약을 확인하고 있습니다.",
      "현재 위치 분석은 가능하며, 확인이 끝나면 AI 연습을 시작할 수 있습니다.",
      "analyze",
    );
  }
  return result(
    "practice-setup",
    "neutral",
    "AI 자동 응수는 아직 꺼져 있습니다.",
    "빈 보드에서 시작하거나 직접 수를 둔 뒤 ‘AI 연습 시작’을 누르세요.",
    "practice-start",
  );
}

function attachPrimary(actions, primaryAction) {
  return Object.fromEntries(Object.entries(actions).map(([id, action]) => [id, {
    ...action,
    primary: id === primaryAction && action.visible && action.enabled,
  }]));
}

/**
 * Derive the complete user-facing desktop state from JSON-compatible app state.
 * This module intentionally has no DOM dependency so precedence and CTA
 * invariants can be tested independently from rendering.
 */
export function deriveViewState(input = {}) {
  const state = normalizeInput(input);
  const terminal = terminalPresentation(state.positionState);
  const boardInteractive = boardIsInteractive(state);
  const base = baseActions(state, boardInteractive);
  const selected = selectState(state, terminal, boardInteractive, base);
  const actions = attachPrimary(base, selected.primaryAction);

  return deepFreeze({
    schemaVersion: VIEW_STATE_VERSION,
    key: selected.key,
    task: selected.task,
    terminal,
    primaryAction: selected.primaryAction,
    actions,
    boardInteractive,
    clearAnalysis: terminal.visible,
  });
}
