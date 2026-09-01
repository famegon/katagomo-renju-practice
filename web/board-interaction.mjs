function pointInCircle(point, area) {
  return Math.hypot(point.x - area.px, point.y - area.py) <= area.radius;
}
function pointInBox(point, box) {
  if (!box) return false;
  return point.x >= box.x && point.x <= box.x + box.width
    && point.y >= box.y && point.y <= box.y + box.height;
}

/** Prefer a visible candidate circle over any label that overlaps it. */
export function candidateHitAtPoint(areas, point) {
  const circle = areas.find((area) => pointInCircle(point, area));
  if (circle) return Object.freeze({ kind: "circle", move: circle.move });
  const label = areas.find((area) => pointInBox(point, area.box));
  return label ? Object.freeze({ kind: "label", move: label.move }) : null;
}

/**
 * Candidate labels are inspection controls, candidate circles play their own
 * move when the board is live, and bare intersections play that intersection.
 * A label can therefore never fall through to a covered board intersection.
 */
export function resolveBoardPointerIntent({
  candidateHit = null,
  intersection = null,
  boardInteractive = false,
} = {}) {
  if (candidateHit?.kind === "label") {
    return Object.freeze({ kind: "focus-candidate", move: candidateHit.move });
  }
  if (candidateHit?.kind === "circle") {
    return Object.freeze(boardInteractive
      ? { kind: "place", move: candidateHit.move }
      : { kind: "focus-candidate", move: candidateHit.move });
  }
  if (intersection) {
    return Object.freeze(boardInteractive
      ? { kind: "place", move: intersection.move }
      : { kind: "blocked", move: intersection.move });
  }
  return Object.freeze({ kind: "none", move: null });
}

export function resetNeedsConfirmation({
  moveCount = 0,
  practiceActive = false,
  practiceEnded = false,
  analysisPresent = false,
} = {}) {
  return Number(moveCount) > 0 || practiceActive || practiceEnded || analysisPresent;
}
