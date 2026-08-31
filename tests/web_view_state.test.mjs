import test from "node:test";
import assert from "node:assert/strict";

import {
  PRIMARY_ACTION_IDS,
  deriveViewState,
} from "../web/view-state.mjs";

const READY = Object.freeze({
  mode: "practice",
  connected: true,
  engineState: "ready",
  trainingContractState: "ready",
  legalityState: "ready",
});

function primaryActions(view) {
  return Object.entries(view.actions)
    .filter(([, action]) => action.visible && action.enabled && action.primary)
    .map(([id]) => id);
}

function terminalState(outcome, terminalReason, extra = {}) {
  const winner = outcome === "black_win" ? "B" : outcome === "white_win" ? "W" : null;
  return {
    isTerminal: true,
    outcome,
    winner,
    terminalReason,
    terminalMove: "H8",
    moveCount: 9,
    ...extra,
  };
}

test("practice setup and free analysis expose one clear primary action", () => {
  const practice = deriveViewState(READY);
  assert.equal(practice.key, "practice-setup");
  assert.equal(practice.primaryAction, "practice-start");
  assert.deepEqual(primaryActions(practice), ["practice-start"]);
  assert.equal(practice.boardInteractive, true);

  const analysis = deriveViewState({ ...READY, mode: "analysis" });
  assert.equal(analysis.key, "free-analysis");
  assert.equal(analysis.primaryAction, "analyze");
  assert.deepEqual(primaryActions(analysis), ["analyze"]);
  assert.equal(analysis.boardInteractive, true);
});

test("live analysis locks the board and makes cancel the only primary CTA", () => {
  for (const state of ["requested", "streaming"]) {
    const view = deriveViewState({ ...READY, analysis: { state, insufficient: false } });
    assert.equal(view.key, "analyzing");
    assert.equal(view.task.tone, "busy");
    assert.equal(view.boardInteractive, false);
    assert.equal(view.primaryAction, "cancel");
    assert.deepEqual(primaryActions(view), ["cancel"]);
    assert.equal(view.actions["practice-start"].enabled, false);
  }
});

test("a prepared practice user turn treats the board as the primary action", () => {
  const view = deriveViewState({
    ...READY,
    practice: {
      active: true,
      phase: "user_turn",
      userColor: "W",
    },
    analysis: { state: "final", insufficient: false },
  });
  assert.equal(view.key, "practice-user-turn");
  assert.match(view.task.title, /백/);
  assert.equal(view.boardInteractive, true);
  assert.equal(view.primaryAction, "board");
  assert.deepEqual(primaryActions(view), ["board"]);
});

test("practice transitions lock placement while a practice error offers re-analysis", () => {
  const waiting = deriveViewState({
    ...READY,
    practice: { active: true, phase: "ai_wait", userColor: "B" },
  });
  assert.equal(waiting.key, "practice-transition");
  assert.equal(waiting.boardInteractive, false);
  assert.equal(waiting.primaryAction, null);

  const failed = deriveViewState({
    ...READY,
    practice: { active: true, phase: "error", userColor: "B" },
    analysis: { state: "failed", insufficient: false },
  });
  assert.equal(failed.key, "practice-error");
  assert.equal(failed.task.tone, "error");
  assert.equal(failed.primaryAction, "analyze");
  assert.deepEqual(primaryActions(failed), ["analyze"]);
});

test("official terminal state dominates review, search, and practice and clears stale analysis", () => {
  const view = deriveViewState({
    ...READY,
    positionState: terminalState("black_win", "line_win"),
    reviewActive: true,
    practice: { active: true, phase: "analyzing_ai", userColor: "W" },
    analysis: { state: "streaming", insufficient: false },
  });
  assert.equal(view.key, "terminal");
  assert.equal(view.terminal.visible, true);
  assert.equal(view.terminal.outcome, "black_win");
  assert.equal(view.terminal.title, "흑 승");
  assert.match(view.terminal.message, /KataGomo의 공식 Renju 종국 판정/);
  assert.match(view.terminal.message, /MCTS 분석하지 않습니다/);
  assert.equal(view.clearAnalysis, true);
  assert.equal(view.boardInteractive, false);
  assert.equal(view.primaryAction, "reset");
  assert.deepEqual(primaryActions(view), ["reset"]);
});

