const BOARD_SIZE = 15;
const COLUMNS = "ABCDEFGHJKLMNOP";
const canvas = document.querySelector("#board");
const context = canvas.getContext("2d");
const margin = 48;
const spacing = (canvas.width - margin * 2) / (BOARD_SIZE - 1);

const elements = {
  engineStatus: document.querySelector("#engine-status"),
  analysisStatus: document.querySelector("#analysis-status"),
  legalityStatus: document.querySelector("#legality-status"),
  nextPlayer: document.querySelector("#next-player"),
  maxVisits: document.querySelector("#max-visits"),
  userColor: document.querySelector("#user-color"),
  analyze: document.querySelector("#analyze"),
  cancel: document.querySelector("#cancel"),
  undo: document.querySelector("#undo"),
  reset: document.querySelector("#reset"),
  candidates: document.querySelector("#candidates"),
  rawPolicy: document.querySelector("#raw-policy"),
  requestId: document.querySelector("#request-id"),
  policyLength: document.querySelector("#policy-length"),
  visitTotal: document.querySelector("#visit-total"),
  responseKind: document.querySelector("#response-kind"),
};

let moves = [];
let forbiddenMoves = new Set();
let legalityReady = false;
let candidates = [];
let socket;
let reconnectTimer;
let legalityGeneration = 0;
let activeClientRequestId = null;
let canceledClientRequestId = null;

function nextPlayer() { return moves.length % 2 === 0 ? "B" : "W"; }
function xyToMove(x, y) { return `${COLUMNS[x]}${BOARD_SIZE - y}`; }
function moveToXY(move) {
  return [COLUMNS.indexOf(move[0]), BOARD_SIZE - Number(move.slice(1))];
}
function percent(value) { return `${(Number(value) * 100).toFixed(1)}%`; }
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
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

  for (const forbidden of forbiddenMoves) {
    const [x, y] = moveToXY(forbidden);
    const px = margin + x * spacing;
    const py = margin + y * spacing;
    context.strokeStyle = "#b63a32";
    context.lineWidth = 3;
    context.beginPath(); context.moveTo(px - 8, py - 8); context.lineTo(px + 8, py + 8); context.moveTo(px + 8, py - 8); context.lineTo(px - 8, py + 8); context.stroke();
  }

  candidates.slice(0, 5).forEach((candidate, index) => {
    if (moves.some(([, move]) => move === candidate.move)) return;
    const [x, y] = moveToXY(candidate.move);
    const px = margin + x * spacing;
    const py = margin + y * spacing;
    const radius = 9 + 12 * Math.sqrt(candidate.visitShare || 0);
    context.fillStyle = index === 0 ? "rgba(20,93,72,.86)" : "rgba(255,255,255,.78)";
    context.strokeStyle = "#145d48";
    context.lineWidth = index === 0 ? 3 : 1.5;
    context.beginPath(); context.arc(px, py, radius, 0, Math.PI * 2); context.fill(); context.stroke();
    context.fillStyle = index === 0 ? "white" : "#145d48";
    context.font = "bold 13px -apple-system, sans-serif";
    context.fillText(String(index + 1), px, py);
  });

  moves.forEach(([player, move], index) => {
    const [x, y] = moveToXY(move);
    const px = margin + x * spacing;
    const py = margin + y * spacing;
    const radius = spacing * 0.43;
    context.fillStyle = player === "B" ? "#171a18" : "#f7f8f5";
    context.strokeStyle = index === moves.length - 1 ? "#c43d34" : "#343b37";
    context.lineWidth = index === moves.length - 1 ? 3 : 1;
    context.beginPath(); context.arc(px, py, radius, 0, Math.PI * 2); context.fill(); context.stroke();
    context.fillStyle = player === "B" ? "#f5f5f2" : "#1f2421";
    context.font = "12px ui-monospace, monospace";
    context.fillText(String(index + 1), px, py + 1);
  });
  elements.nextPlayer.textContent = nextPlayer() === "B" ? "흑" : "백";
}

