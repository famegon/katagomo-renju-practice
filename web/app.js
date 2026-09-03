import {
  MANUAL_END_VALUE,
  automaticCompletionReason,
  endConditionLabel,
  parseEndCondition,
} from "./training-rules.mjs";
import {
  appendGameMove,
  appendPracticeTurnRecord,
  applyAnalysisResponse,
  beginAnalysisJob,
  beginPracticeCompletion,
  cancelAnalysisJob,
  commitOfficialPositionState,
  createGameDocument,
  createPracticeAttempt,
  finishPracticeCompletion,
  gamePositionKey,
  replaceGameMoves,
  transitionAnalysisJob,
  trimPracticeTurnRecords,
  truncateGameDocument,
  withoutOfficialPositionState,
} from "./session-state.mjs";
import {
  HISTORY_STORAGE_KEY,
  LEGACY_HISTORY_STORAGE_KEY,
  clearHistory,
  deleteHistory,
  deserializeHistory,
  migrateHistory,
  resolveHistorySources,
  selectHistoryReview,
  serializeHistory,
  upsertHistory,
} from "./history-store.mjs";
import {
  createHistoryReview,
  isReviewTerminalPosition,
  moveHistoryReview,
  reviewMistakePlys,
  reviewMoves,
  reviewTurn,
} from "./history-review.mjs";
import { deriveViewState } from "./view-state.mjs";
import { decideWebSocketMessage } from "./ws-message-state.mjs";
import { decidePracticeReconnect } from "./socket-recovery.mjs";
import {
  candidateHitAtPoint,
  resetNeedsConfirmation,
  resolveBoardPointerIntent,
} from "./board-interaction.mjs";
import {
  clientPointToCanvas,
  configureHiDpiSquareCanvas,
} from "./canvas-geometry.mjs";
import {
  applyComparisonResponse,
  beginComparisonRequest,
  cancelComparisonLab,
  comparisonStageDescriptor,
  createComparisonLab,
  deriveComparisonResult,
  invalidateComparisonLab,
} from "./comparison-lab.mjs";
import {
  ANALYSIS_VIEW_ORDER,
  WORKBENCH_TAB_ORDER,
  adjacentTab,
  createWorkbenchState,
  selectAnalysisView,
  selectWorkbenchTab,
  showsMctsBoardOverlay,
} from "./workbench-state.mjs";
import {
  parseRenjuKifuJson,
  validateKifuFileMetadata,
} from "./kifu-json.mjs";

const BOARD_SIZE = 15;
const POLICY_LENGTH = 226;
const COLUMNS = "ABCDEFGHJKLMNOP";
const MIN_GRADE_VISITS = 50;
const BOARD_CANVAS_SIZE = 760;
const REVIEW_CANVAS_SIZE = 540;
const canvas = document.querySelector("#board");
const reviewCanvas = document.querySelector("#review-board");
const { context } = configureHiDpiSquareCanvas(
  canvas,
  BOARD_CANVAS_SIZE,
  window.devicePixelRatio,
);
const { context: reviewContext } = configureHiDpiSquareCanvas(
  reviewCanvas,
  REVIEW_CANVAS_SIZE,
  window.devicePixelRatio,
);
const margin = 48;
const spacing = (BOARD_CANVAS_SIZE - margin * 2) / (BOARD_SIZE - 1);

const byId = (id) => document.querySelector(`#${id}`);
const elements = {
  engineStatus: byId("engine-status"), analysisStatus: byId("analysis-status"),
  practicePhase: byId("practice-phase"), legalityStatus: byId("legality-status"),
  actionNotice: byId("action-notice"), nextPlayer: byId("next-player"),
  plyCount: byId("ply-count"), turnOwner: byId("turn-owner"), boardHelp: byId("board-help"),
  sessionComplete: byId("session-complete"), boardSummary: byId("board-summary"),
  mode: byId("mode"), userColor: byId("user-color"), stopPly: byId("stop-ply"),
  gradingMode: byId("grading-mode"), maxVisits: byId("max-visits"),
  userColorSetting: byId("user-color-setting"), stopPlySetting: byId("stop-ply-setting"),
  gradingModeSetting: byId("grading-mode-setting"), modeHelp: byId("mode-help"),
  sizeMetric: byId("size-metric"), topCount: byId("top-count"),
  practiceStart: byId("practice-start"), practiceFinish: byId("practice-finish"),
  analyze: byId("analyze"), cancel: byId("cancel"),
  retryLegality: byId("retry-legality"), retryTraining: byId("retry-training"),
  kifuImport: byId("kifu-import"), kifuFile: byId("kifu-file"),
  undo: byId("undo"), reset: byId("reset"), clearPv: byId("clear-pv"),
  candidates: byId("candidates"), rawPolicy: byId("raw-policy"),
  candidateFocus: byId("candidate-focus"), candidateFocusCard: byId("candidate-focus-card"),
  instantCard: byId("instant-feedback-card"), instantState: byId("instant-grade-state"),
  instantFeedback: byId("instant-feedback"), resultsCard: byId("results-card"),
  resultSummary: byId("result-summary"), summaryBody: byId("summary-body"),
  mistakes: byId("mistakes"), continuePractice: byId("continue-practice"),
  sameStart: byId("same-start"), newOpening: byId("new-opening"),
  requestId: byId("request-id"), policyLength: byId("policy-length"),
  visitTotal: byId("visit-total"), rootVisits: byId("root-visits"),
  blackWinrate: byId("black-winrate"), currentWinrate: byId("current-winrate"),
  userWinrate: byId("user-winrate"), userWinrateRow: byId("user-winrate-row"),
  responseKind: byId("response-kind"),
  glossary: byId("analysis-glossary"), glossaryLink: byId("glossary-link"),
  terminalBanner: byId("terminal-banner"), terminalTitle: byId("terminal-title"),
  terminalMessage: byId("terminal-message"), taskBanner: byId("task-banner"),
  taskTitle: byId("task-title"), taskMessage: byId("task-message"),
  engineDiagnosticState: byId("engine-diagnostic-state"), enginePid: byId("engine-pid"),
  engineRestarts: byId("engine-restarts"), engineLastError: byId("engine-last-error"),
  historyCount: byId("history-count"), historyList: byId("history-list"),
  historyClear: byId("history-clear"), historyDiagnostics: byId("history-diagnostics"),
  reviewPanel: byId("review-panel"), reviewPosition: byId("review-position"),
  reviewSummary: byId("review-summary"), reviewDetail: byId("review-detail"),
  reviewFirst: byId("review-first"), reviewPrev: byId("review-prev"),
  reviewNext: byId("review-next"), reviewLast: byId("review-last"),
  reviewStartPractice: byId("review-start-practice"), reviewClose: byId("review-close"),
  comparisonCard: byId("comparison-card"), comparisonStatus: byId("comparison-status"),
  comparisonSlotA: byId("comparison-slot-a"), comparisonSlotB: byId("comparison-slot-b"),
  comparisonMoveA: byId("comparison-move-a"), comparisonMoveB: byId("comparison-move-b"),
  comparisonProgress: byId("comparison-progress"), comparisonSelect: byId("comparison-select"),
  comparisonRun: byId("comparison-run"), comparisonCancel: byId("comparison-cancel"),
  comparisonClear: byId("comparison-clear"), comparisonResults: byId("comparison-results"),
  comparisonConclusion: byId("comparison-conclusion"), comparisonBody: byId("comparison-body"),
  comparisonHeadingA: byId("comparison-heading-a"), comparisonHeadingB: byId("comparison-heading-b"),
  comparisonPreviewA: byId("comparison-preview-a"), comparisonPreviewB: byId("comparison-preview-b"),
  comparisonPreviewClear: byId("comparison-preview-clear"),
  comparisonGlance: byId("comparison-glance"), practiceOptions: byId("practice-options"),
  workbench: byId("workbench"), workbenchTabAnalysis: byId("workbench-tab-analysis"),
  workbenchTabComparison: byId("workbench-tab-comparison"), workbenchTabHistory: byId("workbench-tab-history"),
  workbenchPanelAnalysis: byId("workbench-panel-analysis"), workbenchPanelHistory: byId("workbench-panel-history"),
  analysisViewTabMcts: byId("analysis-view-tab-mcts"), analysisViewTabPolicy: byId("analysis-view-tab-policy"),
  analysisViewMcts: byId("analysis-view-mcts"), analysisViewPolicy: byId("analysis-view-policy"),
  historyIndex: byId("history-index"),
};

let gameDocument = createGameDocument();
let forbiddenMoves = new Set();
let legalMoves = [];
let legalityState = "pending";
let legalityGeneration = 0;
let minimumGradeVisits = MIN_GRADE_VISITS;
let engineState = "unknown";
let trainingContractState = "pending";
let allCandidates = [];
let fullPolicy = [];
let currentAnalysis = null;
let candidateHitAreas = [];
let hoveredCandidateMove = null;
let pinnedCandidateMove = null;
let boardCursor = { x: 7, y: 7 };
let socket;
let reconnectTimer;
let practiceRecoveryTimer;
let practiceRecoveryPending = false;
let analysisJob = null;
let analysisContext = null;
let aiTimer = null;
let historyDiagnostics = [];
let history = loadHistory();
let reviewSession = null;
let comparisonLab = null;
let comparisonGeneration = 0;
let comparisonUi = emptyComparisonUi();
let workbenchUi = createWorkbenchState();
let kifuImportGeneration = 0;
let kifuImporting = false;
const suppressedComparisonCancelIds = new Set();

function emptyComparisonUi() {
  return {
    mode: "idle",
    activeSlot: "a",
    moveA: null,
    moveB: null,
    previewSlot: null,
    anchor: null,
    error: null,
  };
}

const WORKBENCH_BUTTONS = Object.freeze({
  analysis: elements.workbenchTabAnalysis,
  comparison: elements.workbenchTabComparison,
  history: elements.workbenchTabHistory,
});
const WORKBENCH_PANELS = Object.freeze({
  analysis: elements.workbenchPanelAnalysis,
  comparison: elements.comparisonCard,
  history: elements.workbenchPanelHistory,
});
const ANALYSIS_VIEW_BUTTONS = Object.freeze({
  mcts: elements.analysisViewTabMcts,
  policy: elements.analysisViewTabPolicy,
});
const ANALYSIS_VIEW_PANELS = Object.freeze({
  mcts: elements.analysisViewMcts,
  policy: elements.analysisViewPolicy,
});

function renderWorkbenchNavigation() {
  elements.workbench.dataset.activeTab = workbenchUi.tab;
  for (const [tabName, button] of Object.entries(WORKBENCH_BUTTONS)) {
    const selected = tabName === workbenchUi.tab;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    WORKBENCH_PANELS[tabName].hidden = !selected;
  }
  for (const [viewName, button] of Object.entries(ANALYSIS_VIEW_BUTTONS)) {
    const selected = viewName === workbenchUi.analysisView;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    ANALYSIS_VIEW_PANELS[viewName].hidden = !selected;
  }
}

function switchWorkbenchTab(tab, { focus = false } = {}) {
  const decision = selectWorkbenchTab(workbenchUi, tab, { comparisonMode: comparisonUi.mode });
  if (decision.effect === "block-running-comparison") {
    notice("진행 중인 수 비교를 취소하거나 완료한 뒤 다른 탭으로 이동하세요.", true);
    return false;
  }
  workbenchUi = decision.state;
  if (decision.effect === "clear-comparison") {
    clearComparison({ reason: "comparison-tab-left" });
    notice("수 비교를 닫았습니다. 보드에서 계속 착수하거나 현재 위치를 분석할 수 있습니다.");
  }
  renderWorkbenchNavigation();
  drawBoard();
  if (focus) WORKBENCH_BUTTONS[workbenchUi.tab].focus();
  return true;
}

function switchAnalysisView(view, { focus = false } = {}) {
  workbenchUi = selectAnalysisView(workbenchUi, view);
  renderWorkbenchNavigation();
  drawBoard();
  if (focus) ANALYSIS_VIEW_BUTTONS[workbenchUi.analysisView].focus();
}

function emptyPractice(token = 0) {
  return {
    active: false, ended: false, token, phase: "setup", attempt: null,
    preparedAnalysis: null, preparedLegalMoves: [], pendingRecord: null,
    saved: false, summaryPending: false,
  };
}
let practice = emptyPractice();

function nextPlayer() { return gameDocument.moves.length % 2 === 0 ? "B" : "W"; }
function isFreeAnalysisMode() { return elements.mode.value === "analysis" && !practice.active; }
function playerName(player) { return player === "B" ? "흑" : "백"; }
function otherPlayer(player) { return player === "B" ? "W" : "B"; }
function terminalResultLabel(state = gameDocument.positionState) {
  if (!state?.isTerminal) return null;
  if (state.outcome === "draw") return "무승부 · 보드가 가득 찼습니다";
  const winner = playerName(state.winner);
  if (state.terminalReason === "black_forbidden") return `${winner} 승 · 흑 금수 착수`;
  return `${winner} 승 · 오목 완성`;
}
function positionKey(value = gameDocument.moves) {
  return value === gameDocument.moves ? gamePositionKey(gameDocument) : JSON.stringify(value);
}
function cloneMoves(value = gameDocument.moves) { return value.map(([player, move]) => [player, move]); }
function analysisIsLive() { return ["requested", "streaming"].includes(analysisJob?.state); }
function comparisonIsSelecting() { return comparisonUi.mode === "selecting"; }
function comparisonWorkflowActive() {
  return comparisonLab !== null && ["ready", "running"].includes(comparisonLab.status);
}
function comparisonIsOpen() { return comparisonUi.mode !== "idle"; }
function comparisonAnchorIsCurrent() {
  return Boolean(comparisonUi.anchor)
    && comparisonUi.anchor.revision === gameDocument.revision
    && comparisonUi.anchor.positionKey === positionKey();
}
function comparisonCanOpen() {
  return !practice.active && !practice.ended && !practice.summaryPending && !reviewSession
    && !gameDocument.positionState?.isTerminal && legalityState === "ready";
}
function selectedEndCondition() { return parseEndCondition(elements.stopPly.value); }
function hasReachedPracticeLimit() {
  return Boolean(practice.attempt?.settings)
    && automaticCompletionReason(
      practice.attempt.settings.endCondition,
      gameDocument.moves.length,
      Boolean(gameDocument.positionState?.isTerminal),
    ) === "ply-limit";
}
function xyToMove(x, y) { return `${COLUMNS[x]}${BOARD_SIZE - y}`; }
function moveToXY(move) { return [COLUMNS.indexOf(move[0]), BOARD_SIZE - Number(move.slice(1))]; }
function isBoardMove(move) {
  if (typeof move !== "string") return false;
  const [x, y] = moveToXY(move.toUpperCase());
  return x >= 0 && x < BOARD_SIZE && Number.isInteger(y) && y >= 0 && y < BOARD_SIZE;
}
function percent(value) {
  return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : "—";
}
function policyPercent(value) {
  if (!Number.isFinite(Number(value))) return "—";
  const measured = Number(value) * 100;
  const digits = measured >= .1 ? 1 : measured >= .01 ? 2 : 3;
  return `${measured.toFixed(digits)}%`;
}
function percentagePoints(value) {
  if (!Number.isFinite(Number(value))) return "—";
  const measured = Number(value) * 100;
  const points = Math.abs(measured) < .05 ? 0 : measured;
  return `${points > 0 ? "+" : ""}${points.toFixed(1)}%p`;
}
function preferredScrollBehavior() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}
function candidateOrder(candidate, fallback = null) {
  const rawOrder = candidate?.order;
  if (rawOrder === null || rawOrder === undefined || rawOrder === "") return fallback;
  const order = Number(rawOrder);
  return Number.isInteger(order) && order >= 0 ? order : fallback;
}
function compactNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function compactAnalysisSnapshot(analysis) {
  if (!analysis || typeof analysis !== "object") return null;
  const candidates = Array.isArray(analysis.candidates) ? [...analysis.candidates] : [];
  candidates.sort((left, right) => {
    const leftOrder = candidateOrder(left);
    const rightOrder = candidateOrder(right);
    if (leftOrder !== null && rightOrder !== null) return leftOrder - rightOrder;
    if (leftOrder !== null) return -1;
    if (rightOrder !== null) return 1;
    return Number(right.visits || 0) - Number(left.visits || 0);
  });
  const root = analysis.rootInfo || {};
  return {
    isFinal: analysis.isFinal === true,
    currentPlayer: ["B", "W"].includes(analysis.currentPlayer) ? analysis.currentPlayer : null,
    requestedMaxVisits: Number.isInteger(Number(analysis.requestedMaxVisits))
      ? Number(analysis.requestedMaxVisits) : null,
    candidateVisitTotal: Number.isInteger(Number(analysis.candidateVisitTotal))
      ? Number(analysis.candidateVisitTotal) : null,
    rootInfo: {
      visits: Number.isInteger(Number(root.visits)) ? Number(root.visits) : null,
      blackWinrate: compactNumber(root.blackWinrate),
      currentPlayerWinrate: compactNumber(root.currentPlayerWinrate),
      userWinrate: compactNumber(root.userWinrate),
    },
    candidates: candidates.slice(0, 10).filter((candidate) => isBoardMove(candidate.move)).map((candidate) => ({
      move: candidate.move.toUpperCase(),
      order: candidateOrder(candidate),
      rawPrior: compactNumber(candidate.rawPrior),
      visits: Number.isInteger(Number(candidate.visits)) && Number(candidate.visits) >= 0
        ? Number(candidate.visits) : 0,
      visitShare: compactNumber(candidate.visitShare),
      blackWinrate: compactNumber(candidate.blackWinrate),
      currentPlayerWinrate: compactNumber(candidate.currentPlayerWinrate),
      userWinrate: compactNumber(candidate.userWinrate),
      pv: Array.isArray(candidate.pv) ? candidate.pv.filter(isBoardMove).map((move) => move.toUpperCase()) : [],
    })),
  };
}
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}
function occupied(move) { return gameDocument.moves.some(([, placed]) => placed === move); }
function candidateRanked() {
  const candidates = [...allCandidates];
  return candidates.sort((left, right) => {
    const leftOrder = candidateOrder(left);
    const rightOrder = candidateOrder(right);
    if (leftOrder !== null && rightOrder !== null) return leftOrder - rightOrder;
    if (leftOrder !== null) return -1;
    if (rightOrder !== null) return 1;
    return Number(right.visits || 0) - Number(left.visits || 0);
  });
}
function visibleCandidates() { return candidateRanked().slice(0, Number(elements.topCount.value)); }
function focusedCandidate() {
  const move = pinnedCandidateMove || hoveredCandidateMove;
  return move ? allCandidates.find((candidate) => candidate.move === move) : null;
}
function practiceIdentityMatches(token, epoch, revision = gameDocument.revision) {
  return practice.active && practice.token === token
    && practice.attempt?.sessionEpoch === epoch && gameDocument.revision === revision;
}
function practiceTransitionBusy() {
  return practice.summaryPending || [
    "starting", "applying_user", "undoing", "analyzing_user", "analyzing_ai",
    "finalizing", "ai_wait", "finishing",
  ].includes(practice.phase);
}