test("terminal copy distinguishes line wins, forbidden loss, and draw", () => {
  const whiteLine = deriveViewState({
    ...READY,
    positionState: terminalState("white_win", "line_win", { moveCount: 10 }),
  });
  assert.equal(whiteLine.terminal.title, "백 승");
  assert.match(whiteLine.terminal.message, /백이 오목/);

  const forbidden = deriveViewState({
    ...READY,
    positionState: terminalState("white_win", "black_forbidden"),
  });
  assert.match(forbidden.terminal.message, /흑의 금수 착수/);

  const draw = deriveViewState({
    ...READY,
    positionState: terminalState("draw", "board_full", {
      terminalMove: "O15",
      moveCount: 225,
    }),
  });
  assert.equal(draw.terminal.title, "무승부");
  assert.match(draw.terminal.message, /보드가 가득/);
});

test("review does not make the live board interactive and owns the primary CTA", () => {
  const view = deriveViewState({
    ...READY,
    reviewActive: true,
    reviewCanStartPractice: true,
    analysis: { state: "final", insufficient: false },
  });
  assert.equal(view.key, "review");
  assert.equal(view.boardInteractive, false);
  assert.equal(view.clearAnalysis, false);
  assert.equal(view.primaryAction, "review-start-practice");
  assert.deepEqual(primaryActions(view), ["review-start-practice"]);
});

test("review owns its controls even if stale input still claims an analysis is streaming", () => {
  const view = deriveViewState({
    ...READY,
    reviewActive: true,
    analysis: { state: "streaming", insufficient: false },
  });
  assert.equal(view.key, "review");
  assert.equal(view.actions.cancel.visible, false);
  assert.equal(view.actions.cancel.enabled, false);
  assert.equal(view.actions.cancel.primary, false);
  assert.deepEqual(primaryActions(view), ["review-start-practice"]);
});

test("disconnection and legality failure take priority over ordinary session states", () => {
  const disconnected = deriveViewState({
    ...READY,
    connected: false,
    practice: { ended: true, phase: "complete" },
  });
  assert.equal(disconnected.key, "disconnected");
  assert.equal(disconnected.task.tone, "error");
  assert.equal(disconnected.primaryAction, null);

  const helperError = deriveViewState({
    ...READY,
    legalityState: "error",
    analysis: { state: "final", insufficient: false },
  });
  assert.equal(helperError.key, "legality-error");
  assert.equal(helperError.boardInteractive, false);
  assert.equal(helperError.primaryAction, "retry-legality");
  assert.deepEqual(primaryActions(helperError), ["retry-legality"]);
});

test("only a ready engine enables new analysis and AI practice", () => {
  for (const engineState of ["unknown", "starting", "analyzing", "restarting", "stopping"]) {
    const view = deriveViewState({ ...READY, engineState });
    assert.equal(view.key, "engine-pending");
    assert.equal(view.task.tone, "busy");
    assert.equal(view.actions.analyze.enabled, false);
    assert.equal(view.actions["practice-start"].enabled, false);
    assert.equal(view.boardInteractive, true, "setup board editing remains local");
  }
  for (const engineState of ["stopped", "error"]) {
    const view = deriveViewState({ ...READY, engineState });
    assert.equal(view.key, "engine-unavailable");
    assert.equal(view.task.tone, "error");
    assert.equal(view.actions.analyze.enabled, false);
    assert.equal(view.actions["practice-start"].enabled, false);
  }
});

test("training contract pending and error are distinct and retryable", () => {
  const pending = deriveViewState({ ...READY, trainingContractState: "pending" });
  assert.equal(pending.key, "practice-contract-pending");
  assert.equal(pending.task.tone, "busy");
  assert.equal(pending.primaryAction, "analyze");
  assert.equal(pending.actions["retry-training"].visible, false);

  const failed = deriveViewState({ ...READY, trainingContractState: "error" });
  assert.equal(failed.key, "practice-contract-error");
  assert.equal(failed.task.tone, "error");
  assert.equal(failed.primaryAction, "retry-training");
  assert.deepEqual(primaryActions(failed), ["retry-training"]);
  assert.equal(failed.actions.analyze.enabled, true);

  const freeAnalysis = deriveViewState({
    ...READY,
    mode: "analysis",
    trainingContractState: "error",
  });
  assert.equal(freeAnalysis.key, "free-analysis");
  assert.equal(freeAnalysis.primaryAction, "analyze");
});

test("practice summarizing and completion have explicit continuation states", () => {
  const summarizing = deriveViewState({
    ...READY,
    practice: { ended: true, summaryPending: true, phase: "finishing" },
  });
  assert.equal(summarizing.key, "practice-summarizing");
  assert.equal(summarizing.task.tone, "busy");
  assert.equal(summarizing.primaryAction, null);

  const completed = deriveViewState({
    ...READY,
    practice: { ended: true, phase: "complete", completionTerminal: false },
  });
  assert.equal(completed.key, "practice-completed");
  assert.equal(completed.primaryAction, "continue-practice");

  const completedTerminal = deriveViewState({
    ...READY,
    practice: { ended: true, phase: "complete", completionTerminal: true },
  });
  assert.equal(completedTerminal.primaryAction, "new-opening");
});

