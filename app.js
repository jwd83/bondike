const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");
const appShell = document.querySelector(".app-shell");
const canvasStage = document.querySelector(".canvas-stage");
const toolbarEl = document.querySelector(".toolbar");
const newGameBtn = document.getElementById("new-game-btn");
const autoBtn = document.getElementById("auto-btn");
const safeAutoBtn = document.getElementById("safe-auto-btn");
const fullscreenBtn = document.getElementById("fullscreen-btn");

const BOARD = { w: canvas.width, h: canvas.height };
const BOARD_ASPECT = BOARD.w / BOARD.h;
const CARD = { w: 90, h: 126, r: 12 };
const TOP_Y = 82;
const TABLEAU_Y = 222;
const LEFT = 28;
const COL_GAP = 12;
const TABLEAU_GAP_X = 16;
const TABLEAU_DX = CARD.w + TABLEAU_GAP_X;
const FACE_DOWN_OFFSET = 20;
const FACE_UP_OFFSET = 28;
const SUIT_GLYPHS = {
  clubs: "♣",
  diamonds: "♦",
  hearts: "♥",
  spades: "♠",
};
const FOUNDATION_ORDER = ["clubs", "diamonds", "hearts", "spades"];
const RED_SUITS = new Set(["hearts", "diamonds"]);
const HINT_TEXT =
  "Click or drag to move cards. Stock draws, empty stock recycles. N=new, A=auto once, S=safe auto-complete, F=fullscreen.";
const TOP_FOUNDATION_GROUP_X = LEFT + (CARD.w + COL_GAP) * 3 + 20;

const state = {
  mode: "menu",
  stock: [],
  waste: [],
  foundations: [[], [], [], [],],
  tableau: [[], [], [], [], [], [], []],
  selected: null,
  moves: 0,
  score: 0,
  message: "Click the board to start.",
  lastAction: "",
  seed: 0,
  wonAt: null,
  drag: null,
  hovered: null,
  autoCompleting: false,
};

const animationState = {
  items: new Map(),
  clockMs: 0,
  lastPerfMs: null,
  rafId: 0,
  prefersReducedMotion:
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false,
};

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function syncAnimationClockFromPerf(now = performance.now()) {
  if (animationState.lastPerfMs == null) {
    animationState.lastPerfMs = now;
    if (animationState.clockMs === 0) animationState.clockMs = now;
    return;
  }
  const delta = Math.max(0, Math.min(50, now - animationState.lastPerfMs));
  animationState.clockMs += delta;
  animationState.lastPerfMs = now;
}

function pruneFinishedAnimations() {
  const now = animationState.clockMs;
  for (const [cardId, anim] of animationState.items) {
    if (now >= anim.startMs + anim.durationMs) {
      animationState.items.delete(cardId);
    }
  }
}

function isCardAnimating(cardId) {
  pruneFinishedAnimations();
  return animationState.items.has(cardId);
}

function getAnimatedCardPosition(cardId) {
  const anim = animationState.items.get(cardId);
  if (!anim) return null;
  const now = animationState.clockMs;
  if (now <= anim.startMs) return { x: anim.fromX, y: anim.fromY };
  const t = Math.min(1, (now - anim.startMs) / anim.durationMs);
  const e = easeOutCubic(t);
  return {
    x: anim.fromX + (anim.toX - anim.fromX) * e,
    y: anim.fromY + (anim.toY - anim.fromY) * e,
  };
}

function scheduleAnimationFrame() {
  if (animationState.rafId || animationState.prefersReducedMotion) return;
  if (animationState.items.size === 0) return;
  animationState.rafId = window.requestAnimationFrame((ts) => {
    animationState.rafId = 0;
    syncAnimationClockFromPerf(ts);
    pruneFinishedAnimations();
    render();
    if (animationState.items.size > 0) scheduleAnimationFrame();
  });
}

function queueCardSlide(card, from, to, options = {}) {
  if (!card || animationState.prefersReducedMotion) return;
  const durationMs = options.durationMs ?? 210;
  if (durationMs <= 0) return;
  animationState.items.set(card.id, {
    card,
    faceUp: options.faceUp ?? true,
    fromX: from.x,
    fromY: from.y,
    toX: to.x,
    toY: to.y,
    startMs: animationState.clockMs + (options.delayMs ?? 0),
    durationMs,
    showDecimal: options.showDecimal ?? false,
  });
  scheduleAnimationFrame();
}

function drawQueuedCardAnimations() {
  if (animationState.items.size === 0) return;
  pruneFinishedAnimations();
  for (const anim of animationState.items.values()) {
    const pos = getAnimatedCardPosition(anim.card.id);
    if (!pos) continue;
    if (anim.faceUp) {
      drawFaceUpCard(anim.card, pos.x, pos.y, false, anim.showDecimal);
    } else {
      drawFaceDownCard(pos.x, pos.y, false);
    }
  }
}

function getInitialOptions() {
  const params = new URLSearchParams(window.location.search);
  const rawSeed = params.get("seed");
  const parsedSeed = rawSeed !== null ? Number(rawSeed) : null;
  const seed = Number.isFinite(parsedSeed) ? Math.trunc(parsedSeed) : null;
  const autostart = params.get("autostart") === "1";
  return { seed, autostart };
}

function isAppFullscreen() {
  return document.fullscreenElement === appShell;
}

function resizeCanvasPresentation() {
  if (!canvasStage) return;

  const stageRect = canvasStage.getBoundingClientRect();
  const stageStyle = window.getComputedStyle(canvasStage);
  const padX =
    parseFloat(stageStyle.paddingLeft || "0") +
    parseFloat(stageStyle.paddingRight || "0");
  const padY =
    parseFloat(stageStyle.paddingTop || "0") +
    parseFloat(stageStyle.paddingBottom || "0");

  let availableW = Math.max(260, stageRect.width - padX);
  let availableH = Infinity;

  if (isAppFullscreen()) {
    const toolbarH = toolbarEl?.getBoundingClientRect().height ?? 0;
    const shellStyle = window.getComputedStyle(appShell);
    const shellPadY =
      parseFloat(shellStyle.paddingTop || "0") +
      parseFloat(shellStyle.paddingBottom || "0");
    const gap = parseFloat(shellStyle.rowGap || shellStyle.gap || "0") || 0;
    availableH = Math.max(220, window.innerHeight - toolbarH - shellPadY - gap - padY - 2);
  }

  let displayW = Math.min(BOARD.w, availableW);
  let displayH = displayW / BOARD_ASPECT;
  if (displayH > availableH) {
    displayH = availableH;
    displayW = displayH * BOARD_ASPECT;
  }

  canvas.style.width = `${Math.floor(displayW)}px`;
  canvas.style.height = `${Math.floor(displayH)}px`;
}

function updateFullscreenButtonLabel() {
  if (!fullscreenBtn) return;
  fullscreenBtn.textContent = isAppFullscreen() ? "Exit Fullscreen" : "Fullscreen";
}

