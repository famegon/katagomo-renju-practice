const BOARD_SIZE = 15;
const POLICY_LENGTH = 226;
const COLUMNS = "ABCDEFGHJKLMNOP";
const HISTORY_KEY = "katagomo.openingPractice.v1";
const MIN_GRADE_VISITS = 50;
const canvas = document.querySelector("#board");
const context = canvas.getContext("2d");
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
  sizeMetric: byId("size-metric"), topCount: byId("top-count"),
  practiceStart: byId("practice-start"), analyze: byId("analyze"), cancel: byId("cancel"),
  undo: byId("undo"), reset: byId("reset"), clearPv: byId("clear-pv"),
  candidates: byId("candidates"), rawPolicy: byId("raw-policy"),
  candidateFocus: byId("candidate-focus"), candidateFocusCard: byId("candidate-focus-card"),
  instantCard: byId("instant-feedback-card"), instantState: byId("instant-grade-state"),
  instantFeedback: byId("instant-feedback"), resultsCard: byId("results-card"),
  resultSummary: byId("result-summary"), summaryBody: byId("summary-body"),
  mistakes: byId("mistakes"), sameStart: byId("same-start"), newOpening: byId("new-opening"),
  requestId: byId("request-id"), policyLength: byId("policy-length"),
  visitTotal: byId("visit-total"), rootVisits: byId("root-visits"),
  blackWinrate: byId("black-winrate"), currentWinrate: byId("current-winrate"),
  userWinrate: byId("user-winrate"), responseKind: byId("response-kind"),
  historyCount: byId("history-count"), historyList: byId("history-list"),
};

let moves = [];
let forbiddenMoves = new Set();
let legalMoves = [];
let legalityReady = false;
let legalityGeneration = 0;
let positionRevision = 0;
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
let activeRequest = null;
let canceledClientRequestId = null;
let aiTimer = null;
let history = loadHistory();

function emptyPractice(token = 0) {
  return {
    active: false, ended: false, token, phase: "setup", startedAt: null,
    openingMoves: [], settings: null, preparedAnalysis: null,
    preparedLegalMoves: [], pendingRecord: null, records: [], saved: false,
    sessionEpoch: null, summaryPending: false,
  };
}
let practice = emptyPractice();

