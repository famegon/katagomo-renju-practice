const BOARD_SIZE = 15;
const BOARD_CAPACITY = BOARD_SIZE * BOARD_SIZE;
const COLUMNS = "ABCDEFGHJKLMNOP";

export const KIFU_FORMAT = "katagomo-renju-kifu";
export const KIFU_VERSION = 1;
export const MAX_KIFU_FILE_BYTES = 256 * 1024;

function fail(message) {
  throw new Error(message);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function validateKifuFileMetadata({ name, size } = {}) {
  if (typeof name !== "string" || !name.toLowerCase().endsWith(".json")) {
    fail(".json 파일만 불러올 수 있습니다");
  }
  if (!Number.isSafeInteger(size) || size < 0) fail("기보 파일 크기를 확인할 수 없습니다");
  if (size > MAX_KIFU_FILE_BYTES) {
    fail(`기보 파일은 ${Math.floor(MAX_KIFU_FILE_BYTES / 1024)} KiB 이하여야 합니다`);
  }
  return true;
}

function normalizeCoordinate(value, index) {
  if (typeof value !== "string") fail(`moves[${index}][1]은 좌표 문자열이어야 합니다`);
  const move = value.trim().toUpperCase();
  const column = COLUMNS.indexOf(move[0]);
  const row = Number(move.slice(1));
  if (column < 0 || !Number.isInteger(row) || row < 1 || row > BOARD_SIZE) {
    fail(`moves[${index}][1]에 유효한 15×15 좌표가 필요합니다: ${value}`);
  }
  return `${COLUMNS[column]}${row}`;
}

function normalizeMoves(value) {
  if (!Array.isArray(value)) fail("moves는 배열이어야 합니다");
  if (value.length > BOARD_CAPACITY) fail(`moves는 ${BOARD_CAPACITY}수를 넘을 수 없습니다`);
  const occupied = new Set();
  return value.map((entry, index) => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      fail(`moves[${index}]는 [player, move] 형식이어야 합니다`);
    }
    const expectedPlayer = index % 2 === 0 ? "B" : "W";
    const player = typeof entry[0] === "string" ? entry[0].trim().toUpperCase() : entry[0];
    if (player !== expectedPlayer) fail(`${index + 1}수는 ${expectedPlayer} 차례여야 합니다`);
    const move = normalizeCoordinate(entry[1], index);
    if (occupied.has(move)) fail(`중복 착수 좌표입니다: ${move}`);
    occupied.add(move);
    return [player, move];
  });
}

export function parseRenjuKifuJson(text) {
  if (typeof text !== "string") fail("기보 파일은 JSON 텍스트여야 합니다");
  let source;
  try {
    source = JSON.parse(text);
  } catch (error) {
    fail(`JSON 문법을 읽을 수 없습니다: ${error.message}`);
  }
  if (!isPlainObject(source)) fail("기보 JSON의 최상위 값은 객체여야 합니다");
  if (source.format !== KIFU_FORMAT) fail(`format은 ${KIFU_FORMAT}이어야 합니다`);
  if (source.version !== KIFU_VERSION) fail(`version은 ${KIFU_VERSION}이어야 합니다`);
  if (typeof source.rules !== "string" || source.rules.trim().toLowerCase() !== "renju") {
    fail("rules는 renju여야 합니다");
  }
  if (source.boardSize !== BOARD_SIZE) fail(`boardSize는 ${BOARD_SIZE}여야 합니다`);
  return deepFreeze({
    format: KIFU_FORMAT,
    version: KIFU_VERSION,
    rules: "renju",
    boardSize: BOARD_SIZE,
    moves: normalizeMoves(source.moves),
  });
}
