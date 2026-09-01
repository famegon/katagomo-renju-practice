import test from "node:test";
import assert from "node:assert/strict";

import {
  applyComparisonResponse,
  beginComparisonRequest,
  cancelComparisonLab,
  comparisonPolicyIndex,
  comparisonStageDescriptor,
  createComparisonLab,
  deriveComparisonResult,
  invalidateComparisonLab,
} from "../web/comparison-lab.mjs";

const COLUMNS = "ABCDEFGHJKLMNOP";
const SOURCES = Object.freeze({
  source: "KataGomo Board::isForbidden()",
  historySource: "KataGomo BoardHistory::makeBoardMoveAssumeLegal()",
});
const BASE_MOVES = [["B", "H8"], ["W", "H9"]];

function allCoordinates() {
  return Array.from({ length: 15 }, (_, y) => 15 - y)
    .flatMap((row) => [...COLUMNS].map((column) => `${column}${row}`));
}

function ongoingPosition(moves = BASE_MOVES, forbiddenMoves = []) {
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
    legalMoves: allCoordinates().filter((move) => !occupied.has(move) && !forbidden.has(move)),
    forbiddenMoves,
    ...SOURCES,
  };
}

function createLab(overrides = {}) {
  return createComparisonLab({
    moves: BASE_MOVES,
    player: "B",
    positionKey: '[["B","H8"],["W","H9"]]',
    revision: 7,
    officialPosition: ongoingPosition(),
    moveA: "G9",
    moveB: "J9",
    maxVisits: 500,
    runId: "comparison-run-1",
    sessionEpoch: "session-1",
    ...overrides,
  });
}

function policyForComparison() {
  const policy = Array(226).fill(0.001);
  policy[225] = -1;
  policy[comparisonPolicyIndex("K9")] = 0.9;
  policy[comparisonPolicyIndex("G9")] = 0.4;
  policy[comparisonPolicyIndex("J9")] = 0.2;
  return policy;
}

function identityForRequest(request) {
  return {
    clientRequestId: request.clientRequestId,
    analysisPurpose: request.analysisPurpose,
    positionRevision: request.positionRevision,
    positionMoveCount: request.moves.length,
    requestedMaxVisits: request.maxVisits,
    sessionEpoch: request.sessionEpoch,
  };
}

function analysisResponse(request, {
  isFinal = true,
  blackWinrate = 0.55,
  rootVisits = 501,
  candidates = [],
  policy = policyForComparison(),
  analysisInsufficient = false,
  analysisInsufficientReasons = [],
} = {}) {
  const currentPlayer = request.moves.length % 2 === 0 ? "B" : "W";
  return {
    type: "analysis",
    ...identityForRequest(request),
    isFinal,
    isDuringSearch: !isFinal,
    analysisInsufficient,
    analysisInsufficientReasons,
    winratePerspective: "BLACK",
    policy,
    candidates,
    rootInfo: {
      currentPlayer,
      visits: rootVisits,
      blackWinrate,
      winratePerspective: "BLACK",
    },
    ignoredServerField: "not part of the final snapshot",
  };
}

function terminalResponse(request, move, outcome = "black_win") {
  const contracts = {
    black_win: { winner: "B", terminalReason: "line_win" },
    white_win: { winner: "W", terminalReason: "line_win" },
    draw: { winner: null, terminalReason: "board_full" },
  };
  return {
    type: "position",
    code: "position_terminal",
    ...identityForRequest(request),
    gameState: {
      boardXSize: 15,
      boardYSize: 15,
      rules: "renju",
      isValid: true,
      moveCount: request.moves.length,
      nextPlayer: request.moves.length % 2 === 0 ? "B" : "W",
      isTerminal: true,
      outcome,
      terminalMove: move,
      legalMoves: [],
      forbiddenMoves: [],
      ...contracts[outcome],
      ...SOURCES,
    },
  };
}

