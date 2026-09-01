import test from "node:test";
import assert from "node:assert/strict";

import {
  candidateHitAtPoint,
  resetNeedsConfirmation,
  resolveBoardPointerIntent,
} from "../web/board-interaction.mjs";

const areas = [
  { move: "H8", px: 100, py: 100, radius: 20, box: { x: 120, y: 80, width: 104, height: 48 } },
  { move: "J8", px: 145, py: 100, radius: 18, box: { x: 160, y: 120, width: 104, height: 48 } },
];

test("candidate hit testing distinguishes circles, labels, and empty board space", () => {
  assert.deepEqual(candidateHitAtPoint(areas, { x: 100, y: 100 }), { kind: "circle", move: "H8" });
  assert.deepEqual(candidateHitAtPoint(areas, { x: 210, y: 90 }), { kind: "label", move: "H8" });
  assert.equal(candidateHitAtPoint(areas, { x: 20, y: 20 }), null);

  // J8's circle overlaps H8's label, and the visible circle wins.
  assert.deepEqual(candidateHitAtPoint(areas, { x: 145, y: 100 }), { kind: "circle", move: "J8" });
});

test("candidate circles remain interactive when progressive labels are hidden", () => {
  const areas = [{ move: "G8", px: 40, py: 40, radius: 12, box: null }];
  assert.deepEqual(candidateHitAtPoint(areas, { x: 40, y: 40 }), { kind: "circle", move: "G8" });
  assert.equal(candidateHitAtPoint(areas, { x: 80, y: 80 }), null);
});
test("candidate labels never fall through to a covered intersection", () => {
  const labelHit = { kind: "label", move: "H8" };
  assert.deepEqual(resolveBoardPointerIntent({
    candidateHit: labelHit,
    intersection: { move: "K10" },
    boardInteractive: true,
  }), { kind: "focus-candidate", move: "H8" });

  assert.deepEqual(resolveBoardPointerIntent({
    candidateHit: { kind: "circle", move: "H8" },
    intersection: { move: "K10" },
    boardInteractive: true,
  }), { kind: "place", move: "H8" });

  assert.deepEqual(resolveBoardPointerIntent({
    candidateHit: { kind: "circle", move: "H8" },
    intersection: { move: "H8" },
    boardInteractive: false,
  }), { kind: "focus-candidate", move: "H8" });
});

test("bare intersections and reset confirmation have explicit contracts", () => {
  assert.deepEqual(resolveBoardPointerIntent({
    intersection: { move: "K10" }, boardInteractive: true,
  }), { kind: "place", move: "K10" });
  assert.deepEqual(resolveBoardPointerIntent({
    intersection: { move: "K10" }, boardInteractive: false,
  }), { kind: "blocked", move: "K10" });
  assert.deepEqual(resolveBoardPointerIntent({}), { kind: "none", move: null });

  assert.equal(resetNeedsConfirmation({}), false);
  assert.equal(resetNeedsConfirmation({ moveCount: 1 }), true);
  assert.equal(resetNeedsConfirmation({ practiceActive: true }), true);
  assert.equal(resetNeedsConfirmation({ practiceEnded: true }), true);
  assert.equal(resetNeedsConfirmation({ analysisPresent: true }), true);
});
