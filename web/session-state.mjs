const BOARD_SIZE = 15;
const BOARD_CAPACITY = BOARD_SIZE * BOARD_SIZE;
const COLUMNS = "ABCDEFGHJKLMNOP";
const PLAYERS = new Set(["B", "W"]);
const POSITION_SOURCE = "KataGomo Board::isForbidden()";
const HISTORY_SOURCE = "KataGomo BoardHistory::makeBoardMoveAssumeLegal()";

export const SESSION_STATE_VERSION = 1;

export const ANALYSIS_JOB_STATES = Object.freeze([
  "requested",
  "streaming",
  "final",
  "canceled",
  "interrupted",
  "failed",
]);

const LIVE_ANALYSIS_STATES = new Set(["requested", "streaming"]);
const ANALYSIS_TRANSITIONS = Object.freeze({
  requested: new Set(["streaming", "final", "canceled", "interrupted", "failed"]),
  streaming: new Set(["streaming", "final", "canceled", "interrupted", "failed"]),
  final: new Set(),
  canceled: new Set(),
  interrupted: new Set(),
  failed: new Set(),
});

const PRACTICE_COMPLETION_REASONS = new Set(["game-terminal", "ply-limit", "manual"]);
const ANALYSIS_PURPOSES = new Set([
  "manual", "user_pre", "post_user_ai", "final_grade",
  "comparison_base", "comparison_a", "comparison_b",
]);

function fail(message) {
  throw new Error(message);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneJsonValue(value) {
  if (value === null || ["string", "number", "boolean", "undefined"].includes(typeof value)) {
    return value;
  }
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (!isPlainObject(value)) fail("세션 상태에는 JSON 호환 값만 저장할 수 있습니다");
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, cloneJsonValue(entry)]),
  );
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function immutableCopy(value) {
  return deepFreeze(cloneJsonValue(value));
}

function requireNonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim() === "") fail(`${field}는 비어 있지 않은 문자열이어야 합니다`);
  return value;
}