function currentViewInput() {
  const jobMatchesPosition = analysisJob
    && Number(analysisJob.positionRevision) === gameDocument.revision
    && (analysisJob.sessionEpoch ?? null)
      === (practice.active ? practice.attempt?.sessionEpoch ?? null : null);
  return {
    mode: elements.mode.value,
    connected: socket?.readyState === WebSocket.OPEN,
    engineState,
    trainingContractState,
    legalityState,
    positionState: gameDocument.positionState,
    practice: {
      active: practice.active,
      ended: practice.ended,
      summaryPending: practice.summaryPending,
      phase: practice.phase,
      userColor: practice.attempt?.settings?.userColor ?? elements.userColor.value,
      completionTerminal: Boolean(practice.attempt?.completion?.terminalState?.isTerminal),
    },
    analysis: jobMatchesPosition ? {
      state: analysisJob.state,
      insufficient: Boolean(currentAnalysis?.analysisInsufficient),
    } : null,
    reviewActive: Boolean(reviewSession),
    reviewCanStartPractice: Boolean(reviewSession) && !isReviewTerminalPosition(reviewSession),
  };
}

function currentViewState() {
  return deriveViewState(currentViewInput());
}

function setAnalysisStatus(text, className = "") {
  elements.analysisStatus.textContent = text;
  elements.analysisStatus.className = `status ${className}`.trim();
}
function setPracticePhase(phase, text, className = "neutral") {
  practice.phase = phase;
  elements.practicePhase.textContent = text;
  elements.practicePhase.className = `status ${className}`.trim();
  updateControls();
}
function updateModeUi() {
  const freeAnalysis = isFreeAnalysisMode();
  for (const element of [elements.userColorSetting, elements.stopPlySetting, elements.gradingModeSetting]) {
    element.hidden = freeAnalysis;
  }
  elements.practiceOptions.hidden = freeAnalysis;
  if (freeAnalysis) elements.practiceOptions.open = false;
  elements.userWinrateRow.hidden = freeAnalysis;
  elements.modeHelp.textContent = freeAnalysis
    ? "사용자 색과 AI 자동 착수 없이 흑·백을 번갈아 직접 둡니다. 각 위치에서 ‘현재 위치 분석’을 누르세요."
    : "아래 ‘AI 연습 시작’을 누르면 반대 색을 KataGomo가 자동 착수합니다.";
}
function notice(text, isError = false) {
  elements.actionNotice.textContent = text;
  elements.actionNotice.className = `notice action-notice${isError ? " error" : ""}`;
}

function drawBoard() {
  context.clearRect(0, 0, BOARD_CANVAS_SIZE, BOARD_CANVAS_SIZE);
  context.fillStyle = "#d8a85c";
  context.fillRect(0, 0, BOARD_CANVAS_SIZE, BOARD_CANVAS_SIZE);
  context.strokeStyle = "#493519";
  context.lineWidth = 1.35;
  for (let index = 0; index < BOARD_SIZE; index += 1) {
    const position = margin + index * spacing;
    context.beginPath(); context.moveTo(margin, position); context.lineTo(BOARD_CANVAS_SIZE - margin, position); context.stroke();
    context.beginPath(); context.moveTo(position, margin); context.lineTo(position, BOARD_CANVAS_SIZE - margin); context.stroke();
  }
  context.fillStyle = "#493519";
  for (const [x, y] of [[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]]) {
    context.beginPath(); context.arc(margin + x * spacing, margin + y * spacing, 4.5, 0, Math.PI * 2); context.fill();
  }
  context.font = "13px -apple-system, sans-serif";
  context.fillStyle = "#493519";
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (let index = 0; index < BOARD_SIZE; index += 1) {
    const position = margin + index * spacing;
    context.fillText(COLUMNS[index], position, 21);
    context.fillText(String(BOARD_SIZE - index), 22, position);
  }

  if (comparisonIsOpen()) {
    candidateHitAreas = [];
    drawComparisonOverlay();
  } else if (showsMctsBoardOverlay(workbenchUi)) {
    drawPv();
    drawCandidateOverlays();
  } else {
    candidateHitAreas = [];
  }

  gameDocument.moves.forEach(([player, move], index) => {
    const [x, y] = moveToXY(move);
    const px = margin + x * spacing;
    const py = margin + y * spacing;
    const radius = spacing * .43;
    context.fillStyle = player === "B" ? "#171a18" : "#f7f8f5";
    context.strokeStyle = index === gameDocument.moves.length - 1 ? "#c43d34" : "#343b37";
    context.lineWidth = index === gameDocument.moves.length - 1 ? 3.5 : 1;
    context.beginPath(); context.arc(px, py, radius, 0, Math.PI * 2); context.fill(); context.stroke();
    context.fillStyle = player === "B" ? "#f5f5f2" : "#1f2421";
    context.font = "12px ui-monospace, monospace";
    context.fillText(String(index + 1), px, py + 1);
  });

  for (const forbidden of forbiddenMoves) {
    if (occupied(forbidden)) continue;
    const [x, y] = moveToXY(forbidden);
    const px = margin + x * spacing;
    const py = margin + y * spacing;
    context.strokeStyle = "#b63a32";
    context.lineWidth = 3.5;
    context.beginPath();
    context.moveTo(px - 9, py - 9); context.lineTo(px + 9, py + 9);
    context.moveTo(px + 9, py - 9); context.lineTo(px - 9, py + 9); context.stroke();
  }

  if (canvas === document.activeElement) {
    const px = margin + boardCursor.x * spacing;
    const py = margin + boardCursor.y * spacing;
    context.strokeStyle = "#315d89";
    context.lineWidth = 2;
    context.strokeRect(px - spacing * .46, py - spacing * .46, spacing * .92, spacing * .92);
  }
  updateBoardText();
}

function drawPv() {
  const candidate = focusedCandidate();
  if (!candidate?.pv?.length) return;
  candidate.pv.forEach((move, index) => {
    if (!isBoardMove(move) || occupied(move)) return;
    const [x, y] = moveToXY(move);
    if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) return;
    const px = margin + x * spacing;
    const py = margin + y * spacing;
    const player = index % 2 === 0 ? nextPlayer() : otherPlayer(nextPlayer());
    context.fillStyle = player === "B" ? "rgba(23,26,24,.38)" : "rgba(247,248,245,.64)";
    context.strokeStyle = "rgba(49,93,137,.72)";
    context.lineWidth = 2;
    context.beginPath(); context.arc(px, py, spacing * .37, 0, Math.PI * 2); context.fill(); context.stroke();
    context.fillStyle = player === "B" ? "white" : "#1f2421";
    context.font = "bold 11px ui-monospace, monospace";
    context.fillText(`P${index + 1}`, px, py + 1);
  });
}

function comparisonPreviewLine(slot) {
  if (!comparisonLab || !["a", "b"].includes(slot)) return [];
  const result = deriveComparisonResult(comparisonLab);
  const branch = result.branches[slot];
  if (!branch?.move) return [];
  const responseLine = [...(branch.opponentOrder0Pv || [])];
  if (branch.opponentOrder0Move && responseLine[0] !== branch.opponentOrder0Move) {
    responseLine.unshift(branch.opponentOrder0Move);
  }
  return [branch.move, ...responseLine];
}

function drawComparisonMarker(move, label, color, muted = false) {
  if (!isBoardMove(move) || occupied(move)) return;
  const [x, y] = moveToXY(move);
  const px = margin + x * spacing;
  const py = margin + y * spacing;
  context.fillStyle = muted ? "rgba(255,255,255,.60)" : "rgba(255,255,255,.90)";
  context.strokeStyle = muted ? "rgba(78,93,102,.52)" : color;
  context.lineWidth = muted ? 2 : 4;
  context.beginPath(); context.arc(px, py, spacing * .40, 0, Math.PI * 2); context.fill(); context.stroke();
  context.fillStyle = muted ? "#637078" : color;
  context.font = "800 13px -apple-system, sans-serif";
  context.fillText(label, px, py + 1);
}

function drawComparisonOverlay() {
  const selections = { a: comparisonUi.moveA, b: comparisonUi.moveB };
  const preview = comparisonUi.previewSlot;
  if (!preview) {
    drawComparisonMarker(selections.a, "A", "#315d89");
    drawComparisonMarker(selections.b, "B", "#7b4e8d");
    return;
  }

  const other = preview === "a" ? "b" : "a";
  drawComparisonMarker(selections[other], other.toUpperCase(), "#637078", true);
  const line = comparisonPreviewLine(preview);
  if (!line.length) {
    drawComparisonMarker(selections[preview], preview.toUpperCase(), preview === "a" ? "#315d89" : "#7b4e8d");
    return;
  }
  line.forEach((move, index) => {
    if (!isBoardMove(move) || occupied(move)) return;
    const [x, y] = moveToXY(move);
    const px = margin + x * spacing;
    const py = margin + y * spacing;
    const player = index % 2 === 0 ? comparisonLab.base.player : otherPlayer(comparisonLab.base.player);
    context.fillStyle = player === "B" ? "rgba(23,26,24,.52)" : "rgba(247,248,245,.78)";
    context.strokeStyle = preview === "a" ? "rgba(49,93,137,.90)" : "rgba(123,78,141,.90)";
    context.lineWidth = index === 0 ? 4 : 2;
    context.beginPath(); context.arc(px, py, spacing * .38, 0, Math.PI * 2); context.fill(); context.stroke();
    context.fillStyle = player === "B" ? "white" : "#1f2421";
    context.font = "bold 11px ui-monospace, monospace";
    context.fillText(index === 0 ? preview.toUpperCase() : `P${index}`, px, py + 1);
  });
}

function drawCandidateOverlays() {
  candidateHitAreas = [];
  const candidates = visibleCandidates().filter((candidate) => isBoardMove(candidate.move) && !occupied(candidate.move));
  const metric = elements.sizeMetric.value;
  const values = candidates.map((candidate) => Number(metric === "policy" ? candidate.rawPrior : candidate.visitShare) || 0);
  const maxValue = Math.max(...values, .000001);
  const labelBoxes = [];
  candidates.forEach((candidate, index) => {
    const [x, y] = moveToXY(candidate.move);
    const px = margin + x * spacing;
    const py = margin + y * spacing;
    const radius = 10 + 13 * Math.sqrt(values[index] / maxValue);
    const focused = candidate.move === (pinnedCandidateMove || hoveredCandidateMove);
    const order = candidateOrder(candidate);
    const first = order === 0;
    const orderLabel = order === null ? "—" : String(order);
    context.fillStyle = first ? "rgba(20,93,72,.91)" : focused ? "rgba(49,93,137,.88)" : "rgba(255,255,255,.84)";
    context.strokeStyle = first ? "#f4ce68" : focused ? "#315d89" : "#145d48";
    context.lineWidth = first ? 4 : focused ? 3 : 1.5;
    context.beginPath(); context.arc(px, py, radius, 0, Math.PI * 2); context.fill(); context.stroke();
    context.fillStyle = first || focused ? "white" : "#145d48";
    context.font = "bold 12px -apple-system, sans-serif";
    context.fillText(orderLabel, px, py);

    let box = null;
    if (first || focused) {
      box = findLabelBox(px, py, labelBoxes, index);
      labelBoxes.push(box);
      context.fillStyle = first ? "rgba(14,70,54,.93)" : "rgba(255,255,255,.94)";
      context.strokeStyle = first ? "#f4ce68" : "rgba(20,93,72,.65)";
      context.lineWidth = 1;
      context.fillRect(box.x, box.y, box.width, box.height);
      context.strokeRect(box.x, box.y, box.width, box.height);
      context.textAlign = "left";
      context.fillStyle = first ? "white" : "#173f33";
      context.font = "bold 10px ui-monospace, monospace";
      context.fillText(`${candidate.move}  Order ${orderLabel}`, box.x + 4, box.y + 9);
      context.font = "10px ui-monospace, monospace";
      context.fillText(`Visits ${percent(candidate.visitShare)}`, box.x + 4, box.y + 22);
      context.fillText(`Policy ${percent(candidate.rawPrior)}`, box.x + 4, box.y + 35);
      context.fillText(`Black ${percent(candidate.blackWinrate)}`, box.x + 4, box.y + 48);
      context.textAlign = "center";
    }
    candidateHitAreas.push({ move: candidate.move, px, py, radius: Math.max(radius, 18), box });
  });
}

function findLabelBox(px, py, existing, index) {
  const width = 126;
  const height = 54;
  const offsets = [[18, -58], [-144, -58], [18, 8], [-144, 8], [-63, -82], [-63, 28]];
  let best;
  let bestPenalty = Infinity;
  offsets.forEach(([dx, dy], offsetIndex) => {
    const box = {
      x: Math.max(29, Math.min(BOARD_CANVAS_SIZE - width - 6, px + dx)),
      y: Math.max(5, Math.min(BOARD_CANVAS_SIZE - height - 5, py + dy)), width, height,
    };
    const overlap = existing.reduce((total, other) => total + rectangleOverlap(box, other), 0);
    const penalty = overlap + offsetIndex * .01 + index * .001;
    if (penalty < bestPenalty) { best = box; bestPenalty = penalty; }
  });
  return best;
}
function rectangleOverlap(a, b) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function updateBoardText() {
  const player = nextPlayer();
  const positionState = gameDocument.positionState;
  elements.nextPlayer.textContent = positionState?.isTerminal ? "종국" : playerName(player);
  elements.plyCount.textContent = `${gameDocument.moves.length}수`;
  if (positionState?.isTerminal) {
    elements.turnOwner.textContent = `· ${terminalResultLabel()}`;
  } else if (comparisonIsSelecting()) {
    elements.turnOwner.textContent = `· 비교 수 ${comparisonUi.activeSlot.toUpperCase()} 선택`;
  } else if (comparisonUi.mode === "running") {
    elements.turnOwner.textContent = "· A/B 비교 분석 중";
  } else if (comparisonUi.mode === "complete") {
    elements.turnOwner.textContent = "· A/B 비교 결과";
  } else if (comparisonUi.mode === "error") {
    elements.turnOwner.textContent = "· A/B 비교 오류";
  } else if (practice.active) {
    elements.turnOwner.textContent = player === practice.attempt.settings.userColor ? "· 사용자 차례" : "· AI 차례";
  } else {
    elements.turnOwner.textContent = elements.mode.value === "analysis" ? "· 자유 착수" : "· 설정 가능";
  }
  const summary = positionState?.isTerminal
    ? `${gameDocument.moves.length}수 종국, ${terminalResultLabel()}, 마지막 수 ${positionState.terminalMove || gameDocument.moves.at(-1)?.[1] || "—"}`
    : gameDocument.moves.length
    ? `${gameDocument.moves.length}수 진행, 마지막 수 ${gameDocument.moves.at(-1)[1]}, ${playerName(player)} 차례`
    : `빈 오목판, ${playerName(player)} 차례`;
  elements.boardSummary.textContent = summary;
  elements.boardHelp.textContent = comparisonIsSelecting()
    ? `비교 수 ${comparisonUi.activeSlot.toUpperCase()}로 둘 합법 교차점을 고르세요. 클릭해도 실제 판에는 착수되지 않습니다.`
    : comparisonUi.previewSlot
      ? `비교 ${comparisonUi.previewSlot.toUpperCase()}의 강제 착수와 상대 최선 응수 PV를 반투명하게 표시합니다.`
      : comparisonUi.mode === "running"
        ? "기준 위치와 A/B를 순차 분석 중입니다. 비교가 끝나도 실제 판은 그대로 유지됩니다."
        : comparisonUi.mode === "complete"
          ? "A/B 표 아래의 미리보기 버튼으로 강제 착수와 상대 응수 PV를 확인하세요. 계속 두려면 비교를 초기화하세요."
          : comparisonUi.mode === "error"
            ? "비교를 다시 선택하거나 초기화한 뒤 계속할 수 있습니다."
      : "교차점을 클릭해 착수합니다. 키보드는 방향키로 이동하고 Enter로 착수합니다.";
  canvas.setAttribute(
    "aria-label",
    `15×15 Renju 오목판. ${summary}. ${comparisonIsSelecting() ? `비교 수 ${comparisonUi.activeSlot.toUpperCase()} 선택 중. ` : ""}키보드 커서 ${xyToMove(boardCursor.x, boardCursor.y)}`,
  );
}

function applyPositionState(state, responseRevision = gameDocument.revision) {
  const wasTerminal = Boolean(gameDocument.positionState?.isTerminal);
  const committed = commitOfficialPositionState(gameDocument, state, responseRevision);
  if (committed === gameDocument && responseRevision !== gameDocument.revision) return false;
  gameDocument = committed;
  forbiddenMoves = new Set(state.forbiddenMoves || []);
  legalMoves = Array.isArray(state.legalMoves) ? state.legalMoves : [];
  legalityState = "ready";
  elements.legalityStatus.classList.remove("error");
  if (state.isTerminal) {
    // The WebSocket terminal gate already stops its own query. Keep the same
    // invariant for a terminal state committed through the REST position path:
    // no live AnalysisJob or late engine response may survive the official
    // BoardHistory result.
    cancelAnalysis();
    elements.legalityStatus.textContent = `KataGomo Renju 종국 판정: ${terminalResultLabel(state)}`;
    if (!wasTerminal || currentAnalysis || allCandidates.length || fullPolicy.length) {
      clearAnalysisDisplay({ keepStatus: true });
    }
    setAnalysisStatus("종국 · MCTS 미실행", "neutral");
    elements.responseKind.textContent = "종국 · MCTS 미실행";
  } else {
    elements.legalityStatus.textContent = nextPlayer() === "B"
      ? `KataGomo 금수 판정: 흑 금수 ${forbiddenMoves.size}곳`
      : "백 차례: 흑 금수 규칙을 적용하지 않습니다.";
  }
  drawBoard();
  updateControls();
  return true;
}

