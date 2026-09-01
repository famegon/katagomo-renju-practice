const WORKBENCH_TABS = Object.freeze(["analysis", "comparison", "history"]);
const ANALYSIS_VIEWS = Object.freeze(["mcts", "policy"]);
const COMPARISON_MODES = new Set(["idle", "selecting", "running", "complete", "error"]);

function assertMember(value, values, field) {
  if (!values.includes(value)) throw new Error(`${field}가 유효하지 않습니다: ${value}`);
  return value;
}

function freezeState(state) {
  return Object.freeze({ tab: state.tab, analysisView: state.analysisView });
}

export function createWorkbenchState({ tab = "analysis", analysisView = "mcts" } = {}) {
  return freezeState({
    tab: assertMember(tab, WORKBENCH_TABS, "workbench tab"),
    analysisView: assertMember(analysisView, ANALYSIS_VIEWS, "analysis view"),
  });
}

export function selectWorkbenchTab(state, tab, { comparisonMode = "idle" } = {}) {
  const current = createWorkbenchState(state);
  const target = assertMember(tab, WORKBENCH_TABS, "workbench tab");
  if (!COMPARISON_MODES.has(comparisonMode)) {
    throw new Error(`comparison mode가 유효하지 않습니다: ${comparisonMode}`);
  }
  if (target === current.tab) return Object.freeze({ state: current, effect: "none" });
  if (current.tab === "comparison" && target !== "comparison") {
    if (comparisonMode === "running") {
      return Object.freeze({ state: current, effect: "block-running-comparison" });
    }
    const effect = comparisonMode === "idle" ? "none" : "clear-comparison";
    return Object.freeze({ state: freezeState({ ...current, tab: target }), effect });
  }
  return Object.freeze({ state: freezeState({ ...current, tab: target }), effect: "none" });
}

export function selectAnalysisView(state, analysisView) {
  const current = createWorkbenchState(state);
  return freezeState({
    ...current,
    analysisView: assertMember(analysisView, ANALYSIS_VIEWS, "analysis view"),
  });
}

export function showsMctsBoardOverlay(state) {
  const current = createWorkbenchState(state);
  return current.tab === "analysis" && current.analysisView === "mcts";
}

export function adjacentTab(current, key, values) {
  const items = [...values];
  const index = items.indexOf(current);
  if (index < 0 || items.length === 0) throw new Error("현재 탭이 탭 목록에 없습니다");
  if (key === "Home") return items[0];
  if (key === "End") return items.at(-1);
  if (key === "ArrowLeft") return items[(index - 1 + items.length) % items.length];
  if (key === "ArrowRight") return items[(index + 1) % items.length];
  return current;
}

export const WORKBENCH_TAB_ORDER = WORKBENCH_TABS;
export const ANALYSIS_VIEW_ORDER = ANALYSIS_VIEWS;
