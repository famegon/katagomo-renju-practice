const LOCAL_TRANSITION_PHASES = new Set([
  "applying_user",
  "ai_wait",
  "finalizing",
]);

/**
 * Decide how an active practice should continue after its analysis WebSocket
 * reconnects. DOM and timers stay in app.js; this function makes the race
 * between transport recovery and an already accepted final result testable.
 */
export function decidePracticeReconnect({
  practiceActive = false,
  recoveryPending = false,
  analysisLive = false,
  phase = "setup",
  aiTimerPending = false,
  preparedUserTurn = false,
} = {}) {
  if (!practiceActive || !recoveryPending) return "none";
  if (analysisLive) return "flow-resumed";
  if (preparedUserTurn) return "user-ready";
  if (aiTimerPending || LOCAL_TRANSITION_PHASES.has(phase)) return "wait";
  return "resume-analysis";
}