function nextPlayer() { return moves.length % 2 === 0 ? "B" : "W"; }
function playerName(player) { return player === "B" ? "흑" : "백"; }
function otherPlayer(player) { return player === "B" ? "W" : "B"; }
function positionKey(value = moves) { return JSON.stringify(value); }
function cloneMoves(value = moves) { return value.map(([player, move]) => [player, move]); }
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
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}
function occupied(move) { return moves.some(([, placed]) => placed === move); }
function candidateRanked() {
  const candidates = [...allCandidates];
  const hasOrders = candidates.length && candidates.every((candidate) => Number.isInteger(Number(candidate.order)));
  return candidates.sort(hasOrders
    ? (left, right) => Number(left.order) - Number(right.order)
    : (left, right) => Number(right.visits || 0) - Number(left.visits || 0));
}
function visibleCandidates() { return candidateRanked().slice(0, Number(elements.topCount.value)); }
function focusedCandidate() {
  const move = pinnedCandidateMove || hoveredCandidateMove;
  return move ? allCandidates.find((candidate) => candidate.move === move) : null;
}
function practiceIdentityMatches(token, epoch, revision = positionRevision) {
  return practice.active && practice.token === token
    && practice.sessionEpoch === epoch && positionRevision === revision;
}
function practiceTransitionBusy() {
  return practice.summaryPending || [
    "starting", "applying_user", "undoing", "analyzing_user", "analyzing_ai",
    "finalizing", "ai_wait", "finishing",
  ].includes(practice.phase);
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

  moves.forEach(([player, move], index) => {
    const [x, y] = moveToXY(move);
    const px = margin + x * spacing;
    const py = margin + y * spacing;
    const radius = spacing * .43;
    context.fillStyle = player === "B" ? "#171a18" : "#f7f8f5";
    context.strokeStyle = index === moves.length - 1 ? "#c43d34" : "#343b37";
    context.lineWidth = index === moves.length - 1 ? 3.5 : 1;
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
    context.fillStyle = index === 0 ? "rgba(20,93,72,.91)" : focused ? "rgba(49,93,137,.88)" : "rgba(255,255,255,.84)";
    context.strokeStyle = index === 0 ? "#f4ce68" : focused ? "#315d89" : "#145d48";
    context.lineWidth = index === 0 ? 4 : focused ? 3 : 1.5;
    context.beginPath(); context.arc(px, py, radius, 0, Math.PI * 2); context.fill(); context.stroke();
    context.fillStyle = index === 0 || focused ? "white" : "#145d48";
    context.font = "bold 12px -apple-system, sans-serif";
    context.fillText(`#${index + 1}`, px, py);

    const box = findLabelBox(px, py, labelBoxes, index);
    labelBoxes.push(box);
    context.fillStyle = index === 0 ? "rgba(14,70,54,.93)" : "rgba(255,255,255,.94)";
    context.strokeStyle = index === 0 ? "#f4ce68" : "rgba(20,93,72,.65)";
    context.lineWidth = 1;
    context.fillRect(box.x, box.y, box.width, box.height);
    context.strokeRect(box.x, box.y, box.width, box.height);
    context.textAlign = "left";
    context.fillStyle = index === 0 ? "white" : "#173f33";
    context.font = "bold 10px ui-monospace, monospace";
    context.fillText(`${candidate.move}  #${index + 1}`, box.x + 4, box.y + 9);
    context.font = "9px ui-monospace, monospace";
    context.fillText(`V ${percent(candidate.visitShare)}`, box.x + 4, box.y + 21);
    context.fillText(`P ${percent(candidate.rawPrior)}`, box.x + 4, box.y + 32);
    context.fillText(`B ${percent(candidate.blackWinrate)}`, box.x + 4, box.y + 43);
    context.textAlign = "center";
    candidateHitAreas.push({ move: candidate.move, px, py, radius: Math.max(radius, 18), box });
  });
}

function findLabelBox(px, py, existing, index) {
  const width = 82;
  const height = 48;
  const offsets = [[18, -52], [-100, -52], [18, 8], [-100, 8], [-41, -76], [-41, 28]];
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
  elements.nextPlayer.textContent = playerName(player);
  elements.plyCount.textContent = `${moves.length}수`;
  if (practice.active) {
    elements.turnOwner.textContent = player === practice.settings.userColor ? "· 사용자 차례" : "· AI 차례";
  } else {
    elements.turnOwner.textContent = elements.mode.value === "analysis" ? "· 자유 착수" : "· 설정 가능";
  }
  elements.boardSummary.textContent = moves.length
    ? `${moves.length}수 진행, 마지막 수 ${moves.at(-1)[1]}, ${playerName(player)} 차례`
    : `빈 오목판, ${playerName(player)} 차례`;
}

async function refreshLegality() {
  const generation = ++legalityGeneration;
  legalityReady = false;
  elements.legalityStatus.classList.remove("error");
  elements.legalityStatus.textContent = "금수 정보를 확인 중입니다.";
  updateControls();
  try {
    const response = await fetch("/api/legality", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moves, nextPlayer: nextPlayer() }),
    });
    const body = await response.json();
    if (generation !== legalityGeneration) return false;
    if (!response.ok) throw new Error(body.detail || `HTTP ${response.status}`);
    forbiddenMoves = new Set(body.forbiddenMoves || []);
    legalMoves = Array.isArray(body.legalMoves) ? body.legalMoves : [];
    legalityReady = true;
    elements.legalityStatus.textContent = nextPlayer() === "B"
      ? `공식 Board::isForbidden() 결과: 흑 금수 ${forbiddenMoves.size}곳`
      : "백 차례: 흑 금수 규칙을 적용하지 않습니다.";
  } catch (error) {
    if (generation !== legalityGeneration) return false;
    forbiddenMoves = new Set();
    legalMoves = [];
    elements.legalityStatus.textContent = `금수 helper 오류 — 안전을 위해 착수를 차단합니다: ${error.message}`;
    elements.legalityStatus.classList.add("error");
  }
  drawBoard();
  updateControls();
  return legalityReady;
}

