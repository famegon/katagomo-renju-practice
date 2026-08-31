import test from "node:test";
import assert from "node:assert/strict";

import {
  clampReviewPly,
  createHistoryReview,
  isReviewTerminalPosition,
  moveHistoryReview,
  reviewMistakePlys,
  reviewMoves,
  reviewTurn,
} from "../web/history-review.mjs";

function record(overrides = {}) {
  return Object.freeze({
    id: "one",
    finalMoves: Object.freeze([
      Object.freeze(["B", "H8"]),
      Object.freeze(["W", "H9"]),
      Object.freeze(["B", "J8"]),
    ]),
    turns: Object.freeze([
      Object.freeze({ ply: 1, userMove: "H8" }),
      Object.freeze({ ply: 3, userMove: "J8" }),
    ]),
    completion: Object.freeze({
      summary: Object.freeze({ topMistakes: Object.freeze([{ ply: 3 }, { ply: 1 }, { ply: 3 }, { ply: 99 }]) }),
    }),
    terminalState: null,
    ...overrides,
  });
}

test("review navigation clamps to 0..final ply and leaves the record untouched", () => {
  const source = record();
  const review = createHistoryReview(source);
  assert.equal(review.ply, 3);
  assert.equal(moveHistoryReview(review, -8).ply, 0);
  assert.equal(moveHistoryReview(review, 99).ply, 3);
  assert.equal(clampReviewPly(source, 1.9), 1);
  assert.equal(review.record, source);
  assert.equal(review.ply, 3);
});

test("reviewMoves returns an isolated prefix and reviewTurn matches only the selected ply", () => {
  const source = record();
  const review = moveHistoryReview(createHistoryReview(source), 1);
  const selectedMoves = reviewMoves(review);
  assert.deepEqual(selectedMoves, [["B", "H8"]]);
  selectedMoves[0][1] = "A1";
  assert.equal(source.finalMoves[0][1], "H8");
  assert.equal(reviewTurn(review).userMove, "H8");
  assert.equal(reviewTurn(moveHistoryReview(review, 2)), null);
});

test("review exposes valid unique mistake plies and terminal status only at the last position", () => {
  const terminal = record({ terminalState: Object.freeze({ isTerminal: true }) });
  const last = createHistoryReview(terminal);
  assert.deepEqual(reviewMistakePlys(last), [3, 1]);
  assert.equal(isReviewTerminalPosition(last), true);
  assert.equal(isReviewTerminalPosition(moveHistoryReview(last, 2)), false);
});