function finishBase(comparison, clientRequestId = "comparison-base") {
  const started = beginComparisonRequest(comparison, { clientRequestId });
  const response = analysisResponse(started.request, {
    blackWinrate: 0.55,
    rootVisits: 501,
    candidates: [{
      move: "G9",
      order: 1,
      visits: 120,
      visitShare: 0.24,
      blackWinrate: 0.57,
      pv: ["G9", "F9"],
    }],
  });
  return applyComparisonResponse(started.comparison, response);
}

test("policy indexing is top-row-major on 15x15 and omits I", () => {
  assert.equal(comparisonPolicyIndex("A15"), 0);
  assert.equal(comparisonPolicyIndex("H8"), 112);
  assert.equal(comparisonPolicyIndex("J8"), 113);
  assert.equal(comparisonPolicyIndex("P1"), 224);
  assert.equal(comparisonPolicyIndex("j9"), 98);
  assert.throws(() => comparisonPolicyIndex("I8"), /유효한 15x15/);
});

test("creation snapshots the live position and accepts only two distinct official legal moves", () => {
  const sourceMoves = BASE_MOVES.map((entry) => [...entry]);
  const officialPosition = ongoingPosition(sourceMoves);
  const comparison = createLab({ moves: sourceMoves, officialPosition });

  sourceMoves.push(["B", "A1"]);
  officialPosition.legalMoves.splice(0, officialPosition.legalMoves.length);
  assert.deepEqual(comparison.base.moves, BASE_MOVES);
  assert.equal(comparison.base.player, "B");
  assert.equal(comparison.base.revision, 7);
  assert.equal(comparison.maxVisits, 500);
  assert.equal(comparison.runId, "comparison-run-1");
  assert.equal(Object.isFrozen(comparison), true);
  assert.equal(Object.isFrozen(comparison.base.moves), true);

  assert.throws(() => createLab({ moveB: "G9" }), /서로 다른/);
  assert.throws(() => createLab({ moveB: "H8" }), /official legalMoves/);
  assert.throws(
    () => createLab({ officialPosition: { ...ongoingPosition(), source: "browser" } }),
    /공식 KataGomo helper/,
  );
});

test("base, forced A, and forced B request specs are sequential, unique, and equal-visit", () => {
  let factoryContext;
  const baseStarted = beginComparisonRequest(createLab(), {
    createClientRequestId(context) {
      factoryContext = context;
      return `${context.runId}-${context.stage}`;
    },
  });
  assert.equal(Object.isFrozen(factoryContext), true);
  assert.equal(factoryContext.purpose, "comparison_base");
  assert.deepEqual(baseStarted.request.moves, BASE_MOVES);
  assert.equal(baseStarted.request.maxVisits, 500);
  assert.equal(baseStarted.request.userColor, "B");
  assert.equal(baseStarted.request.analysisPurpose, "comparison_base");
  assert.equal(baseStarted.request.positionRevision, 7);
  assert.equal(baseStarted.request.sessionEpoch, "session-1");
  assert.throws(
    () => beginComparisonRequest(baseStarted.comparison, { clientRequestId: "too-early" }),
    /ready 상태/,
  );

  const afterBase = applyComparisonResponse(
    baseStarted.comparison,
    analysisResponse(baseStarted.request),
  );
  assert.equal(afterBase.stage, "a");
  assert.equal(afterBase.status, "ready");
  assert.throws(
    () => beginComparisonRequest(afterBase, { clientRequestId: baseStarted.request.clientRequestId }),
    /고유해야/,
  );

  const aStarted = beginComparisonRequest(afterBase, { clientRequestId: "comparison-a" });
  assert.deepEqual(aStarted.request.moves, [...BASE_MOVES, ["B", "G9"]]);
  assert.equal(aStarted.request.analysisPurpose, "comparison_a");
  assert.equal(aStarted.request.maxVisits, baseStarted.request.maxVisits);
  assert.equal(aStarted.request.userColor, "B");
  const afterA = applyComparisonResponse(
    aStarted.comparison,
    analysisResponse(aStarted.request, { blackWinrate: 0.62 }),
  );

  const bStarted = beginComparisonRequest(afterA, { clientRequestId: "comparison-b" });
  assert.deepEqual(bStarted.request.moves, [...BASE_MOVES, ["B", "J9"]]);
  assert.equal(bStarted.request.analysisPurpose, "comparison_b");
  assert.equal(bStarted.request.maxVisits, baseStarted.request.maxVisits);
  assert.equal(comparisonStageDescriptor(bStarted.comparison).positionMoveCount, 3);
});