function connectWebSocket() {
  clearTimeout(reconnectTimer);
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${scheme}://${location.host}/ws/analysis`);
  socket.addEventListener("open", () => setAnalysisStatus("연결됨", "neutral"));
  socket.addEventListener("close", () => {
    activeRequest = null;
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

function handleMessage(message) {
  if (message.type === "error" || message.type === "warning") {
    if (message.clientRequestId && message.clientRequestId !== activeRequest?.clientRequestId) return;
    setAnalysisStatus(`${message.code || "engine_warning"}: ${message.message}`, "error");
    activeRequest = null;
    if (practice.active) setPracticePhase("error", "분석 오류", "error");
    notice(`엔진 오류: ${message.message}`, true);
    updateControls();
    return;
  }
  if (message.type === "status") {
    updateEngineBadge(message.engine);
    if (message.status === "analyzing") {
      if (message.clientRequestId !== activeRequest?.clientRequestId) return;
      elements.requestId.textContent = message.requestId || "—";
      setAnalysisStatus("분석 중", "busy");
    } else if (message.status === "canceled") {
      if (message.clientRequestId !== canceledClientRequestId) return;
      canceledClientRequestId = null;
      setAnalysisStatus("취소됨", "neutral");
      elements.responseKind.textContent = "취소됨";
    } else if (["idle", "connected"].includes(message.status) && !activeRequest) {
      setAnalysisStatus(message.status === "connected" ? "연결됨" : "분석 대기", "neutral");
    }
    updateControls();
    return;
  }
  if (message.type !== "analysis" || message.clientRequestId !== activeRequest?.clientRequestId) return;
  if (activeRequest.positionKey !== positionKey()) return;
  const meta = activeRequest;
  const metadataMismatch = Number(message.positionRevision) !== meta.positionRevision
    || Number(message.positionMoveCount) !== meta.ply
    || (!message.noResults && Number(message.turnNumber) !== meta.ply)
    || Number(message.requestedMaxVisits) !== meta.requestedMaxVisits
    || message.analysisPurpose !== meta.analysisPurpose
    || (message.sessionEpoch ?? null) !== meta.sessionEpoch;
  if (metadataMismatch) {
    activeRequest = null;
    setAnalysisStatus("응답 메타데이터 불일치", "error");
    if (practice.active) setPracticePhase("error", "오래된 응답 차단", "error");
    notice("엔진 응답의 위치 revision/수순/purpose가 현재 요청과 달라 적용하지 않았습니다.", true);
    updateControls();
    return;
  }
  if (message.noResults) {
    activeRequest = null;
    setAnalysisStatus("분석 결과 없음", "error");
    elements.responseKind.textContent = "noResults";
    if (practice.active) setPracticePhase("error", "분석 결과 없음", "error");
    notice("엔진이 이 요청의 분석 결과를 반환하지 않았습니다. 가짜 값으로 대체하지 않습니다.", true);
    updateControls();
    return;
  }
  currentAnalysis = message;
  allCandidates = Array.isArray(message.candidates) ? message.candidates : [];
  fullPolicy = Array.isArray(message.policy) ? message.policy : [];
  renderAnalysis(message);
  if (!message.isFinal) return;
  activeRequest = null;
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
  elements.userWinrate.textContent = `${percent(message.rootInfo?.userWinrate)} (${playerName(message.userColor || elements.userColor.value)})`;
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
    elements.candidates.innerHTML = '<tr><td colspan="6" class="empty">후보 없음 · 분석 부족</td></tr>';
    return;
  }
  elements.candidates.innerHTML = shown.map((candidate, index) => `
    <tr class="candidate-row${candidate.move === (pinnedCandidateMove || hoveredCandidateMove) ? " is-focused" : ""}" data-move="${escapeHtml(candidate.move)}" tabindex="0">
      <td>#${index + 1} <strong>${escapeHtml(candidate.move)}</strong></td>
      <td>${percent(candidate.rawPrior)}</td>
      <td>${escapeHtml(candidate.visits)}</td>
      <td>${percent(candidate.visitShare)}</td>
      <td>${percent(candidate.blackWinrate)}</td>
      <td title="${escapeHtml((candidate.pv || []).join(" "))}">${escapeHtml((candidate.pv || []).join(" "))}</td>
    </tr>`).join("");
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
    : "<li>분석 결과 없음</li>";
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
    elements.candidateFocus.textContent = "후보 원이나 표의 행에 마우스를 올리면 PV가 반투명 수순으로 표시됩니다.";
    return;
  }
  const rank = candidateRanked().findIndex((entry) => entry.move === candidate.move) + 1;
  elements.candidateFocus.innerHTML = `<strong>#${rank} ${escapeHtml(candidate.move)}</strong> · 방문 ${percent(candidate.visitShare)} (${escapeHtml(candidate.visits)} visits) · 정책 ${percent(candidate.rawPrior)} · 흑 승률 ${percent(candidate.blackWinrate)}<br>PV: ${escapeHtml((candidate.pv || []).join(" ") || "없음")}`;
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
  if (!keepStatus) setAnalysisStatus("분석 대기", "neutral");
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
  if (activeRequest) {
    canceledClientRequestId = activeRequest.clientRequestId;
    activeRequest = null;
    send({ action: "cancel" });
  }
  clearTimeout(aiTimer);
  aiTimer = null;
  if (!preservePractice && practice.active) practice = emptyPractice(practice.token + 1);
  updateControls();
}
function requestAnalysis(purpose = "manual") {
  if (activeRequest) cancelAnalysis();
  const clientRequestId = crypto.randomUUID();
  const purposeMap = {
    manual: "manual", "prepare-user": "user_pre", "ai-turn": "post_user_ai",
    "post-user": "final_grade",
  };
  const request = {
    clientRequestId, purpose, analysisPurpose: purposeMap[purpose] || "manual",
    positionKey: positionKey(), positionRevision, ply: moves.length,
    sessionEpoch: practice.active ? practice.sessionEpoch : null,
  };
  activeRequest = request;
  canceledClientRequestId = null;
  clearAnalysisDisplay({ keepStatus: true });
  const settings = practice.active ? practice.settings : {
    maxVisits: Number(elements.maxVisits.value), userColor: elements.userColor.value,
  };
  request.requestedMaxVisits = settings.maxVisits;
  if (!send({
    action: "analyze", moves, rules: "renju", boardXSize: 15, boardYSize: 15,
    maxVisits: settings.maxVisits, reportDuringSearchEvery: .5,
    userColor: settings.userColor, clientRequestId,
    analysisPurpose: request.analysisPurpose, positionRevision: request.positionRevision,
    sessionEpoch: request.sessionEpoch,
  })) {
    activeRequest = null;
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

async function startPractice(startMoves = null) {
  cancelAnalysis({ preservePractice: false });
  if (startMoves) {
    moves = cloneMoves(startMoves);
    positionRevision += 1;
  }
  const stopPly = Number(elements.stopPly.value);
  if (moves.length >= stopPly) {
    notice(`시작 위치가 종료 수(${stopPly}수)보다 짧아야 합니다.`, true);
    return;
  }
  const token = practice.token + 1;
  practice = {
    active: true, ended: false, token, phase: "starting", startedAt: new Date().toISOString(),
    openingMoves: cloneMoves(), records: [], pendingRecord: null, preparedAnalysis: null,
    preparedLegalMoves: [], saved: false, sessionEpoch: crypto.randomUUID(),
    summaryPending: false,
    settings: {
      userColor: elements.userColor.value, stopPly,
      gradingMode: elements.gradingMode.value, maxVisits: Number(elements.maxVisits.value),
    },
  };
  elements.resultsCard.hidden = true;
  elements.instantCard.hidden = true;
  elements.sessionComplete.dataset.complete = "false";
  elements.sessionComplete.textContent = "진행 중";
  clearAnalysisDisplay();
  notice(`${playerName(practice.settings.userColor)}으로 ${stopPly}수까지 연습을 시작합니다.`);
  const epoch = practice.sessionEpoch;
  const revision = positionRevision;
  const legalityOk = await refreshLegality();
  if (!practiceIdentityMatches(token, epoch, revision)) return;
  if (legalityOk) beginPracticeTurn(token);
  else setPracticePhase("error", "금수 오류", "error");
}

async function beginPracticeTurn(token = practice.token) {
  if (!practice.active || token !== practice.token) return;
  const epoch = practice.sessionEpoch;
  const revision = positionRevision;
  if (moves.length >= practice.settings.stopPly) {
    if (practice.pendingRecord) requestAnalysis("post-user");
    else finishPractice();
    return;
  }
  if (!legalityReady) {
    const legalityOk = await refreshLegality();
    if (!practiceIdentityMatches(token, epoch, revision)) return;
    if (!legalityOk) {
      setPracticePhase("error", "금수 오류", "error");
      return;
    }
  }
  if (!practiceIdentityMatches(token, epoch, revision)) return;
  if (nextPlayer() === practice.settings.userColor) requestAnalysis("prepare-user");
  else requestAnalysis("ai-turn");
}

async function processPracticeFinal(message, request) {
  if (!practice.active || request.positionKey !== positionKey()) return;
  const token = practice.token;
  const epoch = practice.sessionEpoch;
  const revision = positionRevision;
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
  if (moves.length >= practice.settings.stopPly) {
    finishPractice();
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
    ply: moves.length + 1, userMove: move, userColor: practice.settings.userColor,
    preAnalysis: analysis, legalMoves: [...practice.preparedLegalMoves],
    prePositionRevision: positionRevision,
  };
}
async function finalizePendingRecord(afterAnalysis) {
  const pending = practice.pendingRecord;
  if (!pending) return true;
  const expectedToken = practice.token;
  const expectedEpoch = practice.sessionEpoch;
  const expectedRevision = positionRevision;
  const clientEvaluationId = crypto.randomUUID();
  try {
    const response = await fetch("/api/training/evaluate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ply: pending.ply, userMove: pending.userMove, userColor: pending.userColor,
        preAnalysis: pending.preAnalysis, postRootInfo: afterAnalysis.rootInfo,
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
      || practice.sessionEpoch !== expectedEpoch
      || positionRevision !== expectedRevision || practice.pendingRecord !== pending) return false;
    practice.records.push(body);
    practice.pendingRecord = null;
    if (practice.settings.gradingMode === "immediate") renderInstantFeedback(body);
    return true;
  } catch (error) {
    if (!practice.active || practice.token !== expectedToken
      || practice.sessionEpoch !== expectedEpoch
      || positionRevision !== expectedRevision || practice.pendingRecord !== pending) return false;
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
  const epoch = practice.sessionEpoch;
  const revision = positionRevision;
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
    moves.push([nextPlayer(), candidate.move]);
    positionRevision += 1;
    const placedRevision = positionRevision;
    practice.preparedAnalysis = null;
    clearAnalysisDisplay();
    drawBoard();
    const nextLegalityOk = await refreshLegality();
    if (!practiceIdentityMatches(token, epoch, placedRevision)) return;
    if (!nextLegalityOk) {
      setPracticePhase("error", "금수 오류", "error");
      return;
    }
    if (moves.length >= practice.settings.stopPly) finishPractice();
    else beginPracticeTurn(token);
  }, 350);
}

async function attemptMove(move) {
  if (!legalityReady) { notice("금수 확인이 끝날 때까지 착수할 수 없습니다.", true); return; }
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
    if (nextPlayer() !== practice.settings.userColor) { notice("지금은 AI 차례입니다.", true); return; }
    const prepared = practice.preparedAnalysis;
    if (!prepared?.isFinal || Number(prepared.turnNumber) !== moves.length
      || Number(prepared.positionRevision) !== positionRevision
      || prepared.sessionEpoch !== practice.sessionEpoch
      || prepared.analysisPurpose !== "user_pre") {
      notice("사용자 착수 전 최종 분석이 아직 준비되지 않았습니다.", true);
      return;
    }
    const token = practice.token;
    const epoch = practice.sessionEpoch;
    const pending = createPendingRecord(move, prepared);
    practice.pendingRecord = pending;
    practice.preparedAnalysis = null;
    practice.preparedLegalMoves = [];
    moves.push([nextPlayer(), move]);
    positionRevision += 1;
    const placedRevision = positionRevision;
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
    if (moves.length >= practice.settings.stopPly) requestAnalysis("post-user");
    else beginPracticeTurn(practice.token);
    return;
  }
  cancelAnalysis();
  moves.push([nextPlayer(), move]);
  positionRevision += 1;
  clearAnalysisDisplay();
  drawBoard();
  await refreshLegality();
}

async function finishPractice() {
  if (!practice.active) return;
  const expectedToken = practice.token;
  const expectedEpoch = practice.sessionEpoch;
  const expectedRevision = positionRevision;
  const clientSummaryId = crypto.randomUUID();
  clearTimeout(aiTimer);
  practice.active = false;
  practice.ended = true;
  practice.summaryPending = true;
  setPracticePhase("finishing", "결과 정리 중", "busy");
  elements.sessionComplete.dataset.complete = "false";
  elements.sessionComplete.textContent = "정리 중";
  notice(`${moves.length}수에 도달해 서버 평가를 정리하고 있습니다.`);
  let summary = null;
  try {
    const response = await fetch("/api/training/summary", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        evaluations: practice.records, limit: 3, clientSummaryId,
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
    if (practice.token !== expectedToken || practice.sessionEpoch !== expectedEpoch
      || positionRevision !== expectedRevision || !practice.ended || !practice.summaryPending) return;
    notice(`연습은 종료됐지만 서버 요약에 실패했습니다: ${error.message}`, true);
  }
  if (practice.token !== expectedToken || practice.sessionEpoch !== expectedEpoch
    || positionRevision !== expectedRevision || !practice.ended || !practice.summaryPending) return;
  renderResults(summary);
  if (!practice.saved) {
    saveCompletedPractice();
    practice.saved = true;
  }
  practice.summaryPending = false;
  setPracticePhase("complete", "연습 완료", "");
  elements.sessionComplete.dataset.complete = "true";
  elements.sessionComplete.textContent = "종료";
  notice(`${moves.length}수 초반 연습이 종료되었습니다.`);
  updateControls();
}

function renderInstantFeedback(record) {
  elements.instantCard.hidden = false;
  elements.instantState.textContent = record.analysisInsufficient ? "분석 부족" : `${record.preRootVisits} visits 기준`;
  elements.instantFeedback.innerHTML = `
    <div class="feedback-grid">
      <div><small>사용자 / 추천</small><strong>${escapeHtml(record.userMove)} / ${escapeHtml(record.recommendedMove || "—")}</strong></div>
      <div><small>Policy</small><strong>${percent(record.rawPolicy)} · ${record.policyRank ? `${record.policyRank}위` : "순위 없음"}</strong></div>
      <div><small>Visit 순위 (사용자/추천)</small><strong>${visitRankComparison(record)}</strong></div>
      <div><small>사용자 승률 전→후</small><strong class="${Number(record.winrateDelta) < 0 ? "negative" : "positive"}">${percent(record.beforeUserWinrate)} → ${percent(record.afterUserWinrate)} (${percentagePoints(record.winrateDelta)})</strong></div>
      <div><small>추천 1위와 승률 차이</small><strong>${record.analysisInsufficient ? "분석 부족" : percentagePoints(record.recommendedWinrateGap)}</strong></div>
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
  const insufficientCount = summary?.insufficientCount ?? practice.records.filter((record) => record.analysisInsufficient).length;
  elements.resultSummary.textContent = `${playerName(practice.settings.userColor)} 연습 · ${moves.length}수 종료 · 사용자 착수 ${practice.records.length}개 · 분석 부족 ${insufficientCount}개. 절대 점수 없이 실제 policy, visit 순위와 사용자 관점 승률 변화만 표시합니다.`;
  elements.summaryBody.innerHTML = practice.records.length ? practice.records.map((record) => `
    <tr data-ply="${record.ply}" data-insufficient="${record.analysisInsufficient}">
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
    ? mistakes.map((record) => `<li>${record.ply}수 ${escapeHtml(record.userMove)} — 추천 ${escapeHtml(record.recommendedMove)} 대비 사용자 승률 ${percentagePoints(-record.recommendedWinrateGap)} · policy ${record.policyRank ? `${record.policyRank}위` : "순위 없음"} · visit ${record.visitRank ? `${record.visitRank}위` : "후보 밖"}</li>`).join("")
    : `<li>${summary ? "충분한 분석에서 추천 대비 확인된 실수가 없습니다." : "서버 요약을 불러오지 못해 실수 순위를 표시하지 않습니다."}</li>`;
  elements.resultsCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 20) : [];
  } catch { return []; }
}
function saveCompletedPractice() {
  const entry = {
    id: crypto.randomUUID(), startedAt: practice.startedAt, endedAt: new Date().toISOString(),
    settings: { ...practice.settings }, openingMoves: cloneMoves(practice.openingMoves),
    finalMoves: cloneMoves(), records: practice.records.map((record) => ({ ...record })),
  };
  history.unshift(entry);
  history = history.slice(0, 20);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); }
  catch (error) { notice(`연습 결과는 표시했지만 localStorage 저장에 실패했습니다: ${error.message}`, true); }
  renderHistory();
}
function renderHistory() {
  elements.historyCount.textContent = String(history.length);
  elements.historyList.innerHTML = history.length ? history.slice(0, 5).map((entry) => {
    const date = new Date(entry.endedAt);
    const records = Array.isArray(entry.records) ? entry.records : [];
    const insufficient = records.filter((record) => record.analysisInsufficient).length;
    return `<li><time datetime="${escapeHtml(entry.endedAt)}">${escapeHtml(date.toLocaleString("ko-KR"))}</time> · <strong>${playerName(entry.settings?.userColor)}</strong> · ${entry.finalMoves?.length ?? 0}수 · 평가 ${records.length}개${insufficient ? ` · 분석 부족 ${insufficient}` : ""}</li>`;
  }).join("") : "<li>아직 완료한 연습이 없습니다.</li>";
}

