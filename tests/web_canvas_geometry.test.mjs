import test from "node:test";
import assert from "node:assert/strict";

import {
  clientPointToCanvas,
  configureHiDpiSquareCanvas,
  normalizedPixelRatio,
} from "../web/canvas-geometry.mjs";

test("Retina canvas uses a capped backing-store ratio and logical coordinates", () => {
  const transforms = [];
  const context = { setTransform: (...values) => transforms.push(values) };
  const canvas = { width: 0, height: 0, dataset: {}, getContext: () => context };
  const configured = configureHiDpiSquareCanvas(canvas, 760, 3);

  assert.equal(configured.pixelRatio, 2);
  assert.equal(canvas.width, 1520);
  assert.equal(canvas.height, 1520);
  assert.equal(canvas.dataset.pixelRatio, "2");
  assert.deepEqual(transforms, [[2, 0, 0, 2, 0, 0]]);
});

test("CSS client coordinates map to the same logical board at any pixel ratio", () => {
  assert.deepEqual(
    clientPointToCanvas(
      { clientX: 430, clientY: 220 },
      { left: 50, top: 30, width: 380, height: 380 },
      760,
    ),
    { x: 760, y: 380 },
  );
});

test("invalid or sub-one display ratios safely use one", () => {
  assert.equal(normalizedPixelRatio(undefined), 1);
  assert.equal(normalizedPixelRatio(0), 1);
  assert.equal(normalizedPixelRatio(1.5), 1.5);
});