test("request userColor remains the base mover when White compares two moves", () => {
  const moves = [["B", "H8"]];
  const comparison = createLab({
    moves,
    player: "W",
    positionKey: '[["B","H8"]]',
    officialPosition: ongoingPosition(moves),
  });
  const baseStarted = beginComparisonRequest(comparison, { clientRequestId: "white-base" });
  assert.equal(baseStarted.request.userColor, "W");
  assert.equal(comparisonStageDescriptor(baseStarted.comparison).player, "W");
  const afterBase = applyComparisonResponse(
    baseStarted.comparison,
    analysisResponse(baseStarted.request),
  );
  const aStarted = beginComparisonRequest(afterBase, { clientRequestId: "white-a" });
  assert.deepEqual(aStarted.request.moves.at(-1), ["W", "G9"]);
  assert.equal(aStarted.request.userColor, "W");
  assert.equal(comparisonStageDescriptor(aStarted.comparison).player, "B");

  const afterA = applyComparisonResponse(
    aStarted.comparison,
    analysisResponse(aStarted.request, {
      blackWinrate: 0.4,
      candidates: [{
        move: "pass",
        order: 0,
        visits: 20,
        visitShare: 0.2,
        blackWinrate: 0.4,
        pv: ["pass", "F8"],
      }],
    }),
  );
  const bStarted = beginComparisonRequest(afterA, { clientRequestId: "white-b" });
  const complete = applyComparisonResponse(
    bStarted.comparison,
    analysisResponse(bStarted.request, { blackWinrate: 0.6 }),
  );
  const result = deriveComparisonResult(complete);
  assert.ok(Math.abs(result.baseMoverWinrate - 0.45) < 1e-12);
  assert.ok(Math.abs(result.branches.a.afterMoverWinrate - 0.6) < 1e-12);
  assert.ok(Math.abs(result.branches.b.afterMoverWinrate - 0.4) < 1e-12);
  assert.ok(Math.abs(result.branches.a.moverWinrateDeltaFromBase - 0.15) < 1e-12);
  assert.ok(Math.abs(result.branches.b.moverWinrateDeltaFromBase + 0.05) < 1e-12);
  assert.equal(result.branches.a.opponentOrder0Move, "PASS");
  assert.deepEqual(result.branches.a.opponentOrder0Pv, ["PASS", "F8"]);
});

test("all echoed identity fields gate partial and final responses while stale data is ignored", () => {
  const started = beginComparisonRequest(createLab(), { clientRequestId: "identity-base" });
  const current = analysisResponse(started.request, { isFinal: false });
  const mismatches = [
    { clientRequestId: "stale" },
    { analysisPurpose: "comparison_a" },
    { positionRevision: 8 },
    { positionMoveCount: 3 },
    { requestedMaxVisits: 100 },
    { sessionEpoch: "old-session" },
  ];
  for (const mismatch of mismatches) {
    assert.equal(
      applyComparisonResponse(started.comparison, { ...current, ...mismatch }),
      started.comparison,
    );
  }

  const partial = applyComparisonResponse(started.comparison, current);
  assert.equal(partial.status, "running");
  assert.equal(partial.stage, "base");
  assert.equal(partial.lastEvent.kind, "partial");
  assert.equal(partial.partial.snapshot.policy.length, 226);
  assert.equal(partial.results.base, null);

  const finalMessage = analysisResponse(started.request, { isFinal: true });
  const final = applyComparisonResponse(partial, finalMessage);
  assert.equal(final.status, "ready");
  assert.equal(final.stage, "a");
  assert.equal(final.results.base.kind, "analysis");
  assert.deepEqual(Object.keys(final.results.base.snapshot).sort(), [
    "analysisInsufficient",
    "analysisInsufficientReasons",
    "candidates",
    "policy",
    "requestedMaxVisits",
    "rootInfo",
  ]);
  assert.equal(final.results.base.snapshot.ignoredServerField, undefined);

  finalMessage.policy[comparisonPolicyIndex("G9")] = 99;
  finalMessage.rootInfo.blackWinrate = 0;
  assert.notEqual(final.results.base.snapshot.policy[comparisonPolicyIndex("G9")], 99);
  assert.equal(final.results.base.snapshot.rootInfo.blackWinrate, 0.55);
  assert.equal(Object.isFrozen(final.results.base.snapshot), true);
});

