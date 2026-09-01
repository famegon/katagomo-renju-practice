const BOARD_SIZE = 15;
const BOARD_CAPACITY = BOARD_SIZE * BOARD_SIZE;
const POLICY_LENGTH = BOARD_CAPACITY + 1;
const COLUMNS = "ABCDEFGHJKLMNOP";
const PLAYERS = new Set(["B", "W"]);
const OFFICIAL_POSITION_SOURCE = "KataGomo Board::isForbidden()";
const OFFICIAL_HISTORY_SOURCE = "KataGomo BoardHistory::makeBoardMoveAssumeLegal()";
const STAGE_PURPOSE = Object.freeze({
  base: "comparison_base",
  a: "comparison_a",
  b: "comparison_b",
});
const NEXT_STAGE = Object.freeze({ base: "a", a: "b", b: "complete" });

export const COMPARISON_LAB_VERSION = 1;

function fail(message) {
  throw new Error(message);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneJson(value, field = "value", seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${field}에는 유한한 숫자만 사용할 수 있습니다`);
    return value;
  }
  if (typeof value !== "object") fail(`${field}에는 JSON 호환 값만 사용할 수 있습니다`);
  if (seen.has(value)) fail(`${field}에는 순환 참조를 사용할 수 없습니다`);
  seen.add(value);
  let copy;
  if (Array.isArray(value)) {
    copy = value.map((entry, index) => cloneJson(entry, `${field}[${index}]`, seen));
  } else {
    if (!isPlainObject(value)) fail(`${field}에는 JSON 객체만 사용할 수 있습니다`);
    copy = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) copy[key] = cloneJson(entry, `${field}.${key}`, seen);
    }
  }
  seen.delete(value);
  return copy;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function immutableJson(value) {
  return deepFreeze(cloneJson(value));
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${field}는 비어 있지 않은 문자열이어야 합니다`);
  }
  return value.trim();
}