function updateSafeAutoButtonState() {
  if (!safeAutoBtn) return;
  safeAutoBtn.disabled = state.autoCompleting;
  safeAutoBtn.textContent = state.autoCompleting ? "Auto-Completing..." : "Auto-Complete Safe";
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(array, rng = Math.random) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function createDeck() {
  let id = 0;
  const deck = [];
  for (const suit of FOUNDATION_ORDER) {
    for (let rank = 1; rank <= 13; rank += 1) {
      deck.push({
        id: id += 1,
        suit,
        rank,
        color: RED_SUITS.has(suit) ? "red" : "black",
      });
    }
  }
  return deck;
}

function newGame(seed = Date.now()) {
  animationState.items.clear();
  if (animationState.rafId) {
    cancelAnimationFrame(animationState.rafId);
    animationState.rafId = 0;
  }
  state.seed = seed;
  const rng = mulberry32(seed);
  const deck = shuffle(createDeck(), rng);

  state.stock = [];
  state.waste = [];
  state.foundations = [[], [], [], []];
  state.tableau = [[], [], [], [], [], [], []];
  state.selected = null;
  state.drag = null;
  state.hovered = null;
  state.autoCompleting = false;
  state.moves = 0;
  state.score = 0;
  state.mode = "playing";
  state.wonAt = null;
  state.lastAction = "New game";
  state.message = "Deal complete. Build foundations Ace (0001) to King (1101).";

  for (let col = 0; col < 7; col += 1) {
    for (let row = 0; row <= col; row += 1) {
      const card = deck.pop();
      state.tableau[col].push({ card, faceUp: row === col });
    }
  }
  state.stock = deck;
  updateSafeAutoButtonState();
  render();
}

function cardBits(rank) {
  return rank.toString(2).padStart(4, "0");
}

function cardLabel(card) {
  if (!card) return null;
  return `${SUIT_GLYPHS[card.suit]} ${cardBits(card.rank)} ${card.rank}`;
}

function foundationIndexForSuit(suit) {
  return FOUNDATION_ORDER.indexOf(suit);
}

function topFoundationCard(index) {
  const pile = state.foundations[index];
  return pile[pile.length - 1] || null;
}

function topWasteCard() {
  return state.waste[state.waste.length - 1] || null;
}

function topTableauEntry(col) {
  const pile = state.tableau[col];
  return pile[pile.length - 1] || null;
}

function canPlaceOnFoundation(card, foundationIndex) {
  const pile = state.foundations[foundationIndex];
  const top = pile[pile.length - 1];
  if (!top) return card.rank === 1;
  return top.suit === card.suit && card.rank === top.rank + 1;
}

function canPlaceOnTableau(card, targetCol) {
  const pile = state.tableau[targetCol];
  const top = pile[pile.length - 1];
  if (!top) return card.rank === 13;
  if (!top.faceUp) return false;
  return top.card.color !== card.color && top.card.rank === card.rank + 1;
}

function getSelectedCards() {
  if (!state.selected) return [];
  if (state.selected.source === "waste") {
    const card = topWasteCard();
    return card ? [card] : [];
  }
  if (state.selected.source === "foundation") {
    const card = topFoundationCard(state.selected.foundation);
    return card ? [card] : [];
  }
  if (state.selected.source === "tableau") {
    const pile = state.tableau[state.selected.col];
    return pile.slice(state.selected.index).map((entry) => entry.card);
  }
  return [];
}

function removeSelectedFromSource() {
  if (!state.selected) return [];
  if (state.selected.source === "waste") {
    const card = state.waste.pop();
    state.selected = null;
    return card ? [card] : [];
  }
  if (state.selected.source === "foundation") {
    const pile = state.foundations[state.selected.foundation];
    const card = pile.pop();
    state.selected = null;
    return card ? [card] : [];
  }
  if (state.selected.source === "tableau") {
    const pile = state.tableau[state.selected.col];
    const moved = pile.splice(state.selected.index);
    if (pile.length > 0 && !pile[pile.length - 1].faceUp) {
      pile[pile.length - 1].faceUp = true;
      state.score += 5;
      state.lastAction = "Flip";
    }
    state.selected = null;
    return moved.map((entry) => entry.card);
  }
  return [];
}

function attachToTableau(col, cards) {
  for (const card of cards) {
    state.tableau[col].push({ card, faceUp: true });
  }
}

function attachToFoundation(index, cards) {
  if (cards.length !== 1) return false;
  state.foundations[index].push(cards[0]);
  return true;
}

function moveSelectedToTableau(targetCol) {
  if (!state.selected) return false;
  const cards = getSelectedCards();
  if (cards.length === 0) return false;
  if (!canPlaceOnTableau(cards[0], targetCol)) return false;

  const fromPositions = captureSelectedCardPositions();
  const source = state.selected.source;
  const moved = removeSelectedFromSource();
  attachToTableau(targetCol, moved);
  queueSelectedMoveAnimationToTableau(targetCol, moved, fromPositions);
  state.moves += 1;
  if (source === "foundation") state.score -= 10;
  else state.score += moved.length;
  state.lastAction = `Move to tableau ${targetCol + 1}`;
  state.message = `Moved ${cardLabel(moved[0])} to tableau ${targetCol + 1}.`;
  checkWin();
  render();
  return true;
}

function moveSelectedToFoundation(index) {
  if (!state.selected) return false;
  const cards = getSelectedCards();
  if (cards.length !== 1) return false;
  if (!canPlaceOnFoundation(cards[0], index)) return false;

  const fromPositions = captureSelectedCardPositions();
  const moved = removeSelectedFromSource();
  attachToFoundation(index, moved);
  queueSelectedMoveAnimationToFoundation(index, moved, fromPositions);
  state.moves += 1;
  state.score += 10;
  state.lastAction = `Move to foundation ${index + 1}`;
  state.message = `Foundation ${index + 1}: ${cardLabel(moved[0])}`;
  checkWin();
  render();
  return true;
}

function selectionsEqual(a, b) {
  if (!a || !b || a.source !== b.source) return false;
  if (a.source === "waste") return true;
  if (a.source === "foundation") return a.foundation === b.foundation;
  if (a.source === "tableau") return a.col === b.col && a.index === b.index;
  return false;
}

function hoverRefFromHit(hit) {
  if (!hit) return null;
  if (hit.kind === "waste" && topWasteCard()) return { source: "waste" };
  if (hit.kind === "foundation" && topFoundationCard(hit.index)) {
    return { source: "foundation", foundation: hit.index };
  }
  if (hit.kind === "tableauCard") {
    const pile = state.tableau[hit.col];
    const entry = pile[hit.index];
    if (entry?.faceUp) return { source: "tableau", col: hit.col, index: hit.index };
  }
  return null;
}

function setHoveredCard(nextHover, rerender = true) {
  const same =
    (state.hovered === null && nextHover === null) ||
    (state.hovered && nextHover && selectionsEqual(state.hovered, nextHover));
  if (same) return false;
  state.hovered = nextHover;
  if (rerender) render();
  return true;
}

function trySelectSource(nextSel) {
  if (!nextSel) return;
  if (state.selected && selectionsEqual(state.selected, nextSel)) {
    state.selected = null;
    state.message = "Selection cleared.";
  } else {
    state.selected = nextSel;
    const cards = getSelectedCards();
    state.message = cards.length
      ? `Selected ${cardLabel(cards[0])}${cards.length > 1 ? ` (+${cards.length - 1})` : ""}`
      : "Selection empty.";
  }
  render();
}

function drawFromStock() {
  if (state.mode !== "playing") return;
  state.selected = null;
  state.drag = null;
  state.hovered = null;
  if (state.stock.length > 0) {
    const drawn = state.stock[state.stock.length - 1];
    state.waste.push(state.stock.pop());
    const { stockRect, wasteRect } = getTopRects();
    queueCardSlide(drawn, { x: stockRect.x, y: stockRect.y }, { x: wasteRect.x, y: wasteRect.y }, {
      faceUp: true,
      durationMs: 190,
    });
    state.moves += 1;
    state.lastAction = "Draw";
    state.message = `Drew ${cardLabel(topWasteCard())}`;
  } else if (state.waste.length > 0) {
    while (state.waste.length) state.stock.push(state.waste.pop());
    state.moves += 1;
    state.lastAction = "Recycle";
    state.message = "Recycled waste back into stock.";
  } else {
    state.message = "Stock and waste are empty.";
  }
  render();
}

function checkWin() {
  const total = state.foundations.reduce((sum, pile) => sum + pile.length, 0);
  if (total === 52) {
    state.mode = "won";
    state.wonAt = Date.now();
    state.selected = null;
    state.drag = null;
    state.hovered = null;
    state.message = "Win: all foundations completed.";
  }
}

function clearSelection() {
  state.selected = null;
  state.message = "Selection cleared.";
  render();
}

function tryAutoMoveOnce() {
  if (state.mode !== "playing") return false;
  state.selected = null;

  const waste = topWasteCard();
  if (waste) {
    const f = foundationIndexForSuit(waste.suit);
    state.selected = { source: "waste" };
    if (moveSelectedToFoundation(f)) return true;
    state.selected = null;
  }

  for (let col = 0; col < 7; col += 1) {
    const top = topTableauEntry(col);
    if (!top || !top.faceUp) continue;
    const f = foundationIndexForSuit(top.card.suit);
    state.selected = { source: "tableau", col, index: state.tableau[col].length - 1 };
    if (moveSelectedToFoundation(f)) return true;
    state.selected = null;
  }

  state.message = "No eligible auto-move to foundation.";
  render();
  return false;
}

function foundationTopRankForSuit(suit) {
  const i = foundationIndexForSuit(suit);
  const top = topFoundationCard(i);
  return top?.rank ?? 0;
}

function isSafeAutoFoundationMove(card) {
  if (!card) return false;
  // Conservative Klondike heuristic:
  // Always safe for A/2. For higher ranks, only advance when both opposite-color
  // foundations are at least rank-1, so we don't strand needed tableau links.
  if (card.rank <= 2) return true;
  const oppositeSuits = FOUNDATION_ORDER.filter(
    (suit) => RED_SUITS.has(suit) !== RED_SUITS.has(card.suit),
  );
  return oppositeSuits.every((suit) => foundationTopRankForSuit(suit) >= card.rank - 1);
}

async function tryAutoCompleteSafeFoundations() {
  if (state.mode !== "playing" || state.autoCompleting) return 0;
  state.autoCompleting = true;
  updateSafeAutoButtonState();

  const maxMoves = 52;
  let moves = 0;
  const cadenceMs = animationState.prefersReducedMotion ? 0 : 95;

  while (moves < maxMoves) {
    const waste = topWasteCard();
    if (waste && isSafeAutoFoundationMove(waste)) {
      state.selected = { source: "waste" };
      const f = foundationIndexForSuit(waste.suit);
      if (moveSelectedToFoundation(f)) {
        moves += 1;
        if (cadenceMs > 0) await waitMs(cadenceMs);
        continue;
      }
      state.selected = null;
    }

    let movedFromTableau = false;
    for (let col = 0; col < 7; col += 1) {
      const top = topTableauEntry(col);
      if (!top || !top.faceUp || !isSafeAutoFoundationMove(top.card)) continue;
      state.selected = { source: "tableau", col, index: state.tableau[col].length - 1 };
      const f = foundationIndexForSuit(top.card.suit);
      if (moveSelectedToFoundation(f)) {
        moves += 1;
        movedFromTableau = true;
        if (cadenceMs > 0) await waitMs(cadenceMs);
        break;
      }
      state.selected = null;
    }

    if (!movedFromTableau) break;
  }

  state.autoCompleting = false;
  updateSafeAutoButtonState();

  if (moves === 0) {
    state.message = "No safe auto-foundation moves available.";
  } else {
    state.message = `Auto-completed ${moves} safe foundation move${moves === 1 ? "" : "s"}.`;
  }
  render();
  return moves;
}

function tryMoveSelectionToOwnFoundation(selection) {
  if (state.mode !== "playing" || !selection) return false;
  const previousSelection = state.selected;
  state.selected = selection;
  const cards = getSelectedCards();
  if (cards.length !== 1) {
    state.selected = previousSelection;
    return false;
  }
  const targetFoundation = foundationIndexForSuit(cards[0].suit);
  if (moveSelectedToFoundation(targetFoundation)) return true;
  state.selected = previousSelection;
  return false;
}

function revealTopIfNeeded(col) {
  const pile = state.tableau[col];
  if (pile.length > 0 && !pile[pile.length - 1].faceUp) {
    pile[pile.length - 1].faceUp = true;
    state.score += 5;
    state.lastAction = "Flip";
    state.message = `Flipped tableau ${col + 1}.`;
    render();
    return true;
  }
  return false;
}

function isValidTableauRunFrom(col, index) {
  const pile = state.tableau[col];
  const run = pile.slice(index);
  return run.every((e, i) => {
    if (!e.faceUp) return false;
    if (i === 0) return true;
    const prev = run[i - 1].card;
    return prev.color !== e.card.color && prev.rank === e.card.rank + 1;
  });
}

function getTopRects() {
  const stockRect = { x: LEFT, y: TOP_Y, w: CARD.w, h: CARD.h, type: "stock" };
  const wasteRect = {
    x: LEFT + (CARD.w + COL_GAP),
    y: TOP_Y,
    w: CARD.w,
    h: CARD.h,
    type: "waste",
  };
  const foundations = [];
  const startX = TOP_FOUNDATION_GROUP_X;
  for (let i = 0; i < 4; i += 1) {
    foundations.push({
      x: startX + i * (CARD.w + COL_GAP),
      y: TOP_Y,
      w: CARD.w,
      h: CARD.h,
      type: "foundation",
      index: i,
    });
  }
  return { stockRect, wasteRect, foundations };
}

function tableauColumnX(col) {
  return LEFT + col * TABLEAU_DX;
}

function getTableauCardY(entry, topY) {
  return topY + (entry.faceUp ? FACE_UP_OFFSET : FACE_DOWN_OFFSET);
}

function pointInRect(px, py, rect) {
  return (
    px >= rect.x &&
    px <= rect.x + rect.w &&
    py >= rect.y &&
    py <= rect.y + rect.h
  );
}

function tableauHit(px, py) {
  for (let col = 6; col >= 0; col -= 1) {
    const x = tableauColumnX(col);
    const pile = state.tableau[col];
    let y = TABLEAU_Y;

    if (pile.length === 0) {
      const emptyRect = { x, y, w: CARD.w, h: CARD.h };
      if (pointInRect(px, py, emptyRect)) return { kind: "tableauEmpty", col };
      continue;
    }

    const rects = [];
    for (let i = 0; i < pile.length; i += 1) {
      rects.push({ x, y, w: CARD.w, h: CARD.h, col, index: i, entry: pile[i] });
      if (i < pile.length - 1) {
        y += pile[i].faceUp ? FACE_UP_OFFSET : FACE_DOWN_OFFSET;
      }
    }

    for (let i = rects.length - 1; i >= 0; i -= 1) {
      if (pointInRect(px, py, rects[i])) {
        return { kind: "tableauCard", col, index: rects[i].index };
      }
    }

    const columnRect = {
      x,
      y: TABLEAU_Y,
      w: CARD.w,
      h: Math.max(CARD.h, y - TABLEAU_Y + CARD.h),
    };
    if (pointInRect(px, py, columnRect)) return { kind: "tableauColumn", col };
  }
  return null;
}

function hitTest(px, py) {
  const { stockRect, wasteRect, foundations } = getTopRects();
  if (pointInRect(px, py, stockRect)) return { kind: "stock" };
  if (pointInRect(px, py, wasteRect)) return { kind: "waste" };
  for (const rect of foundations) {
    if (pointInRect(px, py, rect)) return { kind: "foundation", index: rect.index };
  }
  return tableauHit(px, py);
}

function selectionFromHit(hit) {
  if (!hit || state.mode === "menu") return null;
  if (hit.kind === "waste" && topWasteCard()) return { source: "waste" };
  if (hit.kind === "foundation" && topFoundationCard(hit.index)) {
    return { source: "foundation", foundation: hit.index };
  }
  if (hit.kind === "tableauCard") {
    const pile = state.tableau[hit.col];
    const entry = pile[hit.index];
    if (!entry || !entry.faceUp) return null;
    if (!isValidTableauRunFrom(hit.col, hit.index)) return null;
    return { source: "tableau", col: hit.col, index: hit.index };
  }
  return null;
}

function attemptDropOnHit(hit) {
  if (!hit || !state.selected) return false;
  if (hit.kind === "foundation") return moveSelectedToFoundation(hit.index);
  if (
    hit.kind === "tableauEmpty" ||
    hit.kind === "tableauColumn" ||
    hit.kind === "tableauCard"
  ) {
    return moveSelectedToTableau(hit.col);
  }
  return false;
}

function handleBoardClick(px, py) {
  if (state.mode === "menu") {
    newGame();
    return;
  }
  const hit = hitTest(px, py);
  if (!hit) {
    if (state.selected) clearSelection();
    return;
  }

  if (hit.kind === "stock") {
    drawFromStock();
    return;
  }

  if (hit.kind === "waste") {
    if (state.selected) {
      if (state.selected.source === "waste") clearSelection();
      return;
    }
    if (topWasteCard()) trySelectSource({ source: "waste" });
    else {
      state.message = "Waste is empty.";
      render();
    }
    return;
  }

  if (hit.kind === "foundation") {
    if (state.selected) {
      if (!moveSelectedToFoundation(hit.index)) {
        state.message = "Illegal foundation move.";
        render();
      }
      return;
    }
    if (topFoundationCard(hit.index)) {
      trySelectSource({ source: "foundation", foundation: hit.index });
    }
    return;
  }

  if (hit.kind === "tableauEmpty") {
    if (state.selected) {
      if (!moveSelectedToTableau(hit.col)) {
        state.message = "Only a King (1101) can move to an empty tableau column.";
        render();
      }
    }
    return;
  }

  if (hit.kind === "tableauColumn") {
    if (state.selected) {
      if (!moveSelectedToTableau(hit.col)) {
        state.message = "Illegal tableau move.";
        render();
      }
    }
    return;
  }

  if (hit.kind === "tableauCard") {
    const pile = state.tableau[hit.col];
    const entry = pile[hit.index];
    if (!entry) return;

    if (!entry.faceUp) {
      const isTop = hit.index === pile.length - 1;
      if (isTop && !state.selected) {
        revealTopIfNeeded(hit.col);
      }
      return;
    }

    if (state.selected) {
      const sameSource =
        state.selected.source === "tableau" &&
        state.selected.col === hit.col &&
        state.selected.index === hit.index;
      if (sameSource) {
        clearSelection();
        return;
      }
      if (!moveSelectedToTableau(hit.col)) {
        state.message = "Illegal tableau move.";
        render();
      }
      return;
    }

    if (!isValidTableauRunFrom(hit.col, hit.index)) {
      state.message = "Selected run is not a valid descending alternating stack.";
      render();
      return;
    }
    trySelectSource({ source: "tableau", col: hit.col, index: hit.index });
  }
}

function canvasPointFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function roundRectPath(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function fillWrappedText(text, x, y, maxWidth, lineHeight) {
  const words = String(text).split(/\s+/).filter(Boolean);
  let line = "";
  let cy = y;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      ctx.fillText(line, x, cy);
      line = word;
      cy += lineHeight;
    } else {
      line = next;
    }
  }
  if (line) ctx.fillText(line, x, cy);
  return cy + lineHeight;
}