test("failed, interrupted, canceled, and insufficient analysis remain distinct", () => {
  for (const state of ["failed", "interrupted"]) {
    const view = deriveViewState({ ...READY, analysis: { state, insufficient: true } });
    assert.equal(view.key, "analysis-error");
    assert.equal(view.task.tone, "error");
    assert.equal(view.primaryAction, "analyze");
  }
  const canceled = deriveViewState({
    ...READY,
    mode: "analysis",
    analysis: { state: "canceled", insufficient: true },
  });
  assert.equal(canceled.key, "analysis-canceled");
  assert.equal(canceled.primaryAction, "analyze");

  const insufficient = deriveViewState({
    ...READY,
    mode: "analysis",
    analysis: { state: "final", insufficient: true },
  });
  assert.equal(insufficient.key, "analysis-insufficient");
  assert.equal(insufficient.task.tone, "insufficient");
  assert.equal(insufficient.primaryAction, "analyze");
});

test("every supported state combination has at most one visible enabled primary CTA", () => {
  const modes = ["practice", "analysis"];
  const booleans = [false, true];
  const legalities = ["pending", "ready", "error"];
  const engineStates = ["unknown", "ready", "analyzing", "error"];
  const trainingContractStates = ["pending", "ready", "error"];
  const positions = [null, terminalState("black_win", "line_win")];
  const practices = [
    {},
    { active: true, phase: "user_turn", userColor: "B" },
    { active: true, phase: "analyzing_ai", userColor: "W" },
    { active: true, phase: "error", userColor: "B" },
    { ended: true, summaryPending: true, phase: "finishing" },
    { ended: true, phase: "complete", completionTerminal: false },
    { ended: true, phase: "complete", completionTerminal: true },
  ];
  const analyses = [
    null,
    { state: "requested", insufficient: false },
    { state: "streaming", insufficient: false },
    { state: "final", insufficient: false },
    { state: "final", insufficient: true },
    { state: "canceled", insufficient: false },
    { state: "interrupted", insufficient: true },
    { state: "failed", insufficient: true },
  ];

  let combinations = 0;
  for (const mode of modes) {
    for (const connected of booleans) {
      for (const engineState of engineStates) {
        for (const trainingContractState of trainingContractStates) {
          for (const legalityState of legalities) {
            for (const positionState of positions) {
              for (const reviewActive of booleans) {
                for (const practice of practices) {
                  for (const analysis of analyses) {
                    combinations += 1;
                    const view = deriveViewState({
                      mode,
                      connected,
                      engineState,
                      trainingContractState,
                      legalityState,
                      positionState,
                      reviewActive,
                      practice,
                      analysis,
                    });
                    const primaries = primaryActions(view);
                    assert.ok(primaries.length <= 1, JSON.stringify({ view, primaries }));
                    assert.equal(
                      view.primaryAction === null ? primaries.length : primaries[0],
                      view.primaryAction === null ? 0 : view.primaryAction,
                    );
                    assert.ok(
                      view.primaryAction === null || PRIMARY_ACTION_IDS.includes(view.primaryAction),
                    );
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  assert.equal(combinations, 32_256);
});

test("the output is immutable JSON and invalid input is rejected", () => {
  const view = deriveViewState(READY);
  assert.doesNotThrow(() => JSON.stringify(view));
  assert.equal(Object.isFrozen(view), true);
  assert.equal(Object.isFrozen(view.task), true);
  assert.equal(Object.isFrozen(view.actions.analyze), true);
  assert.throws(() => deriveViewState({ ...READY, mode: "gomoku" }), /mode/);
  assert.throws(() => deriveViewState({ ...READY, connected: "yes" }), /boolean/);
  assert.throws(() => deriveViewState({ ...READY, engineState: "idle" }), /engineState/);
  assert.throws(
    () => deriveViewState({ ...READY, trainingContractState: "failed" }),
    /trainingContractState/,
  );
  assert.throws(
    () => deriveViewState({ ...READY, practice: { active: true, ended: true } }),
    /동시에 true/,
  );
  assert.throws(
    () => deriveViewState({ ...READY, analysis: { state: "idle" } }),
    /analysis.state/,
  );
});
