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
  isAnalysisResponseCurrent,
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

const BOARD_SIZE = 15;
const POLICY_LENGTH = 226;
const COLUMNS = "ABCDEFGHJKLMNOP";
const MIN_GRADE_VISITS = 50;
const canvas = document.querySelector("#board");
const context = canvas.getContext("2d");
const reviewCanvas = document.querySelector("#review-board");
const reviewContext = reviewCanvas.getContext("2d");
const margin = 48;
const spacing = (canvas.width - margin * 2) / (BOARD_SIZE - 1);

const byId = (id) => document.querySelector(`#${id}`);
const elements = {
  engineStatus: byId("engine-status"), analysisStatus: byId("analysis-status"),
  practicePhase: byId("practice-phase"), legalityStatus: byId("legality-status"),
  actionNotice: byId("action-notice"), nextPlayer: byId("next-player"),
  plyCount: byId("ply-count"), turnOwner: byId("turn-owner"),
  sessionComplete: byId("session-complete"), boardSummary: byId("board-summary"),
  mode: byId("mode"), userColor: byId("user-color"), stopPly: byId("stop-ply"),
  gradingMode: byId("grading-mode"), maxVisits: byId("max-visits"),
  userColorSetting: byId("user-color-setting"), stopPlySetting: byId("stop-ply-setting"),
  gradingModeSetting: byId("grading-mode-setting"), modeHelp: byId("mode-help"),
  sizeMetric: byId("size-metric"), topCount: byId("top-count"),
  practiceStart: byId("practice-start"), practiceFinish: byId("practice-finish"),
  analyze: byId("analyze"), cancel: byId("cancel"),
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
};

let gameDocument = createGameDocument();
let forbiddenMoves = new Set();
let legalMoves = [];
let legalityState = "pending";
let legalityGeneration = 0;
let minimumGradeVisits = MIN_GRADE_VISITS;
let trainingContractReady = false;
let allCandidates = [];
let fullPolicy = [];
let currentAnalysis = null;
let candidateHitAreas = [];
let hoveredCandidateMove = null;
let pinnedCandidateMove = null;
let boardCursor = { x: 7, y: 7 };
let socket;
let reconnectTimer;
let analysisJob = null;
let analysisContext = null;
let aiTimer = null;
let historyDiagnostics = [];
let history = loadHistory();
let reviewSession = null;

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
function analysisErrorTargetsLiveJob(message) {
  return analysisIsLive()
    && typeof message?.clientRequestId === "string"
    && message.clientRequestId === analysisJob.clientRequestId;
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
    trainingContractReady,
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
  elements.userWinrateRow.hidden = freeAnalysis;
  elements.modeHelp.textContent = freeAnalysis
    ? "사용자 색과 AI 자동 착수 없이 흑·백을 번갈아 직접 둡니다. 각 위치에서 ‘현재 위치 분석’을 누르세요."
    : "사용자 색을 정하고 반대 색은 KataGomo가 자동 착수합니다.";
}
function notice(text, isError = false) {
  elements.actionNotice.textContent = text;
  elements.actionNotice.className = `notice action-notice${isError ? " error" : ""}`;
}

function drawBoard() {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#d8a85c";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#493519";
  context.lineWidth = 1.35;
  for (let index = 0; index < BOARD_SIZE; index += 1) {
    const position = margin + index * spacing;
    context.beginPath(); context.moveTo(margin, position); context.lineTo(canvas.width - margin, position); context.stroke();
    context.beginPath(); context.moveTo(position, margin); context.lineTo(position, canvas.height - margin); context.stroke();
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

  drawPv();
  drawCandidateOverlays();

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

    const box = findLabelBox(px, py, labelBoxes, index);
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
    context.font = "9px ui-monospace, monospace";
    context.fillText(`V ${percent(candidate.visitShare)}`, box.x + 4, box.y + 21);
    context.fillText(`P ${percent(candidate.rawPrior)}`, box.x + 4, box.y + 32);
    context.fillText(`B ${percent(candidate.blackWinrate)}`, box.x + 4, box.y + 43);
    context.textAlign = "center";
    candidateHitAreas.push({ move: candidate.move, px, py, radius: Math.max(radius, 18), box });
  });
}