test("forced terminal is an official result with no invented analysis or live-board mutation", () => {
  const liveMoves = BASE_MOVES.map((entry) => [...entry]);
  const afterBase = finishBase(createLab({ moves: liveMoves }));
  const aStarted = beginComparisonRequest(afterBase, { clientRequestId: "terminal-a" });
  const staleTerminal = terminalResponse(aStarted.request, "G9");
  staleTerminal.requestedMaxVisits = 100;
  assert.equal(applyComparisonResponse(aStarted.comparison, staleTerminal), aStarted.comparison);

  const terminal = terminalResponse(aStarted.request, "G9");
  const afterTerminal = applyComparisonResponse(aStarted.comparison, terminal);
  assert.equal(afterTerminal.stage, "b");
  assert.equal(afterTerminal.results.a.kind, "terminal");
  assert.equal(afterTerminal.results.a.blackWinrate, undefined);
  assert.equal(afterTerminal.results.a.terminalState.outcome, "black_win");
  assert.deepEqual(liveMoves, BASE_MOVES);
  assert.deepEqual(afterTerminal.base.moves, BASE_MOVES);

  const derived = deriveComparisonResult(afterTerminal);
  assert.equal(derived.branches.a.resultKind, "terminal");
  assert.equal(derived.branches.a.terminalOutcome, "black_win");
  assert.equal(derived.branches.a.afterBlackWinrate, null);
  assert.equal(derived.branches.a.blackWinrateDeltaFromBase, null);
  assert.equal(derived.branches.a.afterRootVisits, null);
  assert.equal(derived.branches.a.opponentOrder0Move, null);
  assert.deepEqual(derived.branches.a.opponentOrder0Pv, []);

  const whiteMoves = [["B", "H8"]];
  const whiteBase = finishBase(createLab({
    moves: whiteMoves,
    player: "W",
    positionKey: '[["B","H8"]]',
    officialPosition: ongoingPosition(whiteMoves),
  }), "white-terminal-base");
  const whiteA = beginComparisonRequest(whiteBase, { clientRequestId: "white-terminal-a" });
  const impossibleForbidden = terminalResponse(whiteA.request, "G9", "white_win");
  impossibleForbidden.gameState.terminalReason = "black_forbidden";
  assert.throws(
    () => applyComparisonResponse(whiteA.comparison, impossibleForbidden),
    /착수자\/종료 사유/,
  );
});