async function requestOfficialPositionState(moves) {
  const response = await fetch("/api/position", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      moves,
      nextPlayer: moves.length % 2 === 0 ? "B" : "W",
    }),
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`공식 판정 응답을 읽을 수 없습니다 (HTTP ${response.status})`);
  }
  if (!response.ok) {
    const detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
    throw new Error(detail || `HTTP ${response.status}`);
  }
  return body;
}

async function refreshLegality() {
  const generation = ++legalityGeneration;
  const requestedRevision = gameDocument.revision;
  const requestedMoves = cloneMoves();
  legalityState = "pending";
  elements.legalityStatus.classList.remove("error");
  elements.legalityStatus.textContent = "금수 정보를 확인 중입니다.";
  updateControls();
  try {
    const body = await requestOfficialPositionState(requestedMoves);
    if (generation !== legalityGeneration) return false;
    if (!applyPositionState(body, requestedRevision)) return false;
  } catch (error) {
    if (generation !== legalityGeneration) return false;
    forbiddenMoves = new Set();
    legalMoves = [];
    legalityState = "error";
    gameDocument = withoutOfficialPositionState(gameDocument);
    elements.legalityStatus.textContent = `금수 판정 오류 — 안전을 위해 착수를 차단합니다: ${error.message}`;
    elements.legalityStatus.classList.add("error");
  }
  drawBoard();
  updateControls();
  return legalityState === "ready";
}

function preparedUserTurnIsCurrent() {
  const prepared = practice.preparedAnalysis;
  return Boolean(practice.active && practice.phase === "user_turn" && prepared?.isFinal
    && Number(prepared.turnNumber) === gameDocument.moves.length
    && Number(prepared.positionRevision) === gameDocument.revision
    && prepared.sessionEpoch === practice.attempt?.sessionEpoch
    && prepared.analysisPurpose === "user_pre");
}

function clearPracticeRecovery() {
  clearTimeout(practiceRecoveryTimer);
  practiceRecoveryTimer = null;
  practiceRecoveryPending = false;
}

function schedulePracticeRecovery(delay = 0) {
  clearTimeout(practiceRecoveryTimer);
  practiceRecoveryTimer = setTimeout(() => {
    practiceRecoveryTimer = null;
    void resumePracticeAfterReconnect();
  }, delay);
}

async function resumePracticeAfterReconnect() {
  const activeSocket = socket;
  if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) return;
  const decision = decidePracticeReconnect({
    practiceActive: practice.active,
    recoveryPending: practiceRecoveryPending,
    analysisLive: analysisIsLive(),
    phase: practice.phase,
    aiTimerPending: Boolean(aiTimer),
    preparedUserTurn: preparedUserTurnIsCurrent(),
  });
  if (decision === "none") return;
  if (decision === "flow-resumed" || decision === "user-ready") {
    clearPracticeRecovery();
    if (decision === "user-ready") {
      setPracticePhase("user_turn", "사용자 착수", "");
      notice("분석 서버에 다시 연결되었습니다. 준비된 위치에서 계속 착수하세요.");
    }
    return;
  }
  if (decision === "wait") {
    schedulePracticeRecovery(250);
    return;
  }
  if (engineState !== "ready") {
    await refreshStatus();
    if (socket !== activeSocket || !practice.active || !practiceRecoveryPending) return;
    if (engineState !== "ready") {
      schedulePracticeRecovery(750);
      return;
    }
  }
  const token = practice.token;
  clearPracticeRecovery();
  notice("분석 서버에 다시 연결되어 중단된 연습 분석을 자동으로 이어갑니다.");
  void beginPracticeTurn(token);
}

function connectWebSocket() {
  if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const candidateSocket = new WebSocket(`${scheme}://${location.host}/ws/analysis`);
  socket = candidateSocket;
  candidateSocket.addEventListener("open", () => {
    if (socket !== candidateSocket) return;
    setAnalysisStatus("연결됨", "neutral");
    if (practice.active && practiceRecoveryPending) schedulePracticeRecovery();
    updateControls();
  });
  candidateSocket.addEventListener("close", () => {
    if (socket !== candidateSocket) return;
    socket = null;
    const interruptedLiveAnalysis = analysisIsLive();
    if (interruptedLiveAnalysis) {
      analysisJob = transitionAnalysisJob(analysisJob, "failed");
      if (analysisContext?.owner === "comparison") {
        failComparison("분석 연결이 끊겨 A/B 비교의 부분 결과를 폐기했습니다. 재연결 후 전체 비교를 다시 실행하세요.");
      } else {
        discardIncompleteAnalysis("연결 끊김 · 부분 결과 폐기");
      }
    }
    setAnalysisStatus("연결 끊김", "error");
    if (practice.active) {
      practiceRecoveryPending = true;
      notice("분석 연결이 끊겼습니다. 다시 연결되면 현재 연습을 자동으로 이어갑니다.", true);
    }
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWebSocket();
      }, 1500);
    }
    updateControls();
  });
  candidateSocket.addEventListener("message", (event) => {
    if (socket !== candidateSocket) return;
    try { handleMessage(JSON.parse(event.data)); }
    catch (error) { notice(`응답 JSON 오류: ${error.message}`, true); }
  });
}

function currentAnalysisIdentity() {
  return {
    positionRevision: gameDocument.revision,
    sessionEpoch: practice.active ? practice.attempt?.sessionEpoch ?? null : null,
  };
}

function handleComparisonMessage(message) {
  if (analysisContext?.owner !== "comparison" || !comparisonLab) return false;
  const active = comparisonLab.activeRequest;
  const targetsActive = Boolean(active)
    && message?.clientRequestId === active.clientRequestId;

  if (message?.type === "status") {
    if (message.status === "analyzing" && targetsActive) {
      if (analysisJob?.state === "requested") {
        analysisJob = transitionAnalysisJob(analysisJob, "streaming");
      }
      setAnalysisStatus(`수 비교 ${comparisonLab.stage.toUpperCase()} 분석`, "busy");
      renderComparisonLab();
      updateControls();
      return true;
    }
    return targetsActive;
  }
  if (message?.type === "warning" && targetsActive) {
    elements.comparisonProgress.textContent = `엔진 경고: ${message.message}`;
    elements.comparisonProgress.classList.add("error");
    return true;
  }
  if (message?.type === "error") {
    if (targetsActive) {
      if (analysisIsLive()) analysisJob = transitionAnalysisJob(analysisJob, "failed");
      failComparison(`비교 분석 오류(${message.code || "engine_error"}): ${message.message}`);
      return true;
    }
    if (!message.clientRequestId && comparisonWorkflowActive()) {
      notice(`보조 WebSocket 오류(${message.code || "unknown"})는 현재 비교 요청과 연결되지 않아 비교를 계속합니다.`, true);
      return true;
    }
    return false;
  }
  if (!["analysis", "position"].includes(message?.type)) return false;
  if (!targetsActive) return true;

  const previous = comparisonLab;
  let next;
  try {
    next = applyComparisonResponse(previous, message);
  } catch (error) {
    if (analysisIsLive()) analysisJob = transitionAnalysisJob(analysisJob, "failed");
    failComparison(`비교 응답 계약 오류: ${error.message}`);
    return true;
  }
  if (next === previous) {
    failComparison("비교 응답의 purpose·revision·visits·수순 메타데이터가 요청과 일치하지 않습니다.");
    return true;
  }

  if (message.type === "analysis") {
    if (message.noResults === true) {
      if (analysisIsLive()) analysisJob = transitionAnalysisJob(analysisJob, "interrupted");
    } else {
      const accepted = applyAnalysisResponse(analysisJob, message, {
        positionRevision: previous.base.revision,
        sessionEpoch: previous.sessionEpoch,
      });
      if (!accepted.accepted) {
        failComparison("비교 분석 응답이 현재 요청 ID와 일치하지 않아 적용하지 않았습니다.");
        return true;
      }
      analysisJob = accepted.job;
    }
  } else if (analysisIsLive()) {
    analysisJob = transitionAnalysisJob(analysisJob, "interrupted");
  }

  comparisonLab = next;
  if (next.status === "running") {
    renderComparisonLab();
    return true;
  }
  if (next.status === "ready") {
    renderComparisonLab();
    const generation = comparisonGeneration;
    setTimeout(() => submitComparisonStage(generation), 0);
    return true;
  }
  if (next.status === "complete") {
    comparisonUi = { ...comparisonUi, mode: "complete", previewSlot: null, error: null };
    analysisContext = null;
    updateEngineBadge({ state: "ready" });
    setAnalysisStatus("수 비교 완료");
    renderComparisonLab();
    drawBoard();
    updateControls();
    notice(`A ${comparisonUi.moveA}와 B ${comparisonUi.moveB} 비교를 완료했습니다. 결과 행과 PV 미리보기를 확인하세요.`);
    return true;
  }
  failComparison("검색이 완료되기 전에 결과가 중단됐습니다. 부분 결과로 A/B 결론을 만들지 않았습니다.");
  return true;
}

function handleMessage(message) {
  if (message?.engine) updateEngineBadge(message.engine);
  if (message?.type === "status" && message.status === "canceled"
    && suppressedComparisonCancelIds.has(message.clientRequestId)) {
    suppressedComparisonCancelIds.delete(message.clientRequestId);
    return;
  }
  if (analysisContext?.owner === "comparison" && handleComparisonMessage(message)) return;
  const decision = decideWebSocketMessage({
    message,
    job: analysisJob,
    analysisContext,
    currentIdentity: currentAnalysisIdentity(),
    currentPositionKey: positionKey(),
    positionIsTerminal: Boolean(gameDocument.positionState?.isTerminal),
  });

  if (decision.kind === "position-terminal") {
    const responseRevision = analysisJob.positionRevision;
    analysisJob = transitionAnalysisJob(analysisJob, "interrupted");
    if (message.gameState
      && !applyPositionState(message.gameState, responseRevision)) return;
    updateEngineBadge({ state: "ready" });
    setAnalysisStatus("종국 · MCTS 미실행", "neutral");
    notice(`${terminalResultLabel(message.gameState)} — 공식 종국 위치는 MCTS에 보내지 않습니다.`);
    if (practice.active) void beginPracticeTurn(practice.token);
    updateControls();
    return;
  }
  if (decision.kind === "position-invalid") {
    analysisJob = transitionAnalysisJob(analysisJob, "failed");
    discardIncompleteAnalysis("오류 · 잘못된 종국 응답 폐기");
    setAnalysisStatus("종국 응답 계약 오류", "error");
    if (practice.active) setPracticePhase("error", "종국 판정 오류", "error");
    notice("서버의 position 응답이 공식 종국 상태를 포함하지 않아 적용하지 않았습니다.", true);
    updateControls();
    return;
  }
  if (decision.kind === "warning-current") {
    setAnalysisStatus(`${message.code || "engine_warning"}: ${message.message}`, "busy");
    notice(`엔진 경고: ${message.message}`);
    updateControls();
    return;
  }
  if (decision.kind === "error-auxiliary") {
    notice(`보조 WebSocket 오류(${message.code || "unknown"})는 현재 분석 요청과 연결되지 않아 분석을 계속합니다.`, true);
    return;
  }
  if (decision.kind === "error-current") {
    analysisJob = transitionAnalysisJob(analysisJob, "failed");
    discardIncompleteAnalysis("오류 · 부분 결과 폐기");
    setAnalysisStatus(`${message.code || "engine_error"}: ${message.message}`, "error");
    if (practice.active) setPracticePhase("error", "분석 오류", "error");
    notice(`엔진 오류: ${message.message}`, true);
    if (!message.engine) void refreshStatus();
    updateControls();
    return;
  }
  if (decision.kind === "status-analyzing") {
    analysisJob = transitionAnalysisJob(analysisJob, "streaming");
    elements.requestId.textContent = message.requestId || "—";
    setAnalysisStatus("분석 중", "busy");
    updateControls();
    return;
  }
  if (decision.kind === "status-canceled") {
    setAnalysisStatus("취소됨", "neutral");
    elements.responseKind.textContent = "취소됨";
    updateControls();
    return;
  }
  if (["status-idle", "status-connected"].includes(decision.kind)) {
    setAnalysisStatus(decision.kind === "status-connected" ? "연결됨" : "분석 대기", "neutral");
    updateControls();
    return;
  }
  if (decision.kind === "status-engine-only") {
    updateControls();
    return;
  }
  if (decision.kind === "analysis-after-terminal") {
    cancelAnalysis();
    clearAnalysisDisplay({ keepStatus: true });
    updateControls();
    return;
  }
  const meta = analysisContext;
  if (decision.kind === "analysis-metadata-mismatch") {
    analysisJob = transitionAnalysisJob(analysisJob, "failed");
    discardIncompleteAnalysis("오류 · 오래된 부분 결과 폐기");
    setAnalysisStatus("응답 메타데이터 불일치", "error");
    if (practice.active) setPracticePhase("error", "오래된 응답 차단", "error");
    notice("엔진 응답의 요청 정보가 현재 위치와 달라 오래된 결과로 보고 적용하지 않았습니다.", true);
    updateControls();
    return;
  }
  if (!["analysis-no-results", "analysis-partial", "analysis-final"].includes(decision.kind)) return;
  const accepted = applyAnalysisResponse(
    analysisJob, message, currentAnalysisIdentity(),
  );
  if (!accepted.accepted) return;
  analysisJob = accepted.job;
  if (decision.kind === "analysis-no-results") {
    updateEngineBadge({ state: "ready" });
    discardIncompleteAnalysis("noResults · 부분 결과 폐기");
    setAnalysisStatus("분석 중단 · 결과 없음", "error");
    if (practice.active) setPracticePhase("error", "분석 중단", "error");
    notice("검색이 시작되기 전에 요청이 중단되어 noResults가 반환됐습니다. 승패 신호로 해석하지 않으며 다시 분석할 수 있습니다.", true);
    updateControls();
    return;
  }
  currentAnalysis = message;
  allCandidates = Array.isArray(message.candidates) ? message.candidates : [];
  fullPolicy = Array.isArray(message.policy) ? message.policy : [];
  renderAnalysis(message);
  if (decision.kind !== "analysis-final") return;
  updateEngineBadge({ state: "ready" });
  setAnalysisStatus(message.analysisInsufficient ? "최종 · 분석 부족" : "최종 결과", message.analysisInsufficient ? "insufficient" : "");
  updateControls();
  if (practice.active) void processPracticeFinal(message, meta);
}

function renderAnalysis(message) {
  elements.requestId.textContent = message.requestId || "—";
  elements.policyLength.textContent = String(message.policyLength ?? "—");
  elements.visitTotal.textContent = String(message.candidateVisitTotal ?? "—");
  elements.rootVisits.textContent = String(message.rootInfo?.visits ?? "—");
  elements.blackWinrate.textContent = percent(message.rootInfo?.blackWinrate);
  elements.currentWinrate.textContent = `${percent(message.rootInfo?.currentPlayerWinrate)} (${playerName(message.currentPlayer || nextPlayer())})`;
  elements.userWinrate.textContent = isFreeAnalysisMode()
    ? "— (색 미지정)"
    : `${percent(message.rootInfo?.userWinrate)} (${playerName(message.userColor || elements.userColor.value)})`;
  elements.responseKind.textContent = message.isFinal ? "최종" : "검색 중간";
  setAnalysisStatus(message.isFinal ? "최종 결과" : "분석 중", message.isFinal ? "" : "busy");
  renderCandidates();
  renderRawPolicy();
  renderCandidateFocus();
  drawBoard();
}

function captureCandidateTableFocus() {
  const active = document.activeElement;
  if (!active?.classList?.contains("candidate-row") || !elements.candidates.contains(active)) return null;
  const scrollContainer = elements.candidates.closest(".table-wrap");
  return {
    move: active.dataset.move,
    scrollContainer,
    scrollLeft: scrollContainer?.scrollLeft ?? 0,
    scrollTop: scrollContainer?.scrollTop ?? 0,
  };
}

function restoreCandidateTableFocus(snapshot) {
  if (!snapshot) return;
  const matchingRow = [...elements.candidates.querySelectorAll(".candidate-row")]
    .find((row) => row.dataset.move === snapshot.move);
  if (!matchingRow) {
    if (hoveredCandidateMove === snapshot.move) hoveredCandidateMove = null;
    return;
  }
  matchingRow.focus({ preventScroll: true });
  if (snapshot.scrollContainer) {
    snapshot.scrollContainer.scrollLeft = snapshot.scrollLeft;
    snapshot.scrollContainer.scrollTop = snapshot.scrollTop;
  }
}

function renderCandidates() {
  const focusSnapshot = captureCandidateTableFocus();
  const shown = visibleCandidates();
  if (!shown.length) {
    const message = gameDocument.positionState?.isTerminal
      ? "종국 위치 · MCTS 분석 미실행"
      : currentAnalysis ? "후보 없음 · 분석 부족" : "현재 위치를 분석하면 MCTS 후보가 표시됩니다.";
    elements.candidates.innerHTML = `<tr><td colspan="7" class="empty">${message}</td></tr>`;
    restoreCandidateTableFocus(focusSnapshot);
    return;
  }
  elements.candidates.innerHTML = shown.map((candidate) => {
    const order = candidateOrder(candidate);
    const first = order === 0;
    const selected = candidate.move === pinnedCandidateMove;
    const pv = (candidate.pv || []).join(" ") || "없음";
    const accessibleLabel = `Order ${order ?? "없음"}, Move ${candidate.move}, Raw policy ${percent(candidate.rawPrior)}, Visits ${candidate.visits}, Visit share ${percent(candidate.visitShare)}, Winrate (Black) ${percent(candidate.blackWinrate)}, PV ${pv}`;
    return `
    <tr class="candidate-row${first ? " is-order-zero" : ""}${candidate.move === (pinnedCandidateMove || hoveredCandidateMove) ? " is-focused" : ""}" data-order="${order ?? ""}" data-move="${escapeHtml(candidate.move)}" tabindex="0" aria-label="${escapeHtml(accessibleLabel)}" aria-selected="${selected}">
      <td>${order ?? "—"}</td>
      <td><strong>${escapeHtml(candidate.move)}</strong></td>
      <td>${percent(candidate.rawPrior)}</td>
      <td>${escapeHtml(candidate.visits)}</td>
      <td>${percent(candidate.visitShare)}</td>
      <td>${percent(candidate.blackWinrate)}</td>
      <td title="${escapeHtml(pv)}">${escapeHtml(pv)}</td>
    </tr>`;
  }).join("");
  elements.candidates.querySelectorAll(".candidate-row").forEach((row) => {
    row.addEventListener("mouseenter", () => focusCandidate(row.dataset.move, false));
    row.addEventListener("mouseleave", () => focusCandidate(null, false));
    row.addEventListener("focus", () => focusCandidate(row.dataset.move, false));
    row.addEventListener("blur", () => focusCandidate(null, false));
    row.addEventListener("click", () => focusCandidate(row.dataset.move, true));
    row.addEventListener("keydown", (event) => {
      if (["Enter", " "].includes(event.key)) { event.preventDefault(); focusCandidate(row.dataset.move, true); }
    });
  });
  restoreCandidateTableFocus(focusSnapshot);
}