async function refreshLegality() {
  const generation = ++legalityGeneration;
  legalityReady = false;
  elements.legalityStatus.classList.remove("error");
  elements.legalityStatus.textContent = "금수 정보를 확인 중입니다.";
  try {
    const response = await fetch("/api/legality", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moves, nextPlayer: nextPlayer() }),
    });
    const body = await response.json();
    if (generation !== legalityGeneration) return;
    if (!response.ok) throw new Error(body.detail || `HTTP ${response.status}`);
    forbiddenMoves = new Set(body.forbiddenMoves || []);
    legalityReady = true;
    elements.legalityStatus.textContent = nextPlayer() === "B"
      ? `공식 Board::isForbidden() 결과: 금수 ${forbiddenMoves.size}곳`
      : "백 차례: 흑 금수 규칙을 적용하지 않습니다.";
  } catch (error) {
    if (generation !== legalityGeneration) return;
    forbiddenMoves = new Set();
    elements.legalityStatus.textContent = `금수 helper 오류 — 착수를 차단합니다: ${error.message}`;
    elements.legalityStatus.classList.add("error");
  }
  drawBoard();
}

function connectWebSocket() {
  clearTimeout(reconnectTimer);
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${scheme}://${location.host}/ws/analysis`);
  socket.addEventListener("open", () => setAnalysisStatus("연결됨", "neutral"));
  socket.addEventListener("close", () => {
    activeClientRequestId = null;
    setAnalysisStatus("연결 끊김", "error");
    reconnectTimer = setTimeout(connectWebSocket, 1500);
  });
  socket.addEventListener("message", (event) => handleMessage(JSON.parse(event.data)));
}

function setAnalysisStatus(text, className = "") {
  elements.analysisStatus.textContent = text;
  elements.analysisStatus.className = `status ${className}`.trim();
}

function handleMessage(message) {
  if (message.type === "error") {
    if (message.clientRequestId && message.clientRequestId !== activeClientRequestId) return;
    setAnalysisStatus(`${message.code}: ${message.message}`, "error");
    return;
  }
  if (message.type === "warning") {
    if (message.clientRequestId && message.clientRequestId !== activeClientRequestId) return;
    setAnalysisStatus(`엔진 경고: ${message.message}`, "error");
    return;
  }
  if (message.type === "status") {
    if (message.status === "analyzing") {
      if (message.clientRequestId !== activeClientRequestId) return;
      elements.requestId.textContent = message.requestId;
      setAnalysisStatus("분석 중");
    } else if (message.status === "canceled") {
      if (message.clientRequestId !== canceledClientRequestId) return;
      canceledClientRequestId = null;
      setAnalysisStatus("취소됨", "neutral");
      elements.responseKind.textContent = "취소됨";
    } else if (message.status === "idle") {
      setAnalysisStatus("분석 대기", "neutral");
    }
    updateEngineBadge(message.engine);
    return;
  }
  if (message.type !== "analysis") return;
  if (message.clientRequestId !== activeClientRequestId) return;
  candidates = (message.candidates || []).slice(0, 5);
  elements.requestId.textContent = message.requestId || "—";
  elements.policyLength.textContent = String(message.policyLength ?? "—");
  elements.visitTotal.textContent = String(message.candidateVisitTotal ?? "—");
  elements.responseKind.textContent = message.isFinal ? "최종" : "검색 중간";
  setAnalysisStatus(message.isFinal ? "최종 결과" : "분석 중");
  renderCandidates();
  renderRawPolicy(message.rawPolicyTop5 || []);
  drawBoard();
}

function renderCandidates() {
  if (!candidates.length) {
    elements.candidates.innerHTML = '<tr><td colspan="6" class="empty">후보 없음 · 분석 부족</td></tr>';
    return;
  }
  elements.candidates.innerHTML = candidates.map((candidate) => `
    <tr>
      <td>${escapeHtml(candidate.move)}</td>
      <td>${percent(candidate.rawPrior)}</td>
      <td>${candidate.visits}</td>
      <td>${percent(candidate.visitShare)}</td>
      <td>${percent(candidate.blackWinrate)}</td>
      <td title="${escapeHtml((candidate.pv || []).join(" "))}">${escapeHtml((candidate.pv || []).join(" "))}</td>
    </tr>`).join("");
}

