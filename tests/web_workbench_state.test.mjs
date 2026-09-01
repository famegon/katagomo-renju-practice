import test from "node:test";
import assert from "node:assert/strict";

import {
  ANALYSIS_VIEW_ORDER,
  WORKBENCH_TAB_ORDER,
  adjacentTab,
  createWorkbenchState,
  selectAnalysisView,
  selectWorkbenchTab,
  showsMctsBoardOverlay,
} from "../web/workbench-state.mjs";

test("workbench starts in the MCTS analysis view with immutable state", () => {
  const state = createWorkbenchState();
  assert.deepEqual(state, { tab: "analysis", analysisView: "mcts" });
  assert.equal(Object.isFrozen(state), true);
  assert.throws(() => createWorkbenchState({ tab: "settings" }), /유효하지/);
});

test("ordinary workbench tabs preserve the selected analysis subview", () => {
  const policy = selectAnalysisView(createWorkbenchState(), "policy");
  const history = selectWorkbenchTab(policy, "history");
  assert.equal(history.effect, "none");
  assert.deepEqual(history.state, { tab: "history", analysisView: "policy" });
});

test("MCTS board overlays appear only beside the matching MCTS view", () => {
  assert.equal(showsMctsBoardOverlay(createWorkbenchState()), true);
  assert.equal(showsMctsBoardOverlay(createWorkbenchState({ analysisView: "policy" })), false);
  assert.equal(showsMctsBoardOverlay(createWorkbenchState({ tab: "history" })), false);
});

test("leaving a non-idle comparison requests one explicit clear", () => {
  const comparison = createWorkbenchState({ tab: "comparison" });
  for (const comparisonMode of ["selecting", "complete", "error"]) {
    const decision = selectWorkbenchTab(comparison, "analysis", { comparisonMode });
    assert.equal(decision.state.tab, "analysis");
    assert.equal(decision.effect, "clear-comparison");
  }
});

test("a running comparison blocks tab navigation instead of hiding live work", () => {
  const comparison = createWorkbenchState({ tab: "comparison" });
  const decision = selectWorkbenchTab(comparison, "history", { comparisonMode: "running" });
  assert.equal(decision.effect, "block-running-comparison");
  assert.equal(decision.state.tab, "comparison");
});

test("keyboard navigation wraps and supports Home and End", () => {
  assert.equal(adjacentTab("analysis", "ArrowLeft", WORKBENCH_TAB_ORDER), "history");
  assert.equal(adjacentTab("history", "ArrowRight", WORKBENCH_TAB_ORDER), "analysis");
  assert.equal(adjacentTab("policy", "Home", ANALYSIS_VIEW_ORDER), "mcts");
  assert.equal(adjacentTab("mcts", "End", ANALYSIS_VIEW_ORDER), "policy");
  assert.equal(adjacentTab("mcts", "Escape", ANALYSIS_VIEW_ORDER), "mcts");
});