function drawSlot(x, y, label, accent = false) {
  ctx.save();
  roundRectPath(x, y, CARD.w, CARD.h, CARD.r);
  ctx.fillStyle = accent ? "rgba(226, 208, 130, 0.08)" : "rgba(0,0,0,0.1)";
  ctx.fill();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = accent ? "rgba(238, 216, 125, 0.5)" : "rgba(195, 234, 216, 0.35)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(220, 244, 234, 0.7)";
  ctx.font = '14px "APL386", monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + CARD.w / 2, y + CARD.h / 2);
  ctx.restore();
}

function drawFaceDownCard(x, y, selected = false) {
  ctx.save();
  roundRectPath(x, y, CARD.w, CARD.h, CARD.r);
  ctx.fillStyle = selected ? "#314e85" : "#22344f";
  ctx.fill();
  ctx.strokeStyle = selected ? "#f5d66e" : "#94b9ff";
  ctx.lineWidth = selected ? 3 : 1.5;
  ctx.stroke();

  roundRectPath(x + 8, y + 8, CARD.w - 16, CARD.h - 16, 10);
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.stroke();

  // Clip the decorative pattern to the card bounds so stacked backs don't bleed into neighbors.
  roundRectPath(x + 9, y + 9, CARD.w - 18, CARD.h - 18, 9);
  ctx.clip();
  ctx.font = '12px "APL386", monospace';
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(223, 237, 255, 0.72)";
  for (let row = 0; row < 6; row += 1) {
    ctx.fillText("0101 1010", x + 15, y + 16 + row * 16);
  }
  ctx.restore();
}