function requireInteger(value, field, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${field}는 ${minimum}..${maximum} 정수여야 합니다`);
  }
  return value;
}

function requireProbability(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    fail(`${field}는 0..1의 유한한 숫자여야 합니다`);
  }
  return value;
}

function normalizeCoordinate(value, field = "move") {
  if (typeof value !== "string") fail(`${field}는 KataGomo 좌표 문자열이어야 합니다`);
  const move = value.trim().toUpperCase();
  const column = COLUMNS.indexOf(move[0]);
  const row = Number(move.slice(1));
  if (column < 0 || !Number.isInteger(row) || row < 1 || row > BOARD_SIZE) {
    fail(`${field}에 유효한 15x15 KataGomo 좌표가 필요합니다: ${value}`);
  }
  return `${COLUMNS[column]}${row}`;
}

function normalizeAnalysisMove(value, field = "move") {
  if (typeof value === "string" && value.trim().toUpperCase() === "PASS") return "PASS";
  return normalizeCoordinate(value, field);
}

export function comparisonPolicyIndex(move) {
  const normalized = normalizeCoordinate(move);
  const x = COLUMNS.indexOf(normalized[0]);
  const yFromTop = BOARD_SIZE - Number(normalized.slice(1));
  return yFromTop * BOARD_SIZE + x;
}

function normalizeMoves(value) {
  if (!Array.isArray(value) || value.length > BOARD_CAPACITY) {
    fail(`moves는 최대 ${BOARD_CAPACITY}개의 수를 담은 배열이어야 합니다`);
  }
  const occupied = new Set();
  return value.map((entry, index) => {
    if (!Array.isArray(entry) || entry.length !== 2) fail(`moves[${index}]는 [player, move]여야 합니다`);
    const expectedPlayer = index % 2 === 0 ? "B" : "W";
    if (entry[0] !== expectedPlayer) fail(`moves[${index}]는 ${expectedPlayer} 차례여야 합니다`);
    const move = normalizeCoordinate(entry[1], `moves[${index}][1]`);
    if (occupied.has(move)) fail(`moves에 중복 착수 ${move}가 있습니다`);
    occupied.add(move);
    return [expectedPlayer, move];
  });
}

function normalizeCoordinateList(value, field, occupied = new Set()) {
  if (!Array.isArray(value)) fail(`${field}는 좌표 배열이어야 합니다`);
  const seen = new Set();
  const moves = value.map((entry, index) => normalizeCoordinate(entry, `${field}[${index}]`));
  for (const move of moves) {
    if (seen.has(move)) fail(`${field}에 중복 좌표 ${move}가 있습니다`);
    if (occupied.has(move)) fail(`${field}에 이미 착수된 좌표 ${move}가 있습니다`);
    seen.add(move);
  }
  return moves;
}

function normalizeOfficialBasePosition(position, moves, player) {
  if (!isPlainObject(position)) fail("officialPosition은 공식 helper JSON 객체여야 합니다");
  if (position.boardXSize !== BOARD_SIZE || position.boardYSize !== BOARD_SIZE
    || position.rules !== "renju" || position.isValid !== true) {
    fail("officialPosition은 유효한 15x15 Renju 결과여야 합니다");
  }
  if (position.source !== OFFICIAL_POSITION_SOURCE
    || position.historySource !== OFFICIAL_HISTORY_SOURCE) {
    fail("officialPosition은 공식 KataGomo helper 출처여야 합니다");
  }
  if (position.moveCount !== moves.length || position.nextPlayer !== player) {
    fail("officialPosition의 수순/차례가 base snapshot과 다릅니다");
  }
  if (position.isTerminal !== false || position.outcome !== "ongoing"
    || position.winner !== null || position.terminalReason !== null
    || position.terminalMove !== null) {
    fail("비교 시작 위치는 진행 중인 공식 position이어야 합니다");
  }
  const occupied = new Set(moves.map(([, move]) => move));
  const legalMoves = normalizeCoordinateList(position.legalMoves, "officialPosition.legalMoves", occupied);
  const forbiddenMoves = normalizeCoordinateList(
    position.forbiddenMoves, "officialPosition.forbiddenMoves", occupied,
  );
  const forbidden = new Set(forbiddenMoves);
  if (legalMoves.some((move) => forbidden.has(move))) {
    fail("officialPosition legalMoves와 forbiddenMoves는 겹칠 수 없습니다");
  }
  if (legalMoves.length + forbiddenMoves.length !== BOARD_CAPACITY - moves.length) {
    fail("officialPosition이 모든 빈 교차점의 합법성을 포함해야 합니다");
  }
  if (player === "W" && forbiddenMoves.length !== 0) {
    fail("백 차례에는 흑 금수를 적용할 수 없습니다");
  }
  return { legalMoves, forbiddenMoves };
}

function requireComparisonLab(comparison) {
  if (!isPlainObject(comparison) || comparison.kind !== "ComparisonLab"
    || comparison.schemaVersion !== COMPARISON_LAB_VERSION) {
    fail("유효한 ComparisonLab 상태가 필요합니다");
  }
}

function otherPlayer(player) {
  return player === "B" ? "W" : "B";
}

function winrateForPlayer(blackWinrate, player) {
  return blackWinrate === null ? null : player === "B" ? blackWinrate : 1 - blackWinrate;
}

export function createComparisonLab({
  moves,
  player,
  positionKey,
  revision,
  officialPosition,
  moveA,
  moveB,
  maxVisits,
  runId,
  sessionEpoch,
} = {}) {
  const baseMoves = normalizeMoves(moves);
  if (!PLAYERS.has(player) || player !== (baseMoves.length % 2 === 0 ? "B" : "W")) {
    fail("player는 base moves의 현재 차례와 같아야 합니다");
  }
  const normalizedPositionKey = requireString(positionKey, "positionKey");
  const normalizedRevision = requireInteger(revision, "revision");
  const normalizedMaxVisits = requireInteger(maxVisits, "maxVisits", 1, 10_000);
  const normalizedRunId = requireString(runId, "runId");
  const normalizedSessionEpoch = requireString(sessionEpoch, "sessionEpoch");
  const official = normalizeOfficialBasePosition(officialPosition, baseMoves, player);
  const a = normalizeCoordinate(moveA, "moveA");
  const b = normalizeCoordinate(moveB, "moveB");
  if (a === b) fail("moveA와 moveB는 서로 다른 수여야 합니다");
  const legal = new Set(official.legalMoves);
  if (!legal.has(a) || !legal.has(b)) fail("moveA와 moveB는 official legalMoves에 있어야 합니다");

  return immutableJson({
    kind: "ComparisonLab",
    schemaVersion: COMPARISON_LAB_VERSION,
    runId: normalizedRunId,
    sessionEpoch: normalizedSessionEpoch,
    status: "ready",
    stage: "base",
    base: {
      moves: baseMoves,
      player,
      positionKey: normalizedPositionKey,
      revision: normalizedRevision,
      legalMoves: official.legalMoves,
      forbiddenMoves: official.forbiddenMoves,
    },
    selections: { a, b },
    maxVisits: normalizedMaxVisits,
    usedClientRequestIds: [],
    activeRequest: null,
    partial: null,
    results: { base: null, a: null, b: null },
    lastEvent: { kind: "created", stage: "base" },
  });
}

export function comparisonStageDescriptor(comparison) {
  requireComparisonLab(comparison);
  if (!Object.hasOwn(STAGE_PURPOSE, comparison.stage)) return null;
  const isBase = comparison.stage === "base";
  const moves = isBase
    ? comparison.base.moves
    : [...comparison.base.moves, [comparison.base.player, comparison.selections[comparison.stage]]];
  return immutableJson({
    stage: comparison.stage,
    purpose: STAGE_PURPOSE[comparison.stage],
    moves,
    player: isBase ? comparison.base.player : otherPlayer(comparison.base.player),
    positionMoveCount: moves.length,
    positionRevision: comparison.base.revision,
    positionKey: comparison.base.positionKey,
    maxVisits: comparison.maxVisits,
  });
}

function resolveClientRequestId(comparison, descriptor, options) {
  if (!isPlainObject(options)) fail("clientRequestId 또는 createClientRequestId가 필요합니다");
  const hasId = options.clientRequestId !== undefined;
  const hasFactory = options.createClientRequestId !== undefined;
  if (hasId === hasFactory) fail("clientRequestId와 createClientRequestId 중 정확히 하나가 필요합니다");
  const context = immutableJson({
    runId: comparison.runId,
    stage: descriptor.stage,
    purpose: descriptor.purpose,
    positionKey: descriptor.positionKey,
    positionRevision: descriptor.positionRevision,
    positionMoveCount: descriptor.positionMoveCount,
    maxVisits: descriptor.maxVisits,
  });
  const rawId = hasFactory
    ? options.createClientRequestId(context)
    : options.clientRequestId;
  const clientRequestId = requireString(rawId, "clientRequestId");
  if (clientRequestId.length > 128) fail("clientRequestId는 128자를 넘을 수 없습니다");
  if (comparison.usedClientRequestIds.includes(clientRequestId)) {
    fail(`comparison clientRequestId는 run 안에서 고유해야 합니다: ${clientRequestId}`);
  }
  return clientRequestId;
}

export function beginComparisonRequest(comparison, options = {}) {
  requireComparisonLab(comparison);
  if (comparison.status !== "ready" || comparison.activeRequest !== null) {
    fail("ready 상태의 comparison stage만 시작할 수 있습니다");
  }
  const descriptor = comparisonStageDescriptor(comparison);
  if (descriptor === null) fail("완료된 comparison에는 새 요청을 만들 수 없습니다");
  const clientRequestId = resolveClientRequestId(comparison, descriptor, options);
  const activeRequest = {
    clientRequestId,
    analysisPurpose: descriptor.purpose,
    positionRevision: descriptor.positionRevision,
    positionMoveCount: descriptor.positionMoveCount,
    requestedMaxVisits: descriptor.maxVisits,
    sessionEpoch: comparison.sessionEpoch,
  };
  const request = immutableJson({
    action: "analyze",
    moves: descriptor.moves,
    rules: "renju",
    boardXSize: BOARD_SIZE,
    boardYSize: BOARD_SIZE,
    maxVisits: comparison.maxVisits,
    reportDuringSearchEvery: 0.5,
    userColor: comparison.base.player,
    clientRequestId,
    analysisPurpose: descriptor.purpose,
    positionRevision: comparison.base.revision,
    sessionEpoch: comparison.sessionEpoch,
  });
  const next = immutableJson({
    ...comparison,
    status: "running",
    activeRequest,
    partial: null,
    usedClientRequestIds: [...comparison.usedClientRequestIds, clientRequestId],
    lastEvent: { kind: "requested", stage: comparison.stage, clientRequestId },
  });
  return deepFreeze({ comparison: next, request });
}

function responseTargetsActiveRequest(comparison, response) {
  const active = comparison.activeRequest;
  return comparison.status === "running" && active !== null
    && response.clientRequestId === active.clientRequestId
    && response.analysisPurpose === active.analysisPurpose
    && response.positionRevision === active.positionRevision
    && response.positionMoveCount === active.positionMoveCount
    && response.requestedMaxVisits === active.requestedMaxVisits
    && response.sessionEpoch === active.sessionEpoch;
}

function normalizePv(value, field) {
  if (!Array.isArray(value) || value.length > BOARD_CAPACITY) fail(`${field}는 PV 분석 수 배열이어야 합니다`);
  return value.map((move, index) => normalizeAnalysisMove(move, `${field}[${index}]`));
}

function normalizeCandidate(value, index) {
  if (!isPlainObject(value)) fail(`candidates[${index}]는 객체여야 합니다`);
  const candidate = cloneJson(value, `candidates[${index}]`);
  candidate.move = normalizeAnalysisMove(value.move, `candidates[${index}].move`);
  if (value.order === null || value.order === undefined) {
    candidate.order = null;
  } else {
    candidate.order = requireInteger(value.order, `candidates[${index}].order`);
  }
  candidate.pv = normalizePv(value.pv ?? [], `candidates[${index}].pv`);
  if (value.visits !== undefined) {
    candidate.visits = requireInteger(value.visits, `candidates[${index}].visits`);
  }
  if (value.blackWinrate !== undefined) {
    candidate.blackWinrate = requireProbability(
      value.blackWinrate, `candidates[${index}].blackWinrate`,
    );
  }
  if (value.visitShare !== undefined) {
    candidate.visitShare = requireProbability(
      value.visitShare, `candidates[${index}].visitShare`,
    );
  }
  return candidate;
}

function normalizeAnalysisSnapshot(response, descriptor) {
  if (!Array.isArray(response.policy) || response.policy.length !== POLICY_LENGTH) {
    fail(`comparison policy는 ${POLICY_LENGTH}개여야 합니다`);
  }
  const policy = response.policy.map((value, index) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      fail(`policy[${index}]는 유한한 숫자여야 합니다`);
    }
    return value;
  });
  if (!Array.isArray(response.candidates)) fail("comparison candidates 배열이 필요합니다");
  const candidates = response.candidates.map(normalizeCandidate);
  if (!isPlainObject(response.rootInfo)) fail("comparison rootInfo 객체가 필요합니다");
  const rootInfo = cloneJson(response.rootInfo, "rootInfo");
  rootInfo.visits = requireInteger(response.rootInfo.visits, "rootInfo.visits");
  rootInfo.blackWinrate = requireProbability(
    response.rootInfo.blackWinrate, "rootInfo.blackWinrate",
  );
  if (response.rootInfo.currentPlayer !== descriptor.player) {
    fail("rootInfo.currentPlayer가 comparison stage 차례와 다릅니다");
  }
  if (response.winratePerspective !== "BLACK"
    || (response.rootInfo.winratePerspective !== undefined
      && response.rootInfo.winratePerspective !== "BLACK")) {
    fail("comparison winrate는 BLACK 관점이어야 합니다");
  }
  if (response.analysisInsufficient !== undefined
    && typeof response.analysisInsufficient !== "boolean") {
    fail("analysisInsufficient는 boolean이어야 합니다");
  }
  const rawReasons = response.analysisInsufficientReasons
    ?? response.insufficientReasons
    ?? [];
  if (!Array.isArray(rawReasons)
    || rawReasons.some((reason) => typeof reason !== "string" || reason.trim() === "")) {
    fail("analysisInsufficientReasons는 비어 있지 않은 문자열 배열이어야 합니다");
  }
  return immutableJson({
    policy,
    candidates,
    rootInfo,
    analysisInsufficient: response.analysisInsufficient === true,
    analysisInsufficientReasons: rawReasons.map((reason) => reason.trim()),
    requestedMaxVisits: response.requestedMaxVisits,
  });
}

function normalizeTerminalState(value, comparison, descriptor) {
  if (!isPlainObject(value) || value.boardXSize !== BOARD_SIZE || value.boardYSize !== BOARD_SIZE
    || value.rules !== "renju" || value.isValid !== true || value.isTerminal !== true) {
    fail("forced branch terminal에는 유효한 공식 15x15 Renju 종국이 필요합니다");
  }
  if (value.source !== OFFICIAL_POSITION_SOURCE || value.historySource !== OFFICIAL_HISTORY_SOURCE) {
    fail("forced branch terminal은 공식 KataGomo helper 출처여야 합니다");
  }
  const forcedMove = comparison.selections[comparison.stage];
  if (value.moveCount !== descriptor.positionMoveCount
    || value.nextPlayer !== descriptor.player
    || normalizeCoordinate(value.terminalMove, "gameState.terminalMove") !== forcedMove) {
    fail("forced branch terminal의 수순/차례/마지막 수가 stage와 다릅니다");
  }
  if (!Array.isArray(value.legalMoves) || value.legalMoves.length !== 0
    || !Array.isArray(value.forbiddenMoves) || value.forbiddenMoves.length !== 0) {
    fail("종국 gameState는 합법/금수 목록을 노출할 수 없습니다");
  }
  if (value.outcome === "black_win") {
    if (value.winner !== "B" || value.terminalReason !== "line_win"
      || comparison.base.player !== "B") fail("black_win 종국 계약이 다릅니다");
  } else if (value.outcome === "white_win") {
    if (value.winner !== "W" || !["line_win", "black_forbidden"].includes(value.terminalReason)) {
      fail("white_win 종국 계약이 다릅니다");
    }
    if ((value.terminalReason === "line_win" && comparison.base.player !== "W")
      || (value.terminalReason === "black_forbidden" && comparison.base.player !== "B")) {
      fail("white_win 종국의 착수자/종료 사유 계약이 다릅니다");
    }
  } else if (value.outcome === "draw") {
    if (value.winner !== null || value.terminalReason !== "board_full") fail("draw 종국 계약이 다릅니다");
  } else {
    fail("forced branch terminal outcome이 유효하지 않습니다");
  }
  return immutableJson(value);
}

function advanceWithResult(comparison, result, eventKind) {
  const finishedStage = comparison.stage;
  const nextStage = NEXT_STAGE[finishedStage];
  return immutableJson({
    ...comparison,
    status: nextStage === "complete" ? "complete" : "ready",
    stage: nextStage,
    activeRequest: null,
    partial: null,
    results: { ...comparison.results, [finishedStage]: result },
    lastEvent: { kind: eventKind, stage: finishedStage },
  });
}

export function applyComparisonResponse(comparison, response) {
  requireComparisonLab(comparison);
  if (!isPlainObject(response) || !responseTargetsActiveRequest(comparison, response)) {
    return comparison;
  }
  const descriptor = comparisonStageDescriptor(comparison);
  if (descriptor === null) return comparison;

  if (response.type === "position") {
    if (comparison.stage === "base" || response.code !== "position_terminal") return comparison;
    const terminalState = normalizeTerminalState(response.gameState, comparison, descriptor);
    return advanceWithResult(
      comparison,
      immutableJson({ kind: "terminal", terminalState }),
      "terminal",
    );
  }
  if (response.type !== "analysis" || typeof response.isFinal !== "boolean") return comparison;
  if (response.noResults === true) {
    return immutableJson({
      ...comparison,
      status: "canceled",
      activeRequest: null,
      partial: null,
      lastEvent: { kind: "no-results", stage: comparison.stage },
    });
  }
  const snapshot = normalizeAnalysisSnapshot(response, descriptor);
  if (!response.isFinal) {
    return immutableJson({
      ...comparison,
      partial: { stage: comparison.stage, snapshot },
      lastEvent: { kind: "partial", stage: comparison.stage },
    });
  }
  return advanceWithResult(
    comparison,
    immutableJson({ kind: "analysis", snapshot }),
    "final",
  );
}

export function cancelComparisonLab(comparison, reason = "user") {
  requireComparisonLab(comparison);
  if (["complete", "canceled", "invalidated"].includes(comparison.status)) return comparison;
  return immutableJson({
    ...comparison,
    status: "canceled",
    activeRequest: null,
    partial: null,
    lastEvent: { kind: "canceled", stage: comparison.stage, reason: requireString(reason, "reason") },
  });
}

export function invalidateComparisonLab(comparison, reason = "live-position-changed") {
  requireComparisonLab(comparison);
  if (comparison.status === "invalidated") return comparison;
  return immutableJson({
    ...comparison,
    status: "invalidated",
    activeRequest: null,
    partial: null,
    lastEvent: { kind: "invalidated", stage: comparison.stage, reason: requireString(reason, "reason") },
  });
}

function basePolicyMetrics(comparison, baseSnapshot, move) {
  if (baseSnapshot === null) return { rawPolicy: null, rank: null };
  const rawPolicy = baseSnapshot.policy[comparisonPolicyIndex(move)];
  if (rawPolicy < 0) return { rawPolicy, rank: null };
  const greater = comparison.base.legalMoves.reduce((count, legalMove) => (
    baseSnapshot.policy[comparisonPolicyIndex(legalMove)] > rawPolicy ? count + 1 : count
  ), 0);
  return { rawPolicy, rank: greater + 1 };
}

function deriveBranch(comparison, key, baseSnapshot, baseBlackWinrate) {
  const move = comparison.selections[key];
  const policy = basePolicyMetrics(comparison, baseSnapshot, move);
  const baseCandidate = baseSnapshot?.candidates.find((candidate) => candidate.move === move) ?? null;
  const branchResult = comparison.results[key];
  const afterBlackWinrate = branchResult?.kind === "analysis"
    ? branchResult.snapshot.rootInfo.blackWinrate
    : null;
  const afterRootVisits = branchResult?.kind === "analysis"
    ? branchResult.snapshot.rootInfo.visits
    : null;
  const opponentOrder0 = branchResult?.kind === "analysis"
    ? branchResult.snapshot.candidates.find((candidate) => candidate.order === 0) ?? null
    : null;
  const afterMoverWinrate = winrateForPlayer(afterBlackWinrate, comparison.base.player);
  const baseMoverWinrate = winrateForPlayer(baseBlackWinrate, comparison.base.player);
  return {
    key,
    label: key.toUpperCase(),
    move,
    baseRawPolicy: policy.rawPolicy,
    basePolicyRank: policy.rank,
    basePolicyRankBasis: "official-helper-legal-moves",
    baseMctsOrder: baseCandidate?.order ?? null,
    baseMctsVisits: baseCandidate?.visits ?? null,
    baseVisitShare: baseCandidate?.visitShare ?? null,
    baseRequestedMaxVisits: baseSnapshot?.requestedMaxVisits ?? null,
    baseAnalysisInsufficient: baseSnapshot?.analysisInsufficient ?? null,
    baseAnalysisInsufficientReasons: baseSnapshot?.analysisInsufficientReasons ?? [],
    afterBlackWinrate,
    afterMoverWinrate,
    afterRootVisits,
    afterRequestedMaxVisits: branchResult?.kind === "analysis"
      ? branchResult.snapshot.requestedMaxVisits
      : null,
    afterAnalysisInsufficient: branchResult?.kind === "analysis"
      ? branchResult.snapshot.analysisInsufficient
      : null,
    afterAnalysisInsufficientReasons: branchResult?.kind === "analysis"
      ? branchResult.snapshot.analysisInsufficientReasons
      : [],
    opponentOrder0Move: opponentOrder0?.move ?? null,
    opponentOrder0Pv: opponentOrder0?.pv ?? [],
    blackWinrateDeltaFromBase: afterBlackWinrate === null || baseBlackWinrate === null
      ? null
      : afterBlackWinrate - baseBlackWinrate,
    moverWinrateDeltaFromBase: afterMoverWinrate === null || baseMoverWinrate === null
      ? null
      : afterMoverWinrate - baseMoverWinrate,
    resultKind: branchResult?.kind ?? null,
    terminalOutcome: branchResult?.kind === "terminal"
      ? branchResult.terminalState.outcome
      : null,
  };
}

export function deriveComparisonResult(comparison) {
  requireComparisonLab(comparison);
  const baseResult = comparison.results.base;
  const baseSnapshot = baseResult?.kind === "analysis" ? baseResult.snapshot : null;
  const baseBlackWinrate = baseSnapshot?.rootInfo.blackWinrate ?? null;
  return immutableJson({
    runId: comparison.runId,
    status: comparison.status,
    positionKey: comparison.base.positionKey,
    revision: comparison.base.revision,
    player: comparison.base.player,
    maxVisits: comparison.maxVisits,
    baseBlackWinrate,
    baseMoverWinrate: winrateForPlayer(baseBlackWinrate, comparison.base.player),
    baseRootVisits: baseSnapshot?.rootInfo.visits ?? null,
    branches: {
      a: deriveBranch(comparison, "a", baseSnapshot, baseBlackWinrate),
      b: deriveBranch(comparison, "b", baseSnapshot, baseBlackWinrate),
    },
  });
}
