import test from "node:test";
import assert from "node:assert/strict";

import { beginAnalysisJob, transitionAnalysisJob } from "../web/session-state.mjs";
import { decideWebSocketMessage } from "../web/ws-message-state.mjs";

function liveJob() {
  return beginAnalysisJob({
    clientRequestId: "client-1",
    positionRevision: 4,
    sessionEpoch: "session-1",
    analysisPurpose: "manual",
    requestedMaxVisits: 100,
  });
}

const identity = Object.freeze({ positionRevision: 4, sessionEpoch: "session-1" });
const context = Object.freeze({ positionKey: "position-4", ply: 4 });

function decide(message, overrides = {}) {
  return decideWebSocketMessage({
    message,
    job: liveJob(),
    analysisContext: context,
    currentIdentity: identity,
    currentPositionKey: "position-4",
    positionIsTerminal: false,
    ...overrides,
  }).kind;
}

function metadata(extra = {}) {
  return {
    clientRequestId: "client-1",
    positionRevision: 4,
    positionMoveCount: 4,
    turnNumber: 4,
    sessionEpoch: "session-1",
    analysisPurpose: "manual",
    requestedMaxVisits: 100,
    ...extra,
  };
}

test("only an identity-matched error owns the live analysis", () => {
  assert.equal(decide({ type: "error", clientRequestId: "client-1" }), "error-current");
  assert.equal(decide({ type: "error", clientRequestId: "stale" }), "ignore");
  assert.equal(decide({ type: "error", code: "socket_aux" }), "error-auxiliary");
  assert.equal(decide(
    { type: "error", clientRequestId: "client-1" },
    { job: transitionAnalysisJob(liveJob(), "final") },
  ), "ignore");
});
test("official position and late analysis terminal decisions are explicit", () => {
  assert.equal(decide({
    type: "position",
    ...metadata(),
    gameState: { isTerminal: true, outcome: "black_win" },
  }), "position-terminal");
  assert.equal(decide({
    type: "position",
    ...metadata(),
    gameState: { isTerminal: false },
  }), "position-invalid");
  assert.equal(decide({ type: "analysis", ...metadata(), isFinal: false }, {
    positionIsTerminal: true,
  }), "analysis-after-terminal");
});

test("analysis noResults, partial, final, stale, and mismatched metadata stay distinct", () => {
  assert.equal(decide({ type: "analysis", ...metadata(), noResults: true, isFinal: true }), "analysis-no-results");
  assert.equal(decide({ type: "analysis", ...metadata(), isFinal: false }), "analysis-partial");
  assert.equal(decide({ type: "analysis", ...metadata(), isFinal: true }), "analysis-final");
  assert.equal(decide({
    type: "analysis", ...metadata({ requestedMaxVisits: 500 }), isFinal: true,
  }), "analysis-metadata-mismatch");
  assert.equal(decide({
    type: "analysis", ...metadata({ clientRequestId: "stale" }), isFinal: true,
  }), "ignore");
  assert.equal(decide({ type: "analysis", ...metadata(), isFinal: true }, {
    currentPositionKey: "another-position",
  }), "ignore");
});

test("status and warnings update only the matching job while preserving engine-only status", () => {
  assert.equal(decide({ type: "status", status: "analyzing", ...metadata() }), "status-analyzing");
  assert.equal(decide({
    type: "status", status: "analyzing", ...metadata({ clientRequestId: "stale" }),
  }), "status-engine-only");
  assert.equal(decide({ type: "warning", ...metadata(), message: "careful" }), "warning-current");
  assert.equal(decide({ type: "status", status: "connected" }, { job: null }), "status-connected");
  assert.equal(decide({ type: "status", status: "idle" }, { job: null }), "status-idle");
  assert.equal(decide(null), "ignore");
});