function drawCardBitsPips(bits, x, y, color) {
  const radius = 5;
  const gap = 14;
  for (let i = 0; i < 4; i += 1) {
    const cx = x + i * gap;
    ctx.beginPath();
    ctx.arc(cx, y, radius, 0, Math.PI * 2);
    if (bits[i] === "1") {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(20, 52, 45, 0.45)";
      ctx.stroke();
    }
  }
}

function drawFaceUpCard(card, x, y, selected = false, showDecimal = selected) {
  const fg = card.color === "red" ? "#b73236" : "#1b2f2f";
  const soft = card.color === "red" ? "rgba(183, 50, 54, 0.25)" : "rgba(27, 47, 47, 0.22)";

  ctx.save();
  if (selected) {
    ctx.shadowColor = "rgba(245, 214, 110, 0.4)";
    ctx.shadowBlur = 18;
  }
  roundRectPath(x, y, CARD.w, CARD.h, CARD.r);
  ctx.fillStyle = "#fbf8ea";
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = selected ? "#f5d66e" : "rgba(21, 46, 39, 0.35)";
  ctx.lineWidth = selected ? 3 : 1.4;
  ctx.stroke();

  const bits = cardBits(card.rank);
  ctx.fillStyle = fg;
  ctx.font = '18px "APL386", monospace';
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`${SUIT_GLYPHS[card.suit]} ${bits}`, x + 8, y + 7);

  ctx.font = '14px "APL386", monospace';
  ctx.textAlign = "center";
  if (showDecimal) {
    ctx.globalAlpha = 0.92;
    ctx.fillText(String(card.rank), x + CARD.w / 2, y + 31);
    ctx.globalAlpha = 1;
  }

  drawCardBitsPips(bits, x + CARD.w / 2 - 21, y + 52, fg);

  ctx.fillStyle = soft;
  ctx.fillRect(x + 8, y + 62, CARD.w - 16, 1);

  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = '40px "APL386", monospace';
  ctx.fillText(SUIT_GLYPHS[card.suit], x + CARD.w / 2, y + 87);

  ctx.font = '16px "APL386", monospace';
  ctx.fillText(bits, x + CARD.w / 2, y + 108);
  ctx.restore();
}

