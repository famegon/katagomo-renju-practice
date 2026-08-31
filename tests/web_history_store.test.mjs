import test from "node:test";
import assert from "node:assert/strict";

import {
  HISTORY_LIMIT,
  HISTORY_SCHEMA_VERSION,
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
} from "../web/history-store.mjs";

const BASE_MOVES = [
  ["B", "H8"],
  ["W", "H9"],
  ["B", "J8"],
];

function settings(overrides = {}) {
  return {
    userColor: "B",
    endCondition: { kind: "manual" },
    gradingMode: "immediate",
    maxVisits: 500,
    ...overrides,
  };
}

function record(id, overrides = {}) {
  return {
    id,
    startedAt: "2026-09-01T00:00:00.000Z",
    endedAt: "2026-09-01T00:05:00.000Z",
    settings: settings(),
    openingMoves: [],
    finalMoves: BASE_MOVES,
    completion: { reason: "manual", continuedFromPly: null, summary: null },
    terminalState: null,
    turns: [],
    ...overrides,
  };
}

function terminalRecord(id = "terminal") {
  const finalMoves = [
    ["B", "D8"], ["W", "A1"], ["B", "E8"], ["W", "B1"],
    ["B", "F8"], ["W", "C1"], ["B", "G8"], ["W", "D1"], ["B", "H8"],
  ];
  const terminalState = {
    boardXSize: 15,
    boardYSize: 15,
    rules: "renju",
    isValid: true,
    moveCount: finalMoves.length,
    nextPlayer: "W",
    isTerminal: true,
    winner: "B",
    outcome: "black_win",
    terminalReason: "line_win",
    terminalMove: "H8",
    forbiddenMoves: [],
    legalMoves: [],
    source: "KataGomo Board::isForbidden()",
    historySource: "KataGomo BoardHistory::makeBoardMoveAssumeLegal()",
  };
  return record(id, {
    finalMoves,
    completion: { reason: "game-terminal", continuedFromPly: null, summary: { insufficientCount: 0 } },
    terminalState,
    turns: [{
      ply: 9,
      userColor: "B",
      userMove: "H8",
      evaluation: {
        ply: 9,
        userColor: "B",
        userMove: "H8",
        beforeUserWinrate: 0.81,
        afterUserWinrate: 1,
        afterUserWinrateSource: "official-terminal-result",
      },
      analysisSnapshot: null,
    }],
  });
}

test("storage constants and an empty history are distribution-stable JSON", () => {
  assert.equal(HISTORY_SCHEMA_VERSION, 2);
  assert.equal(HISTORY_LIMIT, 20);
  assert.equal(HISTORY_STORAGE_KEY, "katagomo.renjuPractice.v2");
  assert.equal(LEGACY_HISTORY_STORAGE_KEY, "katagomo.openingPractice.v1");

  const empty = clearHistory();
  assert.deepEqual(empty, { schemaVersion: 2, records: [] });
  assert.equal(Object.isFrozen(empty), true);
  assert.equal(Object.isFrozen(empty.records), true);
  assert.equal(serializeHistory(empty), '{"schemaVersion":2,"records":[]}');
});

test("legacy v1 arrays migrate stopPly and retain every evaluation field", () => {
  const legacy = [{
    id: "legacy-one",
    startedAt: "2026-08-31T10:00:00.000Z",
    endedAt: "2026-08-31T10:02:00.000Z",
    settings: { userColor: "B", stopPly: 14, gradingMode: "end", maxVisits: 100 },
    openingMoves: [],
    finalMoves: BASE_MOVES,
    records: [{
      ply: 1,
      userMove: "H8",
      userColor: "B",
      rawPolicy: 0.314,
      policyRank: 2,
      visitRank: 3,
      recommendedMove: "J8",
      analysisInsufficient: false,
      analysisInsufficientReasons: [],
      mistakeSeverity: { winrateLoss: 0.025, visitRankGap: 2 },
      futureCompatibleField: { retained: true },
    }],
  }];

  const loaded = migrateHistory(JSON.stringify(legacy));
  assert.equal(loaded.history.records.length, 1);
  assert.equal(loaded.diagnostics[0].code, "legacy-migrated");
  const migrated = loaded.history.records[0];
  assert.equal(migrated.id, "legacy-one");
  assert.deepEqual(migrated.finalMoves, BASE_MOVES);
  assert.deepEqual(migrated.settings.endCondition, { kind: "ply", ply: 14 });
  assert.equal(migrated.settings.rules, "renju");
  assert.equal(migrated.settings.boardSize, 15);
  assert.equal(migrated.completion.reason, "ply-limit");
  assert.equal(migrated.migratedFrom, LEGACY_HISTORY_STORAGE_KEY);
  assert.deepEqual(migrated.turns[0].evaluation.futureCompatibleField, { retained: true });
  assert.deepEqual(migrated.turns[0].evaluation.mistakeSeverity, {
    winrateLoss: 0.025,
    visitRankGap: 2,
  });
  assert.equal(Object.isFrozen(migrated.turns[0].evaluation), true);
  const roundTrip = deserializeHistory(serializeHistory(loaded.history));
  assert.equal(roundTrip.history.records[0].migratedFrom, LEGACY_HISTORY_STORAGE_KEY);
});

