import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");

function matches(pattern, source) {
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

test("desktop document IDs are unique and every app lookup has a matching element", () => {
  const ids = matches(/\bid=["']([^"']+)["']/g, html);
  const counts = new Map();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);

  assert.deepEqual(
    [...counts.entries()].filter(([, count]) => count !== 1),
    [],
    "HTML IDs must be unique",
  );

  const referenced = new Set(matches(/\bbyId\(["']([^"']+)["']\)/g, app));
  assert.deepEqual(
    [...referenced].filter((id) => !counts.has(id)),
    [],
    "every byId() lookup must resolve in index.html",
  );
});

test("public UI states the fixed product scope without internal stage language", () => {
  assert.match(html, /KataGomo Renju Practice/);
  assert.match(html, /로컬 15×15 Renju 연습 플랫폼/);
  assert.match(html, /15×15 · Renju · Local/);
  assert.doesNotMatch(html, /Stage\s*[0-9]|초반/);
  assert.doesNotMatch(app, /새 초반/);
  assert.equal(matches(/\bid=["']rules["']/g, html).length, 0, "Renju is not user-selectable");
});

test("candidate table and glossary preserve standard KataGomo terminology", () => {
  for (const term of [
    "Order", "Move", "Raw policy", "Visits", "Visit share", "Winrate (Black)", "PV",
  ]) {
    assert.match(html, new RegExp(term.replace(/[()]/g, "\\$&")));
  }
  assert.match(html, /<tbody id="candidates">[\s\S]*?colspan="7"/);
  assert.match(html, /KataGomo의 원시 Winrate 관점은 항상 BLACK/);
  assert.match(html, /<dt>Root visits<\/dt>/);
  assert.match(html, /<dt>Winrate \(Current player\)<\/dt>/);
  assert.match(html, /<dt>Winrate \(User\)<\/dt>/);
  assert.match(html, /<dt>Raw policy rank<\/dt>/);
  assert.match(html, /<dt>Visits rank<\/dt>/);
  assert.match(html, /<dt>100 \/ 500 visits<\/dt>/);
  assert.match(app, /data-order="\$\{order \?\? ""\}"/);
  assert.match(app, /aria-selected="\$\{selected\}"/);
  assert.match(app, /const first = order === 0/);
  assert.doesNotMatch(app, /index === 0 \? "rgba\(20,93,72/);
});

test("the DOM is wired to the pure view state and exposes official terminal status accessibly", () => {
  assert.match(app, /import \{ deriveViewState \} from "\.\/view-state\.mjs"/);
  assert.match(app, /legalityState = "pending"/);
  assert.match(app, /deriveViewState\(currentViewInput\(\)\)/);
  assert.match(app, /elements\.terminalBanner\.hidden = !view\.terminal\.visible/);
  assert.match(app, /elements\.taskTitle\.textContent = view\.task\.title/);
  assert.match(app, /if \(analysisIsLive\(\)\) cancelAnalysis\(\)/);
  assert.match(app, /aria-disabled/);
  assert.match(app, /종국 · MCTS 미실행/);
  assert.match(html, /id="terminal-banner"[^>]*role="alert"/);
  assert.match(html, /id="task-title"/);
  assert.match(html, /id="task-message"/);
  assert.match(html, /id="retry-legality"/);
  assert.match(html, /id="retry-training"/);
});

test("engine process details stay in collapsed diagnostics rather than the header badge", () => {
  for (const id of [
    "engine-diagnostic-state", "engine-pid", "engine-restarts", "engine-last-error",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(app, /engineStatus\.textContent\s*=\s*`[^`]*PID/);
  assert.match(app, /ready: "엔진 준비됨"/);
});

test("WebSocket routing and board hit decisions come from executable pure modules", () => {
  assert.match(app, /import \{ decideWebSocketMessage \} from "\.\/ws-message-state\.mjs"/);
  assert.match(app, /candidateHitAtPoint/);
  assert.match(app, /resolveBoardPointerIntent/);
});

test("streaming candidate rerenders preserve keyboard focus by move without scrolling", () => {
  assert.match(app, /const focusSnapshot = captureCandidateTableFocus\(\)/);
  assert.match(app, /document\.activeElement/);
  assert.match(app, /row\.dataset\.move === snapshot\.move/);
  assert.match(app, /matchingRow\.focus\(\{ preventScroll: true \}\)/);
  assert.match(app, /snapshot\.scrollContainer\.scrollLeft = snapshot\.scrollLeft/);
  assert.match(app, /snapshot\.scrollContainer\.scrollTop = snapshot\.scrollTop/);
  assert.match(app, /if \(hoveredCandidateMove === snapshot\.move\) hoveredCandidateMove = null/);
  assert.equal(
    matches(/restoreCandidateTableFocus\(focusSnapshot\)/g, app).length,
    2,
    "focus restoration must cover both populated and empty candidate rerenders",
  );
});