function updateControls() {
  const connected = socket?.readyState === WebSocket.OPEN;
  const busy = Boolean(activeRequest) || practiceTransitionBusy();
  const settingLocked = practice.active || practice.summaryPending;
  for (const element of [elements.mode, elements.userColor, elements.stopPly, elements.gradingMode, elements.maxVisits]) {
    element.disabled = settingLocked;
  }
  elements.practiceStart.disabled = !connected || !trainingContractReady
    || practice.active || practice.ended || practice.summaryPending
    || elements.mode.value !== "practice";
  elements.practiceStart.textContent = practice.ended ? "현재 위치에서 새 연습" : "이 위치에서 연습 시작";
  elements.analyze.disabled = !connected || busy || practice.ended;
  elements.analyze.textContent = practice.active ? "현재 단계 재분석" : "현재 위치 분석";
  elements.cancel.disabled = !activeRequest;
  const baseLength = practice.active || practice.ended ? practice.openingMoves.length : 0;
  elements.undo.disabled = moves.length <= baseLength || busy || !legalityReady;
  canvas.classList.toggle("locked", !canPlaceMove());
}
function canPlaceMove() {
  if (!legalityReady || activeRequest || practiceTransitionBusy() || practice.ended) return false;
  if (!practice.active) return true;
  return practice.phase === "user_turn" && nextPlayer() === practice.settings.userColor
    && practice.preparedAnalysis?.isFinal;
}