test("legacy entries without IDs receive deterministic IDs", () => {
  const legacy = [{
    startedAt: "2026-08-31T10:00:00.000Z",
    endedAt: "2026-08-31T10:02:00.000Z",
    settings: { userColor: "B", stopPly: 14, gradingMode: "end", maxVisits: 100 },
    openingMoves: [],
    finalMoves: BASE_MOVES,
    records: [],
  }];
  const first = migrateHistory(legacy).history.records[0].id;
  const second = migrateHistory(structuredClone(legacy)).history.records[0].id;
  assert.match(first, /^legacy-[0-9a-f]{8}$/);
  assert.equal(first, second);
});

test("bad JSON and malformed stores return diagnostics instead of throwing", () => {
  const badJson = deserializeHistory("{not-json");
  assert.deepEqual(badJson.history.records, []);
  assert.deepEqual(badJson.diagnostics.map((entry) => entry.code), ["invalid-json"]);

  const wrongShape = deserializeHistory([record("wrong-shape")]);
  assert.deepEqual(wrongShape.history.records, []);
  assert.deepEqual(wrongShape.diagnostics.map((entry) => entry.code), ["invalid-store"]);

  const wrongLegacy = migrateHistory({ records: [] });
  assert.deepEqual(wrongLegacy.history.records, []);
  assert.deepEqual(wrongLegacy.diagnostics.map((entry) => entry.code), ["invalid-legacy-store"]);
});

test("structurally damaged v2 falls back to legacy while a valid empty v2 wins", () => {
  const legacy = JSON.stringify([{
    id: "legacy-recovered",
    startedAt: "2026-08-31T10:00:00.000Z",
    endedAt: "2026-08-31T10:02:00.000Z",
    settings: { userColor: "B", stopPly: 14, gradingMode: "end", maxVisits: 100 },
    openingMoves: [],
    finalMoves: BASE_MOVES,
    records: [],
  }]);
  const recovered = resolveHistorySources("{broken", legacy);
  assert.deepEqual(recovered.history.records.map((entry) => entry.id), ["legacy-recovered"]);
  assert.deepEqual(recovered.diagnostics.map((entry) => entry.code), [
    "invalid-json", "v2-fallback-legacy", "legacy-migrated",
  ]);

  const currentWins = resolveHistorySources('{"schemaVersion":2,"records":[]}', legacy);
  assert.deepEqual(currentWins.history.records, []);
  assert.deepEqual(currentWins.diagnostics, []);
});

test("one damaged or duplicate record does not prevent other records loading", () => {
  const store = {
    schemaVersion: 2,
    records: [
      record("kept-a"),
      record("broken", { finalMoves: [["W", "H8"]] }),
      record("kept-b", { endedAt: "2026-09-01T00:06:00.000Z" }),
      record("kept-a", { endedAt: "2026-09-01T00:07:00.000Z" }),
    ],
  };
  const loaded = deserializeHistory(store);
  assert.deepEqual(loaded.history.records.map((entry) => entry.id), ["kept-a", "kept-b"]);
  assert.deepEqual(loaded.diagnostics.map((entry) => entry.code), [
    "invalid-record",
    "duplicate-record",
  ]);
  assert.equal(loaded.diagnostics[0].id, "broken");
  assert.equal(Object.isFrozen(loaded.diagnostics), true);
});