function findLabelBox(px, py, existing, index) {
  const width = 104;
  const height = 48;
  const offsets = [[18, -52], [-122, -52], [18, 8], [-122, 8], [-52, -76], [-52, 28]];
  let best;
  let bestPenalty = Infinity;
  offsets.forEach(([dx, dy], offsetIndex) => {
    const box = {
      x: Math.max(29, Math.min(canvas.width - width - 6, px + dx)),
      y: Math.max(5, Math.min(canvas.height - height - 5, py + dy)), width, height,
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
  canvas.setAttribute(
    "aria-label",
    `15×15 Renju 오목판. ${summary}. 키보드 커서 ${xyToMove(boardCursor.x, boardCursor.y)}`,
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
    elements.legalityStatus.textContent = `공식 BoardHistory 판정: ${terminalResultLabel(state)}`;
    if (!wasTerminal || currentAnalysis || allCandidates.length || fullPolicy.length) {
      clearAnalysisDisplay({ keepStatus: true });
    }
    setAnalysisStatus("종국 · MCTS 미실행", "neutral");
    elements.responseKind.textContent = "종국 · MCTS 미실행";
  } else {
    elements.legalityStatus.textContent = nextPlayer() === "B"
      ? `공식 Board::isForbidden() 결과: 흑 금수 ${forbiddenMoves.size}곳`
      : "백 차례: 흑 금수 규칙을 적용하지 않습니다.";
  }
  drawBoard();
  updateControls();
  return true;
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
    const response = await fetch("/api/position", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        moves: requestedMoves,
        nextPlayer: requestedMoves.length % 2 === 0 ? "B" : "W",
      }),
    });
    const body = await response.json();
    if (generation !== legalityGeneration) return false;
    if (!response.ok) throw new Error(body.detail || `HTTP ${response.status}`);
    if (!applyPositionState(body, requestedRevision)) return false;
  } catch (error) {
    if (generation !== legalityGeneration) return false;
    forbiddenMoves = new Set();
    legalMoves = [];
    legalityState = "error";
    gameDocument = withoutOfficialPositionState(gameDocument);
    elements.legalityStatus.textContent = `금수 helper 오류 — 안전을 위해 착수를 차단합니다: ${error.message}`;
    elements.legalityStatus.classList.add("error");
  }
  drawBoard();
  updateControls();
  return legalityState === "ready";
}