function isSelectedTableauEntry(col, index) {
  return (
    state.selected &&
    state.selected.source === "tableau" &&
    state.selected.col === col &&
    index >= state.selected.index
  );
}

function isHoveredTableauEntry(col, index) {
  return (
    state.hovered &&
    state.hovered.source === "tableau" &&
    state.hovered.col === col &&
    state.hovered.index === index
  );
}

function tableauCardYForIndex(col, index) {
  const pile = state.tableau[col];
  let y = TABLEAU_Y;
  for (let i = 0; i < index; i += 1) {
    y += pile[i].faceUp ? FACE_UP_OFFSET : FACE_DOWN_OFFSET;
  }
  return y;
}

function selectionTopLeft(selection) {
  if (!selection) return null;
  const { wasteRect, foundations } = getTopRects();
  if (selection.source === "waste") {
    return { x: wasteRect.x, y: wasteRect.y };
  }
  if (selection.source === "foundation") {
    const rect = foundations[selection.foundation];
    return rect ? { x: rect.x, y: rect.y } : null;
  }
  if (selection.source === "tableau") {
    return {
      x: tableauColumnX(selection.col),
      y: tableauCardYForIndex(selection.col, selection.index),
    };
  }
  return null;
}

function captureSelectedCardPositions() {
  if (!state.selected) return [];
  if (state.selected.source === "waste" || state.selected.source === "foundation") {
    const card = state.selected.source === "waste"
      ? topWasteCard()
      : topFoundationCard(state.selected.foundation);
    const origin = selectionTopLeft(state.selected);
    return card && origin ? [{ card, x: origin.x, y: origin.y, faceUp: true }] : [];
  }
  if (state.selected.source === "tableau") {
    const pile = state.tableau[state.selected.col];
    const x = tableauColumnX(state.selected.col);
    const out = [];
    for (let i = state.selected.index; i < pile.length; i += 1) {
      const y = tableauCardYForIndex(state.selected.col, i);
      out.push({ card: pile[i].card, x, y, faceUp: !!pile[i].faceUp });
    }
    return out;
  }
  return [];
}

function queueSelectedMoveAnimationToTableau(targetCol, movedCards, fromPositions) {
  if (!movedCards.length || !fromPositions.length) return;
  const pile = state.tableau[targetCol];
  const startIndex = pile.length - movedCards.length;
  for (let i = 0; i < movedCards.length; i += 1) {
    const card = movedCards[i];
    const from = fromPositions.find((p) => p.card.id === card.id);
    if (!from) continue;
    const to = {
      x: tableauColumnX(targetCol),
      y: tableauCardYForIndex(targetCol, startIndex + i),
    };
    queueCardSlide(card, from, to, {
      faceUp: true,
      durationMs: 210 + i * 18,
      delayMs: i * 12,
    });
  }
}

function queueSelectedMoveAnimationToFoundation(targetFoundation, movedCards, fromPositions) {
  if (movedCards.length !== 1 || !fromPositions.length) return;
  const { foundations } = getTopRects();
  const rect = foundations[targetFoundation];
  if (!rect) return;
  queueCardSlide(
    movedCards[0],
    fromPositions[0],
    { x: rect.x, y: rect.y },
    { faceUp: true, durationMs: 220 }
  );
}

function drawCard(card, x, y, opts) {
  if (opts.faceUp) {
    drawFaceUpCard(card, x, y, opts.selected, opts.showDecimal);
  } else {
    drawFaceDownCard(x, y, opts.selected);
  }
}

function drawDragPreview() {
  if (!state.drag?.active || !state.selected) return;
  const cards = getSelectedCards();
  if (!cards.length) return;

  const x = state.drag.pointer.x - state.drag.offset.x;
  const y = state.drag.pointer.y - state.drag.offset.y;

  ctx.save();
  ctx.globalAlpha = 0.95;
  for (let i = 0; i < cards.length; i += 1) {
    drawFaceUpCard(cards[i], x, y + i * FACE_UP_OFFSET, true, true);
  }
  ctx.restore();
}

