import test from "node:test";
import assert from "node:assert/strict";

import {
  acceptCurrentAnalysisResponse,
  appendGameMove,
  appendPracticeTurnRecord,
  applyAnalysisResponse,
  beginAnalysisJob,
  beginPracticeCompletion,
  bumpGameRevision,
  cancelAnalysisJob,
  commitOfficialPositionState,
  createAnalysisJob,
  createGameDocument,
  createPracticeAttempt,
  finishPracticeCompletion,
  gamePositionKey,
  hasCurrentOfficialPositionState,
  isAnalysisResponseCurrent,
  transitionAnalysisJob,
  trimPracticeTurnRecords,
  truncateGameDocument,
  withOfficialPositionState,
  withoutOfficialPositionState,
} from "../web/session-state.mjs";

const COLUMNS = "ABCDEFGHJKLMNOP";
const SOURCES = {
  source: "KataGomo Board::isForbidden()",
  historySource: "KataGomo BoardHistory::makeBoardMoveAssumeLegal()",
};

function allCoordinates() {
  return [...COLUMNS].flatMap((column) =>
    Array.from({ length: 15 }, (_, index) => `${column}${index + 1}`));
}

function ongoingState(moves, forbiddenMoves = []) {
  const occupied = new Set(moves.map(([, move]) => move));
  const forbidden = new Set(forbiddenMoves);
  return {
    boardXSize: 15,
    boardYSize: 15,
    rules: "renju",
    isValid: true,
    moveCount: moves.length,
    nextPlayer: moves.length % 2 === 0 ? "B" : "W",
    isTerminal: false,
    winner: null,
    outcome: "ongoing",
    terminalReason: null,
    terminalMove: null,
    forbiddenMoves,
    legalMoves: allCoordinates().filter((move) => !occupied.has(move) && !forbidden.has(move)),
    ...SOURCES,
  };
}

function terminalBlackWinState(moves) {
  return {
    boardXSize: 15,
    boardYSize: 15,
    rules: "renju",
    isValid: true,
    moveCount: moves.length,
    nextPlayer: moves.length % 2 === 0 ? "B" : "W",
    isTerminal: true,
    winner: "B",
    outcome: "black_win",
    terminalReason: "line_win",
    terminalMove: moves.at(-1)[1],
    forbiddenMoves: [],
    legalMoves: [],
    ...SOURCES,
  };
}

const SETTINGS = Object.freeze({
  userColor: "B",
  endCondition: { kind: "manual" },
  gradingMode: "immediate",
  maxVisits: 500,
});

test("GameDocument copies moves, enforces turn order, and advances one monotonic revision", () => {
  const sourceMoves = [["B", "h8"]];
  const initial = createGameDocument({ moves: sourceMoves, revision: 4 });
  sourceMoves[0][1] = "A1";

  assert.deepEqual(initial.moves, [["B", "H8"]]);
  assert.equal(initial.revision, 4);
  assert.equal(gamePositionKey(initial), '[["B","H8"]]');
  assert.equal(Object.isFrozen(initial.moves), true);

  const next = appendGameMove(initial, ["W", "H9"]);
  assert.deepEqual(next.moves, [["B", "H8"], ["W", "H9"]]);
  assert.equal(next.revision, 5);
  assert.equal(next.positionState, null);
  assert.throws(() => appendGameMove(initial, ["B", "H9"]), /W 차례/);
  assert.throws(() => appendGameMove(next, ["B", "H8"]), /중복/);
});

test("official position state binds only to the exact GameDocument revision", () => {
  const document = createGameDocument({ moves: [["B", "H8"], ["W", "H9"]], revision: 7 });
  const state = ongoingState(document.moves);

  const stale = withOfficialPositionState(document, state, 6);
  assert.equal(stale, document);
  assert.equal(hasCurrentOfficialPositionState(stale), false);

  const current = withOfficialPositionState(document, state, 7);
  assert.equal(hasCurrentOfficialPositionState(current), true);
  assert.equal(current.positionStateRevision, 7);
  assert.equal(current.positionState.moveCount, 2);

  const unvalidated = withoutOfficialPositionState(current);
  assert.equal(unvalidated.revision, 7);
  assert.equal(unvalidated.positionState, null);
  assert.equal(withoutOfficialPositionState(unvalidated), unvalidated);

  const changed = appendGameMove(current, ["B", "J8"]);
  assert.equal(changed.revision, 8);
  assert.equal(changed.positionState, null);
  assert.equal(changed.positionStateRevision, null);

  const invalidated = bumpGameRevision(current);
  assert.equal(invalidated.revision, 8);
  assert.equal(invalidated.positionState, null);
  assert.equal(commitOfficialPositionState(invalidated, state, 7), invalidated);
});

