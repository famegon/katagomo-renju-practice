import test from "node:test";
import assert from "node:assert/strict";

import {
  KIFU_FORMAT,
  KIFU_VERSION,
  MAX_KIFU_FILE_BYTES,
  parseRenjuKifuJson,
  validateKifuFileMetadata,
} from "../web/kifu-json.mjs";

function kifu(overrides = {}) {
  return JSON.stringify({
    format: KIFU_FORMAT,
    version: KIFU_VERSION,
    rules: "renju",
    boardSize: 15,
    moves: [["B", "H8"], ["W", "H9"]],
    ...overrides,
  });
}

test("Renju JSON 기보를 canonical 15x15 수순으로 읽는다", () => {
  const parsed = parseRenjuKifuJson(kifu({
    rules: "RENJU",
    moves: [["b", " h8 "], ["w", "h9"]],
  }));
  assert.deepEqual(parsed, {
    format: KIFU_FORMAT,
    version: 1,
    rules: "renju",
    boardSize: 15,
    moves: [["B", "H8"], ["W", "H9"]],
  });
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.moves), true);
  assert.equal(MAX_KIFU_FILE_BYTES, 262144);
  assert.equal(validateKifuFileMetadata({ name: "opening.JSON", size: 1024 }), true);
  assert.throws(() => validateKifuFileMetadata({ name: "opening.sgf", size: 1024 }), /.json 파일만/);
  assert.throws(() => validateKifuFileMetadata({ name: "opening.json", size: MAX_KIFU_FILE_BYTES + 1 }), /256 KiB/);
});

test("기보 JSON 문법과 최상위 형식을 명확히 거부한다", () => {
  assert.throws(() => parseRenjuKifuJson("{"), /JSON 문법/);
  assert.throws(() => parseRenjuKifuJson("[]"), /최상위 값은 객체/);
  assert.throws(() => parseRenjuKifuJson(null), /JSON 텍스트/);
});

test("알 수 없는 형식 버전과 Renju가 아닌 규칙을 거부한다", () => {
  assert.throws(() => parseRenjuKifuJson(kifu({ format: "other" })), /format/);
  assert.throws(() => parseRenjuKifuJson(kifu({ version: 2 })), /version/);
  assert.throws(() => parseRenjuKifuJson(kifu({ rules: "freestyle" })), /rules는 renju/);
  assert.throws(() => parseRenjuKifuJson(kifu({ boardSize: 19 })), /boardSize는 15/);
});

test("흑부터 교대하지 않는 수순, 잘못된 좌표, 중복 착수를 거부한다", () => {
  assert.throws(() => parseRenjuKifuJson(kifu({ moves: [["W", "H8"]] })), /1수는 B/);
  assert.throws(() => parseRenjuKifuJson(kifu({ moves: [["B", "I8"]] })), /유효한 15×15 좌표/);
  assert.throws(() => parseRenjuKifuJson(kifu({ moves: [["B", "H8"], ["W", "H8"]] })), /중복 착수/);
  assert.throws(() => parseRenjuKifuJson(kifu({ moves: [["B", "PASS"]] })), /유효한 15×15 좌표/);
});

test("빈 기보와 225수 이하의 구조만 허용한다", () => {
  assert.deepEqual(parseRenjuKifuJson(kifu({ moves: [] })).moves, []);
  const moves = Array.from({ length: 226 }, (_, index) => [index % 2 === 0 ? "B" : "W", "H8"]);
  assert.throws(() => parseRenjuKifuJson(kifu({ moves })), /225수를 넘을 수 없습니다/);
});