function drawBoardBackground() {
  function fillBoard() { ctx.fillRect(0, 0, BOARD.w, BOARD.h); }

  const base = ctx.createLinearGradient(0, 0, 0, BOARD.h);
  base.addColorStop(0, "#1b6a57");
  base.addColorStop(0.42, "#145244");
  base.addColorStop(1, "#0a2f2a");
  ctx.fillStyle = base;
  fillBoard();

  const glowA = ctx.createRadialGradient(120, 110, 20, 120, 110, 320);
  glowA.addColorStop(0, "rgba(245, 214, 110, 0.16)");
  glowA.addColorStop(1, "rgba(245, 214, 110, 0)");
  ctx.fillStyle = glowA;
  fillBoard();

  const glowB = ctx.createRadialGradient(1020, 120, 20, 1020, 120, 340);
  glowB.addColorStop(0, "rgba(114, 210, 188, 0.14)");
  glowB.addColorStop(1, "rgba(114, 210, 188, 0)");
  ctx.fillStyle = glowB;
  fillBoard();

  ctx.save();
  ctx.globalAlpha = 0.065;
  ctx.strokeStyle = "#dff3eb";
  ctx.lineWidth = 1;
  for (let i = -BOARD.h; i < BOARD.w + 40; i += 18) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + BOARD.h, BOARD.h);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.035;
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < 900; i += 1) {
    const x = (i * 137) % BOARD.w;
    const y = (i * 83) % BOARD.h;
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.restore();

  const topRail = ctx.createLinearGradient(0, 0, 0, 60);
  topRail.addColorStop(0, "rgba(3, 10, 10, 0.32)");
  topRail.addColorStop(1, "rgba(3, 10, 10, 0.12)");
  ctx.fillStyle = topRail;
  ctx.fillRect(0, 0, BOARD.w, 60);

  const vignette = ctx.createRadialGradient(
    BOARD.w / 2,
    BOARD.h / 2,
    260,
    BOARD.w / 2,
    BOARD.h / 2,
    BOARD.w * 0.62
  );
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.22)");
  ctx.fillStyle = vignette;
  fillBoard();
}

function drawHeader() {
  ctx.save();
  roundRectPath(16, 10, BOARD.w - 32, 40, 10);
  ctx.fillStyle = "rgba(4, 14, 14, 0.22)";
  ctx.fill();
  ctx.strokeStyle = "rgba(225, 244, 235, 0.08)";
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#edf7ef";
  ctx.font = '20px "APL386", monospace';
  ctx.fillText("BINARY KLONDIKE", 26, 30);

  const chips = [
    `MODE ${state.mode.toUpperCase()}`,
    `MOVES ${state.moves}`,
    `SCORE ${state.score}`,
    `STOCK ${state.stock.length}`,
    `WASTE ${state.waste.length}`,
  ];
  let x = 270;
  for (let i = 0; i < chips.length; i += 1) {
    const text = chips[i];
    ctx.font = '13px "APL386", monospace';
    const w = Math.ceil(ctx.measureText(text).width) + 16;
    roundRectPath(x, 16, w, 28, 7);
    ctx.fillStyle =
      i === 0 ? "rgba(240, 210, 126, 0.14)" : "rgba(255, 255, 255, 0.04)";
    ctx.fill();
    ctx.strokeStyle =
      i === 0 ? "rgba(240, 210, 126, 0.28)" : "rgba(214, 241, 230, 0.12)";
    ctx.stroke();
    ctx.fillStyle = i === 0 ? "#f0d27e" : "rgba(236, 246, 229, 0.82)";
    ctx.fillText(text, x + 8, 30);
    x += w + 8;
  }
  ctx.restore();
}

function drawTopRow() {
  const { stockRect, wasteRect, foundations } = getTopRects();
  drawSlot(stockRect.x, stockRect.y, state.stock.length ? "STOCK" : "RELOAD", true);
  drawSlot(wasteRect.x, wasteRect.y, "WASTE");
  for (let i = 0; i < foundations.length; i += 1) {
    const suit = FOUNDATION_ORDER[i];
    drawSlot(foundations[i].x, foundations[i].y, `${SUIT_GLYPHS[suit]} F${i + 1}`, true);
  }

  if (state.stock.length > 0) {
    drawFaceDownCard(stockRect.x, stockRect.y, state.selected?.source === "stock");
  }

  const waste = topWasteCard();
  if (waste) {
    const sel = state.selected?.source === "waste";
    const hov = state.hovered?.source === "waste";
    if (!isCardAnimating(waste.id)) {
      drawFaceUpCard(waste, wasteRect.x, wasteRect.y, sel, sel || hov);
    }
  }

  for (let i = 0; i < 4; i += 1) {
    const card = topFoundationCard(i);
    if (card) {
      const sel = state.selected?.source === "foundation" && state.selected.foundation === i;
      const hov = state.hovered?.source === "foundation" && state.hovered.foundation === i;
      if (!isCardAnimating(card.id)) {
        drawFaceUpCard(card, foundations[i].x, foundations[i].y, sel, sel || hov);
      }
    }
  }
}

function drawTableau() {
  for (let col = 0; col < 7; col += 1) {
    const x = tableauColumnX(col);
    const pile = state.tableau[col];
    if (pile.length === 0) drawSlot(x, TABLEAU_Y, `T${col + 1}`);

    let y = TABLEAU_Y;
    for (let i = 0; i < pile.length; i += 1) {
      const entry = pile[i];
      if (!isCardAnimating(entry.card.id)) {
        drawCard(entry.card, x, y, {
          faceUp: entry.faceUp,
          selected: isSelectedTableauEntry(col, i),
          showDecimal: isSelectedTableauEntry(col, i) || isHoveredTableauEntry(col, i),
        });
      }
      if (i < pile.length - 1) y += entry.faceUp ? FACE_UP_OFFSET : FACE_DOWN_OFFSET;
    }
  }
}

function drawFooter() {
  ctx.save();
  const footerY = BOARD.h - 94;
  roundRectPath(16, footerY - 10, BOARD.w - 32, 78, 12);
  ctx.fillStyle = "rgba(4, 12, 12, 0.34)";
  ctx.fill();
  ctx.strokeStyle = "rgba(210, 238, 227, 0.14)";
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = '14px "APL386", monospace';
  ctx.fillStyle = "rgba(233, 245, 231, 0.95)";
  let nextY = fillWrappedText(state.message, 30, footerY, BOARD.w - 60, 18);
  ctx.font = '12px "APL386", monospace';
  ctx.fillStyle = "rgba(233, 245, 231, 0.7)";
  fillWrappedText(HINT_TEXT, 30, nextY, BOARD.w - 60, 16);
  ctx.restore();
}