test("official position contract rejects incomplete legality and inconsistent metadata", () => {
  const document = createGameDocument({ moves: [], revision: 0 });
  assert.throws(
    () => withOfficialPositionState(document, { ...ongoingState([]), legalMoves: [] }, 0),
    /모든 빈 교차점/,
  );
  assert.throws(
    () => withOfficialPositionState(document, { ...ongoingState([]), source: "browser" }, 0),
    /공식 KataGomo helper/,
  );
});

test("terminal GameDocument blocks further play while undo creates an unvalidated revision", () => {
  const moves = [
    ["B", "D8"], ["W", "A1"], ["B", "E8"], ["W", "B1"],
    ["B", "F8"], ["W", "C1"], ["B", "G8"], ["W", "D1"], ["B", "H8"],
  ];
  const terminal = withOfficialPositionState(
    createGameDocument({ moves, revision: 9 }),
    terminalBlackWinState(moves),
    9,
  );
  assert.throws(() => appendGameMove(terminal, ["W", "E1"]), /종국 뒤/);

  const undone = truncateGameDocument(terminal, 8);
  assert.equal(undone.revision, 10);
  assert.equal(undone.positionState, null);
  assert.equal(undone.moves.length, 8);
});

test("PracticeAttempt owns immutable settings and ordered user turn records", () => {
  const settings = { ...SETTINGS, endCondition: { kind: "manual" } };
  const attempt = createPracticeAttempt({
    sessionEpoch: "epoch-1",
    settings,
    openingMoves: [],
    startedAt: "2026-09-01T00:00:00.000Z",
  });
  settings.maxVisits = 1;
  assert.equal(attempt.settings.maxVisits, 500);
  assert.equal(attempt.status, "active");

  const first = appendPracticeTurnRecord(attempt, {
    ply: 1,
    userMove: "H8",
    userColor: "B",
    rawPrior: 0.25,
    visits: 100,
  });
  const second = appendPracticeTurnRecord(first, {
    ply: 3,
    userMove: "J8",
    userColor: "B",
    rawPrior: 0.1,
    visits: 75,
  });
  assert.deepEqual(second.turnRecords.map((record) => record.ply), [1, 3]);
  assert.equal(attempt.turnRecords.length, 0);
  assert.throws(
    () => appendPracticeTurnRecord(second, { ply: 2, userMove: "H9", userColor: "B" }),
    /userColor와 ply/,
  );

  const trimmed = trimPracticeTurnRecords(second, 1);
  assert.deepEqual(trimmed.turnRecords.map((record) => record.ply), [1]);
});

test("PracticeAttempt separates summarizing from completed and preserves official terminal result", () => {
  const moves = [
    ["B", "D8"], ["W", "A1"], ["B", "E8"], ["W", "B1"],
    ["B", "F8"], ["W", "C1"], ["B", "G8"], ["W", "D1"], ["B", "H8"],
  ];
  let attempt = createPracticeAttempt({
    sessionEpoch: "epoch-terminal",
    settings: SETTINGS,
    startedAt: "2026-09-01T00:00:00.000Z",
  });
  for (const [index, [player, move]] of moves.entries()) {
    if (player === "B") {
      attempt = appendPracticeTurnRecord(attempt, {
        ply: index + 1,
        userMove: move,
        userColor: "B",
      });
    }
  }
  const summarizing = beginPracticeCompletion(attempt, {
    reason: "game-terminal",
    finalMoves: moves,
    endedAt: "2026-09-01T00:05:00.000Z",
    terminalState: terminalBlackWinState(moves),
  });
  assert.equal(summarizing.status, "summarizing");
  assert.equal(summarizing.completion.terminalState.winner, "B");
  assert.throws(
    () => appendPracticeTurnRecord(summarizing, { ply: 11, userMove: "J8", userColor: "B" }),
    /기록을 추가/,
  );

  const completed = finishPracticeCompletion(summarizing, { insufficientCount: 0 });
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.completion.summary, { insufficientCount: 0 });
  assert.throws(() => finishPracticeCompletion(completed, null), /summarizing/);
});