function renderRawPolicy(policy) {
  elements.rawPolicy.innerHTML = policy.length
    ? policy.map((entry) => `<li><strong>${escapeHtml(entry.move)}</strong> ${percent(entry.rawPolicy)}</li>`).join("")
    : "<li>분석 결과 없음</li>";
}

function clearAnalysisDisplay() {
  candidates = [];
  renderCandidates();
  renderRawPolicy([]);
  elements.requestId.textContent = "—";
  elements.policyLength.textContent = "—";
  elements.visitTotal.textContent = "—";
  elements.responseKind.textContent = "—";
  setAnalysisStatus("분석 대기", "neutral");
}

function send(value) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    setAnalysisStatus("WebSocket 연결 대기", "error");
    return false;
  }
  socket.send(JSON.stringify(value));
  return true;
}

function cancelAnalysis() {
  canceledClientRequestId = activeClientRequestId;
  activeClientRequestId = null;
  send({ action: "cancel" });
}

canvas.addEventListener("click", async (event) => {
  if (!legalityReady) return;
  const rectangle = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rectangle.width;
  const scaleY = canvas.height / rectangle.height;
  const px = (event.clientX - rectangle.left) * scaleX;
  const py = (event.clientY - rectangle.top) * scaleY;
  const x = Math.round((px - margin) / spacing);
  const y = Math.round((py - margin) / spacing);
  if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return;
  if (Math.hypot(px - (margin + x * spacing), py - (margin + y * spacing)) > spacing * 0.44) return;
  const move = xyToMove(x, y);
  if (moves.some(([, occupied]) => occupied === move)) return;
  if (forbiddenMoves.has(move)) {
    elements.legalityStatus.textContent = `${move}는 흑 금수라 착수할 수 없습니다.`;
    elements.legalityStatus.classList.add("error");
    return;
  }
  cancelAnalysis();
  moves.push([nextPlayer(), move]);
  clearAnalysisDisplay();
  drawBoard();
  await refreshLegality();
});

elements.analyze.addEventListener("click", () => {
  const clientRequestId = crypto.randomUUID();
  activeClientRequestId = clientRequestId;
  canceledClientRequestId = null;
  if (send({
    action: "analyze",
    moves,
    rules: "renju",
    boardXSize: 15,
    boardYSize: 15,
    maxVisits: Number(elements.maxVisits.value),
    reportDuringSearchEvery: 0.5,
    userColor: elements.userColor.value,
    clientRequestId,
  })) {
    setAnalysisStatus("요청 전송");
  } else {
    activeClientRequestId = null;
  }
});
elements.cancel.addEventListener("click", cancelAnalysis);
elements.undo.addEventListener("click", async () => {
  cancelAnalysis(); moves.pop(); clearAnalysisDisplay(); drawBoard(); await refreshLegality();
});
elements.reset.addEventListener("click", async () => {
  cancelAnalysis(); moves = []; clearAnalysisDisplay(); drawBoard(); await refreshLegality();
});

function updateEngineBadge(engine) {
  if (!engine) return;
  elements.engineStatus.textContent = `엔진 ${engine.state} · PID ${engine.pid ?? "—"}`;
  elements.engineStatus.className = `status ${engine.state === "error" ? "error" : ""}`.trim();
}

async function refreshStatus() {
  try {
    const response = await fetch("/api/status");
    updateEngineBadge((await response.json()).engine);
  } catch (error) {
    elements.engineStatus.textContent = `서버 상태 오류: ${error.message}`;
    elements.engineStatus.className = "status error";
  }
}

drawBoard();
refreshLegality();
connectWebSocket();
refreshStatus();
setInterval(refreshStatus, 2000);