test("completed comparison derives policy, MCTS, opponent reply, and BLACK deltas separately", () => {
  let comparison = finishBase(createLab());
  const aStarted = beginComparisonRequest(comparison, { clientRequestId: "derive-a" });
  comparison = applyComparisonResponse(aStarted.comparison, analysisResponse(aStarted.request, {
    blackWinrate: 0.62,
    rootVisits: 503,
    analysisInsufficient: true,
    analysisInsufficientReasons: ["candidate-visits-below-threshold"],
    candidates: [{
      move: "F9",
      order: 0,
      visits: 200,
      visitShare: 0.4,
      blackWinrate: 0.6,
      pv: ["F9", "K9", "F8"],
    }],
  }));
  const bStarted = beginComparisonRequest(comparison, { clientRequestId: "derive-b" });
  comparison = applyComparisonResponse(
    bStarted.comparison,
    terminalResponse(bStarted.request, "J9", "black_win"),
  );

  assert.equal(comparison.status, "complete");
  assert.equal(comparison.stage, "complete");
  assert.equal(comparisonStageDescriptor(comparison), null);
  const result = deriveComparisonResult(comparison);
  assert.equal(result.baseBlackWinrate, 0.55);
  assert.equal(result.baseRootVisits, 501);
  assert.equal(result.branches.a.baseRawPolicy, 0.4);
  assert.equal(result.branches.a.basePolicyRank, 2);
  assert.equal(result.branches.a.baseMctsOrder, 1);
  assert.equal(result.branches.a.baseMctsVisits, 120);
  assert.equal(result.branches.a.baseVisitShare, 0.24);
  assert.equal(result.branches.a.baseRequestedMaxVisits, 500);
  assert.equal(result.branches.a.baseAnalysisInsufficient, false);
  assert.deepEqual(result.branches.a.baseAnalysisInsufficientReasons, []);
  assert.equal(result.branches.a.afterBlackWinrate, 0.62);
  assert.equal(result.branches.a.afterMoverWinrate, 0.62);
  assert.equal(result.branches.a.afterRootVisits, 503);
  assert.equal(result.branches.a.afterRequestedMaxVisits, 500);
  assert.equal(result.branches.a.afterAnalysisInsufficient, true);
  assert.deepEqual(
    result.branches.a.afterAnalysisInsufficientReasons,
    ["candidate-visits-below-threshold"],
  );
  assert.equal(result.branches.a.opponentOrder0Move, "F9");
  assert.deepEqual(result.branches.a.opponentOrder0Pv, ["F9", "K9", "F8"]);
  assert.ok(Math.abs(result.branches.a.blackWinrateDeltaFromBase - 0.07) < 1e-12);
  assert.ok(Math.abs(result.branches.a.moverWinrateDeltaFromBase - 0.07) < 1e-12);
  assert.equal(result.branches.b.baseRawPolicy, 0.2);
  assert.equal(result.branches.b.basePolicyRank, 3);
  assert.equal(result.branches.b.baseMctsOrder, null);
  assert.equal(result.branches.b.baseMctsVisits, null);
  assert.equal(result.branches.b.baseVisitShare, null);
  assert.equal(result.branches.b.afterBlackWinrate, null);
  assert.equal(result.branches.b.afterAnalysisInsufficient, null);
  assert.deepEqual(result.branches.b.afterAnalysisInsufficientReasons, []);
  assert.equal(result.branches.b.terminalOutcome, "black_win");
  assert.equal(Object.isFrozen(result.branches.a.opponentOrder0Pv), true);
});

test("cancel and invalidation clear active work and reject all late responses", () => {
  const started = beginComparisonRequest(createLab(), { clientRequestId: "cancel-me" });
  const late = analysisResponse(started.request);
  const canceled = cancelComparisonLab(started.comparison, "user-closed-lab");
  assert.equal(canceled.status, "canceled");
  assert.equal(canceled.activeRequest, null);
  assert.equal(canceled.partial, null);
  assert.equal(applyComparisonResponse(canceled, late), canceled);
  assert.throws(
    () => beginComparisonRequest(canceled, { clientRequestId: "after-cancel" }),
    /ready 상태/,
  );

  const invalidated = invalidateComparisonLab(createLab(), "live-revision-changed");
  assert.equal(invalidated.status, "invalidated");
  assert.equal(invalidated.lastEvent.reason, "live-revision-changed");
  assert.throws(
    () => beginComparisonRequest(invalidated, { clientRequestId: "after-invalidate" }),
    /ready 상태/,
  );
});
