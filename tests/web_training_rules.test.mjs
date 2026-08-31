import test from "node:test";
import assert from "node:assert/strict";

import {
  FIXED_END_PLIES,
  MANUAL_END_VALUE,
  automaticCompletionReason,
  endConditionLabel,
  parseEndCondition,
  shouldAutoFinish,
} from "../web/training-rules.mjs";

test("fixed end conditions preserve the default opening boundaries", () => {
  assert.deepEqual(FIXED_END_PLIES, [6, 8, 10, 12, 14, 16]);
  const condition = parseEndCondition("14");
  assert.deepEqual(condition, { kind: "ply", ply: 14 });
  assert.equal(shouldAutoFinish(condition, 13), false);
  assert.equal(shouldAutoFinish(condition, 14), true);
  assert.equal(shouldAutoFinish(condition, 15), true);
  assert.equal(endConditionLabel(condition), "14수까지");
});

test("manual finish crosses 14 and 16 without automatic completion", () => {
  const condition = parseEndCondition(MANUAL_END_VALUE);
  assert.deepEqual(condition, { kind: "manual" });
  assert.equal(shouldAutoFinish(condition, 14), false);
  assert.equal(shouldAutoFinish(condition, 16), false);
  assert.equal(shouldAutoFinish(condition, 224), false);
  assert.equal(endConditionLabel(condition), "직접 종료할 때까지");
});

test("invalid end conditions and ply counts are rejected", () => {
  assert.throws(() => parseEndCondition("15"), /지원하지 않는 종료 조건/);
  assert.throws(() => parseEndCondition("14.0"), /지원하지 않는 종료 조건/);
  assert.throws(() => shouldAutoFinish({ kind: "unknown" }, 14), /잘못된/);
  assert.throws(() => shouldAutoFinish({ kind: "manual" }, -1), /0 이상의 정수/);
});

test("official terminal result takes priority over a fixed ply limit", () => {
  const fixed = parseEndCondition("14");
  assert.equal(automaticCompletionReason(fixed, 14, true), "game-terminal");
  assert.equal(automaticCompletionReason(fixed, 14, false), "ply-limit");
  assert.equal(automaticCompletionReason(fixed, 13, false), null);
  assert.equal(
    automaticCompletionReason(parseEndCondition(MANUAL_END_VALUE), 225, true),
    "game-terminal",
  );
  assert.throws(
    () => automaticCompletionReason(fixed, 14, "yes"),
    /boolean/,
  );
});
