function fail(message) {
  throw new Error(message);
}

function requireRecord(record) {
  if (!record || typeof record !== "object" || !Array.isArray(record.finalMoves)
    || !Array.isArray(record.turns)) {
    fail("복기할 v2 history record가 필요합니다");
  }
}

function requireSession(session) {
  if (!session || typeof session !== "object") fail("복기 세션이 필요합니다");
  requireRecord(session.record);
  if (!Number.isInteger(session.ply)) fail("복기 ply는 정수여야 합니다");
}

export function clampReviewPly(record, ply) {
  requireRecord(record);
  const numeric = Number(ply);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(record.finalMoves.length, Math.trunc(numeric)));
}

export function createHistoryReview(record, ply = record?.finalMoves?.length ?? 0) {
  requireRecord(record);
  return Object.freeze({ record, ply: clampReviewPly(record, ply) });
}

export function moveHistoryReview(session, ply) {
  requireSession(session);
  return Object.freeze({ record: session.record, ply: clampReviewPly(session.record, ply) });
}

export function reviewMoves(session) {
  requireSession(session);
  return session.record.finalMoves.slice(0, session.ply).map(([player, move]) => [player, move]);
}

export function reviewTurn(session) {
  requireSession(session);
  return session.record.turns.find((turn) => turn.ply === session.ply) ?? null;
}

export function reviewMistakePlys(session) {
  requireSession(session);
  const mistakes = session.record.completion?.summary?.topMistakes;
  if (!Array.isArray(mistakes)) return Object.freeze([]);
  const unique = [];
  for (const mistake of mistakes) {
    const ply = Number(mistake?.ply);
    if (Number.isInteger(ply) && ply >= 1 && ply <= session.record.finalMoves.length
      && !unique.includes(ply)) unique.push(ply);
  }
  return Object.freeze(unique);
}

export function isReviewTerminalPosition(session) {
  requireSession(session);
  return session.ply === session.record.finalMoves.length
    && session.record.terminalState?.isTerminal === true;
}