async function undoMove() {
  cancelAnalysis();
  if (!moves.length) return;
  if (practice.active || practice.ended) {
    const wasEnded = practice.ended;
    practice.active = true;
    practice.ended = false;
    practice.summaryPending = false;
    practice.saved = false;
    practice.token += 1;
    if (wasEnded) {
      practice.sessionEpoch = crypto.randomUUID();
      practice.startedAt = new Date().toISOString();
    }
    do {
      const removed = moves.pop();
      if (removed?.[0] === practice.settings.userColor) break;
    } while (moves.length > practice.openingMoves.length);
    practice.records = practice.records.filter((record) => record.ply <= moves.length);
    practice.pendingRecord = null;
    practice.preparedAnalysis = null;
    practice.preparedLegalMoves = [];
    positionRevision += 1;
    setPracticePhase("undoing", "무르기 적용 중", "busy");
    elements.resultsCard.hidden = true;
    elements.instantCard.hidden = true;
    elements.sessionComplete.dataset.complete = "false";
    elements.sessionComplete.textContent = "진행 중";
  } else moves.pop();
  if (!practice.active) positionRevision += 1;
  clearAnalysisDisplay();
  drawBoard();
  const expectedToken = practice.token;
  const expectedEpoch = practice.sessionEpoch;
  const expectedRevision = positionRevision;
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
  moves = [];
  positionRevision += 1;
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
    else if (practice.ended) notice("완료된 연습판입니다. 같은 시작점 또는 새 초반 버튼을 사용하세요.", true);
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
  else if (nextPlayer() === practice.settings.userColor && !practice.pendingRecord) requestAnalysis("prepare-user");
  else requestAnalysis(moves.length >= practice.settings.stopPly ? "post-user" : "ai-turn");
});
elements.cancel.addEventListener("click", () => {
  cancelAnalysis();
  if (practice.active) setPracticePhase("error", "분석 취소", "error");
  notice("분석을 취소했습니다. 현재 위치 분석으로 다시 시작할 수 있습니다.");
});
elements.undo.addEventListener("click", undoMove);
elements.reset.addEventListener("click", resetBoard);
elements.sameStart.addEventListener("click", () => startPractice(practice.openingMoves));
elements.newOpening.addEventListener("click", () => startPractice([]));
elements.clearPv.addEventListener("click", () => { pinnedCandidateMove = null; hoveredCandidateMove = null; renderCandidateFocus(); renderCandidates(); drawBoard(); });
elements.sizeMetric.addEventListener("change", drawBoard);
elements.topCount.addEventListener("change", () => { renderCandidates(); renderRawPolicy(); drawBoard(); });
elements.mode.addEventListener("change", () => {
  setPracticePhase(elements.mode.value === "analysis" ? "analysis" : "setup", elements.mode.value === "analysis" ? "분석 전용" : "설정 중", "neutral");
  elements.practiceStart.disabled = elements.mode.value !== "practice";
  notice(elements.mode.value === "analysis" ? "분석 전용 모드에서는 흑·백을 자유롭게 착수합니다." : "현재 위치를 시작점으로 삼아 AI와 연습할 수 있습니다.");
  drawBoard();
  updateControls();
});
elements.userColor.addEventListener("change", () => {
  if (currentAnalysis) requestAnalysis("manual");
});

function updateEngineBadge(engine) {
  if (!engine) return;
  elements.engineStatus.textContent = `엔진 ${engine.state} · PID ${engine.pid ?? "—"}`;
  elements.engineStatus.className = `status ${engine.state === "error" ? "error" : ""}`.trim();
}
async function refreshStatus() {
  try {
    const response = await fetch("/api/status");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    updateEngineBadge((await response.json()).engine);
  } catch (error) {
    elements.engineStatus.textContent = `서버 상태 오류: ${error.message}`;
    elements.engineStatus.className = "status error";
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