function rawPolicyEntries(limit = Number(elements.topCount.value)) {
  if (fullPolicy.length !== POLICY_LENGTH) return [];
  return fullPolicy.slice(0, BOARD_SIZE * BOARD_SIZE)
    .map((value, index) => ({ value: Number(value), move: xyToMove(index % BOARD_SIZE, Math.floor(index / BOARD_SIZE)) }))
    .filter((entry) => Number.isFinite(entry.value) && entry.value >= 0 && legalMoves.includes(entry.move))
    .sort((left, right) => right.value - left.value)
    .slice(0, limit);
}
function renderRawPolicy() {
  const policy = rawPolicyEntries();
  elements.rawPolicy.innerHTML = policy.length
    ? policy.map((entry, index) => `<li><strong>#${index + 1} ${escapeHtml(entry.move)}</strong> ${percent(entry.value)} <small>raw</small></li>`).join("")
    : gameDocument.positionState?.isTerminal
      ? "<li>종국 위치에서는 Raw policy/MCTS 분석을 실행하지 않습니다.</li>"
      : "<li>현재 위치를 분석하면 합법 수의 Raw policy 순위가 표시됩니다.</li>";
}
function focusCandidate(move, pin) {
  if (pin) pinnedCandidateMove = pinnedCandidateMove === move ? null : move;
  else hoveredCandidateMove = move;
  renderCandidateFocus();
  updateCandidateRowState();
  drawBoard();
}
function updateCandidateRowState() {
  const focusedMove = pinnedCandidateMove || hoveredCandidateMove;
  elements.candidates.querySelectorAll(".candidate-row").forEach((row) => {
    row.classList.toggle("is-focused", row.dataset.move === focusedMove);
    row.setAttribute("aria-selected", String(row.dataset.move === pinnedCandidateMove));
  });
}
function renderCandidateFocus() {
  const candidate = focusedCandidate();
  if (!candidate) {
    elements.candidateFocus.textContent = gameDocument.positionState?.isTerminal
      ? "종국 위치에서는 MCTS/PV 분석을 실행하지 않습니다."
      : "후보 원이나 표의 행에 마우스를 올리면 PV가 반투명 수순으로 표시됩니다.";
    return;
  }
  const order = candidateOrder(candidate);
  elements.candidateFocus.innerHTML = `<strong>Order ${order ?? "—"} · ${escapeHtml(candidate.move)}</strong> · Visit share ${percent(candidate.visitShare)} (${escapeHtml(candidate.visits)} Visits) · Raw policy ${percent(candidate.rawPrior)} · Winrate (Black) ${percent(candidate.blackWinrate)}<br>PV: ${escapeHtml((candidate.pv || []).join(" ") || "없음")}`;
}

function clearAnalysisDisplay({ keepStatus = false } = {}) {
  allCandidates = [];
  fullPolicy = [];
  currentAnalysis = null;
  hoveredCandidateMove = null;
  pinnedCandidateMove = null;
  renderCandidates();
  renderRawPolicy();
  renderCandidateFocus();
  for (const element of [elements.requestId, elements.policyLength, elements.visitTotal, elements.rootVisits,
    elements.blackWinrate, elements.currentWinrate, elements.userWinrate, elements.responseKind]) element.textContent = "—";
  if (gameDocument.positionState?.isTerminal) {
    elements.responseKind.textContent = "종국 · MCTS 미실행";
    setAnalysisStatus("종국 · MCTS 미실행", "neutral");
  } else if (!keepStatus) setAnalysisStatus("분석 대기", "neutral");
  drawBoard();
}

function discardIncompleteAnalysis(responseKind) {
  clearAnalysisDisplay({ keepStatus: true });
  elements.responseKind.textContent = responseKind;
}

function restoreUnderlyingAnalysisStatus() {
  if (currentAnalysis?.isFinal) {
    const insufficient = currentAnalysis.analysisInsufficient === true;
    elements.responseKind.textContent = "최종";
    setAnalysisStatus(insufficient ? "최종 · 분석 부족" : "최종 결과", insufficient ? "insufficient" : "");
    return;
  }
  setAnalysisStatus("분석 대기", "neutral");
}

function setComparisonStatus(text, tone = "") {
  elements.comparisonStatus.textContent = text;
  elements.comparisonStatus.hidden = !text;
  elements.comparisonStatus.className = `comparison-status${tone ? ` ${tone}` : ""}`;
}

function terminalOutcomeText(outcome) {
  return ({ black_win: "공식 종국 · 흑 승", white_win: "공식 종국 · 백 승", draw: "공식 종국 · 무승부" })[outcome]
    || "공식 종국";
}

function comparisonBranchPv(branch) {
  const pv = [...(branch?.opponentOrder0Pv || [])];
  if (branch?.opponentOrder0Move && pv[0] !== branch.opponentOrder0Move) {
    pv.unshift(branch.opponentOrder0Move);
  }
  return pv;
}

function comparisonBranchValue(branch, metric) {
  if (!branch) return "—";
  if (metric === "move") return escapeHtml(branch.move);
  if (metric === "raw-policy") return branch.baseRawPolicy === null ? "—" : policyPercent(branch.baseRawPolicy);
  if (metric === "policy-rank") return branch.basePolicyRank === null ? "순위 없음" : `${branch.basePolicyRank}위`;
  if (metric === "mcts-order") return branch.baseMctsOrder === null
    ? "MCTS 후보 미반환" : `Order ${branch.baseMctsOrder}`;
  if (metric === "base-visits") return branch.baseMctsVisits === null
    ? "MCTS 후보 미반환"
    : `${branch.baseMctsVisits} · ${percent(branch.baseVisitShare)}`;
  if (branch.resultKind === "terminal") {
    if (metric === "terminal") return terminalOutcomeText(branch.terminalOutcome);
    if (["black-winrate", "mover-winrate", "delta", "root-visits", "reply", "pv"].includes(metric)) {
      return metric === "reply" ? "종국 · 상대 응수 없음" : "— · MCTS 미실행";
    }
  }
  if (metric === "black-winrate") return percent(branch.afterBlackWinrate);
  if (metric === "mover-winrate") return percent(branch.afterMoverWinrate);
  if (metric === "delta") return percentagePoints(branch.moverWinrateDeltaFromBase);
  if (metric === "root-visits") return branch.afterRootVisits ?? "—";
  if (metric === "reply") return branch.opponentOrder0Move
    ? `Order 0 · ${escapeHtml(branch.opponentOrder0Move)}` : "Order 0 후보 미반환";
  if (metric === "pv") {
    const pv = comparisonBranchPv(branch);
    return pv.length ? escapeHtml(pv.join(" ")) : "PV 미반환";
  }
  if (metric === "terminal") return "진행 중 위치";
  return "—";
}

function comparisonConclusion(result) {
  const { a, b } = result.branches;
  if (a.resultKind === "terminal" || b.resultKind === "terminal") {
    return `A ${a.move}: ${a.resultKind === "terminal" ? terminalOutcomeText(a.terminalOutcome) : "MCTS 분석"} · B ${b.move}: ${b.resultKind === "terminal" ? terminalOutcomeText(b.terminalOutcome) : "MCTS 분석"}. 종국 수에는 추정 Winrate를 만들지 않습니다.`;
  }
  const aMover = a.afterMoverWinrate;
  const bMover = b.afterMoverWinrate;
  if (!Number.isFinite(aMover) || !Number.isFinite(bMover)) {
    return "두 분기의 최종 Winrate가 모두 있어야 비교 결론을 표시합니다.";
  }
  const insufficient = a.baseAnalysisInsufficient || b.baseAnalysisInsufficient
    || a.afterAnalysisInsufficient || b.afterAnalysisInsufficient
    || Number(a.afterRootVisits || 0) < MIN_GRADE_VISITS
    || Number(b.afterRootVisits || 0) < MIN_GRADE_VISITS;
  const difference = aMover - bMover;
  const leader = Math.abs(difference) < .0005 ? null : difference > 0 ? a : b;
  const comparisonText = leader
    ? `${leader.label} ${leader.move} 쪽이 ${Math.abs(difference * 100).toFixed(1)}%p 높습니다.`
    : "두 수의 착수자 관점 추정치가 거의 같습니다.";
  return `${playerName(result.player)} 착수자 관점: A ${percent(aMover)} · B ${percent(bMover)}. ${comparisonText}${insufficient ? " 분석량이 적어 탐색 추정으로만 보세요." : ""}`;
}

function comparisonGlanceMarkup(branch) {
  const policy = branch.baseRawPolicy === null
    ? "—"
    : `${policyPercent(branch.baseRawPolicy)}${branch.basePolicyRank === null ? "" : ` · #${branch.basePolicyRank}`}`;
  const mcts = branch.baseMctsOrder === null
    ? "후보 미반환"
    : `Order ${branch.baseMctsOrder}${branch.baseVisitShare === null ? "" : ` · ${percent(branch.baseVisitShare)}`}`;
  const winrate = branch.resultKind === "terminal"
    ? `${terminalOutcomeText(branch.terminalOutcome)} · MCTS 미실행`
    : percent(branch.afterBlackWinrate);
  const reply = branch.resultKind === "terminal"
    ? "종국 · 응수 없음"
    : branch.opponentOrder0Move ? `Order 0 · ${branch.opponentOrder0Move}` : "후보 미반환";
  return `<article class="comparison-glance-branch">
    <h4>${escapeHtml(branch.label)} · ${escapeHtml(branch.move)}</h4>
    <dl>
      <div><dt>Raw policy</dt><dd>${escapeHtml(policy)}</dd></div>
      <div><dt>MCTS</dt><dd>${escapeHtml(mcts)}</dd></div>
      <div><dt>Winrate (Black)</dt><dd>${escapeHtml(winrate)}</dd></div>
      <div><dt>상대 최선 응수</dt><dd>${escapeHtml(reply)}</dd></div>
    </dl>
  </article>`;
}

function renderComparisonResults(result) {
  const { a, b } = result.branches;
  elements.comparisonHeadingA.textContent = `수 A · ${a.move}`;
  elements.comparisonHeadingB.textContent = `수 B · ${b.move}`;
  const rows = [
    ["선택 수", "move"],
    ["Raw policy · 착수 전", "raw-policy"],
    ["Raw policy rank · 합법 수 기준", "policy-rank"],
    ["MCTS Order · 착수 전", "mcts-order"],
    ["Visits · Visit share · 착수 전", "base-visits"],
    ["Winrate (Black) · 착수 후", "black-winrate"],
    [`Winrate (${playerName(result.player)} 착수자) · 착수 후`, "mover-winrate"],
    ["착수자 Winrate 변화 · 기준 대비", "delta"],
    ["상대의 Order 0 응수", "reply"],
    ["Root visits · 착수 후", "root-visits"],
    ["상대 응수 PV", "pv"],
    ["공식 종국 판정", "terminal"],
  ];
  elements.comparisonBody.innerHTML = rows.map(([label, metric]) => `<tr>
    <th scope="row">${escapeHtml(label)}</th>
    <td>${comparisonBranchValue(a, metric)}</td>
    <td>${comparisonBranchValue(b, metric)}</td>
  </tr>`).join("");
  elements.comparisonConclusion.textContent = comparisonConclusion(result);
  elements.comparisonGlance.innerHTML = `${comparisonGlanceMarkup(a)}${comparisonGlanceMarkup(b)}`;
  elements.comparisonResults.hidden = false;
}

function comparisonStageProgress() {
  if (!comparisonLab) return null;
  const descriptor = comparisonStageDescriptor(comparisonLab);
  if (!descriptor) return null;
  const index = ({ base: 1, a: 2, b: 3 })[descriptor.stage];
  const label = ({ base: "기준 위치", a: `수 A · ${comparisonUi.moveA} 이후`, b: `수 B · ${comparisonUi.moveB} 이후` })[descriptor.stage];
  const partialVisits = comparisonLab.partial?.snapshot?.rootInfo?.visits;
  return `${index}/3 ${label} 분석${Number.isInteger(partialVisits) ? ` · 현재 Root visits ${partialVisits}` : ""}`;
}

function renderComparisonLab() {
  elements.comparisonMoveA.textContent = comparisonUi.moveA || "선택 안 됨";
  elements.comparisonMoveB.textContent = comparisonUi.moveB || "선택 안 됨";
  elements.comparisonSlotA.dataset.filled = String(Boolean(comparisonUi.moveA));
  elements.comparisonSlotB.dataset.filled = String(Boolean(comparisonUi.moveB));
  elements.comparisonSlotA.setAttribute("aria-pressed", String(comparisonIsSelecting() && comparisonUi.activeSlot === "a"));
  elements.comparisonSlotB.setAttribute("aria-pressed", String(comparisonIsSelecting() && comparisonUi.activeSlot === "b"));

  if (comparisonUi.mode === "idle") {
    setComparisonStatus("대기");
    elements.comparisonProgress.textContent = "‘두 수 선택’을 누른 뒤 보드의 합법 교차점 두 곳을 고르세요.";
    elements.comparisonProgress.classList.remove("error");
    elements.comparisonResults.hidden = true;
  } else if (comparisonUi.mode === "selecting") {
    setComparisonStatus("수 선택 중");
    const chosen = [comparisonUi.moveA && `A ${comparisonUi.moveA}`, comparisonUi.moveB && `B ${comparisonUi.moveB}`].filter(Boolean).join(" · ");
    elements.comparisonProgress.textContent = comparisonUi.moveA && comparisonUi.moveB
      ? `${chosen} · 선택 완료. 같은 visits로 비교하거나 A/B 버튼을 눌러 다시 고르세요.`
      : `${chosen ? `${chosen} · ` : ""}보드에서 수 ${comparisonUi.activeSlot.toUpperCase()}를 선택하세요. 실제 판은 바뀌지 않습니다.`;
    elements.comparisonProgress.classList.remove("error");
    elements.comparisonResults.hidden = true;
  } else if (comparisonUi.mode === "running") {
    setComparisonStatus("분석 중", "busy");
    elements.comparisonProgress.textContent = `${comparisonStageProgress() || "다음 비교 단계 준비"} · 각 ${comparisonLab?.maxVisits ?? "—"} visits`;
    elements.comparisonProgress.classList.remove("error");
    elements.comparisonResults.hidden = true;
  } else if (comparisonUi.mode === "complete" && comparisonLab) {
    setComparisonStatus("");
    elements.comparisonProgress.textContent = `기준 위치와 A/B를 각각 ${comparisonLab.maxVisits} visits로 순차 분석했습니다. 실제 Root visits는 아래에 그대로 표시합니다.`;
    elements.comparisonProgress.classList.remove("error");
    renderComparisonResults(deriveComparisonResult(comparisonLab));
  } else {
    setComparisonStatus("비교 오류", "error");
    elements.comparisonProgress.textContent = comparisonUi.error || "비교를 완료하지 못했습니다. 두 수를 확인하고 다시 실행하세요.";
    elements.comparisonProgress.classList.add("error");
    elements.comparisonResults.hidden = true;
  }

  const selecting = comparisonIsSelecting();
  const running = comparisonUi.mode === "running";
  elements.comparisonSlotA.disabled = !selecting;
  elements.comparisonSlotB.disabled = !selecting;
  elements.comparisonSelect.hidden = selecting || running;
  elements.comparisonSelect.textContent = comparisonUi.mode === "complete" || comparisonUi.mode === "error"
    ? "두 수 다시 선택" : "두 수 선택";
  elements.comparisonRun.hidden = !selecting;
  elements.comparisonRun.disabled = !comparisonUi.moveA || !comparisonUi.moveB;
  elements.comparisonCancel.hidden = !running;
  elements.comparisonClear.disabled = comparisonUi.mode === "idle";
  elements.comparisonPreviewA.setAttribute("aria-pressed", String(comparisonUi.previewSlot === "a"));
  elements.comparisonPreviewB.setAttribute("aria-pressed", String(comparisonUi.previewSlot === "b"));
  elements.comparisonHeadingA.classList.toggle("is-previewing", comparisonUi.previewSlot === "a");
  elements.comparisonHeadingB.classList.toggle("is-previewing", comparisonUi.previewSlot === "b");
}

function clearComparison({ reason = "comparison-closed", announce = false } = {}) {
  const wasOpen = comparisonIsOpen();
  const ownedLiveRequest = analysisContext?.owner === "comparison" && analysisIsLive();
  comparisonGeneration += 1;
  if (ownedLiveRequest) {
    if (analysisJob?.clientRequestId) suppressedComparisonCancelIds.add(analysisJob.clientRequestId);
    analysisJob = cancelAnalysisJob(analysisJob);
    send({ action: "cancel" });
  }
  if (comparisonLab) comparisonLab = invalidateComparisonLab(comparisonLab, reason);
  comparisonLab = null;
  comparisonUi = emptyComparisonUi();
  if (analysisContext?.owner === "comparison") analysisContext = null;
  if (wasOpen) restoreUnderlyingAnalysisStatus();
  renderComparisonLab();
  drawBoard();
  updateControls();
  if (announce && wasOpen) notice("수 비교 실험을 초기화했습니다.");
}