test("non-terminal PracticeAttempt completion cannot smuggle a terminal state", () => {
  const moves = [
    ["B", "D8"], ["W", "A1"], ["B", "E8"], ["W", "B1"],
    ["B", "F8"], ["W", "C1"], ["B", "G8"], ["W", "D1"], ["B", "H8"],
  ];
  const attempt = createPracticeAttempt({
    sessionEpoch: "epoch-manual",
    settings: SETTINGS,
    startedAt: "2026-09-01T00:00:00.000Z",
  });
  assert.throws(
    () => beginPracticeCompletion(attempt, {
      reason: "manual",
      finalMoves: moves,
      endedAt: "2026-09-01T00:05:00.000Z",
      terminalState: terminalBlackWinState(moves),
    }),
    /종국이 아닌 완료 사유/,
  );
});

test("AnalysisJob accepts responses only for the live request, revision, and session epoch", () => {
  const job = createAnalysisJob({
    clientRequestId: "request-1",
    positionRevision: 12,
    sessionEpoch: "epoch-1",
    analysisPurpose: "user_pre",
    requestedMaxVisits: 500,
  });
  const response = {
    clientRequestId: "request-1",
    positionRevision: 12,
    sessionEpoch: "epoch-1",
    isFinal: false,
  };
  assert.equal(isAnalysisResponseCurrent(job, response, {
    positionRevision: 12,
    sessionEpoch: "epoch-1",
  }), true);
  assert.equal(isAnalysisResponseCurrent(job, { ...response, clientRequestId: "old" }, {
    positionRevision: 12,
    sessionEpoch: "epoch-1",
  }), false);
  assert.equal(isAnalysisResponseCurrent(job, response, {
    positionRevision: 13,
    sessionEpoch: "epoch-1",
  }), false);
  assert.equal(isAnalysisResponseCurrent(job, response, {
    positionRevision: 12,
    sessionEpoch: "epoch-2",
  }), false);
});

test("AnalysisJob accepts the three comparison workflow purposes", () => {
  for (const analysisPurpose of ["comparison_base", "comparison_a", "comparison_b"]) {
    const job = createAnalysisJob({
      clientRequestId: `request-${analysisPurpose}`,
      positionRevision: 12,
      sessionEpoch: "comparison:test-run",
      analysisPurpose,
      requestedMaxVisits: 500,
    });
    assert.equal(job.analysisPurpose, analysisPurpose);
  }
});

test("AnalysisJob transition table makes final, canceled, and interrupted states terminal", () => {
  const requested = beginAnalysisJob({
    clientRequestId: "request-2",
    positionRevision: 3,
    requestedMaxVisits: 100,
  });
  const partial = applyAnalysisResponse(requested, {
    clientRequestId: "request-2",
    positionRevision: 3,
    sessionEpoch: null,
    isFinal: false,
  }, { positionRevision: 3, sessionEpoch: null });
  assert.equal(partial.accepted, true);
  assert.equal(partial.job.state, "streaming");

  const final = applyAnalysisResponse(partial.job, {
    clientRequestId: "request-2",
    positionRevision: 3,
    sessionEpoch: null,
    isFinal: true,
  }, { positionRevision: 3, sessionEpoch: null });
  assert.equal(final.job.state, "final");
  assert.throws(() => transitionAnalysisJob(final.job, "streaming"), /전이할 수 없습니다/);

  const canceled = cancelAnalysisJob(requested);
  assert.equal(cancelAnalysisJob(canceled), canceled);
  const ignored = acceptCurrentAnalysisResponse(canceled, {
    clientRequestId: "request-2",
    positionRevision: 3,
    sessionEpoch: null,
    isFinal: true,
  }, { positionRevision: 3, sessionEpoch: null });
  assert.equal(ignored.accepted, false);
  assert.equal(ignored.job, canceled);

  const interrupted = applyAnalysisResponse(requested, {
    clientRequestId: "request-2",
    positionRevision: 3,
    sessionEpoch: null,
    noResults: true,
  }, { positionRevision: 3, sessionEpoch: null });
  assert.equal(interrupted.job.state, "interrupted");
});