function drawMenuOverlay() {
  ctx.save();
  ctx.fillStyle = "rgba(3, 8, 9, 0.62)";
  ctx.fillRect(0, 0, BOARD.w, BOARD.h);

  const w = 820;
  const h = 360;
  const x = (BOARD.w - w) / 2;
  const y = 148;
  roundRectPath(x, y, w, h, 16);
  const panel = ctx.createLinearGradient(x, y, x, y + h);
  panel.addColorStop(0, "rgba(14, 38, 34, 0.97)");
  panel.addColorStop(1, "rgba(10, 28, 25, 0.97)");
  ctx.fillStyle = panel;
  ctx.fill();
  ctx.strokeStyle = "rgba(245, 214, 110, 0.42)";
  ctx.lineWidth = 2;
  ctx.stroke();

  roundRectPath(x + 14, y + 14, w - 28, 72, 12);
  ctx.fillStyle = "rgba(255,255,255,0.03)";
  ctx.fill();
  ctx.strokeStyle = "rgba(230, 246, 239, 0.08)";
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#f4e3a4";
  ctx.font = '16px "APL386", monospace';
  ctx.fillText("KLONDIKE // BINARY RANKS // APL386 SUITS", x + 28, y + 28);

  ctx.fillStyle = "#eef7f1";
  ctx.font = '30px "APL386", monospace';
  ctx.fillText("BINARY KLONDIKE", x + 28, y + 52);

  const innerPad = 28;
  const colGap = 22;
  const leftColX = x + innerPad;
  const leftColY = y + 104;
  const rightY = y + 104;
  const rightW = 264;
  const rightH = 232;
  const rightX = x + w - innerPad - rightW;
  const leftColW = rightX - leftColX - colGap;

  // Left text column (clipped to prevent font-metric overflow into the right panel).
  ctx.save();
  roundRectPath(leftColX - 4, leftColY - 4, leftColW + 8, 154, 10);
  ctx.clip();

  ctx.fillStyle = "rgba(235, 246, 239, 0.9)";
  ctx.font = '16px "APL386", monospace';
  let textY = fillWrappedText(
    "Classic solitaire. Numeric ranks become 4-bit cards.",
    leftColX,
    leftColY,
    leftColW,
    20
  );

  ctx.font = '14px "APL386", monospace';
  ctx.fillStyle = "rgba(235, 246, 239, 0.76)";
  textY = fillWrappedText(
    "Build foundations by suit from Ace (0001) to King (1101). Tableau builds downward in alternating colors.",
    leftColX,
    textY + 4,
    leftColW,
    18
  );
  fillWrappedText(
    "Drag cards or use click-to-select, click-to-place. The stock draws one card and recycles when empty.",
    leftColX,
    textY + 2,
    leftColW,
    18
  );
  ctx.restore();

  roundRectPath(leftColX, y + h - 92, 250, 56, 10);
  ctx.fillStyle = "rgba(240, 210, 126, 0.12)";
  ctx.fill();
  ctx.strokeStyle = "rgba(240, 210, 126, 0.34)";
  ctx.stroke();
  ctx.fillStyle = "#f0d27e";
  ctx.font = '14px "APL386", monospace';
  ctx.fillText("CLICK ANYWHERE TO DEAL", leftColX + 14, y + h - 74);
  ctx.font = '12px "APL386", monospace';
  ctx.fillStyle = "rgba(240, 210, 126, 0.86)";
  ctx.fillText("or press N", leftColX + 14, y + h - 54);

  roundRectPath(rightX, rightY, rightW, rightH, 12);
  ctx.fillStyle = "rgba(255, 255, 255, 0.025)";
  ctx.fill();
  ctx.strokeStyle = "rgba(227, 245, 236, 0.08)";
  ctx.stroke();

  ctx.save();
  roundRectPath(rightX + 3, rightY + 3, rightW - 6, rightH - 6, 10);
  ctx.clip();

  ctx.fillStyle = "#e9f5ee";
  ctx.font = '15px "APL386", monospace';
  ctx.fillText("RANK ENCODING", rightX + 16, rightY + 16);
  ctx.font = '13px "APL386", monospace';
  ctx.fillStyle = "rgba(233, 245, 238, 0.84)";
  ctx.fillText("A  = 0001", rightX + 16, rightY + 46);
  ctx.fillText("10 = 1010", rightX + 16, rightY + 68);
  ctx.fillText("J  = 1011", rightX + 16, rightY + 90);
  ctx.fillText("Q  = 1100", rightX + 16, rightY + 112);
  ctx.fillText("K  = 1101", rightX + 16, rightY + 134);

  ctx.fillStyle = "#f0d27e";
  ctx.font = '14px "APL386", monospace';
  ctx.fillText("CONTROLS", rightX + 16, rightY + 162);
  ctx.fillStyle = "rgba(233, 245, 238, 0.82)";
  ctx.font = '11px "APL386", monospace';
  fillWrappedText(
    "N new game  A auto move  S safe auto-complete  F fullscreen  Esc clear selection",
    rightX + 16,
    rightY + 183,
    rightW - 32,
    15
  );
  ctx.restore();
  ctx.restore();
}

function render() {
  drawBoardBackground();
  drawHeader();
  drawTopRow();
  drawTableau();
  drawQueuedCardAnimations();
  drawDragPreview();
  drawFooter();
  if (state.mode === "menu") drawMenuOverlay();
  if (state.mode === "won") drawWinBanner();
}

function drawWinBanner() {
  ctx.save();
  roundRectPath(330, 120, 540, 92, 14);
  ctx.fillStyle = "rgba(245, 214, 110, 0.9)";
  ctx.fill();
  ctx.strokeStyle = "rgba(33, 26, 4, 0.3)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#1d2d1c";
  ctx.font = '24px "APL386", monospace';
  ctx.fillText("FOUNDATIONS COMPLETE // YOU WIN", BOARD.w / 2, 154);
  ctx.font = '16px "APL386", monospace';
  ctx.fillText(`Moves ${state.moves} | Score ${state.score} | Press N for new game`, BOARD.w / 2, 184);
  ctx.restore();
}

function screenToCanvasClick(event) {
  const p = canvasPointFromEvent(event);
  handleBoardClick(p.x, p.y);
}

const pointerGesture = {
  isDown: false,
  pointerId: null,
  start: null,
  startHit: null,
  dragStarted: false,
};

function beginDragFromSelection(selection, point) {
  const origin = selectionTopLeft(selection);
  if (!origin) return false;
  state.selected = selection;
  state.hovered = null;
  state.drag = {
    active: true,
    pointer: { ...point },
    offset: {
      x: point.x - origin.x,
      y: point.y - origin.y,
    },
  };
  const cards = getSelectedCards();
  state.message = cards.length
    ? `Dragging ${cardLabel(cards[0])}${cards.length > 1 ? ` (+${cards.length - 1})` : ""}`
    : "Dragging";
  render();
  return true;
}