function openComparisonSelection() {
  if (!comparisonCanOpen()) {
    notice(gameDocument.positionState?.isTerminal
      ? "종국 위치에서는 두 수를 비교할 수 없습니다. 무르거나 새 판을 시작하세요."
      : "진행 중인 AI 연습·복기를 마치고 금수 확인이 완료된 위치에서 비교할 수 있습니다.", true);
    return false;
  }
  switchWorkbenchTab("comparison");
  if (analysisIsLive()) {
    cancelAnalysis();
    discardIncompleteAnalysis("취소됨 · 부분 결과 폐기");
    setAnalysisStatus("수 비교 준비", "neutral");
  }
  comparisonGeneration += 1;
  comparisonLab = null;
  comparisonUi = {
    ...emptyComparisonUi(),
    mode: "selecting",
    activeSlot: "a",
    anchor: {
      revision: gameDocument.revision,
      positionKey: positionKey(),
      moves: cloneMoves(),
      player: nextPlayer(),
      officialPosition: gameDocument.positionState,
      legalMoves: [...legalMoves],
    },
  };
  renderComparisonLab();
  notice("비교할 첫 번째 합법 수 A를 보드에서 선택하세요. 클릭해도 실제 착수되지 않습니다.");
  drawBoard();
  updateControls();
  return true;
}

function chooseComparisonSlot(slot) {
  if (!comparisonIsSelecting() || !["a", "b"].includes(slot)) return;
  comparisonUi = { ...comparisonUi, activeSlot: slot };
  renderComparisonLab();
  drawBoard();
}

function chooseComparisonMove(move) {
  if (!comparisonIsSelecting() || !comparisonAnchorIsCurrent()) {
    clearComparison({ reason: "live-position-changed" });
    notice("판이 바뀌어 비교 선택을 취소했습니다. 다시 두 수를 선택하세요.", true);
    return false;
  }
  if (!comparisonUi.anchor.legalMoves.includes(move) || !legalMoves.includes(move)) {
    notice(`${move}는 현재 공식 KataGomo 합법 수 목록에 없어 비교할 수 없습니다.`, true);
    return false;
  }
  const slotKey = comparisonUi.activeSlot === "a" ? "moveA" : "moveB";
  const otherMove = comparisonUi.activeSlot === "a" ? comparisonUi.moveB : comparisonUi.moveA;
  if (move === otherMove) {
    notice("A와 B에는 서로 다른 수를 선택해야 합니다.", true);
    return false;
  }
  comparisonUi = {
    ...comparisonUi,
    [slotKey]: move,
    activeSlot: comparisonUi.activeSlot === "a" ? "b" : "b",
    previewSlot: null,
  };
  renderComparisonLab();
  notice(comparisonUi.moveA && comparisonUi.moveB
    ? `A ${comparisonUi.moveA}와 B ${comparisonUi.moveB}를 선택했습니다. 같은 visits로 비교할 수 있습니다.`
    : `A ${comparisonUi.moveA}를 선택했습니다. 이제 수 B를 고르세요.`);
  drawBoard();
  updateControls();
  return true;
}

function failComparison(message) {
  const ownedRunningRequest = analysisContext?.owner === "comparison"
    && comparisonLab?.status === "running";
  if (ownedRunningRequest) {
    if (analysisJob?.clientRequestId) suppressedComparisonCancelIds.add(analysisJob.clientRequestId);
    if (analysisIsLive()) analysisJob = cancelAnalysisJob(analysisJob);
    if (socket?.readyState === WebSocket.OPEN) send({ action: "cancel" });
  }
  comparisonGeneration += 1;
  if (comparisonLab && !["complete", "canceled", "invalidated"].includes(comparisonLab.status)) {
    comparisonLab = cancelComparisonLab(comparisonLab, "comparison-error");
  }
  if (analysisContext?.owner === "comparison") analysisContext = null;
  comparisonUi = { ...comparisonUi, mode: "error", previewSlot: null, error: message };
  setAnalysisStatus("수 비교 오류", "error");
  renderComparisonLab();
  drawBoard();
  updateControls();
  notice(message, true);
}

function submitComparisonStage(generation = comparisonGeneration) {
  if (generation !== comparisonGeneration || !comparisonLab || comparisonLab.status !== "ready") return false;
  if (!comparisonAnchorIsCurrent()) {
    failComparison("기준 판이 바뀌어 비교 결과를 적용하지 않았습니다. 두 수를 다시 선택하세요.");
    return false;
  }
  const descriptor = comparisonStageDescriptor(comparisonLab);
  let prepared;
  try {
    prepared = beginComparisonRequest(comparisonLab, { clientRequestId: crypto.randomUUID() });
  } catch (error) {
    failComparison(`비교 요청을 만들지 못했습니다: ${error.message}`);
    return false;
  }
  comparisonLab = prepared.comparison;
  analysisJob = beginAnalysisJob({
    clientRequestId: prepared.request.clientRequestId,
    positionRevision: prepared.request.positionRevision,
    sessionEpoch: prepared.request.sessionEpoch,
    analysisPurpose: prepared.request.analysisPurpose,
    requestedMaxVisits: prepared.request.maxVisits,
  });
  analysisContext = {
    owner: "comparison",
    comparisonGeneration: generation,
    stage: descriptor.stage,
    positionKey: comparisonUi.anchor.positionKey,
    ply: prepared.request.moves.length,
  };
  if (!send(prepared.request)) {
    analysisJob = transitionAnalysisJob(analysisJob, "failed");
    failComparison("분석 서버에 비교 요청을 보내지 못했습니다.");
    return false;
  }
  setAnalysisStatus(`수 비교 ${descriptor.stage.toUpperCase()} 분석`, "busy");
  renderComparisonLab();
  updateControls();
  return true;
}

function runComparison() {
  if (!comparisonIsSelecting() || !comparisonUi.moveA || !comparisonUi.moveB) return false;
  switchWorkbenchTab("comparison");
  if (!comparisonAnchorIsCurrent()) {
    clearComparison({ reason: "live-position-changed" });
    notice("판이 바뀌어 비교 선택을 취소했습니다. 다시 시작하세요.", true);
    return false;
  }
  try {
    const runId = crypto.randomUUID();
    comparisonLab = createComparisonLab({
      moves: comparisonUi.anchor.moves,
      player: comparisonUi.anchor.player,
      positionKey: comparisonUi.anchor.positionKey,
      revision: comparisonUi.anchor.revision,
      officialPosition: comparisonUi.anchor.officialPosition,
      moveA: comparisonUi.moveA,
      moveB: comparisonUi.moveB,
      maxVisits: Number(elements.maxVisits.value),
      runId,
      sessionEpoch: `comparison:${runId}`,
    });
  } catch (error) {
    failComparison(`비교를 시작할 수 없습니다: ${error.message}`);
    return false;
  }
  comparisonUi = { ...comparisonUi, mode: "running", previewSlot: null, error: null };
  notice(`기준 위치와 A ${comparisonUi.moveA}, B ${comparisonUi.moveB}를 각각 ${comparisonLab.maxVisits} visits로 분석합니다.`);
  renderComparisonLab();
  drawBoard();
  updateControls();
  return submitComparisonStage(comparisonGeneration);
}

function cancelComparisonRun() {
  if (comparisonUi.mode !== "running") return;
  const ownedLiveRequest = analysisContext?.owner === "comparison" && analysisIsLive();
  comparisonGeneration += 1;
  if (ownedLiveRequest) {
    if (analysisJob?.clientRequestId) suppressedComparisonCancelIds.add(analysisJob.clientRequestId);
    analysisJob = cancelAnalysisJob(analysisJob);
    send({ action: "cancel" });
  }
  if (comparisonLab) comparisonLab = cancelComparisonLab(comparisonLab, "user");
  comparisonLab = null;
  comparisonUi = { ...comparisonUi, mode: "selecting", previewSlot: null, error: null };
  if (analysisContext?.owner === "comparison") analysisContext = null;
  restoreUnderlyingAnalysisStatus();
  renderComparisonLab();
  drawBoard();
  updateControls();
  notice("수 비교를 취소했습니다. 선택한 A/B는 유지됩니다.");
}

function previewComparison(slot = null) {
  if (comparisonUi.mode !== "complete") return;
  comparisonUi = { ...comparisonUi, previewSlot: comparisonUi.previewSlot === slot ? null : slot };
  renderComparisonLab();
  drawBoard();
}

function send(value) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    setAnalysisStatus("WebSocket 연결 대기", "error");
    notice("분석 서버와 아직 연결되지 않았습니다.", true);
    return false;
  }
  socket.send(JSON.stringify(value));
  return true;
}
function cancelAnalysis({ preservePractice = true } = {}) {
  if (analysisIsLive()) {
    analysisJob = cancelAnalysisJob(analysisJob);
    send({ action: "cancel" });
  }
  clearTimeout(aiTimer);
  aiTimer = null;
  if (!preservePractice && (practice.active || practice.ended)) {
    clearPracticeRecovery();
    practice = emptyPractice(practice.token + 1);
  }
  updateControls();
}
function requestAnalysis(purpose = "manual") {
  if (comparisonIsOpen()) clearComparison({ reason: "main-analysis-started" });
  switchWorkbenchTab("analysis");
  if (gameDocument.positionState?.isTerminal) {
    notice(`${terminalResultLabel()} 위치는 이미 끝났으므로 분석을 시작하지 않습니다.`, true);
    return false;
  }
  if (engineState !== "ready") {
    notice("KataGomo 엔진이 준비된 뒤 분석을 시작할 수 있습니다.", true);
    updateControls();
    return false;
  }
  if (analysisIsLive()) cancelAnalysis();
  const clientRequestId = crypto.randomUUID();
  const purposeMap = {
    manual: "manual", "prepare-user": "user_pre", "ai-turn": "post_user_ai",
    "post-user": "final_grade",
  };
  const settings = practice.active ? practice.attempt.settings : {
    maxVisits: Number(elements.maxVisits.value),
    userColor: isFreeAnalysisMode() ? nextPlayer() : elements.userColor.value,
  };
  const analysisPurpose = purposeMap[purpose] || "manual";
  analysisJob = beginAnalysisJob({
    clientRequestId,
    positionRevision: gameDocument.revision,
    sessionEpoch: practice.active ? practice.attempt.sessionEpoch : null,
    analysisPurpose,
    requestedMaxVisits: settings.maxVisits,
  });
  analysisContext = {
    purpose,
    positionKey: positionKey(),
    ply: gameDocument.moves.length,
  };
  clearAnalysisDisplay({ keepStatus: true });
  if (!send({
    action: "analyze", moves: gameDocument.moves, rules: "renju", boardXSize: 15, boardYSize: 15,
    maxVisits: settings.maxVisits, reportDuringSearchEvery: .5,
    userColor: settings.userColor, clientRequestId,
    analysisPurpose: analysisJob.analysisPurpose, positionRevision: analysisJob.positionRevision,
    sessionEpoch: analysisJob.sessionEpoch,
  })) {
    analysisJob = transitionAnalysisJob(analysisJob, "failed");
    if (practice.active) setPracticePhase("error", "연결 오류", "error");
    return false;
  }
  setAnalysisStatus("요청 전송", "busy");
  if (practice.active) {
    if (purpose === "prepare-user") setPracticePhase("analyzing_user", "사용자 수 분석 중", "busy");
    else if (purpose === "post-user") setPracticePhase("finalizing", "사용자 수 채점 중", "busy");
    else setPracticePhase("analyzing_ai", "AI 수 분석 중", "busy");
  }
  notice(purpose === "manual" ? "현재 위치를 실제 KataGomo 엔진으로 분석합니다." : "최종 엔진 응답을 기다리는 중입니다.");
  updateControls();
  return true;
}

async function startPractice(startMoves = null, { continuedFromPly = null } = {}) {
  if (engineState !== "ready" || trainingContractState !== "ready") {
    notice("엔진과 연습 설정 확인이 끝난 뒤 AI 연습을 시작할 수 있습니다.", true);
    updateControls();
    return false;
  }
  if (comparisonIsOpen()) clearComparison({ reason: "practice-started" });
  switchWorkbenchTab("analysis");
  cancelAnalysis({ preservePractice: false });
  clearPracticeRecovery();
  if (startMoves) {
    gameDocument = replaceGameMoves(gameDocument, startMoves);
  }
  if (!(await refreshLegality())) return;
  if (gameDocument.positionState?.isTerminal) {
    notice(`${terminalResultLabel()} 위치에서는 새 연습을 시작할 수 없습니다. 무르거나 초기화하세요.`, true);
    return;
  }
  let endCondition;
  try {
    endCondition = selectedEndCondition();
  } catch (error) {
    notice(error.message, true);
    return;
  }
  if (endCondition.kind === "ply" && gameDocument.moves.length >= endCondition.ply) {
    notice(`시작 위치가 종료 수(${endCondition.ply}수)보다 짧아야 합니다.`, true);
    return;
  }
  const token = practice.token + 1;
  const startedAt = new Date().toISOString();
  const sessionEpoch = crypto.randomUUID();
  const settings = {
    userColor: elements.userColor.value, endCondition,
    gradingMode: elements.gradingMode.value, maxVisits: Number(elements.maxVisits.value),
  };
  practice = {
    active: true, ended: false, token, phase: "starting",
    attempt: createPracticeAttempt({
      sessionEpoch, settings, openingMoves: gameDocument.moves, startedAt, continuedFromPly,
    }),
    pendingRecord: null, preparedAnalysis: null, preparedLegalMoves: [],
    saved: false, summaryPending: false,
  };
  elements.resultsCard.hidden = true;
  elements.instantCard.hidden = true;
  elements.sessionComplete.dataset.complete = "false";
  elements.sessionComplete.textContent = "진행 중";
  clearAnalysisDisplay();
  const continuationText = continuedFromPly == null ? "" : ` ${continuedFromPly}수 위치부터`;
  notice(`${playerName(practice.attempt.settings.userColor)}으로${continuationText} ${endConditionLabel(endCondition)} 연습을 시작합니다.`);
  beginPracticeTurn(token);
}

async function beginPracticeTurn(token = practice.token) {
  if (!practice.active || token !== practice.token) return;
  const epoch = practice.attempt.sessionEpoch;
  const revision = gameDocument.revision;
  if (gameDocument.positionState?.isTerminal) {
    if (practice.pendingRecord) {
      if (!(await finalizePendingRecord(null, gameDocument.positionState))) return;
    }
    finishPractice("game-terminal");
    return;
  }
  if (hasReachedPracticeLimit()) {
    if (practice.pendingRecord) requestAnalysis("post-user");
    else finishPractice("ply-limit");
    return;
  }
  if (legalityState !== "ready") {
    const legalityOk = await refreshLegality();
    if (!practiceIdentityMatches(token, epoch, revision)) return;
    if (!legalityOk) {
      setPracticePhase("error", "금수 오류", "error");
      return;
    }
  }
  if (!practiceIdentityMatches(token, epoch, revision)) return;
  if (nextPlayer() === practice.attempt.settings.userColor) requestAnalysis("prepare-user");
  else requestAnalysis("ai-turn");
}

async function processPracticeFinal(message, request) {
  if (!practice.active || request.positionKey !== positionKey()) return;
  const token = practice.token;
  const epoch = practice.attempt.sessionEpoch;
  const revision = gameDocument.revision;
  if (request.purpose === "prepare-user") {
    practice.preparedAnalysis = message;
    practice.preparedLegalMoves = [...legalMoves];
    setPracticePhase("user_turn", "사용자 착수", "");
    notice(isAnalysisInsufficient(message)
      ? "최종 응답은 받았지만 visits가 적어 이 수는 ‘분석 부족’으로 기록됩니다."
      : "후보를 살펴본 뒤 오목판에 착수하세요.");
    drawBoard();
    return;
  }
  if (practice.pendingRecord) {
    setPracticePhase("finalizing", "사용자 수 채점 중", "busy");
    if (!(await finalizePendingRecord(message))) return;
  }
  if (!practiceIdentityMatches(token, epoch, revision)) return;
  if (hasReachedPracticeLimit()) {
    finishPractice("ply-limit");
    return;
  }
  await playAiMove(message, practice.token);
}

function isAnalysisInsufficient(message) {
  return !message?.isFinal || Boolean(message.analysisInsufficient)
    || Number(message.candidateVisitTotal || 0) < minimumGradeVisits;
}
function createPendingRecord(move, analysis) {
  return {
    ply: gameDocument.moves.length + 1, userMove: move,
    userColor: practice.attempt.settings.userColor,
    preAnalysis: analysis, legalMoves: [...practice.preparedLegalMoves],
    prePositionRevision: gameDocument.revision,
  };
}
async function finalizePendingRecord(afterAnalysis, terminalState = null) {
  const pending = practice.pendingRecord;
  if (!pending) return true;
  const expectedToken = practice.token;
  const expectedEpoch = practice.attempt.sessionEpoch;
  const expectedRevision = gameDocument.revision;
  const clientEvaluationId = crypto.randomUUID();
  try {
    const response = await fetch("/api/training/evaluate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ply: pending.ply, userMove: pending.userMove, userColor: pending.userColor,
        preAnalysis: pending.preAnalysis,
        ...(terminalState
          ? { terminalState }
          : { postRootInfo: afterAnalysis?.rootInfo }),
        legalMoves: pending.legalMoves, minimumCandidateVisits: minimumGradeVisits,
        clientEvaluationId, sessionEpoch: expectedEpoch,
        prePositionRevision: pending.prePositionRevision, postPositionRevision: expectedRevision,
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.detail || `HTTP ${response.status}`);
    if (body.clientEvaluationId !== clientEvaluationId || body.sessionEpoch !== expectedEpoch
      || Number(body.prePositionRevision) !== pending.prePositionRevision
      || Number(body.postPositionRevision) !== expectedRevision) {
      throw new Error("채점 응답이 현재 연습 요청과 일치하지 않습니다");
    }
    if (!practice.active || practice.token !== expectedToken
      || practice.attempt.sessionEpoch !== expectedEpoch
      || gameDocument.revision !== expectedRevision || practice.pendingRecord !== pending) return false;
    const completedRecord = {
      ...body,
      analysisSnapshot: compactAnalysisSnapshot(pending.preAnalysis),
    };
    practice.attempt = appendPracticeTurnRecord(practice.attempt, completedRecord);
    practice.pendingRecord = null;
    if (practice.attempt.settings.gradingMode === "immediate") renderInstantFeedback(completedRecord);
    return true;
  } catch (error) {
    if (!practice.active || practice.token !== expectedToken
      || practice.attempt.sessionEpoch !== expectedEpoch
      || gameDocument.revision !== expectedRevision || practice.pendingRecord !== pending) return false;
    setPracticePhase("error", "채점 오류", "error");
    notice(`서버가 실제 분석 결과를 채점하지 못했습니다: ${error.message}`, true);
    return false;
  }
}