function connectWebSocket() {
  clearTimeout(reconnectTimer);
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${scheme}://${location.host}/ws/analysis`);
  socket.addEventListener("open", () => {
    setAnalysisStatus("연결됨", "neutral");
    updateControls();
  });
  socket.addEventListener("close", () => {
    const interruptedLiveAnalysis = analysisIsLive();
    if (interruptedLiveAnalysis) {
      analysisJob = transitionAnalysisJob(analysisJob, "failed");
      discardIncompleteAnalysis("연결 끊김 · 부분 결과 폐기");
    }
    clearTimeout(aiTimer);
    aiTimer = null;
    setAnalysisStatus("연결 끊김", "error");
    if (practice.active) {
      practice.token += 1;
      setPracticePhase("error", "연결 오류", "error");
      notice("분석 연결이 끊겼습니다. 재연결 후 ‘현재 위치 분석’을 눌러 계속하세요.", true);
    }
    reconnectTimer = setTimeout(connectWebSocket, 1500);
    updateControls();
  });
  socket.addEventListener("message", (event) => {
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

function handleMessage(message) {
  if (message.type === "position") {
    if (!analysisJob || !analysisContext || !isAnalysisResponseCurrent(
      analysisJob, message, currentAnalysisIdentity(),
    )) return;
    const responseRevision = analysisJob.positionRevision;
    analysisJob = transitionAnalysisJob(analysisJob, "interrupted");
    if (message.gameState
      && !applyPositionState(message.gameState, responseRevision)) return;
    setAnalysisStatus("종국 · MCTS 미실행", "neutral");
    notice(`${terminalResultLabel(message.gameState)} — 공식 종국 위치는 MCTS에 보내지 않습니다.`);
    if (practice.active) void beginPracticeTurn(practice.token);
    updateControls();
    return;
  }
  if (message.type === "warning") {
    if (!analysisJob || !isAnalysisResponseCurrent(
      analysisJob, message, currentAnalysisIdentity(),
    )) return;
    setAnalysisStatus(`${message.code || "engine_warning"}: ${message.message}`, "busy");
    notice(`엔진 경고: ${message.message}`);
    updateControls();
    return;
  }
  if (message.type === "error") {
    if (!analysisErrorTargetsLiveJob(message)) {
      if (analysisIsLive() && !message.clientRequestId) {
        notice(`보조 WebSocket 오류(${message.code || "unknown"})는 현재 분석 요청과 연결되지 않아 분석을 계속합니다.`, true);
      }
      return;
    }
    analysisJob = transitionAnalysisJob(analysisJob, "failed");
    discardIncompleteAnalysis("오류 · 부분 결과 폐기");
    setAnalysisStatus(`${message.code || "engine_error"}: ${message.message}`, "error");
    if (practice.active) setPracticePhase("error", "분석 오류", "error");
    notice(`엔진 오류: ${message.message}`, true);
    updateControls();
    return;
  }
  if (message.type === "status") {
    updateEngineBadge(message.engine);
    if (message.status === "analyzing") {
      if (!analysisJob || !isAnalysisResponseCurrent(
        analysisJob, message, currentAnalysisIdentity(),
      )) return;
      analysisJob = transitionAnalysisJob(analysisJob, "streaming");
      elements.requestId.textContent = message.requestId || "—";
      setAnalysisStatus("분석 중", "busy");
    } else if (message.status === "canceled") {
      if (analysisJob?.state !== "canceled"
        || message.clientRequestId !== analysisJob.clientRequestId) return;
      setAnalysisStatus("취소됨", "neutral");
      elements.responseKind.textContent = "취소됨";
    } else if (["idle", "connected"].includes(message.status) && !analysisIsLive()) {
      setAnalysisStatus(message.status === "connected" ? "연결됨" : "분석 대기", "neutral");
    }
    updateControls();
    return;
  }
  if (message.type !== "analysis" || !analysisJob || !analysisContext) return;
  if (gameDocument.positionState?.isTerminal) {
    cancelAnalysis();
    clearAnalysisDisplay({ keepStatus: true });
    updateControls();
    return;
  }
  if (!isAnalysisResponseCurrent(analysisJob, message, currentAnalysisIdentity())) return;
  const meta = analysisContext;
  if (meta.positionKey !== positionKey()) return;
  const metadataMismatch = Number(message.positionRevision) !== analysisJob.positionRevision
    || Number(message.positionMoveCount) !== meta.ply
    || (!message.noResults && Number(message.turnNumber) !== meta.ply)
    || Number(message.requestedMaxVisits) !== analysisJob.requestedMaxVisits
    || message.analysisPurpose !== analysisJob.analysisPurpose
    || (message.sessionEpoch ?? null) !== analysisJob.sessionEpoch;
  if (metadataMismatch) {
    analysisJob = transitionAnalysisJob(analysisJob, "failed");
    discardIncompleteAnalysis("오류 · 오래된 부분 결과 폐기");
    setAnalysisStatus("응답 메타데이터 불일치", "error");
    if (practice.active) setPracticePhase("error", "오래된 응답 차단", "error");
    notice("엔진 응답의 위치 revision/수순/purpose가 현재 요청과 달라 적용하지 않았습니다.", true);
    updateControls();
    return;
  }
  const accepted = applyAnalysisResponse(
    analysisJob, message, currentAnalysisIdentity(),
  );
  if (!accepted.accepted) return;
  analysisJob = accepted.job;
  if (analysisJob.state === "interrupted") {
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
  if (analysisJob.state !== "final") return;
  setAnalysisStatus(message.analysisInsufficient ? "최종 · 분석 부족" : "최종 결과", message.analysisInsufficient ? "busy" : "");
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

function renderCandidates() {
  const shown = visibleCandidates();
  if (!shown.length) {
    const message = gameDocument.positionState?.isTerminal
      ? "종국 위치 · MCTS 분석 미실행"
      : currentAnalysis ? "후보 없음 · 분석 부족" : "현재 위치를 분석하면 MCTS 후보가 표시됩니다.";
    elements.candidates.innerHTML = `<tr><td colspan="7" class="empty">${message}</td></tr>`;
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
    row.addEventListener("click", () => focusCandidate(row.dataset.move, true));
    row.addEventListener("keydown", (event) => {
      if (["Enter", " "].includes(event.key)) { event.preventDefault(); focusCandidate(row.dataset.move, true); }
    });
  });
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
  renderCandidates();
  drawBoard();
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
    practice = emptyPractice(practice.token + 1);
  }
  updateControls();
}
function requestAnalysis(purpose = "manual") {
  if (gameDocument.positionState?.isTerminal) {
    notice(`${terminalResultLabel()} 위치는 이미 끝났으므로 분석을 시작하지 않습니다.`, true);
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
  cancelAnalysis({ preservePractice: false });
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
  if (practice.pendingRecord && !(await finalizePendingRecord(message))) return;
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
      throw new Error("채점 응답의 세션/revision echo가 요청과 다릅니다");
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
    notice("최종 엔진 응답에 order=0 추천 수가 없어 AI가 착수하지 않습니다.", true);
    return;
  }
  if (occupied(candidate.move) || forbiddenMoves.has(candidate.move) || !legalMoves.includes(candidate.move)) {
    setPracticePhase("error", "엔진/helper 합법성 충돌", "error");
    notice(`엔진 order=0 추천 ${candidate.move}가 공식 helper의 legalMoves에 없습니다. 다른 후보로 대체하지 않고 중단합니다.`, true);
    return;
  }
  notice(`AI가 최종 MCTS order=0 추천 ${candidate.move}를 선택했습니다.`);
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
  if (legalityState !== "ready") { notice("금수 확인이 끝날 때까지 착수할 수 없습니다.", true); return; }
  if (occupied(move)) { notice(`${move}에는 이미 돌이 있습니다.`, true); return; }
  if (forbiddenMoves.has(move)) {
    elements.legalityStatus.textContent = `${move}는 공식 helper가 판정한 흑 금수라 착수할 수 없습니다.`;
    elements.legalityStatus.classList.add("error");
    notice(`${move} 착수가 차단되었습니다.`, true);
    return;
  }
  if (!legalMoves.includes(move)) {
    notice(`${move}는 공식 helper의 legalMoves에 없어 착수할 수 없습니다.`, true);
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
      throw new Error("요약 응답의 세션/revision echo가 요청과 다릅니다");
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
  const record = selectHistoryReview(history, id);
  if (!record) {
    notice("선택한 저장 기록을 찾을 수 없습니다.", true);
    return false;
  }
  if (analysisIsLive()) cancelAnalysis();
  reviewSession = createHistoryReview(record, ply ?? record.finalMoves.length);
  elements.reviewPanel.hidden = false;
  renderHistoryReview();
  updateControls();
  elements.reviewPanel.scrollIntoView({ behavior: preferredScrollBehavior(), block: "nearest" });
  return true;
}

function closeHistoryReview() {
  reviewSession = null;
  elements.reviewPanel.hidden = true;
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
  const width = reviewCanvas.width;
  const height = reviewCanvas.height;
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
  if (!candidates.length) return '<p class="insufficient">이 기록에는 compact 후보 snapshot이 없습니다. 기존 v1에서 변환된 기록일 수 있습니다.</p>';
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
      <div><small>Snapshot Winrate (Black)</small><strong>${percent(snapshot?.rootInfo?.blackWinrate)}</strong></div>
      <div><small>분석 상태</small><strong>${insufficient ? "분석 부족" : "최종 분석"}</strong></div>
    </div>
    <p>${insufficient ? `분석 부족: ${escapeHtml((value.analysisInsufficientReasons || []).join(", ") || "visits 기준 미달")}` : "아래 후보와 PV는 사용자가 이 수를 두기 직전의 compact snapshot입니다."}</p>`;
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
  const settingLocked = practice.active || practice.summaryPending || Boolean(reviewSession);
  elements.mode.disabled = settingLocked || analysisIsLive();
  elements.maxVisits.disabled = settingLocked;
  const practiceSettingsDisabled = settingLocked || isFreeAnalysisMode();
  for (const element of [elements.userColor, elements.stopPly, elements.gradingMode]) {
    element.disabled = practiceSettingsDisabled;
  }
  updateModeUi();
  elements.practiceStart.textContent = practice.ended ? "현재 위치에서 새 연습" : "이 위치에서 연습 시작";
  elements.analyze.textContent = practice.active ? "현재 단계 재분석" : "현재 위치 분석";
  elements.practiceFinish.disabled = !connected || !practice.active || busy
    || practice.phase !== "user_turn" || Boolean(practice.pendingRecord) || Boolean(aiTimer)
    || practice.attempt.turnRecords.length === 0 || Boolean(reviewSession);
  const baseLength = practice.active || practice.ended ? practice.attempt.openingMoves.length : 0;
  elements.undo.disabled = gameDocument.moves.length <= baseLength || busy
    || legalityState !== "ready" || Boolean(reviewSession);
  elements.sameStart.disabled = !connected || !trainingContractReady
    || practice.active || !practice.ended || practice.summaryPending || Boolean(reviewSession);
  renderViewState(currentViewState());
}
function canPlaceMove(view = currentViewState()) {
  if (!view.boardInteractive) return false;
  if (!practice.active) return true;
  return practice.phase === "user_turn" && nextPlayer() === practice.attempt.settings.userColor
    && practice.preparedAnalysis?.isFinal;
}

async function undoMove() {
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
}

function canvasPoint(event) {
  const rectangle = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rectangle.left) * canvas.width / rectangle.width,
    y: (event.clientY - rectangle.top) * canvas.height / rectangle.height,
  };
}
function candidateAtPoint(px, py) {
  return candidateHitAreas.find((area) =>
    Math.hypot(px - area.px, py - area.py) <= area.radius
      || (px >= area.box.x && px <= area.box.x + area.box.width && py >= area.box.y && py <= area.box.y + area.box.height));
}
function intersectionAtPoint(px, py) {
  const x = Math.round((px - margin) / spacing);
  const y = Math.round((py - margin) / spacing);
  if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return null;
  if (Math.hypot(px - (margin + x * spacing), py - (margin + y * spacing)) > spacing * .44) return null;
  return { x, y, move: xyToMove(x, y) };
}

canvas.addEventListener("pointermove", (event) => {
  const { x, y } = canvasPoint(event);
  const hit = candidateAtPoint(x, y);
  const next = hit?.move || null;
  if (next !== hoveredCandidateMove) focusCandidate(next, false);
});
canvas.addEventListener("pointerleave", () => focusCandidate(null, false));
canvas.addEventListener("click", async (event) => {
  const point = canvasPoint(event);
  const intersection = intersectionAtPoint(point.x, point.y);
  const candidate = candidateAtPoint(point.x, point.y);
  if (!intersection && candidate) { focusCandidate(candidate.move, true); return; }
  if (!intersection) return;
  boardCursor = { x: intersection.x, y: intersection.y };
  if (!canPlaceMove()) {
    if (candidate) focusCandidate(candidate.move, true);
    else if (practice.ended) notice("완료된 연습판입니다. 현재 판 이어서 연습, 같은 시작점 또는 새 판 버튼을 사용하세요.", true);
    else notice(practice.active ? "최종 분석 또는 AI 착수를 기다리는 중입니다." : "분석 취소 또는 금수 확인을 기다려 주세요.", true);
    return;
  }
  await attemptMove(intersection.move);
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
    if (canPlaceMove()) await attemptMove(xyToMove(boardCursor.x, boardCursor.y));
    else notice("현재는 착수할 수 없습니다.", true);
  }
});
canvas.addEventListener("focus", drawBoard);
canvas.addEventListener("blur", drawBoard);

elements.practiceStart.addEventListener("click", () => startPractice());
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
  cancelAnalysis();
  if (practice.active) setPracticePhase("error", "분석 취소", "error");
  notice("분석을 취소했습니다. 현재 위치 분석으로 다시 시작할 수 있습니다.");
});
elements.undo.addEventListener("click", undoMove);
elements.reset.addEventListener("click", resetBoard);
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
  notice(elements.mode.value === "analysis" ? "사용자 색 없이 흑·백을 모두 직접 착수합니다. AI는 자동 착수하지 않습니다." : "현재 위치를 시작점으로 삼아 AI와 연습할 수 있습니다.");
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
  const label = labels[engine.state] || "엔진 상태 확인 중";
  const className = engine.state === "error"
    ? "status error"
    : ["starting", "analyzing", "restarting", "stopping"].includes(engine.state)
      ? "status busy"
      : engine.state === "stopped" ? "status neutral" : "status";
  if (elements.engineStatus.textContent !== label) elements.engineStatus.textContent = label;
  elements.engineStatus.className = className;
  elements.engineDiagnosticState.textContent = `${label} (${engine.state || "unknown"})`;
  elements.enginePid.textContent = String(engine.pid ?? "—");
  elements.engineRestarts.textContent = `${engine.restartCount ?? "—"} / ${engine.restartLimit ?? "—"}`;
  elements.engineLastError.textContent = engine.lastError || "—";
}
async function refreshStatus() {
  try {
    const response = await fetch("/api/status");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    updateEngineBadge((await response.json()).engine);
  } catch (error) {
    elements.engineStatus.textContent = `서버 상태 오류: ${error.message}`;
    elements.engineStatus.className = "status error";
    elements.engineDiagnosticState.textContent = "서버 상태 확인 실패";
    elements.enginePid.textContent = "—";
    elements.engineRestarts.textContent = "—";
    elements.engineLastError.textContent = error.message;
  }
}

async function refreshTrainingOptions() {
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
    trainingContractReady = true;
    updateControls();
  } catch (error) {
    trainingContractReady = false;
    notice(`연습 설정 계약을 확인하지 못했습니다: ${error.message}`, true);
    updateControls();
  }
}

renderHistory();
drawBoard();
refreshLegality();
connectWebSocket();
refreshStatus();
refreshTrainingOptions();
updateControls();
setInterval(refreshStatus, 2000);