function finishDrag(point) {
  if (!state.drag?.active) return;
  const hit = hitTest(point.x, point.y);
  state.drag = null;
  if (!attemptDropOnHit(hit)) {
    state.message = "Drag canceled or illegal move.";
    render();
  }
}

function onCanvasPointerDown(event) {
  event.preventDefault();
  if (pointerGesture.isDown) return;
  pointerGesture.isDown = true;
  pointerGesture.pointerId = event.pointerId ?? null;
  canvas.setPointerCapture?.(event.pointerId);
  pointerGesture.start = canvasPointFromEvent(event);
  pointerGesture.startHit = hitTest(pointerGesture.start.x, pointerGesture.start.y);
  pointerGesture.dragStarted = false;
}

function onWindowPointerMove(event) {
  if (pointerGesture.isDown && pointerGesture.pointerId != null && event.pointerId !== pointerGesture.pointerId) {
    return;
  }

  const point = canvasPointFromEvent(event);

  if (!pointerGesture.isDown || !pointerGesture.start) {
    if (!state.drag?.active && event.pointerType !== "touch") {
      setHoveredCard(hoverRefFromHit(hitTest(point.x, point.y)));
    }
    return;
  }

  if (state.drag?.active) {
    if (state.hovered) state.hovered = null;
    state.drag.pointer = { ...point };
    render();
    return;
  }

  const dx = point.x - pointerGesture.start.x;
  const dy = point.y - pointerGesture.start.y;
  if (dx * dx + dy * dy < 36) return;

  const selection = selectionFromHit(pointerGesture.startHit);
  if (!selection) return;
  pointerGesture.dragStarted = beginDragFromSelection(selection, point);
}

function resetPointerGesture() {
  pointerGesture.isDown = false;
  pointerGesture.pointerId = null;
  pointerGesture.start = null;
  pointerGesture.startHit = null;
  pointerGesture.dragStarted = false;
}

function onWindowPointerUp(event) {
  if (!pointerGesture.isDown) return;
  if (pointerGesture.pointerId != null && event.pointerId !== pointerGesture.pointerId) return;
  const point = canvasPointFromEvent(event);
  const didDrag = pointerGesture.dragStarted || !!state.drag?.active;
  try { canvas.releasePointerCapture?.(event.pointerId); } catch {}
  resetPointerGesture();

  if (didDrag) {
    finishDrag(point);
    return;
  }
  handleBoardClick(point.x, point.y);
}

function onWindowPointerCancel(event) {
  if (!pointerGesture.isDown) return;
  if (pointerGesture.pointerId != null && event.pointerId !== pointerGesture.pointerId) return;
  state.drag = null;
  resetPointerGesture();
  render();
}

function onCanvasDoubleClick(event) {
  event.preventDefault();
  resetPointerGesture();
  const point = canvasPointFromEvent(event);
  const selection = selectionFromHit(hitTest(point.x, point.y));
  tryMoveSelectionToOwnFoundation(selection);
}

function tryToggleFullscreen() {
  if (!document.fullscreenElement) {
    appShell?.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.().catch(() => {});
  }
}

const KEY_ACTIONS = {
  n: newGame,
  a: tryAutoMoveOnce,
  s: tryAutoCompleteSafeFoundations,
  f: tryToggleFullscreen,
};

function handleKey(event) {
  const action = KEY_ACTIONS[event.key.toLowerCase()];
  if (action) { action(); return; }
  if (event.key === "Escape" && state.selected) {
    state.drag = null;
    clearSelection();
  }
}

function renderGameToText() {
  const waste = topWasteCard();
  const payload = {
    mode: state.mode,
    coordinateSystem: {
      origin: "top-left",
      x: "right",
      y: "down",
      canvas: { width: BOARD.w, height: BOARD.h },
    },
    stockCount: state.stock.length,
    wasteTop: waste
      ? { suit: waste.suit, rank: waste.rank, bits: cardBits(waste.rank) }
      : null,
    foundations: state.foundations.map((pile, i) => ({
      index: i,
      suit: FOUNDATION_ORDER[i],
      count: pile.length,
      top: pile.length
        ? {
            rank: pile[pile.length - 1].rank,
            bits: cardBits(pile[pile.length - 1].rank),
          }
        : null,
    })),
    tableau: state.tableau.map((pile, col) => {
      const faceUpStart = pile.findIndex((e) => e.faceUp);
      return {
        col,
        count: pile.length,
        faceUpStart,
        top: pile.length
          ? {
              faceUp: pile[pile.length - 1].faceUp,
              suit: pile[pile.length - 1].card.suit,
              rank: pile[pile.length - 1].card.rank,
              bits: cardBits(pile[pile.length - 1].card.rank),
            }
          : null,
        faceUp: pile
          .filter((e) => e.faceUp)
          .map((e) => ({ suit: e.card.suit, rank: e.card.rank, bits: cardBits(e.card.rank) })),
      };
    }),
    selected: state.selected,
    moves: state.moves,
    score: state.score,
    message: state.message,
  };
  return JSON.stringify(payload);
}

window.render_game_to_text = renderGameToText;
window.advanceTime = (ms = 16) => {
  if (animationState.lastPerfMs == null && animationState.clockMs === 0) {
    syncAnimationClockFromPerf(performance.now());
  }
  animationState.clockMs += Math.max(0, ms);
  animationState.lastPerfMs = performance.now();
  pruneFinishedAnimations();
  render();
};
window.binaryKlondike = {
  newGame,
  state,
  tryAutoMoveOnce,
  tryAutoCompleteSafeFoundations,
};

canvas.addEventListener("pointerdown", onCanvasPointerDown);
canvas.addEventListener("dblclick", onCanvasDoubleClick);
window.addEventListener("pointermove", onWindowPointerMove);
window.addEventListener("pointerup", onWindowPointerUp);
window.addEventListener("pointercancel", onWindowPointerCancel);
canvas.addEventListener("lostpointercapture", () => {
  if (!pointerGesture.isDown) return;
  state.drag = null;
  resetPointerGesture();
  render();
});
window.addEventListener("resize", () => {
  resizeCanvasPresentation();
  render();
});
document.addEventListener("keydown", handleKey);
newGameBtn.addEventListener("click", () => newGame());
autoBtn.addEventListener("click", () => tryAutoMoveOnce());
safeAutoBtn?.addEventListener("click", () => tryAutoCompleteSafeFoundations());
fullscreenBtn?.addEventListener("click", () => tryToggleFullscreen());
document.addEventListener("fullscreenchange", () => {
  updateFullscreenButtonLabel();
  resizeCanvasPresentation();
  render();
});

Promise.allSettled([
  document.fonts?.load?.('16px "APL386"') ?? Promise.resolve(),
]).finally(() => {
  updateFullscreenButtonLabel();
  updateSafeAutoButtonState();
  resizeCanvasPresentation();
  const initial = getInitialOptions();
  if (initial.autostart) {
    newGame(initial.seed ?? Date.now());
  } else {
    render();
  }
});