test("per-turn snapshots retain the ranked top 10 and PV but never the 226 policy array", () => {
  const candidates = Array.from({ length: 12 }, (_, index) => ({
    move: `${"ABCDEFGHJKLM"[index]}${index + 1}`,
    order: 11 - index,
    rawPrior: (index + 1) / 100,
    visits: index + 1,
    visitShare: (index + 1) / 78,
    blackWinrate: 0.4 + index / 100,
    currentPlayerWinrate: 0.4 + index / 100,
    userWinrate: 0.4 + index / 100,
    pv: ["H8", "H9"],
  }));
  const fullPolicy = Array.from({ length: 226 }, (_, index) => index / 226);
  const input = record("snapshot", {
    turns: [{
      ply: 1,
      userColor: "B",
      userMove: "H8",
      evaluation: {
        ply: 1,
        userColor: "B",
        userMove: "H8",
        rawPolicy: 0.42,
        policy: fullPolicy,
        preAnalysis: { policy: fullPolicy },
      },
      analysisSnapshot: {
        isFinal: true,
        currentPlayer: "B",
        requestedMaxVisits: 500,
        candidateVisitTotal: 78,
        rootInfo: { blackWinrate: 0.51, visits: 500, currentPlayer: "B" },
        candidates,
        policy: fullPolicy,
      },
    }],
  });

  const history = upsertHistory(clearHistory(), input);
  const turn = history.records[0].turns[0];
  assert.equal(turn.analysisSnapshot.candidates.length, 10);
  assert.deepEqual(turn.analysisSnapshot.candidates.map((entry) => entry.order), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(turn.analysisSnapshot.candidates[0].pv, ["H8", "H9"]);
  assert.equal(turn.evaluation.rawPolicy, 0.42);
  assert.equal("policy" in turn.evaluation, false);
  assert.equal("preAnalysis" in turn.evaluation, false);
  assert.equal("policy" in turn.analysisSnapshot, false);
  const serialized = serializeHistory(history);
  assert.equal(serialized.includes(JSON.stringify(fullPolicy)), false);
  assert.equal(serialized.includes('"rawPolicy":0.42'), true);
});

test("preAnalysis is accepted as a snapshot source while its full policy is discarded", () => {
  const input = record("pre-analysis", {
    records: [{
      ply: 1,
      userColor: "B",
      userMove: "H8",
      rawPolicy: 0.3,
      preAnalysis: {
        isFinal: true,
        currentPlayer: "B",
        candidateVisitTotal: 100,
        policy: Array(226).fill(1 / 225),
        candidates: [{
          move: "H8", order: 0, rawPrior: 0.3, visits: 100,
          visitShare: 1, blackWinrate: 0.6, pv: ["H8", "H9"],
        }],
      },
    }],
    turns: undefined,
  });
  const history = upsertHistory(clearHistory(), input);
  assert.equal(history.records[0].turns[0].analysisSnapshot.candidates[0].move, "H8");
  assert.equal(serializeHistory(history).includes('"policy"'), false);
});

test("serialize and deserialize form an immutable JSON-compatible round trip", () => {
  const history = upsertHistory(clearHistory(), terminalRecord());
  const serialized = serializeHistory(history);
  const loaded = deserializeHistory(serialized);
  assert.deepEqual(loaded.diagnostics, []);
  assert.deepEqual(loaded.history, history);
  assert.equal(Object.isFrozen(loaded.history), true);
  assert.equal(Object.isFrozen(loaded.history.records[0].terminalState), true);
  assert.equal(loaded.history.records[0].completion.reason, "game-terminal");
  assert.equal(loaded.history.records[0].terminalState.winner, "B");
  assert.doesNotThrow(() => JSON.parse(serialized));
});

test("upsert replaces by ID, prepends newest data, and caps history at 20", () => {
  let history = clearHistory();
  for (let index = 0; index < HISTORY_LIMIT + 3; index += 1) {
    history = upsertHistory(history, record(`game-${index}`, {
      endedAt: `2026-09-01T00:${String(index).padStart(2, "0")}:00.000Z`,
    }));
  }
  assert.equal(history.records.length, HISTORY_LIMIT);
  assert.equal(history.records[0].id, "game-22");
  assert.equal(history.records.at(-1).id, "game-3");

  history = upsertHistory(history, record("game-10", {
    endedAt: "2026-09-01T01:00:00.000Z",
  }));
  assert.equal(history.records.length, HISTORY_LIMIT);
  assert.equal(history.records[0].id, "game-10");
  assert.equal(history.records.filter((entry) => entry.id === "game-10").length, 1);
  assert.equal(history.records[0].endedAt, "2026-09-01T01:00:00.000Z");
});

test("delete, clear, and select review do not expose mutable storage state", () => {
  let history = upsertHistory(clearHistory(), record("first"));
  history = upsertHistory(history, record("second", { endedAt: "2026-09-01T00:06:00.000Z" }));

  const selected = selectHistoryReview(history, "first");
  assert.equal(selected.id, "first");
  assert.equal(Object.isFrozen(selected.finalMoves), true);
  assert.throws(() => selected.finalMoves.push(["W", "A1"]), TypeError);
  assert.equal(selectHistoryReview(history, "missing"), null);

  const deleted = deleteHistory(history, "first");
  assert.deepEqual(deleted.records.map((entry) => entry.id), ["second"]);
  assert.deepEqual(history.records.map((entry) => entry.id), ["second", "first"]);
  assert.deepEqual(clearHistory().records, []);
});

test("loading keeps only 20 valid records and reports the truncation", () => {
  const records = Array.from({ length: 22 }, (_, index) => record(`stored-${index}`));
  const loaded = deserializeHistory({ schemaVersion: 2, records });
  assert.equal(loaded.history.records.length, 20);
  assert.equal(loaded.diagnostics.at(-1).code, "history-truncated");
  assert.equal(loaded.diagnostics.at(-1).omitted, 2);
});

test("strict mutations reject a pre-existing partially corrupted store", () => {
  const corrupted = { schemaVersion: 2, records: [record("ok"), { id: "broken" }] };
  assert.throws(() => upsertHistory(corrupted, record("next")), /손상된 history/);
  assert.throws(() => deleteHistory(corrupted, "ok"), /손상된 history/);
  assert.throws(() => selectHistoryReview(corrupted, "ok"), /손상된 history/);
  assert.throws(() => serializeHistory(corrupted), /손상된 history/);
});