async function playAiMove(analysis, token) {
  setPracticePhase("ai_wait", "AI 착수 준비", "busy");
  if (!analysis.isFinal) {
    setPracticePhase("error", "최종 응답 없음", "error");
    notice("AI는 최종 분석 응답이 오기 전에는 착수하지 않습니다.", true);
    return;
  }
  const epoch = practice.attempt.sessionEpoch;
  const revision = gameDocument.revision;
  const legalityOk = await refreshLegality();
  if (!practiceIdentityMatches(token, epoch, revision)) return;
  if (!legalityOk) {
    setPracticePhase("error", "금수 오류", "error");
    return;
  }
  const candidate = (analysis.candidates || []).find((entry) => Number(entry.order) === 0);
  if (!candidate) {
    setPracticePhase("error", "AI 1위 후보 없음", "error");
    notice("최종 엔진 응답에 Order 0 추천 수가 없어 AI가 착수하지 않습니다.", true);
    return;
  }
  if (occupied(candidate.move) || forbiddenMoves.has(candidate.move) || !legalMoves.includes(candidate.move)) {
    setPracticePhase("error", "엔진과 합법 수 판정 충돌", "error");
    notice(`엔진 Order 0 추천 ${candidate.move}가 KataGomo 합법 수 목록에 없습니다. 다른 후보로 대체하지 않고 중단합니다.`, true);
    return;
  }
  notice(`AI가 최종 MCTS Order 0 추천 ${candidate.move}를 선택했습니다.`);
  aiTimer = setTimeout(async () => {
    aiTimer = null;
    if (!practiceIdentityMatches(token, epoch, revision)
      || occupied(candidate.move) || forbiddenMoves.has(candidate.move)
      || !legalMoves.includes(candidate.move)) return;
    gameDocument = appendGameMove(gameDocument, [nextPlayer(), candidate.move]);
    const placedRevision = gameDocument.revision;
    practice.preparedAnalysis = null;
    clearAnalysisDisplay();
    drawBoard();
    const nextLegalityOk = await refreshLegality();
    if (!practiceIdentityMatches(token, epoch, placedRevision)) return;
    if (!nextLegalityOk) {
      setPracticePhase("error", "금수 오류", "error");
      return;
    }
    if (gameDocument.positionState?.isTerminal) finishPractice("game-terminal");
    else if (hasReachedPracticeLimit()) finishPractice("ply-limit");
    else beginPracticeTurn(token);
  }, 350);
}

async function attemptMove(move) {
  if (comparisonIsOpen()) clearComparison({ reason: "live-move-played" });
  if (legalityState !== "ready") { notice("금수 확인이 끝날 때까지 착수할 수 없습니다.", true); return; }
  if (occupied(move)) { notice(`${move}에는 이미 돌이 있습니다.`, true); return; }
  if (forbiddenMoves.has(move)) {
    elements.legalityStatus.textContent = `${move}는 KataGomo가 판정한 흑 금수라 착수할 수 없습니다.`;
    elements.legalityStatus.classList.add("error");
    notice(`${move} 착수가 차단되었습니다.`, true);
    return;
  }
  if (!legalMoves.includes(move)) {
    notice(`${move}는 KataGomo 합법 수 목록에 없어 착수할 수 없습니다.`, true);
    return;
  }
  if (practice.active) {
    if (nextPlayer() !== practice.attempt.settings.userColor) { notice("지금은 AI 차례입니다.", true); return; }
    const prepared = practice.preparedAnalysis;
    if (!prepared?.isFinal || Number(prepared.turnNumber) !== gameDocument.moves.length
      || Number(prepared.positionRevision) !== gameDocument.revision
      || prepared.sessionEpoch !== practice.attempt.sessionEpoch
      || prepared.analysisPurpose !== "user_pre") {
      notice("사용자 착수 전 최종 분석이 아직 준비되지 않았습니다.", true);
      return;
    }
    const token = practice.token;
    const epoch = practice.attempt.sessionEpoch;
    const pending = createPendingRecord(move, prepared);
    practice.pendingRecord = pending;
    practice.preparedAnalysis = null;
    practice.preparedLegalMoves = [];
    gameDocument = appendGameMove(gameDocument, [nextPlayer(), move]);
    const placedRevision = gameDocument.revision;
    setPracticePhase("applying_user", "사용자 착수 적용 중", "busy");
    clearAnalysisDisplay();
    drawBoard();
    const legalityOk = await refreshLegality();
    if (!practiceIdentityMatches(token, epoch, placedRevision)
      || practice.pendingRecord !== pending) return;
    if (!legalityOk) {
      setPracticePhase("error", "금수 오류", "error");
      return;
    }
    if (gameDocument.positionState?.isTerminal) {
      if (!(await finalizePendingRecord(null, gameDocument.positionState))) return;
      finishPractice("game-terminal");
    } else if (hasReachedPracticeLimit()) requestAnalysis("post-user");
    else beginPracticeTurn(practice.token);
    return;
  }
  cancelAnalysis();
  gameDocument = appendGameMove(gameDocument, [nextPlayer(), move]);
  clearAnalysisDisplay();
  drawBoard();
  await refreshLegality();
  if (gameDocument.positionState?.isTerminal) {
    notice(`${terminalResultLabel()} — 종국 뒤 추가 착수와 분석을 차단합니다.`);
  }
}

async function finishPractice(completionReason = "manual") {
  if (!practice.active) return;
  if (practice.pendingRecord || analysisIsLive() || aiTimer) {
    notice("현재 수의 분석·채점과 AI 응수가 끝난 뒤 종료할 수 있습니다.", true);
    return;
  }
  const expectedToken = practice.token;
  const expectedEpoch = practice.attempt.sessionEpoch;
  const expectedRevision = gameDocument.revision;
  const clientSummaryId = crypto.randomUUID();
  clearTimeout(aiTimer);
  practice.attempt = beginPracticeCompletion(practice.attempt, {
    reason: completionReason,
    finalMoves: gameDocument.moves,
    endedAt: new Date().toISOString(),
    terminalState: completionReason === "game-terminal"
      ? gameDocument.positionState
      : null,
  });
  practice.active = false;
  practice.ended = true;
  practice.summaryPending = true;
  setPracticePhase("finishing", "결과 정리 중", "busy");
  elements.sessionComplete.dataset.complete = "false";
  elements.sessionComplete.textContent = "정리 중";
  notice(completionReason === "game-terminal"
    ? `${terminalResultLabel(practice.attempt.completion.terminalState)} — 결과를 정리하고 있습니다.`
    : completionReason === "manual"
      ? `${gameDocument.moves.length}수에서 직접 종료해 서버 평가를 정리하고 있습니다.`
      : `${gameDocument.moves.length}수에 도달해 서버 평가를 정리하고 있습니다.`);
  let summary = null;
  try {
    const response = await fetch("/api/training/summary", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        evaluations: practice.attempt.turnRecords.map(({ analysisSnapshot: _snapshot, ...evaluation }) => evaluation),
        limit: 3, clientSummaryId,
        sessionEpoch: expectedEpoch, positionRevision: expectedRevision,
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.detail || `HTTP ${response.status}`);
    if (body.clientSummaryId !== clientSummaryId || body.sessionEpoch !== expectedEpoch
      || Number(body.positionRevision) !== expectedRevision) {
      throw new Error("요약 응답이 현재 연습 요청과 일치하지 않습니다");
    }
    summary = body;
  } catch (error) {
    if (practice.token !== expectedToken || practice.attempt.sessionEpoch !== expectedEpoch
      || gameDocument.revision !== expectedRevision || !practice.ended || !practice.summaryPending) return;
    notice(`연습은 종료됐지만 서버 요약에 실패했습니다: ${error.message}`, true);
  }
  if (practice.token !== expectedToken || practice.attempt.sessionEpoch !== expectedEpoch
    || gameDocument.revision !== expectedRevision || !practice.ended || !practice.summaryPending) return;
  practice.attempt = finishPracticeCompletion(practice.attempt, summary);
  renderResults(summary);
  if (!practice.saved) {
    saveCompletedPractice();
    practice.saved = true;
  }
  practice.summaryPending = false;
  setPracticePhase("complete", "연습 완료", "");
  elements.sessionComplete.dataset.complete = "true";
  elements.sessionComplete.textContent = "종료";
  notice(completionReason === "game-terminal"
    ? `${gameDocument.moves.length}수 ${terminalResultLabel(practice.attempt.completion.terminalState)} — 연습이 종료되었습니다.`
    : `${gameDocument.moves.length}수 연습이 ${completionReason === "manual" ? "직접" : "자동"} 종료되었습니다.`);
  updateControls();
}

function continueCompletedPractice() {
  if (!practice.ended || practice.summaryPending || practice.active
    || practice.attempt?.completion?.terminalState?.isTerminal) return;
  const continuationMoves = cloneMoves();
  const continuedFromPly = continuationMoves.length;
  elements.stopPly.value = MANUAL_END_VALUE;
  void startPractice(continuationMoves, { continuedFromPly });
}

function renderInstantFeedback(record) {
  elements.instantCard.hidden = false;
  elements.instantState.textContent = record.analysisInsufficient ? "분석 부족" : `Root visits ${record.preRootVisits} 기준`;
  elements.instantFeedback.innerHTML = `
    <div class="feedback-grid">
      <div><small>사용자 / 추천</small><strong>${escapeHtml(record.userMove)} / ${escapeHtml(record.recommendedMove || "—")}</strong></div>
      <div><small>Raw policy · rank</small><strong>${percent(record.rawPolicy)} · ${record.policyRank ? `${record.policyRank}위` : "순위 없음"}</strong></div>
      <div><small>Visits rank (사용자/추천)</small><strong>${visitRankComparison(record)}</strong></div>
      <div><small>Winrate (User) 전→후</small><strong class="${Number(record.winrateDelta) < 0 ? "negative" : "positive"}">${percent(record.beforeUserWinrate)} → ${percent(record.afterUserWinrate)} (${percentagePoints(record.winrateDelta)})</strong></div>
      <div><small>추천 대비 Winrate (User)</small><strong>${record.analysisInsufficient ? "분석 부족" : percentagePoints(record.recommendedWinrateGap)}</strong></div>
    </div>${record.analysisInsufficient ? `<p class="insufficient">분석 부족: ${escapeHtml((record.analysisInsufficientReasons || []).join(", "))}. 확정적인 평가를 표시하지 않습니다.</p>` : ""}`;
}

function visitRankComparison(record) {
  const userRank = record.visitRank ? `${record.visitRank}위` : "후보 밖";
  const recommendedRank = record.recommendedVisitRank ? `${record.recommendedVisitRank}위` : "—";
  const difference = Number.isFinite(Number(record.visitRankDifference))
    ? `${Number(record.visitRankDifference) > 0 ? "+" : ""}${Number(record.visitRankDifference)}`
    : "—";
  return `${userRank} / ${recommendedRank} · 차이 ${difference}`;
}

function renderResults(summary) {
  switchWorkbenchTab("history");
  elements.resultsCard.hidden = false;
  const attempt = practice.attempt;
  const records = attempt.turnRecords;
  const completion = attempt.completion;
  const insufficientCount = summary?.insufficientCount ?? records.filter((record) => record.analysisInsufficient).length;
  const completionLabel = completion.reason === "game-terminal"
    ? terminalResultLabel(completion.terminalState)
    : completion.reason === "manual" ? "직접 종료" : "자동 종료";
  const continuationLabel = attempt.continuedFromPly == null ? "" : ` · ${attempt.continuedFromPly}수부터 이어서`;
  elements.resultSummary.textContent = `${playerName(attempt.settings.userColor)} 연습 · ${gameDocument.moves.length}수 ${completionLabel}${continuationLabel} · 사용자 착수 ${records.length}개 · 분석 부족 ${insufficientCount}개. 절대 점수 없이 실제 Raw policy, Visits rank와 Winrate (User) 변화만 표시합니다.`;
  elements.summaryBody.innerHTML = records.length ? records.map((record) => `
    <tr class="result-review-row" data-ply="${record.ply}" data-insufficient="${record.analysisInsufficient}" tabindex="0" title="저장 복기에서 ${record.ply}수 열기">
      <td>${record.ply} · ${playerName(record.userColor)}</td>
      <td><strong>${escapeHtml(record.userMove)}</strong></td>
      <td>${escapeHtml(record.recommendedMove || "—")}</td>
      <td>${percent(record.rawPolicy)} · ${record.policyRank ? `${record.policyRank}위` : "순위 없음"}</td>
      <td>${visitRankComparison(record)}${record.candidateVisits == null ? "" : ` · ${record.candidateVisits} visits`}</td>
      <td>${percent(record.beforeUserWinrate)}→${percent(record.afterUserWinrate)} <span class="${Number(record.winrateDelta) < 0 ? "negative" : "positive"}">${percentagePoints(record.winrateDelta)}</span></td>
      <td>${record.analysisInsufficient ? '<span class="insufficient">분석 부족</span>' : percentagePoints(-record.recommendedWinrateGap)}</td>
      <td>${record.preRootVisits}/${record.postRootVisits ?? "—"}${record.analysisInsufficient ? " · 부족" : ""}</td>
    </tr>`).join("") : '<tr><td colspan="8" class="empty">평가할 사용자 착수가 없습니다.</td></tr>';
  const mistakes = summary?.topMistakes || [];
  elements.mistakes.innerHTML = mistakes.length
    ? mistakes.map((record) => `<li><button class="mistake-jump" type="button" data-ply="${record.ply}">${record.ply}수 ${escapeHtml(record.userMove)} — 추천 ${escapeHtml(record.recommendedMove)} 대비 Winrate (User) ${percentagePoints(-record.recommendedWinrateGap)} · Raw policy ${record.policyRank ? `${record.policyRank}위` : "순위 없음"} · Visits rank ${record.visitRank ? `${record.visitRank}위` : "후보 밖"}</button></li>`).join("")
    : `<li>${summary ? "충분한 분석에서 추천 대비 확인된 실수가 없습니다." : "서버 요약을 불러오지 못해 실수 순위를 표시하지 않습니다."}</li>`;
  elements.resultsCard.scrollIntoView({ behavior: preferredScrollBehavior(), block: "nearest" });
}

function loadHistory() {
  const readDiagnostics = [];
  let current = null;
  let currentReadFailed = false;
  try {
    current = localStorage.getItem(HISTORY_STORAGE_KEY);
  } catch (error) {
    currentReadFailed = true;
    readDiagnostics.push({ code: "storage-read-error", message: `v2 localStorage 기록을 읽지 못했습니다: ${error.message}` });
  }
  if (!currentReadFailed && current !== null) {
    const loaded = deserializeHistory(current);
    const structurallyInvalid = loaded.diagnostics.some((entry) => ["invalid-json", "invalid-store"].includes(entry.code));
    if (!structurallyInvalid) {
      historyDiagnostics = [...readDiagnostics, ...loaded.diagnostics];
      return loaded.history;
    }
  }
  let legacy = null;
  try {
    legacy = localStorage.getItem(LEGACY_HISTORY_STORAGE_KEY);
  } catch (error) {
    readDiagnostics.push({ code: "storage-read-error", message: `legacy v1 기록도 읽지 못했습니다: ${error.message}` });
    const currentLoaded = currentReadFailed ? { history: clearHistory(), diagnostics: [] } : deserializeHistory(current);
    historyDiagnostics = [...readDiagnostics, ...currentLoaded.diagnostics];
    return currentLoaded.history;
  }
  const legacyLoaded = migrateHistory(legacy);
  const loaded = currentReadFailed ? legacyLoaded : resolveHistorySources(current, legacy);
  historyDiagnostics = [...readDiagnostics, ...loaded.diagnostics];
  const legacyInvalid = legacyLoaded.diagnostics.some((entry) => ["invalid-json", "invalid-legacy-store"].includes(entry.code));
  if (legacy !== null && !legacyInvalid) {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, serializeHistory(loaded.history));
    } catch (error) {
      historyDiagnostics = [...historyDiagnostics, { code: "storage-write-error", message: `v2 마이그레이션 저장 실패: ${error.message}` }];
    }
  }
  return loaded.history;
}

function persistHistory(messagePrefix = "연습 기록") {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, serializeHistory(history));
    return true;
  } catch (error) {
    const diagnostic = { code: "storage-write-error", message: `${messagePrefix} 저장 실패: ${error.message}` };
    historyDiagnostics = [...historyDiagnostics, diagnostic];
    renderHistoryDiagnostics();
    notice(`${messagePrefix}을 화면에는 반영했지만 localStorage 저장에 실패했습니다: ${error.message}`, true);
    return false;
  }
}

function saveCompletedPractice() {
  const attempt = practice.attempt;
  const completion = attempt.completion;
  const entry = {
    id: attempt.sessionEpoch,
    startedAt: attempt.startedAt,
    endedAt: completion.endedAt,
    settings: attempt.settings,
    openingMoves: attempt.openingMoves,
    finalMoves: cloneMoves(completion.finalMoves),
    completion: {
      reason: completion.reason,
      continuedFromPly: attempt.continuedFromPly,
      summary: completion.summary,
    },
    terminalState: completion.terminalState,
    turns: attempt.turnRecords,
  };
  try {
    history = upsertHistory(history, entry);
    persistHistory("연습 결과");
  } catch (error) {
    historyDiagnostics = [...historyDiagnostics, { code: "record-invalid", message: `완료 기록 검증 실패: ${error.message}` }];
    notice(`연습 결과는 표시했지만 v2 기록으로 저장하지 못했습니다: ${error.message}`, true);
  }
  renderHistory();
}

function historyCompletionLabel(entry) {
  if (entry.completion.reason === "game-terminal") return terminalResultLabel(entry.terminalState);
  return entry.completion.reason === "manual" ? "직접 종료" : "자동 종료";
}

function renderHistoryDiagnostics() {
  if (!historyDiagnostics.length) {
    elements.historyDiagnostics.hidden = true;
    elements.historyDiagnostics.textContent = "";
    return;
  }
  elements.historyDiagnostics.hidden = false;
  elements.historyDiagnostics.textContent = historyDiagnostics
    .map((entry) => `[${entry.code}] ${entry.message}`)
    .join(" · ");
}

