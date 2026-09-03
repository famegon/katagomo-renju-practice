import test from "node:test";
import assert from "node:assert/strict";

import { decidePracticeReconnect } from "../web/socket-recovery.mjs";

test("an inactive or already recovered practice does nothing", () => {
  assert.equal(decidePracticeReconnect(), "none");
  assert.equal(decidePracticeReconnect({ practiceActive: true }), "none");
});

test("an accepted AI final is not replaced while its local continuation is running", () => {
  for (const phase of ["applying_user", "finalizing", "ai_wait"]) {
    assert.equal(decidePracticeReconnect({
      practiceActive: true,
      recoveryPending: true,
      phase,
    }), "wait");
  }
  assert.equal(decidePracticeReconnect({
    practiceActive: true,
    recoveryPending: true,
    phase: "error",
    aiTimerPending: true,
  }), "wait");
});

test("reconnect preserves a prepared user turn and resumes only interrupted search", () => {
  assert.equal(decidePracticeReconnect({
    practiceActive: true,
    recoveryPending: true,
    phase: "user_turn",
    preparedUserTurn: true,
  }), "user-ready");
  assert.equal(decidePracticeReconnect({
    practiceActive: true,
    recoveryPending: true,
    phase: "analyzing_ai",
  }), "resume-analysis");
  assert.equal(decidePracticeReconnect({
    practiceActive: true,
    recoveryPending: true,
    phase: "analyzing_user",
    analysisLive: true,
  }), "flow-resumed");
});
