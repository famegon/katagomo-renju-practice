const BOARD_SIZE = 15;
const BOARD_CAPACITY = BOARD_SIZE * BOARD_SIZE;
const COLUMNS = "ABCDEFGHJKLMNOP";
const COMPLETION_REASONS = new Set(["game-terminal", "ply-limit", "manual"]);
const GRADING_MODES = new Set(["immediate", "end"]);
const PLAYERS = new Set(["B", "W"]);

export const HISTORY_SCHEMA_VERSION = 2;
export const HISTORY_LIMIT = 20;
export const HISTORY_STORAGE_KEY = "katagomo.renjuPractice.v2";
export const LEGACY_HISTORY_STORAGE_KEY = "katagomo.openingPractice.v1";

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fail(message) {
  throw new Error(message);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function cloneJson(value, field = "value", seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${field}에는 유한한 숫자만 저장할 수 있습니다`);
    return value;
  }
  if (typeof value !== "object") fail(`${field}에는 JSON 호환 값만 저장할 수 있습니다`);
  if (seen.has(value)) fail(`${field}에는 순환 참조를 저장할 수 없습니다`);
  seen.add(value);
  let copy;
  if (Array.isArray(value)) {
    copy = value.map((entry, index) => cloneJson(entry, `${field}[${index}]`, seen));
  } else {
    if (!isPlainObject(value)) fail(`${field}에는 JSON 객체만 저장할 수 있습니다`);
    copy = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) copy[key] = cloneJson(entry, `${field}.${key}`, seen);
    }
  }
  seen.delete(value);
  return copy;
}

function immutableJson(value) {
  return deepFreeze(cloneJson(value));
}

function diagnostic(code, message, details = {}) {
  return { code, message, ...details };
}

function result(history, diagnostics) {
  return immutableJson({ history, diagnostics });
}

function emptyHistory() {
  return { schemaVersion: HISTORY_SCHEMA_VERSION, records: [] };
}

function parseInput(input, diagnostics) {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch (error) {
    diagnostics.push(diagnostic("invalid-json", `저장 기록 JSON을 읽을 수 없습니다: ${error.message}`));
    return null;
  }
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") fail(`${field}는 비어 있지 않은 문자열이어야 합니다`);
  return value.trim();
}

function requireTimestamp(value, field) {
  const timestamp = requireString(value, field);
  if (!Number.isFinite(Date.parse(timestamp))) fail(`${field}는 유효한 날짜 문자열이어야 합니다`);
  return timestamp;
}

function normalizeCoordinate(value, field) {
  if (typeof value !== "string") fail(`${field}는 15x15 좌표 문자열이어야 합니다`);
  const move = value.trim().toUpperCase();
  const column = COLUMNS.indexOf(move[0]);
  const row = Number(move.slice(1));
  if (column < 0 || !Number.isInteger(row) || row < 1 || row > BOARD_SIZE) {
    fail(`${field}에 유효한 15x15 KataGomo 좌표가 필요합니다`);
  }
  return `${COLUMNS[column]}${row}`;
}

function normalizeMoves(value, field) {
  if (!Array.isArray(value) || value.length > BOARD_CAPACITY) {
    fail(`${field}는 최대 ${BOARD_CAPACITY}개의 수를 담은 배열이어야 합니다`);
  }
  const occupied = new Set();
  return value.map((entry, index) => {
    if (!Array.isArray(entry) || entry.length !== 2) fail(`${field}[${index}]는 [player, move]여야 합니다`);
    const expectedPlayer = index % 2 === 0 ? "B" : "W";
    if (entry[0] !== expectedPlayer) fail(`${field}[${index}]는 ${expectedPlayer} 차례여야 합니다`);
    const move = normalizeCoordinate(entry[1], `${field}[${index}][1]`);
    if (occupied.has(move)) fail(`${field}에 중복 착수 ${move}가 있습니다`);
    occupied.add(move);
    return [expectedPlayer, move];
  });
}

function normalizePositiveInteger(value, field, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail(`${field}는 1..${maximum} 정수여야 합니다`);
  }
  return value;
}

function normalizeEndCondition(settings) {
  const source = settings.endCondition;
  if (isPlainObject(source) && source.kind === "manual") return { kind: "manual" };
  if (isPlainObject(source) && source.kind === "ply") {
    return { kind: "ply", ply: normalizePositiveInteger(source.ply, "settings.endCondition.ply", BOARD_CAPACITY) };
  }
  // Stage 3 v1 used stopPly before manual completion was introduced.
  if (settings.stopPly !== undefined) {
    return { kind: "ply", ply: normalizePositiveInteger(Number(settings.stopPly), "settings.stopPly", BOARD_CAPACITY) };
  }
  fail("settings.endCondition 또는 legacy settings.stopPly가 필요합니다");
}

function normalizeSettings(value) {
  if (!isPlainObject(value)) fail("settings 객체가 필요합니다");
  if (!PLAYERS.has(value.userColor)) fail("settings.userColor는 B 또는 W여야 합니다");
  if (!GRADING_MODES.has(value.gradingMode)) fail("settings.gradingMode는 immediate 또는 end여야 합니다");
  const maxVisits = normalizePositiveInteger(Number(value.maxVisits), "settings.maxVisits", 10_000);
  return {
    rules: "renju",
    boardSize: BOARD_SIZE,
    userColor: value.userColor,
    endCondition: normalizeEndCondition(value),
    gradingMode: value.gradingMode,
    maxVisits,
  };
}

function normalizeTerminalState(value, finalMoves) {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value) || value.isTerminal !== true) fail("terminalState는 공식 종국 객체여야 합니다");
  if (value.rules !== "renju" || value.boardXSize !== 15 || value.boardYSize !== 15) {
    fail("terminalState는 15x15 Renju 결과여야 합니다");
  }
  if (value.moveCount !== finalMoves.length) fail("terminalState.moveCount가 finalMoves와 다릅니다");
  if (!PLAYERS.has(value.winner) && !(value.winner === null && value.outcome === "draw")) {
    fail("terminalState.winner/outcome 계약이 올바르지 않습니다");
  }
  if (!PLAYERS.has(value.nextPlayer)) fail("terminalState.nextPlayer가 필요합니다");
  if (!Array.isArray(value.legalMoves) || value.legalMoves.length !== 0
    || !Array.isArray(value.forbiddenMoves) || value.forbiddenMoves.length !== 0) {
    fail("종국 terminalState는 착수 가능한 좌표를 포함할 수 없습니다");
  }
  const terminalMove = normalizeCoordinate(value.terminalMove, "terminalState.terminalMove");
  if (terminalMove !== finalMoves.at(-1)?.[1]) fail("terminalState.terminalMove가 마지막 수와 다릅니다");
  return cloneJson(value, "terminalState");
}

function normalizeCompletion(value, legacyRecord, terminalState) {
  const completion = isPlainObject(value) ? value : {};
  const legacyReason = legacyRecord.completionReason;
  const fallbackReason = legacyRecord.settings?.stopPly !== undefined ? "ply-limit" : "manual";
  const reason = completion.reason ?? legacyReason ?? fallbackReason;
  if (!COMPLETION_REASONS.has(reason)) fail("completion.reason이 올바르지 않습니다");
  if (reason === "game-terminal" && terminalState === null) fail("game-terminal 완료에는 terminalState가 필요합니다");
  if (reason !== "game-terminal" && terminalState !== null) fail("종국이 아닌 완료에는 terminalState를 저장할 수 없습니다");
  const continued = completion.continuedFromPly ?? legacyRecord.continuedFromPly ?? null;
  if (continued !== null && (!Number.isSafeInteger(continued) || continued < 0 || continued > BOARD_CAPACITY)) {
    fail("completion.continuedFromPly가 올바르지 않습니다");
  }
  const summary = completion.summary ?? legacyRecord.summary ?? null;
  return {
    reason,
    continuedFromPly: continued,
    summary: summary === null ? null : cloneJson(summary, "completion.summary"),
  };
}

const EVALUATION_EXCLUDED_FIELDS = new Set([
  "policy", "fullPolicy", "preAnalysis", "postAnalysis", "candidates", "analysisSnapshot",
]);

function normalizeEvaluation(value) {
  if (!isPlainObject(value)) fail("turn.evaluation은 객체여야 합니다");
  const evaluation = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!EVALUATION_EXCLUDED_FIELDS.has(key) && entry !== undefined) {
      evaluation[key] = cloneJson(entry, `turn.evaluation.${key}`);
    }
  }
  return evaluation;
}

function optionalFiniteNumber(value, field) {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) fail(`${field}는 유한한 숫자여야 합니다`);
  return number;
}

function optionalNonnegativeInteger(value, field) {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) fail(`${field}는 0 이상의 정수여야 합니다`);
  return number;
}

function normalizePv(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > BOARD_CAPACITY) fail(`${field}는 PV 좌표 배열이어야 합니다`);
  return value.map((move, index) => normalizeCoordinate(move, `${field}[${index}]`));
}

function normalizeCandidate(value, index) {
  if (!isPlainObject(value)) fail(`analysisSnapshot.candidates[${index}]는 객체여야 합니다`);
  return {
    move: normalizeCoordinate(value.move, `analysisSnapshot.candidates[${index}].move`),
    order: optionalNonnegativeInteger(value.order, `analysisSnapshot.candidates[${index}].order`),
    rawPrior: optionalFiniteNumber(value.rawPrior ?? value.prior, `analysisSnapshot.candidates[${index}].rawPrior`),
    visits: optionalNonnegativeInteger(value.visits, `analysisSnapshot.candidates[${index}].visits`) ?? 0,
    visitShare: optionalFiniteNumber(value.visitShare, `analysisSnapshot.candidates[${index}].visitShare`),
    blackWinrate: optionalFiniteNumber(value.blackWinrate ?? value.winrate, `analysisSnapshot.candidates[${index}].blackWinrate`),
    currentPlayerWinrate: optionalFiniteNumber(value.currentPlayerWinrate, `analysisSnapshot.candidates[${index}].currentPlayerWinrate`),
    userWinrate: optionalFiniteNumber(value.userWinrate, `analysisSnapshot.candidates[${index}].userWinrate`),
    pv: normalizePv(value.pv, `analysisSnapshot.candidates[${index}].pv`),
  };
}

function normalizeAnalysisSnapshot(value) {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) fail("analysisSnapshot은 객체여야 합니다");
  const rawCandidates = value.candidates;
  if (!Array.isArray(rawCandidates)) fail("analysisSnapshot.candidates가 필요합니다");
  const candidates = rawCandidates.map(normalizeCandidate);
  candidates.sort((left, right) => {
    if (left.order !== null && right.order !== null) return left.order - right.order;
    if (left.order !== null) return -1;
    if (right.order !== null) return 1;
    return right.visits - left.visits;
  });
  const topCandidates = candidates.slice(0, 10);
  const currentPlayer = value.currentPlayer ?? value.rootInfo?.currentPlayer ?? null;
  if (currentPlayer !== null && !PLAYERS.has(currentPlayer)) fail("analysisSnapshot.currentPlayer는 B/W/null이어야 합니다");
  return {
    isFinal: value.isFinal === true,
    currentPlayer,
    requestedMaxVisits: optionalNonnegativeInteger(value.requestedMaxVisits, "analysisSnapshot.requestedMaxVisits"),
    candidateVisitTotal: optionalNonnegativeInteger(value.candidateVisitTotal, "analysisSnapshot.candidateVisitTotal")
      ?? topCandidates.reduce((total, candidate) => total + candidate.visits, 0),
    rootInfo: value.rootInfo === undefined || value.rootInfo === null
      ? null
      : cloneJson(value.rootInfo, "analysisSnapshot.rootInfo"),
    candidates: topCandidates,
  };
}

function snapshotSource(turn) {
  return turn.analysisSnapshot
    ?? turn.snapshot
    ?? (isPlainObject(turn.preAnalysis) ? turn.preAnalysis : null);
}

function normalizeTurn(value, index, finalMoves, settings) {
  if (!isPlainObject(value)) fail(`turns[${index}]는 객체여야 합니다`);
  const evaluationSource = isPlainObject(value.evaluation) ? value.evaluation : value;
  const ply = Number(value.ply ?? evaluationSource.ply);
  if (!Number.isSafeInteger(ply) || ply < 1 || ply > finalMoves.length) fail(`turns[${index}].ply가 finalMoves 범위를 벗어났습니다`);
  const [player, playedMove] = finalMoves[ply - 1];
  const userColor = value.userColor ?? evaluationSource.userColor ?? player;
  if (userColor !== settings.userColor || userColor !== player) fail(`turns[${index}]의 userColor가 수순과 다릅니다`);
  const userMove = normalizeCoordinate(value.userMove ?? evaluationSource.userMove, `turns[${index}].userMove`);
  if (userMove !== playedMove) fail(`turns[${index}].userMove가 finalMoves와 다릅니다`);
  return {
    ply,
    userColor,
    userMove,
    evaluation: normalizeEvaluation(evaluationSource),
    analysisSnapshot: normalizeAnalysisSnapshot(snapshotSource(value)),
  };
}

function normalizeTurns(value, finalMoves, settings) {
  if (!Array.isArray(value)) fail("turns/legacy records는 배열이어야 합니다");
  const turns = value.map((turn, index) => normalizeTurn(turn, index, finalMoves, settings));
  turns.sort((left, right) => left.ply - right.ply);
  for (let index = 1; index < turns.length; index += 1) {
    if (turns[index - 1].ply === turns[index].ply) fail(`turns에 중복 ply ${turns[index].ply}가 있습니다`);
  }
  return turns;
}

function normalizeRecord(value, { legacy = false, index = 0 } = {}) {
  if (!isPlainObject(value)) fail("기록 항목은 객체여야 합니다");
  const finalMoves = normalizeMoves(value.finalMoves, "finalMoves");
  const openingMoves = normalizeMoves(value.openingMoves ?? [], "openingMoves");
  if (openingMoves.length > finalMoves.length
    || openingMoves.some((move, moveIndex) => move[0] !== finalMoves[moveIndex]?.[0]
      || move[1] !== finalMoves[moveIndex]?.[1])) {
    fail("openingMoves는 finalMoves의 prefix여야 합니다");
  }
  const settings = normalizeSettings(value.settings);
  const startedAt = requireTimestamp(value.startedAt, "startedAt");
  const endedAt = requireTimestamp(value.endedAt, "endedAt");
  if (Date.parse(endedAt) < Date.parse(startedAt)) fail("endedAt은 startedAt보다 빠를 수 없습니다");
  const id = typeof value.id === "string" && value.id.trim() !== ""
    ? value.id.trim()
    : legacyId(value, index);
  const terminalState = normalizeTerminalState(value.terminalState, finalMoves);
  const completion = normalizeCompletion(value.completion, value, terminalState);
  if (completion.continuedFromPly !== null && completion.continuedFromPly > openingMoves.length) {
    fail("completion.continuedFromPly가 openingMoves보다 클 수 없습니다");
  }
  const turnsSource = value.turns ?? value.records;
  const turns = normalizeTurns(turnsSource ?? [], finalMoves, settings);
  return {
    id,
    startedAt,
    endedAt,
    settings,
    openingMoves,
    finalMoves,
    completion,
    terminalState,
    turns,
    migratedFrom: legacy || value.migratedFrom === LEGACY_HISTORY_STORAGE_KEY
      ? LEGACY_HISTORY_STORAGE_KEY
      : null,
  };
}

function legacyId(value, index) {
  const seed = JSON.stringify([
    value.startedAt ?? "", value.endedAt ?? "", value.finalMoves ?? [], index,
  ]);
  let hash = 2166136261;
  for (let cursor = 0; cursor < seed.length; cursor += 1) {
    hash ^= seed.charCodeAt(cursor);
    hash = Math.imul(hash, 16777619);
  }
  return `legacy-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizeRecordList(records, { legacy = false } = {}) {
  const diagnostics = [];
  const accepted = [];
  const ids = new Set();
  records.forEach((entry, index) => {
    try {
      const normalized = normalizeRecord(entry, { legacy, index });
      if (ids.has(normalized.id)) {
        diagnostics.push(diagnostic("duplicate-record", "중복 기록 ID를 제외했습니다", { index, id: normalized.id }));
        return;
      }
      ids.add(normalized.id);
      accepted.push(normalized);
    } catch (error) {
      diagnostics.push(diagnostic("invalid-record", error.message, {
        index,
        id: typeof entry?.id === "string" ? entry.id : null,
      }));
    }
  });
  if (accepted.length > HISTORY_LIMIT) {
    diagnostics.push(diagnostic("history-truncated", `최신 ${HISTORY_LIMIT}판만 유지했습니다`, {
      omitted: accepted.length - HISTORY_LIMIT,
    }));
  }
  return { records: accepted.slice(0, HISTORY_LIMIT), diagnostics };
}

function requireHistory(value) {
  if (!isPlainObject(value) || value.schemaVersion !== HISTORY_SCHEMA_VERSION || !Array.isArray(value.records)) {
    fail("유효한 v2 history가 필요합니다");
  }
  return value;
}

export function deserializeHistory(input) {
  const diagnostics = [];
  const parsed = parseInput(input, diagnostics);
  if (parsed === null) return result(emptyHistory(), diagnostics);
  if (!isPlainObject(parsed) || parsed.schemaVersion !== HISTORY_SCHEMA_VERSION || !Array.isArray(parsed.records)) {
    diagnostics.push(diagnostic("invalid-store", "v2 기록 저장소 형식이 아닙니다"));
    return result(emptyHistory(), diagnostics);
  }
  const normalized = normalizeRecordList(parsed.records);
  diagnostics.push(...normalized.diagnostics);
  return result({ schemaVersion: HISTORY_SCHEMA_VERSION, records: normalized.records }, diagnostics);
}

export function migrateHistory(input) {
  const diagnostics = [];
  const parsed = parseInput(input, diagnostics);
  if (parsed === null) return result(emptyHistory(), diagnostics);
  if (isPlainObject(parsed) && parsed.schemaVersion === HISTORY_SCHEMA_VERSION) {
    const loaded = deserializeHistory(parsed);
    return result(loaded.history, [...diagnostics, ...loaded.diagnostics]);
  }
  if (!Array.isArray(parsed)) {
    diagnostics.push(diagnostic("invalid-legacy-store", "legacy v1 기록은 배열이어야 합니다"));
    return result(emptyHistory(), diagnostics);
  }
  const normalized = normalizeRecordList(parsed, { legacy: true });
  diagnostics.push(...normalized.diagnostics);
  if (normalized.records.length > 0) {
    diagnostics.unshift(diagnostic("legacy-migrated", `legacy v1 기록 ${normalized.records.length}판을 v2로 변환했습니다`, {
      count: normalized.records.length,
    }));
  }
  return result({ schemaVersion: HISTORY_SCHEMA_VERSION, records: normalized.records }, diagnostics);
}

export function resolveHistorySources(currentInput, legacyInput) {
  if (currentInput === null || currentInput === undefined) return migrateHistory(legacyInput);
  const current = deserializeHistory(currentInput);
  const structurallyInvalid = current.diagnostics.some((entry) => ["invalid-json", "invalid-store"].includes(entry.code));
  if (!structurallyInvalid || legacyInput === null || legacyInput === undefined) return current;
  const legacy = migrateHistory(legacyInput);
  return result(legacy.history, [
    ...current.diagnostics,
    diagnostic("v2-fallback-legacy", "v2 저장소 자체가 손상되어 보존된 legacy v1 기록으로 복구를 시도했습니다"),
    ...legacy.diagnostics,
  ]);
}

export function serializeHistory(history) {
  requireHistory(history);
  const normalized = deserializeHistory(history);
  if (normalized.diagnostics.length > 0 || normalized.history.records.length !== history.records.length) {
    fail("손상된 history는 직렬화할 수 없습니다");
  }
  return JSON.stringify(normalized.history);
}

export function upsertHistory(history, record) {
  requireHistory(history);
  // Validate the existing store strictly so mutations never conceal corruption.
  const loaded = deserializeHistory(history);
  if (loaded.diagnostics.length > 0 || loaded.history.records.length !== history.records.length) {
    fail("손상된 history에는 기록을 추가할 수 없습니다");
  }
  const normalized = normalizeRecord(record);
  const records = [normalized, ...loaded.history.records.filter((entry) => entry.id !== normalized.id)]
    .slice(0, HISTORY_LIMIT);
  return immutableJson({ schemaVersion: HISTORY_SCHEMA_VERSION, records });
}

export function deleteHistory(history, id) {
  requireHistory(history);
  const recordId = requireString(id, "id");
  const loaded = deserializeHistory(history);
  if (loaded.diagnostics.length > 0 || loaded.history.records.length !== history.records.length) {
    fail("손상된 history에서는 기록을 삭제할 수 없습니다");
  }
  const records = loaded.history.records.filter((entry) => entry.id !== recordId);
  if (records.length === loaded.history.records.length) return loaded.history;
  return immutableJson({ schemaVersion: HISTORY_SCHEMA_VERSION, records });
}

export function clearHistory() {
  return immutableJson(emptyHistory());
}

export function selectHistoryReview(history, id) {
  requireHistory(history);
  const recordId = requireString(id, "id");
  const loaded = deserializeHistory(history);
  if (loaded.diagnostics.length > 0 || loaded.history.records.length !== history.records.length) {
    fail("손상된 history에서는 복습 기록을 선택할 수 없습니다");
  }
  return loaded.history.records.find((entry) => entry.id === recordId) ?? null;
}