function renderHistory() {
  const records = history.records;
  elements.historyCount.textContent = String(records.length);
  elements.historyClear.disabled = records.length === 0;
  renderHistoryDiagnostics();
  elements.historyList.innerHTML = records.length ? records.map((entry) => {
    const date = new Date(entry.endedAt);
    const insufficient = entry.turns.filter((turn) => turn.evaluation.analysisInsufficient).length;
    const continuation = Number.isInteger(entry.completion.continuedFromPly)
      ? ` · ${entry.completion.continuedFromPly}수부터 이어서` : "";
    return `<li class="history-entry">
      <button class="history-open" type="button" data-history-id="${escapeHtml(entry.id)}">
        <time datetime="${escapeHtml(entry.endedAt)}">${escapeHtml(date.toLocaleString("ko-KR"))}</time>
        <span><strong>${playerName(entry.settings.userColor)} · ${entry.finalMoves.length}수 ${escapeHtml(historyCompletionLabel(entry))}</strong>${continuation}</span>
        <span>평가 ${entry.turns.length}개${insufficient ? ` · 분석 부족 ${insufficient}` : ""}</span>
      </button>
      <button class="history-delete danger" type="button" data-history-id="${escapeHtml(entry.id)}" aria-label="${escapeHtml(date.toLocaleString("ko-KR"))} 연습 기록 삭제">삭제</button>
    </li>`;
  }).join("") : "<li>아직 완료한 연습이 없습니다.</li>";
  elements.historyList.querySelectorAll(".history-open").forEach((button) => {
    button.addEventListener("click", () => openHistoryReview(button.dataset.historyId));
  });
  elements.historyList.querySelectorAll(".history-delete").forEach((button) => {
    button.addEventListener("click", () => removeHistoryRecord(button.dataset.historyId));
  });
}

function removeHistoryRecord(id) {
  const record = selectHistoryReview(history, id);
  if (!record || !window.confirm(`${new Date(record.endedAt).toLocaleString("ko-KR")} 연습 기록을 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;
  history = deleteHistory(history, id);
  persistHistory("연습 기록 삭제");
  if (reviewSession?.record.id === id) closeHistoryReview();
  renderHistory();
}

function clearAllHistoryRecords() {
  if (!history.records.length || !window.confirm(`저장된 연습 기록 ${history.records.length}판을 모두 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;
  history = clearHistory();
  persistHistory("전체 연습 기록 삭제");
  closeHistoryReview();
  renderHistory();
}

function openHistoryReview(id, ply = null) {
  if (practice.active) {
    notice("진행 중인 AI 연습을 완료하거나 종료한 뒤 저장 기록을 복기하세요.", true);
    return false;
  }
  if (comparisonIsOpen()) clearComparison({ reason: "history-review-opened" });
  const record = selectHistoryReview(history, id);
  if (!record) {
    notice("선택한 저장 기록을 찾을 수 없습니다.", true);
    return false;
  }
  if (analysisIsLive()) cancelAnalysis();
  switchWorkbenchTab("history");
  reviewSession = createHistoryReview(record, ply ?? record.finalMoves.length);
  elements.historyIndex.hidden = true;
  elements.reviewPanel.hidden = false;
  renderHistoryReview();
  updateControls();
  elements.reviewPanel.scrollIntoView({ behavior: preferredScrollBehavior(), block: "nearest" });
  return true;
}

function closeHistoryReview() {
  reviewSession = null;
  elements.reviewPanel.hidden = true;
  elements.historyIndex.hidden = false;
  updateControls();
}

function setReviewPly(ply) {
  if (!reviewSession) return;
  reviewSession = moveHistoryReview(reviewSession, ply);
  renderHistoryReview();
  updateControls();
}

function drawHistoryReviewBoard() {
  const ctx = reviewContext;
  const width = REVIEW_CANVAS_SIZE;
  const height = REVIEW_CANVAS_SIZE;
  const reviewMargin = 36;
  const reviewSpacing = (width - reviewMargin * 2) / (BOARD_SIZE - 1);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#d8a85c";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#493519";
  ctx.lineWidth = 1;
  for (let index = 0; index < BOARD_SIZE; index += 1) {
    const position = reviewMargin + index * reviewSpacing;
    ctx.beginPath(); ctx.moveTo(reviewMargin, position); ctx.lineTo(width - reviewMargin, position); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(position, reviewMargin); ctx.lineTo(position, height - reviewMargin); ctx.stroke();
  }
  ctx.fillStyle = "#493519";
  for (const [x, y] of [[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]]) {
    ctx.beginPath(); ctx.arc(reviewMargin + x * reviewSpacing, reviewMargin + y * reviewSpacing, 3.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.font = "10px -apple-system, sans-serif";
  ctx.fillStyle = "#493519";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let index = 0; index < BOARD_SIZE; index += 1) {
    const position = reviewMargin + index * reviewSpacing;
    ctx.fillText(COLUMNS[index], position, 15);
    ctx.fillText(String(BOARD_SIZE - index), 15, position);
  }
  const selectedMoves = reviewSession ? reviewMoves(reviewSession) : [];
  selectedMoves.forEach(([player, move], index) => {
    const [x, y] = moveToXY(move);
    const px = reviewMargin + x * reviewSpacing;
    const py = reviewMargin + y * reviewSpacing;
    ctx.fillStyle = player === "B" ? "#171a18" : "#f7f8f5";
    ctx.strokeStyle = index === selectedMoves.length - 1 ? "#c43d34" : "#343b37";
    ctx.lineWidth = index === selectedMoves.length - 1 ? 3 : 1;
    ctx.beginPath(); ctx.arc(px, py, reviewSpacing * .42, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = player === "B" ? "#fff" : "#1f2421";
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(index + 1), px, py + 1);
  });
  reviewCanvas.setAttribute("aria-label", reviewSession
    ? `저장된 15×15 Renju 복기판, ${reviewSession.ply}수 위치`
    : "저장된 연습의 읽기 전용 15×15 Renju 복기판");
}

function renderReviewCandidateTable(snapshot) {
  const candidates = snapshot?.candidates || [];
  if (!candidates.length) return '<p class="insufficient">이 기록에는 저장된 후보 분석이 없습니다. 이전 저장 형식에서 변환된 기록일 수 있습니다.</p>';
  return `<div class="table-wrap"><table class="review-candidates">
    <caption class="sr-only">선택한 사용자 착수 직전 저장된 KataGomo 후보와 PV</caption>
    <thead><tr><th>Order</th><th>Move</th><th>Raw policy</th><th>Visits</th><th>Visit share</th><th>Winrate (Black)</th><th>PV</th></tr></thead>
    <tbody>${candidates.map((candidate) => `<tr data-order="${candidate.order ?? ""}">
      <td>${candidate.order ?? "—"}</td><td><strong>${escapeHtml(candidate.move)}</strong></td>
      <td>${percent(candidate.rawPrior)}</td><td>${candidate.visits}</td><td>${percent(candidate.visitShare)}</td>
      <td>${percent(candidate.blackWinrate)}</td><td title="${escapeHtml(candidate.pv.join(" "))}">${escapeHtml(candidate.pv.join(" ") || "—")}</td>
    </tr>`).join("")}</tbody>
  </table></div>`;
}

function renderHistoryReview() {
  if (!reviewSession) return;
  const { record, ply } = reviewSession;
  const turn = reviewTurn(reviewSession);
  const move = record.finalMoves[ply - 1] ?? null;
  const snapshot = turn?.analysisSnapshot ?? null;
  const insufficient = turn?.evaluation.analysisInsufficient === true;
  const mistakes = reviewMistakePlys(reviewSession);
  elements.reviewPosition.textContent = `${ply} / ${record.finalMoves.length}수`;
  elements.reviewSummary.textContent = `${new Date(record.endedAt).toLocaleString("ko-KR")} · ${playerName(record.settings.userColor)} 연습 · ${record.finalMoves.length}수 ${historyCompletionLabel(record)} · 저장 기록을 보는 동안 현재 라이브 보드는 바뀌지 않습니다.`;
  const moveSummary = move
    ? `<h3>${ply}수 · ${playerName(move[0])} ${escapeHtml(move[1])}</h3>`
    : "<h3>0수 · 시작 위치</h3>";
  let evaluation = '<p>이 수에는 사용자 착수 평가가 없습니다. AI 착수 또는 연습 시작 수일 수 있습니다.</p>';
  if (turn) {
    const value = turn.evaluation;
    evaluation = `<div class="review-metrics">
      <div><small>사용자 / 추천</small><strong>${escapeHtml(turn.userMove)} / ${escapeHtml(value.recommendedMove || "—")}</strong></div>
      <div><small>Raw policy · rank</small><strong>${percent(value.rawPolicy)} · ${value.policyRank ? `${value.policyRank}위` : "순위 없음"}</strong></div>
      <div><small>Visits rank</small><strong>${escapeHtml(visitRankComparison(value))}</strong></div>
      <div><small>Winrate (User) 전→후</small><strong>${percent(value.beforeUserWinrate)} → ${percent(value.afterUserWinrate)} (${percentagePoints(value.winrateDelta)})</strong></div>
      <div><small>추천 대비 Winrate</small><strong>${insufficient ? "분석 부족" : percentagePoints(-value.recommendedWinrateGap)}</strong></div>
      <div><small>Root visits 전/후</small><strong>${value.preRootVisits ?? "—"} / ${value.postRootVisits ?? "—"}</strong></div>
      <div><small>저장된 Winrate (Black)</small><strong>${percent(snapshot?.rootInfo?.blackWinrate)}</strong></div>
      <div><small>분석 상태</small><strong>${insufficient ? "분석 부족" : "최종 분석"}</strong></div>
    </div>
    <p>${insufficient ? `분석 부족: ${escapeHtml((value.analysisInsufficientReasons || []).join(", ") || "visits 기준 미달")}` : "아래 후보와 PV는 사용자가 이 수를 두기 직전에 저장한 분석입니다."}</p>`;
  }
  const mistakeLinks = mistakes.length
    ? `<h3>가장 큰 실수</h3><div class="review-mistakes">${mistakes.map((mistakePly) => {
      const mistake = record.turns.find((entry) => entry.ply === mistakePly)?.evaluation;
      return `<button class="secondary review-mistake" type="button" data-review-ply="${mistakePly}">${mistakePly}수 ${escapeHtml(mistake?.userMove || record.finalMoves[mistakePly - 1]?.[1] || "")}</button>`;
    }).join("")}</div>` : "";
  elements.reviewDetail.innerHTML = `${moveSummary}${evaluation}${turn ? "<h3>저장된 후보와 PV</h3>" : ""}${turn ? renderReviewCandidateTable(snapshot) : ""}${mistakeLinks}`;
  elements.reviewDetail.querySelectorAll(".review-mistake").forEach((button) => {
    button.addEventListener("click", () => setReviewPly(Number(button.dataset.reviewPly)));
  });
  elements.reviewFirst.disabled = ply === 0;
  elements.reviewPrev.disabled = ply === 0;
  elements.reviewNext.disabled = ply === record.finalMoves.length;
  elements.reviewLast.disabled = ply === record.finalMoves.length;
  elements.reviewStartPractice.disabled = isReviewTerminalPosition(reviewSession);
  elements.reviewStartPractice.title = isReviewTerminalPosition(reviewSession)
    ? "공식 종국 위치에서는 연습을 시작할 수 없습니다. 이전 수로 이동하세요."
    : "선택한 수순을 새 연습의 시작 위치로 복사합니다.";
  drawHistoryReviewBoard();
}

function setSelectValue(select, value) {
  const stringValue = String(value);
  if ([...select.options].some((option) => option.value === stringValue)) select.value = stringValue;
}

function startPracticeFromReview() {
  if (!reviewSession || isReviewTerminalPosition(reviewSession)) return;
  const selectedMoves = reviewMoves(reviewSession);
  const selectedPly = reviewSession.ply;
  const settings = reviewSession.record.settings;
  elements.mode.value = "practice";
  setSelectValue(elements.userColor, settings.userColor);
  setSelectValue(elements.gradingMode, settings.gradingMode);
  setSelectValue(elements.maxVisits, settings.maxVisits);
  const savedEnd = settings.endCondition;
  const stopValue = savedEnd.kind === "ply" && selectedPly < savedEnd.ply
    ? savedEnd.ply : MANUAL_END_VALUE;
  setSelectValue(elements.stopPly, stopValue);
  closeHistoryReview();
  updateModeUi();
  notice(`${selectedPly}수 저장 위치를 라이브 보드와 새 연습 시작점으로 복사합니다.`);
  void startPractice(selectedMoves, { continuedFromPly: selectedPly });
}

const VIEW_ACTION_ELEMENTS = Object.freeze({
  "practice-start": elements.practiceStart,
  analyze: elements.analyze,
  cancel: elements.cancel,
  "continue-practice": elements.continuePractice,
  "new-opening": elements.newOpening,
  reset: elements.reset,
  "review-start-practice": elements.reviewStartPractice,
  "retry-legality": elements.retryLegality,
  "retry-training": elements.retryTraining,
});

function renderViewState(view) {
  if (view.clearAnalysis && (currentAnalysis || allCandidates.length || fullPolicy.length)) {
    clearAnalysisDisplay({ keepStatus: true });
  }
  elements.terminalBanner.hidden = !view.terminal.visible;
  if (view.terminal.visible) {
    elements.terminalBanner.dataset.outcome = view.terminal.outcome || "terminal";
    elements.terminalTitle.textContent = view.terminal.title;
    elements.terminalMessage.textContent = view.terminal.message;
  } else {
    delete elements.terminalBanner.dataset.outcome;
  }

  elements.taskBanner.className = `task-banner${view.task.tone === "neutral" ? "" : ` ${view.task.tone}`}`;
  elements.taskBanner.dataset.viewState = view.key;
  elements.taskTitle.textContent = view.task.title;
  elements.taskMessage.textContent = view.task.message;

  for (const [id, element] of Object.entries(VIEW_ACTION_ELEMENTS)) {
    const action = view.actions[id];
    element.hidden = !action.visible;
    element.disabled = !action.enabled;
    element.classList.toggle("primary", action.primary);
    element.dataset.primary = String(action.primary);
    if (!element.classList.contains("danger") && !element.classList.contains("text-button")) {
      element.classList.toggle("secondary", !action.primary);
    }
  }

  const boardInteractive = canPlaceMove(view);
  canvas.classList.toggle("locked", !boardInteractive);
  canvas.dataset.interaction = boardInteractive
    ? "ready"
    : view.task.tone === "busy" ? "busy" : "blocked";
  canvas.dataset.primary = String(view.primaryAction === "board" && boardInteractive);
  canvas.setAttribute("aria-disabled", String(!boardInteractive));
  if (view.clearAnalysis) {
    elements.responseKind.textContent = "종국 · MCTS 미실행";
    setAnalysisStatus("종국 · MCTS 미실행", "neutral");
  }
}

function updateControls() {
  const connected = socket?.readyState === WebSocket.OPEN;
  const busy = analysisIsLive() || practiceTransitionBusy();
  const comparisonLocked = comparisonIsSelecting() || comparisonUi.mode === "running";
  const settingLocked = practice.active || practice.summaryPending || Boolean(reviewSession);
  elements.kifuImport.disabled = kifuImporting;
  elements.kifuFile.disabled = kifuImporting;
  elements.mode.disabled = settingLocked || analysisIsLive() || comparisonLocked;
  elements.maxVisits.disabled = settingLocked || comparisonUi.mode === "running";
  const practiceSettingsDisabled = settingLocked || isFreeAnalysisMode();
  for (const element of [elements.userColor, elements.stopPly, elements.gradingMode]) {
    element.disabled = practiceSettingsDisabled;
  }
  updateModeUi();
  elements.practiceStart.textContent = practice.ended ? "현재 위치에서 새 AI 연습" : "이 위치에서 AI 연습 시작";
  elements.analyze.textContent = practice.active ? "현재 단계 재분석" : "현재 위치 분석";
  elements.practiceFinish.hidden = !practice.active;
  elements.practiceFinish.disabled = !connected || engineState !== "ready" || !practice.active || busy
    || practice.phase !== "user_turn" || Boolean(practice.pendingRecord) || Boolean(aiTimer)
    || practice.attempt.turnRecords.length === 0 || Boolean(reviewSession);
  const baseLength = practice.active || practice.ended ? practice.attempt.openingMoves.length : 0;
  elements.undo.disabled = gameDocument.moves.length <= baseLength || busy
    || legalityState !== "ready" || Boolean(reviewSession);
  elements.sameStart.disabled = !connected || engineState !== "ready" || trainingContractState !== "ready"
    || practice.active || !practice.ended || practice.summaryPending || Boolean(reviewSession);
  renderViewState(currentViewState());
  if (comparisonIsOpen()) {
    const selecting = comparisonIsSelecting();
    canvas.classList.toggle("locked", !selecting);
    canvas.dataset.interaction = selecting ? "compare" : comparisonUi.mode === "running" ? "busy" : "blocked";
    canvas.dataset.primary = String(selecting);
    canvas.setAttribute("aria-disabled", String(!selecting));
    elements.practiceStart.disabled = true;
    elements.analyze.disabled = true;
  }
  elements.comparisonSelect.disabled = !comparisonCanOpen() || comparisonUi.mode === "running";
  elements.comparisonRun.disabled = !comparisonIsSelecting()
    || !comparisonUi.moveA || !comparisonUi.moveB || !connected || engineState !== "ready";
  elements.comparisonCancel.disabled = comparisonUi.mode !== "running";
  elements.sizeMetric.disabled = comparisonIsOpen();
  elements.topCount.disabled = comparisonIsOpen();
  elements.comparisonCard.classList.toggle("is-error", comparisonUi.mode === "error");
  renderWorkbenchNavigation();
}
function canPlaceMove(view = currentViewState()) {
  if (comparisonIsOpen()) return false;
  if (!view.boardInteractive) return false;
  if (!practice.active) return true;
  return practice.phase === "user_turn" && nextPlayer() === practice.attempt.settings.userColor
    && practice.preparedAnalysis?.isFinal;
}

async function undoMove() {
  if (comparisonIsOpen()) clearComparison({ reason: "undo" });
  cancelAnalysis();
  if (!gameDocument.moves.length) return;
  if (practice.active || practice.ended) {
    const wasEnded = practice.ended;
    const previousAttempt = practice.attempt;
    practice.active = true;
    practice.ended = false;
    practice.summaryPending = false;
    practice.saved = false;
    practice.token += 1;
    let targetPly = gameDocument.moves.length;
    do {
      const removed = gameDocument.moves[targetPly - 1];
      targetPly -= 1;
      if (removed?.[0] === previousAttempt.settings.userColor) break;
    } while (targetPly > previousAttempt.openingMoves.length);
    gameDocument = truncateGameDocument(gameDocument, targetPly);
    const retainedRecords = previousAttempt.turnRecords.filter((record) => record.ply <= targetPly);
    if (wasEnded) {
      practice.attempt = createPracticeAttempt({
        sessionEpoch: crypto.randomUUID(),
        settings: previousAttempt.settings,
        openingMoves: previousAttempt.openingMoves,
        startedAt: new Date().toISOString(),
        continuedFromPly: previousAttempt.continuedFromPly,
      });
      for (const record of retainedRecords) {
        practice.attempt = appendPracticeTurnRecord(practice.attempt, record);
      }
    } else {
      practice.attempt = trimPracticeTurnRecords(previousAttempt, targetPly);
    }
    practice.pendingRecord = null;
    practice.preparedAnalysis = null;
    practice.preparedLegalMoves = [];
    setPracticePhase("undoing", "무르기 적용 중", "busy");
    elements.resultsCard.hidden = true;
    elements.instantCard.hidden = true;
    elements.sessionComplete.dataset.complete = "false";
    elements.sessionComplete.textContent = "진행 중";
  } else {
    gameDocument = truncateGameDocument(gameDocument, gameDocument.moves.length - 1);
  }
  clearAnalysisDisplay();
  drawBoard();
  const expectedToken = practice.token;
  const expectedEpoch = practice.attempt?.sessionEpoch ?? null;
  const expectedRevision = gameDocument.revision;
  const legalityOk = await refreshLegality();
  if (practice.active) {
    if (!practiceIdentityMatches(expectedToken, expectedEpoch, expectedRevision)) return;
    if (!legalityOk) {
      setPracticePhase("error", "금수 오류", "error");
      return;
    }
    beginPracticeTurn(expectedToken);
  }
}
async function resetBoard() {
  const confirmReset = resetNeedsConfirmation({
    moveCount: gameDocument.moves.length,
    practiceActive: practice.active,
    practiceEnded: practice.ended,
    analysisPresent: analysisIsLive() || Boolean(currentAnalysis)
      || allCandidates.length > 0 || fullPolicy.length > 0 || comparisonIsOpen(),
  });
  if (confirmReset && !window.confirm("현재 수순과 연습·분석 상태를 지우고 새 판을 시작할까요?")) {
    return false;
  }
  if (comparisonIsOpen()) clearComparison({ reason: "board-reset" });
  switchWorkbenchTab("analysis");
  cancelAnalysis({ preservePractice: false });
  practice = emptyPractice(practice.token + 1);
  gameDocument = replaceGameMoves(gameDocument, []);
  elements.resultsCard.hidden = true;
  elements.instantCard.hidden = true;
  elements.sessionComplete.dataset.complete = "false";
  elements.sessionComplete.textContent = "진행 전";
  setPracticePhase(elements.mode.value === "analysis" ? "analysis" : "setup", elements.mode.value === "analysis" ? "분석 전용" : "설정 중", "neutral");
  clearAnalysisDisplay();
  notice("빈 오목판으로 초기화했습니다.");
  await refreshLegality();
  return true;
}

async function importRenjuKifuFile(file) {
  if (!file) return false;
  const generation = ++kifuImportGeneration;
  const originalRevision = gameDocument.revision;
  kifuImporting = true;
  updateControls();
  notice(`${file.name} 기보를 읽고 공식 Renju 판정을 확인합니다.`);
  try {
    validateKifuFileMetadata(file);
    const kifu = parseRenjuKifuJson(await file.text());
    const positionState = await requestOfficialPositionState(kifu.moves);
    if (generation !== kifuImportGeneration) return false;
    if (gameDocument.revision !== originalRevision) {
      throw new Error("기보를 확인하는 동안 현재 판이 바뀌었습니다. 다시 불러오세요");
    }
    const replacesWork = gameDocument.moves.length > 0 || practice.active || practice.ended
      || analysisIsLive() || Boolean(currentAnalysis) || comparisonIsOpen() || Boolean(reviewSession);
    if (replacesWork && !window.confirm("현재 수순과 연습·분석 상태를 불러온 기보로 교체할까요?")) {
      notice("기보 불러오기를 취소했습니다.");
      return false;
    }

    if (comparisonIsOpen()) clearComparison({ reason: "kifu-imported" });
    if (reviewSession) closeHistoryReview();
    cancelAnalysis({ preservePractice: false });
    clearPracticeRecovery();
    practice = emptyPractice(practice.token + 1);
    legalityGeneration += 1;
    gameDocument = replaceGameMoves(gameDocument, kifu.moves);
    elements.mode.value = "analysis";
    updateModeUi();
    switchWorkbenchTab("analysis");
    elements.resultsCard.hidden = true;
    elements.instantCard.hidden = true;
    elements.sessionComplete.dataset.complete = "false";
    elements.sessionComplete.textContent = "기보 위치";
    clearAnalysisDisplay();
    if (!applyPositionState(positionState, gameDocument.revision)) {
      throw new Error("공식 판정 결과를 현재 기보 위치에 적용하지 못했습니다");
    }
    setPracticePhase("analysis", "기보 위치", "neutral");
    notice(`${file.name} · ${kifu.moves.length}수를 불러왔습니다. 무르거나 현재 위치를 분석할 수 있습니다.`);
    return true;
  } catch (error) {
    if (generation === kifuImportGeneration) {
      notice(`기보 불러오기 실패: ${error.message}`, true);
    }
    return false;
  } finally {
    if (generation === kifuImportGeneration) {
      kifuImporting = false;
      elements.kifuFile.value = "";
      updateControls();
    }
  }
}

function canvasPoint(event) {
  return clientPointToCanvas(
    event,
    canvas.getBoundingClientRect(),
    BOARD_CANVAS_SIZE,
  );
}
function intersectionAtPoint(px, py) {
  const x = Math.round((px - margin) / spacing);
  const y = Math.round((py - margin) / spacing);
  if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return null;
  if (Math.hypot(px - (margin + x * spacing), py - (margin + y * spacing)) > spacing * .44) return null;
  return { x, y, move: xyToMove(x, y) };
}

canvas.addEventListener("pointermove", (event) => {
  if (comparisonIsOpen()) {
    if (hoveredCandidateMove !== null) focusCandidate(null, false);
    return;
  }
  const { x, y } = canvasPoint(event);
  const hit = candidateHitAtPoint(candidateHitAreas, { x, y });
  const next = hit?.move || null;
  if (next !== hoveredCandidateMove) focusCandidate(next, false);
});
canvas.addEventListener("pointerleave", () => focusCandidate(null, false));
canvas.addEventListener("click", async (event) => {
  const point = canvasPoint(event);
  const intersection = intersectionAtPoint(point.x, point.y);
  if (comparisonIsSelecting()) {
    if (!intersection) return;
    boardCursor = { x: intersection.x, y: intersection.y };
    chooseComparisonMove(intersection.move);
    return;
  }
  if (comparisonIsOpen()) {
    notice("수 비교 결과를 보는 중입니다. 비교 초기화 또는 두 수 다시 선택을 사용하세요.", true);
    return;
  }
  const candidateHit = candidateHitAtPoint(candidateHitAreas, point);
  const intent = resolveBoardPointerIntent({
    candidateHit,
    intersection,
    boardInteractive: canPlaceMove(),
  });
  if (intent.kind === "focus-candidate") {
    focusCandidate(intent.move, true);
    return;
  }
  if (intent.kind === "none") return;
  if (intersection) boardCursor = { x: intersection.x, y: intersection.y };
  if (intent.kind === "blocked") {
    if (practice.ended) notice("완료된 연습판입니다. 현재 판 이어서 연습, 같은 시작점 또는 새 판 버튼을 사용하세요.", true);
    else notice(practice.active ? "최종 분석 또는 AI 착수를 기다리는 중입니다." : "분석 취소 또는 금수 확인을 기다려 주세요.", true);
    return;
  }
  await attemptMove(intent.move);
});
canvas.addEventListener("keydown", async (event) => {
  const deltas = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (deltas[event.key]) {
    event.preventDefault();
    boardCursor.x = Math.max(0, Math.min(BOARD_SIZE - 1, boardCursor.x + deltas[event.key][0]));
    boardCursor.y = Math.max(0, Math.min(BOARD_SIZE - 1, boardCursor.y + deltas[event.key][1]));
    drawBoard();
  } else if (["Enter", " "].includes(event.key)) {
    event.preventDefault();
    if (comparisonIsSelecting()) chooseComparisonMove(xyToMove(boardCursor.x, boardCursor.y));
    else if (canPlaceMove()) await attemptMove(xyToMove(boardCursor.x, boardCursor.y));
    else notice("현재는 착수할 수 없습니다.", true);
  }
});
canvas.addEventListener("focus", drawBoard);
canvas.addEventListener("blur", drawBoard);

elements.practiceStart.addEventListener("click", () => startPractice());
elements.retryLegality.addEventListener("click", () => { void refreshLegality(); });
elements.retryTraining.addEventListener("click", () => { void refreshTrainingOptions(); });
elements.glossaryLink.addEventListener("click", () => { elements.glossary.open = true; });
elements.analyze.addEventListener("click", () => {
  if (!practice.active) requestAnalysis("manual");
  else if (nextPlayer() === practice.attempt.settings.userColor && !practice.pendingRecord) requestAnalysis("prepare-user");
  else requestAnalysis(hasReachedPracticeLimit() ? "post-user" : "ai-turn");
});
elements.practiceFinish.addEventListener("click", () => {
  if (elements.practiceFinish.disabled) {
    notice("현재 수의 채점과 AI 응수가 끝나 사용자 차례가 되면 종료할 수 있습니다.", true);
    return;
  }
  void finishPractice("manual");
});
elements.cancel.addEventListener("click", () => {
  if (comparisonUi.mode === "running") {
    cancelComparisonRun();
    return;
  }
  cancelAnalysis();
  if (practice.active) setPracticePhase("error", "분석 취소", "error");
  notice("분석을 취소했습니다. 현재 위치 분석으로 다시 시작할 수 있습니다.");
});
elements.undo.addEventListener("click", undoMove);
elements.reset.addEventListener("click", resetBoard);
elements.kifuImport.addEventListener("click", () => {
  elements.kifuFile.value = "";
  elements.kifuFile.click();
});
elements.kifuFile.addEventListener("change", () => {
  const file = elements.kifuFile.files?.[0];
  if (file) void importRenjuKifuFile(file);
});
elements.continuePractice.addEventListener("click", continueCompletedPractice);
elements.sameStart.addEventListener("click", () => startPractice(practice.attempt.openingMoves));
elements.newOpening.addEventListener("click", () => startPractice([]));
elements.historyClear.addEventListener("click", clearAllHistoryRecords);
elements.reviewFirst.addEventListener("click", () => setReviewPly(0));
elements.reviewPrev.addEventListener("click", () => setReviewPly((reviewSession?.ply ?? 0) - 1));
elements.reviewNext.addEventListener("click", () => setReviewPly((reviewSession?.ply ?? 0) + 1));
elements.reviewLast.addEventListener("click", () => {
  if (reviewSession) setReviewPly(reviewSession.record.finalMoves.length);
});
elements.reviewClose.addEventListener("click", closeHistoryReview);
elements.reviewStartPractice.addEventListener("click", startPracticeFromReview);
elements.comparisonSelect.addEventListener("click", openComparisonSelection);
elements.comparisonSlotA.addEventListener("click", () => chooseComparisonSlot("a"));
elements.comparisonSlotB.addEventListener("click", () => chooseComparisonSlot("b"));
elements.comparisonRun.addEventListener("click", runComparison);
elements.comparisonCancel.addEventListener("click", cancelComparisonRun);
elements.comparisonClear.addEventListener("click", () => clearComparison({ announce: true }));
elements.comparisonPreviewA.addEventListener("click", () => previewComparison("a"));
elements.comparisonPreviewB.addEventListener("click", () => previewComparison("b"));
elements.comparisonPreviewClear.addEventListener("click", () => previewComparison(null));
for (const [tabName, button] of Object.entries(WORKBENCH_BUTTONS)) {
  button.addEventListener("click", () => switchWorkbenchTab(tabName));
  button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const target = adjacentTab(tabName, event.key, WORKBENCH_TAB_ORDER);
    switchWorkbenchTab(target, { focus: true });
  });
}
for (const [viewName, button] of Object.entries(ANALYSIS_VIEW_BUTTONS)) {
  button.addEventListener("click", () => switchAnalysisView(viewName));
  button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const target = adjacentTab(viewName, event.key, ANALYSIS_VIEW_ORDER);
    switchAnalysisView(target, { focus: true });
  });
}
elements.summaryBody.addEventListener("click", (event) => {
  const row = event.target.closest("[data-ply]");
  if (row && practice.attempt?.sessionEpoch) openHistoryReview(practice.attempt.sessionEpoch, Number(row.dataset.ply));
});
elements.summaryBody.addEventListener("keydown", (event) => {
  const row = event.target.closest("[data-ply]");
  if (row && ["Enter", " "].includes(event.key)) {
    event.preventDefault();
    if (practice.attempt?.sessionEpoch) openHistoryReview(practice.attempt.sessionEpoch, Number(row.dataset.ply));
  }
});
elements.mistakes.addEventListener("click", (event) => {
  const button = event.target.closest("[data-ply]");
  if (button && practice.attempt?.sessionEpoch) openHistoryReview(practice.attempt.sessionEpoch, Number(button.dataset.ply));
});
elements.clearPv.addEventListener("click", () => { pinnedCandidateMove = null; hoveredCandidateMove = null; renderCandidateFocus(); renderCandidates(); drawBoard(); });
elements.sizeMetric.addEventListener("change", drawBoard);
elements.topCount.addEventListener("change", () => { renderCandidates(); renderRawPolicy(); drawBoard(); });
elements.mode.addEventListener("change", () => {
  if (comparisonIsOpen()) clearComparison({ reason: "mode-changed" });
  switchWorkbenchTab("analysis");
  cancelAnalysis();
  clearAnalysisDisplay();
  if (elements.mode.value === "analysis" && practice.ended) {
    practice = emptyPractice(practice.token + 1);
    elements.resultsCard.hidden = true;
    elements.instantCard.hidden = true;
    elements.sessionComplete.dataset.complete = "false";
    elements.sessionComplete.textContent = "진행 전";
  }
  setPracticePhase(elements.mode.value === "analysis" ? "analysis" : "setup", elements.mode.value === "analysis" ? "양쪽 직접" : "설정 중", "neutral");
  elements.practiceStart.disabled = elements.mode.value !== "practice";
  notice(elements.mode.value === "analysis" ? "사용자 색 없이 흑·백을 모두 직접 착수합니다. AI는 자동 착수하지 않습니다." : "현재 위치를 시작점으로 ‘AI 연습 시작’을 누르면 자동 응수가 켜집니다.");
  drawBoard();
  updateControls();
});
elements.userColor.addEventListener("change", () => {
  if (currentAnalysis) requestAnalysis("manual");
});