function requireRevision(value, field = "revision") {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${field}은 0 이상의 안전한 정수여야 합니다`);
  return value;
}

function normalizeCoordinate(value, field = "move") {
  if (typeof value !== "string") fail(`${field}는 KataGomo 좌표 문자열이어야 합니다`);
  const move = value.toUpperCase();
  const column = COLUMNS.indexOf(move[0]);
  const row = Number(move.slice(1));
  if (column < 0 || !Number.isInteger(row) || row < 1 || row > BOARD_SIZE) {
    fail(`${field}에 유효한 15x15 KataGomo 좌표가 필요합니다: ${value}`);
  }
  return `${COLUMNS[column]}${row}`;
}

export function expectedPlayerAtPly(ply) {
  if (!Number.isInteger(ply) || ply < 1 || ply > BOARD_CAPACITY) {
    fail(`ply는 1..${BOARD_CAPACITY} 정수여야 합니다`);
  }
  return ply % 2 === 1 ? "B" : "W";
}

export function nextPlayerForMoves(moves) {
  const normalized = normalizeMoves(moves);
  return normalized.length % 2 === 0 ? "B" : "W";
}

function normalizeMoves(moves) {
  if (!Array.isArray(moves)) fail("moves는 배열이어야 합니다");
  if (moves.length > BOARD_CAPACITY) fail(`moves는 ${BOARD_CAPACITY}수를 넘을 수 없습니다`);
  const occupied = new Set();
  return moves.map((entry, index) => {
    if (!Array.isArray(entry) || entry.length !== 2) fail(`moves[${index}]는 [player, move]여야 합니다`);
    const [player, rawMove] = entry;
    const expected = expectedPlayerAtPly(index + 1);
    if (player !== expected) fail(`${index + 1}수는 ${expected} 차례여야 합니다`);
    const move = normalizeCoordinate(rawMove, `moves[${index}][1]`);
    if (occupied.has(move)) fail(`중복 착수 좌표입니다: ${move}`);
    occupied.add(move);
    return [player, move];
  });
}

function normalizeCoordinateList(value, field, occupied) {
  if (!Array.isArray(value)) fail(`${field}는 배열이어야 합니다`);
  const seen = new Set();
  const normalized = value.map((entry, index) => normalizeCoordinate(entry, `${field}[${index}]`));
  for (const move of normalized) {
    if (seen.has(move)) fail(`${field}에 중복 좌표가 있습니다: ${move}`);
    if (occupied.has(move)) fail(`${field}에 이미 착수된 좌표가 있습니다: ${move}`);
    seen.add(move);
  }
  return normalized;
}

function normalizeOfficialPositionState(positionState, moves) {
  if (!isPlainObject(positionState)) fail("positionState는 공식 helper JSON 객체여야 합니다");
  if (positionState.boardXSize !== BOARD_SIZE || positionState.boardYSize !== BOARD_SIZE) {
    fail("positionState는 15x15 보드여야 합니다");
  }
  if (positionState.rules !== "renju" || positionState.isValid !== true) {
    fail("positionState는 유효한 Renju 결과여야 합니다");
  }
  if (positionState.source !== POSITION_SOURCE || positionState.historySource !== HISTORY_SOURCE) {
    fail("positionState는 공식 KataGomo helper 출처를 가져야 합니다");
  }
  if (positionState.moveCount !== moves.length) fail("positionState.moveCount가 GameDocument 수순과 다릅니다");
  const nextPlayer = moves.length % 2 === 0 ? "B" : "W";
  if (positionState.nextPlayer !== nextPlayer) fail("positionState.nextPlayer가 수순과 다릅니다");
  if (typeof positionState.isTerminal !== "boolean") fail("positionState.isTerminal은 boolean이어야 합니다");

  const occupied = new Set(moves.map(([, move]) => move));
  const forbiddenMoves = normalizeCoordinateList(positionState.forbiddenMoves, "forbiddenMoves", occupied);
  const legalMoves = normalizeCoordinateList(positionState.legalMoves, "legalMoves", occupied);
  const forbidden = new Set(forbiddenMoves);
  if (legalMoves.some((move) => forbidden.has(move))) fail("legalMoves와 forbiddenMoves는 겹칠 수 없습니다");

  const winner = positionState.winner;
  const outcome = positionState.outcome;
  const terminalReason = positionState.terminalReason;
  const terminalMove = positionState.terminalMove === null
    ? null
    : normalizeCoordinate(positionState.terminalMove, "terminalMove");

  if (positionState.isTerminal) {
    if (legalMoves.length !== 0 || forbiddenMoves.length !== 0) {
      fail("종국 positionState는 착수 가능 좌표를 노출할 수 없습니다");
    }
    if (terminalMove === null || terminalMove !== moves.at(-1)?.[1]) {
      fail("종국 terminalMove는 마지막 수와 같아야 합니다");
    }
    if (outcome === "black_win") {
      if (winner !== "B" || terminalReason !== "line_win") fail("black_win 계약이 일치하지 않습니다");
    } else if (outcome === "white_win") {
      if (winner !== "W" || !["line_win", "black_forbidden"].includes(terminalReason)) {
        fail("white_win 계약이 일치하지 않습니다");
      }
    } else if (outcome === "draw") {
      if (winner !== null || terminalReason !== "board_full") fail("draw 계약이 일치하지 않습니다");
    } else {
      fail("종국 positionState에 유효한 outcome이 필요합니다");
    }
    if (terminalReason === "black_forbidden" && moves.at(-1)?.[0] !== "B") {
      fail("black_forbidden의 마지막 수는 흑이어야 합니다");
    }
  } else {
    if (winner !== null || outcome !== "ongoing" || terminalReason !== null || terminalMove !== null) {
      fail("진행 중 positionState에 종국 메타데이터가 있습니다");
    }
    if (nextPlayer === "W" && forbiddenMoves.length !== 0) {
      fail("백 차례에는 흑 금수를 적용할 수 없습니다");
    }
    if (legalMoves.length + forbiddenMoves.length !== BOARD_CAPACITY - moves.length) {
      fail("진행 중 legalMoves와 forbiddenMoves가 모든 빈 교차점을 포함해야 합니다");
    }
  }

  return {
    boardXSize: BOARD_SIZE,
    boardYSize: BOARD_SIZE,
    rules: "renju",
    isValid: true,
    moveCount: moves.length,
    nextPlayer,
    isTerminal: positionState.isTerminal,
    winner,
    outcome,
    terminalReason,
    terminalMove,
    forbiddenMoves,
    legalMoves,
    source: POSITION_SOURCE,
    historySource: HISTORY_SOURCE,
  };
}

function buildGameDocument(moves, revision, positionState, positionStateRevision) {
  return immutableCopy({
    kind: "GameDocument",
    schemaVersion: SESSION_STATE_VERSION,
    moves,
    revision,
    positionState,
    positionStateRevision,
  });
}

export function createGameDocument({
  moves = [],
  revision = 0,
  positionState = null,
  positionStateRevision = positionState === null ? null : revision,
} = {}) {
  const normalizedMoves = normalizeMoves(moves);
  requireRevision(revision);
  if (positionState === null) {
    if (positionStateRevision !== null) fail("positionState가 없으면 positionStateRevision도 null이어야 합니다");
    return buildGameDocument(normalizedMoves, revision, null, null);
  }
  if (positionStateRevision !== revision) fail("공식 positionState는 현재 revision에만 결합할 수 있습니다");
  const normalizedState = normalizeOfficialPositionState(positionState, normalizedMoves);
  return buildGameDocument(normalizedMoves, revision, normalizedState, revision);
}

function requireGameDocument(document) {
  if (!isPlainObject(document) || document.kind !== "GameDocument"
    || document.schemaVersion !== SESSION_STATE_VERSION) fail("유효한 GameDocument가 필요합니다");
  requireRevision(document.revision);
}

export function gamePositionKey(document) {
  requireGameDocument(document);
  return JSON.stringify(document.moves);
}

export function hasCurrentOfficialPositionState(document) {
  requireGameDocument(document);
  return document.positionState !== null && document.positionStateRevision === document.revision;
}

export function replaceGameMoves(document, moves) {
  requireGameDocument(document);
  return createGameDocument({ moves, revision: document.revision + 1 });
}

// Use this when an operation invalidates helper/analysis results without
// changing the serialized moves (for example, a full session reset boundary).
export function bumpGameRevision(document) {
  requireGameDocument(document);
  return createGameDocument({ moves: document.moves, revision: document.revision + 1 });
}

export function withoutOfficialPositionState(document) {
  requireGameDocument(document);
  if (document.positionState === null) return document;
  return createGameDocument({ moves: document.moves, revision: document.revision });
}

export function appendGameMove(document, entry) {
  requireGameDocument(document);
  if (hasCurrentOfficialPositionState(document) && document.positionState.isTerminal) {
    fail("공식 종국 뒤에는 수를 추가할 수 없습니다");
  }
  return replaceGameMoves(document, [...document.moves, entry]);
}

export function truncateGameDocument(document, ply) {
  requireGameDocument(document);
  if (!Number.isInteger(ply) || ply < 0 || ply > document.moves.length) {
    fail("무르기 ply가 현재 수순 범위를 벗어났습니다");
  }
  return replaceGameMoves(document, document.moves.slice(0, ply));
}

export function withOfficialPositionState(document, positionState, responseRevision) {
  requireGameDocument(document);
  requireRevision(responseRevision, "responseRevision");
  if (responseRevision !== document.revision) return document;
  return createGameDocument({
    moves: document.moves,
    revision: document.revision,
    positionState,
    positionStateRevision: responseRevision,
  });
}

// Domain-language alias used by the app migration: a helper response is a
// commit only when it targets the exact current revision.
export const commitOfficialPositionState = withOfficialPositionState;

function normalizePracticeSettings(settings) {
  if (!isPlainObject(settings)) fail("PracticeAttempt.settings가 필요합니다");
  if (!PLAYERS.has(settings.userColor)) fail("settings.userColor는 B 또는 W여야 합니다");
  if (!isPlainObject(settings.endCondition)) fail("settings.endCondition이 필요합니다");
  let endCondition;
  if (settings.endCondition.kind === "manual") {
    endCondition = { kind: "manual" };
  } else if (settings.endCondition.kind === "ply"
    && Number.isInteger(settings.endCondition.ply)
    && settings.endCondition.ply >= 1
    && settings.endCondition.ply <= BOARD_CAPACITY) {
    endCondition = { kind: "ply", ply: settings.endCondition.ply };
  } else {
    fail("settings.endCondition은 manual 또는 1..225 ply여야 합니다");
  }
  if (!["immediate", "end"].includes(settings.gradingMode)) {
    fail("settings.gradingMode는 immediate 또는 end여야 합니다");
  }
  if (!Number.isInteger(settings.maxVisits) || settings.maxVisits < 1 || settings.maxVisits > 10_000) {
    fail("settings.maxVisits는 1..10000 정수여야 합니다");
  }
  return {
    userColor: settings.userColor,
    endCondition,
    gradingMode: settings.gradingMode,
    maxVisits: settings.maxVisits,
  };
}

function requirePracticeAttempt(attempt) {
  if (!isPlainObject(attempt) || attempt.kind !== "PracticeAttempt"
    || attempt.schemaVersion !== SESSION_STATE_VERSION) fail("유효한 PracticeAttempt가 필요합니다");
}

export function createPracticeAttempt({
  sessionEpoch,
  settings,
  openingMoves = [],
  startedAt,
  continuedFromPly = null,
} = {}) {
  requireNonEmptyString(sessionEpoch, "sessionEpoch");
  requireNonEmptyString(startedAt, "startedAt");
  const normalizedOpening = normalizeMoves(openingMoves);
  if (continuedFromPly !== null
    && (!Number.isInteger(continuedFromPly) || continuedFromPly < 0
      || continuedFromPly > normalizedOpening.length)) {
    fail("continuedFromPly가 openingMoves 범위를 벗어났습니다");
  }
  return immutableCopy({
    kind: "PracticeAttempt",
    schemaVersion: SESSION_STATE_VERSION,
    sessionEpoch,
    settings: normalizePracticeSettings(settings),
    openingMoves: normalizedOpening,
    startedAt,
    continuedFromPly,
    turnRecords: [],
    status: "active",
    completion: null,
  });
}

function normalizeTurnRecord(attempt, record) {
  if (!isPlainObject(record)) fail("turn record는 객체여야 합니다");
  if (!Number.isInteger(record.ply) || record.ply <= attempt.openingMoves.length
    || record.ply > BOARD_CAPACITY) fail("turn record.ply가 연습 범위를 벗어났습니다");
  if (record.userColor !== attempt.settings.userColor
    || record.userColor !== expectedPlayerAtPly(record.ply)) {
    fail("turn record의 userColor와 ply가 PracticeAttempt 설정과 다릅니다");
  }
  const normalized = cloneJsonValue(record);
  normalized.userMove = normalizeCoordinate(record.userMove, "turn record.userMove");
  return normalized;
}

export function appendPracticeTurnRecord(attempt, record) {
  requirePracticeAttempt(attempt);
  if (attempt.status !== "active") fail("완료 중이거나 완료된 PracticeAttempt에는 기록을 추가할 수 없습니다");
  const normalized = normalizeTurnRecord(attempt, record);
  const previousPly = attempt.turnRecords.at(-1)?.ply ?? attempt.openingMoves.length;
  if (normalized.ply <= previousPly) fail("turn record는 ply 오름차순으로만 추가할 수 있습니다");
  return immutableCopy({ ...attempt, turnRecords: [...attempt.turnRecords, normalized] });
}

export function trimPracticeTurnRecords(attempt, throughPly) {
  requirePracticeAttempt(attempt);
  if (attempt.status !== "active") fail("active PracticeAttempt만 무르기 기록을 정리할 수 있습니다");
  if (!Number.isInteger(throughPly) || throughPly < attempt.openingMoves.length
    || throughPly > BOARD_CAPACITY) fail("throughPly가 연습 범위를 벗어났습니다");
  return immutableCopy({
    ...attempt,
    turnRecords: attempt.turnRecords.filter((record) => record.ply <= throughPly),
  });
}

function verifyFinalMoves(attempt, finalMoves) {
  const normalized = normalizeMoves(finalMoves);
  if (normalized.length < attempt.openingMoves.length) fail("finalMoves가 openingMoves보다 짧습니다");
  for (let index = 0; index < attempt.openingMoves.length; index += 1) {
    if (normalized[index][0] !== attempt.openingMoves[index][0]
      || normalized[index][1] !== attempt.openingMoves[index][1]) {
      fail("finalMoves는 openingMoves를 그대로 포함해야 합니다");
    }
  }
  for (const record of attempt.turnRecords) {
    if (record.ply > normalized.length || normalized[record.ply - 1]?.[1] !== record.userMove) {
      fail("turn record가 finalMoves의 사용자 착수와 일치하지 않습니다");
    }
  }
  return normalized;
}

export function beginPracticeCompletion(attempt, {
  reason,
  finalMoves,
  endedAt,
  terminalState = null,
} = {}) {
  requirePracticeAttempt(attempt);
  if (attempt.status !== "active") fail("active PracticeAttempt만 완료를 시작할 수 있습니다");
  if (!PRACTICE_COMPLETION_REASONS.has(reason)) fail("지원하지 않는 PracticeAttempt 완료 사유입니다");
  requireNonEmptyString(endedAt, "endedAt");
  const normalizedMoves = verifyFinalMoves(attempt, finalMoves);
  let normalizedTerminalState = null;
  if (reason === "game-terminal") {
    if (terminalState === null) fail("game-terminal 완료에는 공식 terminalState가 필요합니다");
    normalizedTerminalState = normalizeOfficialPositionState(terminalState, normalizedMoves);
    if (!normalizedTerminalState.isTerminal) fail("game-terminal 완료에는 종국 positionState가 필요합니다");
  } else if (terminalState !== null) {
    fail("종국이 아닌 완료 사유에는 terminalState를 저장할 수 없습니다");
  }
  return immutableCopy({
    ...attempt,
    status: "summarizing",
    completion: {
      reason,
      endedAt,
      finalMoves: normalizedMoves,
      terminalState: normalizedTerminalState,
      summary: null,
    },
  });
}

export function finishPracticeCompletion(attempt, summary) {
  requirePracticeAttempt(attempt);
  if (attempt.status !== "summarizing" || attempt.completion === null) {
    fail("summarizing PracticeAttempt만 완료할 수 있습니다");
  }
  return immutableCopy({
    ...attempt,
    status: "completed",
    completion: { ...attempt.completion, summary: summary === null ? null : cloneJsonValue(summary) },
  });
}

function requireAnalysisJob(job) {
  if (!isPlainObject(job) || job.kind !== "AnalysisJob"
    || job.schemaVersion !== SESSION_STATE_VERSION) fail("유효한 AnalysisJob이 필요합니다");
  if (!ANALYSIS_JOB_STATES.includes(job.state)) fail("AnalysisJob.state가 잘못되었습니다");
}

function normalizeSessionEpoch(value) {
  if (value === null) return null;
  return requireNonEmptyString(value, "sessionEpoch");
}

export function createAnalysisJob({
  clientRequestId,
  positionRevision,
  sessionEpoch = null,
  analysisPurpose = "manual",
  requestedMaxVisits,
} = {}) {
  requireNonEmptyString(clientRequestId, "clientRequestId");
  requireRevision(positionRevision, "positionRevision");
  if (!ANALYSIS_PURPOSES.has(analysisPurpose)) fail("지원하지 않는 analysisPurpose입니다");
  if (!Number.isInteger(requestedMaxVisits) || requestedMaxVisits < 1 || requestedMaxVisits > 10_000) {
    fail("requestedMaxVisits는 1..10000 정수여야 합니다");
  }
  return immutableCopy({
    kind: "AnalysisJob",
    schemaVersion: SESSION_STATE_VERSION,
    clientRequestId,
    positionRevision,
    sessionEpoch: normalizeSessionEpoch(sessionEpoch),
    analysisPurpose,
    requestedMaxVisits,
    state: "requested",
  });
}

export const beginAnalysisJob = createAnalysisJob;

export function transitionAnalysisJob(job, nextState) {
  requireAnalysisJob(job);
  if (!ANALYSIS_JOB_STATES.includes(nextState)) fail("지원하지 않는 AnalysisJob 상태입니다");
  if (!ANALYSIS_TRANSITIONS[job.state].has(nextState)) {
    fail(`AnalysisJob은 ${job.state}에서 ${nextState}(으)로 전이할 수 없습니다`);
  }
  return immutableCopy({ ...job, state: nextState });
}

export function cancelAnalysisJob(job) {
  requireAnalysisJob(job);
  if (!LIVE_ANALYSIS_STATES.has(job.state)) return job;
  return transitionAnalysisJob(job, "canceled");
}

export function isAnalysisResponseCurrent(job, response, {
  positionRevision,
  sessionEpoch = null,
} = {}) {
  requireAnalysisJob(job);
  requireRevision(positionRevision, "현재 positionRevision");
  const currentEpoch = normalizeSessionEpoch(sessionEpoch);
  if (!LIVE_ANALYSIS_STATES.has(job.state)) return false;
  return response?.clientRequestId === job.clientRequestId
    && Number(response?.positionRevision) === job.positionRevision
    && (response?.sessionEpoch ?? null) === job.sessionEpoch
    && positionRevision === job.positionRevision
    && currentEpoch === job.sessionEpoch;
}

export function applyAnalysisResponse(job, response, currentContext) {
  if (!isAnalysisResponseCurrent(job, response, currentContext)) {
    return Object.freeze({ accepted: false, job });
  }
  const nextState = response.noResults === true
    ? "interrupted"
    : response.isFinal === true ? "final" : "streaming";
  return Object.freeze({ accepted: true, job: transitionAnalysisJob(job, nextState) });
}

export const acceptCurrentAnalysisResponse = applyAnalysisResponse;