function updateEngineBadge(engine) {
  if (!engine) return;
  const labels = {
    starting: "엔진 시작 중",
    ready: "엔진 준비됨",
    analyzing: "엔진 분석 중",
    restarting: "엔진 재시작 중",
    stopping: "엔진 종료 중",
    stopped: "엔진 중지됨",
    error: "엔진 오류",
  };
  const normalizedState = Object.hasOwn(labels, engine.state) ? engine.state : "unknown";
  engineState = normalizedState;
  const label = labels[normalizedState] || "엔진 상태 확인 중";
  const className = normalizedState === "error"
    ? "status error"
    : ["starting", "analyzing", "restarting", "stopping", "unknown"].includes(normalizedState)
      ? "status busy"
      : normalizedState === "stopped" ? "status neutral" : "status";
  if (elements.engineStatus.textContent !== label) elements.engineStatus.textContent = label;
  elements.engineStatus.className = className;
  elements.engineDiagnosticState.textContent = `${label} (${normalizedState})`;
  if (Object.hasOwn(engine, "pid")) elements.enginePid.textContent = String(engine.pid ?? "—");
  if (Object.hasOwn(engine, "restartCount") || Object.hasOwn(engine, "restartLimit")) {
    elements.engineRestarts.textContent = `${engine.restartCount ?? "—"} / ${engine.restartLimit ?? "—"}`;
  }
  if (Object.hasOwn(engine, "lastError")) elements.engineLastError.textContent = engine.lastError || "—";
}
async function refreshStatus() {
  try {
    const response = await fetch("/api/status");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    updateEngineBadge((await response.json()).engine);
    updateControls();
  } catch (error) {
    engineState = "error";
    elements.engineStatus.textContent = `서버 상태 오류: ${error.message}`;
    elements.engineStatus.className = "status error";
    elements.engineDiagnosticState.textContent = "서버 상태 확인 실패";
    elements.enginePid.textContent = "—";
    elements.engineRestarts.textContent = "—";
    elements.engineLastError.textContent = error.message;
    updateControls();
  }
}

async function refreshTrainingOptions() {
  trainingContractState = "pending";
  updateControls();
  try {
    const response = await fetch("/api/training/options");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const options = await response.json();
    if (options.winratePerspective !== "BLACK" || options.scoreContract !== "metrics-only-no-opaque-score") {
      throw new Error("지원하지 않는 채점/승률 계약");
    }
    if (options.manualFinishSupported !== true || options.manualEndValue !== MANUAL_END_VALUE) {
      throw new Error("서버가 직접 종료 연습 계약을 지원하지 않습니다");
    }
    minimumGradeVisits = Number(options.minimumCandidateVisits);
    if (!Number.isInteger(minimumGradeVisits) || minimumGradeVisits < 0) throw new Error("잘못된 최소 visits");
    trainingContractState = "ready";
    updateControls();
  } catch (error) {
    trainingContractState = "error";
    notice(`연습 설정 계약을 확인하지 못했습니다: ${error.message}`, true);
    updateControls();
  }
}

renderHistory();
renderComparisonLab();
renderWorkbenchNavigation();
drawBoard();
refreshLegality();
connectWebSocket();
refreshStatus();
refreshTrainingOptions();
updateControls();
setInterval(refreshStatus, 5000);
