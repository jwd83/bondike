// ── Constants ──

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];

const SUIT_SYMBOLS = {
    spades:   '\u2660',
    hearts:   '\u2665',
    diamonds: '\u2666',
    clubs:    '\u2663',
};

const SUIT_COLORS = {
    spades: 'black',
    hearts: 'red',
    diamonds: 'red',
    clubs: 'black',
};

const FOUNDATION_SUIT_ORDER = ['spades', 'hearts', 'diamonds', 'clubs'];

const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

function toBinary(value) {
    return value.toString(2).padStart(4, '0');
}

function toBits(value) {
    return toBinary(value).split('').map(b => b === '1');
}

const BACK_PATTERN = '01100010011011110110111001100100011010010110101101100101';

// ── Game State ──

const state = {
    stock: [],
    waste: [],
    foundations: [[], [], [], []],
    tableaux: [[], [], [], [], [], [], []],
    selected: null,
    moveCount: 0,
    undoStack: [],
};

// ── Card Model ──

function createCard(suit, value) {
    return {
        id: suit + '-' + value,
        suit: suit,
        value: value,
        faceUp: false,
    };
}

// ── Deck ──

function createDeck() {
    const deck = [];
    for (const suit of SUITS) {
        for (const value of VALUES) {
            deck.push(createCard(suit, value));
        }
    }
    return deck;
}

function shuffle(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

// ── Deal ──

function deal() {
    const deck = shuffle(createDeck());
    let idx = 0;
    for (let col = 0; col < 7; col++) {
        state.tableaux[col] = [];
        for (let row = 0; row <= col; row++) {
            const card = deck[idx++];
            card.faceUp = (row === col);
            state.tableaux[col].push(card);
        }
    }
    state.stock = deck.slice(idx);
    state.stock.forEach(c => { c.faceUp = false; });
    state.waste = [];
    state.foundations = [[], [], [], []];
    state.selected = null;
    state.moveCount = 0;
    state.undoStack = [];
}

// ── Rules ──

function canPlaceOnTableau(card, colIndex) {
    const col = state.tableaux[colIndex];
    if (col.length === 0) {
        return card.value === 13;
    }
    const top = col[col.length - 1];
    if (!top.faceUp) return false;
    return SUIT_COLORS[card.suit] !== SUIT_COLORS[top.suit] && card.value === top.value - 1;
}

function canPlaceOnFoundation(card, fIdx) {
    const pile = state.foundations[fIdx];
    if (pile.length === 0) {
        return card.value === 1;
    }
    const top = pile[pile.length - 1];
    return card.suit === top.suit && card.value === top.value + 1;
}

function isGameWon() {
    return state.foundations.every(f => f.length === 13);
}

function findFoundationFor(card) {
    for (let i = 0; i < 4; i++) {
        if (canPlaceOnFoundation(card, i)) return i;
    }
    return -1;
}

function canAutoComplete() {
    if (state.stock.length > 0 || state.waste.length > 0) return false;
    return state.tableaux.every(col => col.every(c => c.faceUp));
}

// ── Undo ──

function saveUndo() {
    const snap = {
        stock: state.stock.map(c => ({ ...c })),
        waste: state.waste.map(c => ({ ...c })),
        foundations: state.foundations.map(f => f.map(c => ({ ...c }))),
        tableaux: state.tableaux.map(t => t.map(c => ({ ...c }))),
        moveCount: state.moveCount,
    };
    state.undoStack.push(JSON.stringify(snap));
    if (state.undoStack.length > 200) state.undoStack.shift();
}

function undo() {
    if (state.undoStack.length === 0) return;
    const snap = JSON.parse(state.undoStack.pop());
    state.stock = snap.stock;
    state.waste = snap.waste;
    state.foundations = snap.foundations;
    state.tableaux = snap.tableaux;
    state.moveCount = snap.moveCount;
    state.selected = null;
    renderAll();
}

// ── Moves ──

function getPileCards(type, index) {
    if (type === 'tableau') return state.tableaux[index];
    if (type === 'waste') return state.waste;
    if (type === 'foundation') return state.foundations[index];
    if (type === 'stock') return state.stock;
    return [];
}

function getMovableCards(type, index, cardIndex) {
    const pile = getPileCards(type, index);
    if (type === 'tableau') {
        return pile.slice(cardIndex);
    }
    if (cardIndex >= 0 && cardIndex < pile.length) {
        return [pile[cardIndex]];
    }
    return [];
}

function executeMove(cards, fromType, fromIndex, toType, toIndex) {
    saveUndo();

    const fromPile = getPileCards(fromType, fromIndex);
    const cutIdx = fromPile.indexOf(cards[0]);
    if (cutIdx >= 0) {
        fromPile.splice(cutIdx, cards.length);
    }

    const toPile = getPileCards(toType, toIndex);
    for (const c of cards) {
        c.faceUp = true;
        toPile.push(c);
    }

    if (fromType === 'tableau') {
        const col = state.tableaux[fromIndex];
        if (col.length > 0 && !col[col.length - 1].faceUp) {
            col[col.length - 1].faceUp = true;
        }
    }

    state.moveCount++;
    state.selected = null;
    renderAll();

    if (isGameWon()) {
        setTimeout(showWin, 400);
    } else if (canAutoComplete()) {
        setTimeout(autoComplete, 300);
    }
}

function drawFromStock() {
    saveUndo();
    if (state.stock.length === 0) {
        state.stock = state.waste.slice().reverse();
        state.stock.forEach(c => { c.faceUp = false; });
        state.waste = [];
    } else {
        const card = state.stock.pop();
        card.faceUp = true;
        state.waste.push(card);
    }
    state.moveCount++;
    state.selected = null;
    renderAll();
}

// ── Auto-Complete ──

let autoCompleting = false;

async function autoComplete() {
    if (autoCompleting) return;
    autoCompleting = true;
    while (!isGameWon()) {
        let moved = false;
        for (let t = 0; t < 7; t++) {
            const col = state.tableaux[t];
            if (col.length === 0) continue;
            const card = col[col.length - 1];
            const fIdx = findFoundationFor(card);
            if (fIdx >= 0) {
                col.pop();
                state.foundations[fIdx].push(card);
                state.moveCount++;
                renderAll();
                await sleep(60);
                moved = true;
                break;
            }
        }
        if (!moved) break;
    }
    autoCompleting = false;
    if (isGameWon()) showWin();
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ── Win Screen ──

function showWin() {
    document.getElementById('win-overlay').classList.remove('hidden');
}

// ── Rendering ──

function renderAll() {
    renderStock();
    renderWaste();
    for (let i = 0; i < 4; i++) renderFoundation(i);
    for (let i = 0; i < 7; i++) renderTableau(i);
    document.getElementById('move-counter').textContent = 'Moves: ' + state.moveCount;
}

function createCardElement(card) {
    const el = document.createElement('div');
    el.classList.add('card');
    el.dataset.cardId = card.id;

    if (!card.faceUp) {
        el.classList.add('face-down');
        const pattern = document.createElement('div');
        pattern.className = 'card-back-pattern';
        pattern.textContent = BACK_PATTERN.repeat(4);
        el.appendChild(pattern);
        return el;
    }

    el.classList.add('face-up-card');
    el.classList.add(SUIT_COLORS[card.suit]);

    const binary = toBinary(card.value);
    const bits = toBits(card.value);
    const suit = SUIT_SYMBOLS[card.suit];

    // Top-left
    const topEl = document.createElement('div');
    topEl.className = 'card-top';
    topEl.innerHTML =
        '<span class="card-suit">' + suit + '</span>' +
        '<span class="card-binary">' + binary + '</span>';

    // Center: CSS-drawn pips (consistent size)
    const centerEl = document.createElement('div');
    centerEl.className = 'card-center';
    for (const on of bits) {
        const pip = document.createElement('span');
        pip.className = 'pip ' + (on ? 'filled' : 'empty');
        centerEl.appendChild(pip);
    }

    // Bottom-right (rotated 180)
    const bottomEl = document.createElement('div');
    bottomEl.className = 'card-bottom';
    bottomEl.innerHTML =
        '<span class="card-suit">' + suit + '</span>' +
        '<span class="card-binary">' + binary + '</span>';

    el.appendChild(topEl);
    el.appendChild(centerEl);
    el.appendChild(bottomEl);

    return el;
}

function createPlaceholder(content) {
    const el = document.createElement('div');
    el.className = 'pile-placeholder';
    if (content) el.textContent = content;
    return el;
}

function renderStock() {
    const container = document.getElementById('stock');
    container.innerHTML = '';
    if (state.stock.length === 0) {
        container.appendChild(createPlaceholder());
    } else {
        const el = createCardElement({ faceUp: false, id: 'stock-top' });
        el.dataset.pile = 'stock';
        container.appendChild(el);
    }
}

function renderWaste() {
    const container = document.getElementById('waste');
    container.innerHTML = '';
    if (state.waste.length === 0) {
        container.appendChild(createPlaceholder());
        return;
    }
    const card = state.waste[state.waste.length - 1];
    const el = createCardElement(card);
    el.dataset.pile = 'waste';
    el.dataset.pileIndex = '0';
    el.dataset.cardIndex = String(state.waste.length - 1);
    if (state.selected && state.selected.cardId === card.id) {
        el.classList.add('selected');
    }
    container.appendChild(el);
}

function renderFoundation(fIdx) {
    const container = document.getElementById('foundation-' + fIdx);
    container.innerHTML = '';
    const pile = state.foundations[fIdx];
    if (pile.length === 0) {
        const suit = FOUNDATION_SUIT_ORDER[fIdx];
        container.appendChild(createPlaceholder(SUIT_SYMBOLS[suit]));
        return;
    }
    const card = pile[pile.length - 1];
    const el = createCardElement(card);
    el.dataset.pile = 'foundation';
    el.dataset.pileIndex = String(fIdx);
    el.dataset.cardIndex = String(pile.length - 1);
    if (state.selected && state.selected.cardId === card.id) {
        el.classList.add('selected');
    }
    container.appendChild(el);
}

function renderTableau(colIdx) {
    const container = document.getElementById('tableau-' + colIdx);
    container.innerHTML = '';
    const col = state.tableaux[colIdx];
    if (col.length === 0) {
        container.appendChild(createPlaceholder());
        return;
    }
    col.forEach((card, i) => {
        const el = createCardElement(card);
        el.dataset.pile = 'tableau';
        el.dataset.pileIndex = String(colIdx);
        el.dataset.cardIndex = String(i);
        el.style.zIndex = String(i);

        if (state.selected &&
            state.selected.type === 'tableau' &&
            state.selected.index === colIdx &&
            i >= state.selected.cardIndex) {
            el.classList.add('selected');
        }
        if (state.selected &&
            state.selected.type !== 'tableau' &&
            state.selected.cardId === card.id) {
            el.classList.add('selected');
        }

        container.appendChild(el);
    });
}

// ── Interaction ──

let interactionState = 'idle';
let dragInfo = null;
let selectionInfo = null;
const DRAG_THRESHOLD = 5;

function getCardInfo(el) {
    const cardEl = el.closest('.card');
    if (!cardEl) return null;
    return {
        element: cardEl,
        pile: cardEl.dataset.pile,
        pileIndex: parseInt(cardEl.dataset.pileIndex) || 0,
        cardIndex: parseInt(cardEl.dataset.cardIndex) || 0,
        cardId: cardEl.dataset.cardId,
        isFaceDown: cardEl.classList.contains('face-down'),
    };
}

// Clean up any lingering drag state
function cancelDrag() {
    if (dragInfo && dragInfo.ghostEl) {
        dragInfo.ghostEl.remove();
    }
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
    dragInfo = null;
    interactionState = 'idle';
}

document.getElementById('game').addEventListener('pointerdown', (e) => {
    // If a drag was somehow stuck, clean it up
    if (interactionState === 'dragging') {
        cancelDrag();
    }

    const target = e.target;

    // Stock pile click
    const stockPile = target.closest('#stock');
    if (stockPile) {
        clearSelection();
        drawFromStock();
        return;
    }

    const info = getCardInfo(target);

    if (!info) {
        const pileEl = target.closest('.pile');
        if (pileEl && selectionInfo) {
            attemptMoveToEmpty(pileEl);
            return;
        }
        clearSelection();
        return;
    }

    // Face-down cards: clear selection, do nothing else
    if (info.isFaceDown) {
        clearSelection();
        return;
    }

    // Second click while something is selected — try to move there
    if (selectionInfo) {
        attemptMoveToTarget(info);
        return;
    }

    // Start tracking for click vs drag
    interactionState = 'pending';
    dragInfo = {
        info: info,
        startX: e.clientX,
        startY: e.clientY,
        ghostEl: null,
        cards: null,
    };
    e.preventDefault();
});

document.addEventListener('pointermove', (e) => {
    if (interactionState !== 'pending' && interactionState !== 'dragging') return;
    if (!dragInfo) return;

    const dx = e.clientX - dragInfo.startX;
    const dy = e.clientY - dragInfo.startY;

    if (interactionState === 'pending') {
        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
            interactionState = 'dragging';
            startDrag(e);
        }
    }

    if (interactionState === 'dragging' && dragInfo && dragInfo.ghostEl) {
        dragInfo.ghostEl.style.left = (e.clientX - dragInfo.offsetX) + 'px';
        dragInfo.ghostEl.style.top = (e.clientY - dragInfo.offsetY) + 'px';
    }
});

document.addEventListener('pointerup', (e) => {
    if (interactionState === 'pending' && dragInfo) {
        handleCardClick(dragInfo.info);
        dragInfo = null;
        interactionState = 'idle';
        return;
    }

    if (interactionState === 'dragging') {
        finishDrag(e);
        return;
    }
});

// Handle lost pointer (e.g. window blur, touch cancel)
document.addEventListener('pointercancel', () => {
    cancelDrag();
});

window.addEventListener('blur', () => {
    cancelDrag();
});

function handleCardClick(info) {
    clearSelection();

    const cards = getMovableCards(info.pile, info.pileIndex, info.cardIndex);
    if (!cards || cards.length === 0) return;

    if (info.pile === 'tableau') {
        const col = state.tableaux[info.pileIndex];
        if (!col[info.cardIndex] || !col[info.cardIndex].faceUp) return;
    }

    selectionInfo = {
        type: info.pile,
        index: info.pileIndex,
        cardIndex: info.cardIndex,
        cardId: info.cardId,
        cards: cards,
    };
    state.selected = selectionInfo;
    renderAll();
}

function clearSelection() {
    selectionInfo = null;
    state.selected = null;
    interactionState = 'idle';
    document.querySelectorAll('.card.selected').forEach(el => el.classList.remove('selected'));
}

function attemptMoveToEmpty(pileEl) {
    if (!selectionInfo) return;
    const cards = selectionInfo.cards;
    const firstCard = cards[0];
    let moved = false;

    if (pileEl.classList.contains('tableau-pile')) {
        const toIdx = parseInt(pileEl.dataset.index);
        if (canPlaceOnTableau(firstCard, toIdx)) {
            executeMove(cards, selectionInfo.type, selectionInfo.index, 'tableau', toIdx);
            moved = true;
        }
    }

    if (!moved && pileEl.classList.contains('foundation-pile') && cards.length === 1) {
        const toIdx = parseInt(pileEl.dataset.index);
        if (canPlaceOnFoundation(firstCard, toIdx)) {
            executeMove(cards, selectionInfo.type, selectionInfo.index, 'foundation', toIdx);
            moved = true;
        }
    }

    clearSelection();
}

function attemptMoveToTarget(targetInfo) {
    if (!selectionInfo) return;
    const cards = selectionInfo.cards;
    const firstCard = cards[0];

    if (targetInfo.pile === 'tableau') {
        const toIdx = targetInfo.pileIndex;
        if (canPlaceOnTableau(firstCard, toIdx)) {
            executeMove(cards, selectionInfo.type, selectionInfo.index, 'tableau', toIdx);
            clearSelection();
            return;
        }
    }

    if (targetInfo.pile === 'foundation' && cards.length === 1) {
        const toIdx = targetInfo.pileIndex;
        if (canPlaceOnFoundation(firstCard, toIdx)) {
            executeMove(cards, selectionInfo.type, selectionInfo.index, 'foundation', toIdx);
            clearSelection();
            return;
        }
    }

    // Clicked same card — deselect
    if (selectionInfo.cardId === targetInfo.cardId) {
        clearSelection();
        return;
    }

    // Invalid target — select the new card instead
    clearSelection();
    handleCardClick(targetInfo);
}

// ── Drag and Drop ──

function startDrag(e) {
    const info = dragInfo.info;
    const cards = getMovableCards(info.pile, info.pileIndex, info.cardIndex);
    if (!cards || cards.length === 0) {
        cancelDrag();
        return;
    }
    dragInfo.cards = cards;

    clearSelection();

    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';

    const sourceEl = info.element;
    const cardWidth = sourceEl.offsetWidth;
    ghost.style.width = cardWidth + 'px';

    cards.forEach((card, i) => {
        const clone = createCardElement(card);
        if (i > 0) {
            clone.style.marginTop = '-70%';
        }
        ghost.appendChild(clone);
    });

    const rect = sourceEl.getBoundingClientRect();
    dragInfo.offsetX = e.clientX - rect.left;
    dragInfo.offsetY = e.clientY - rect.top;
    ghost.style.left = (e.clientX - dragInfo.offsetX) + 'px';
    ghost.style.top = (e.clientY - dragInfo.offsetY) + 'px';

    document.body.appendChild(ghost);
    dragInfo.ghostEl = ghost;

    cards.forEach(c => {
        const el = document.querySelector('[data-card-id="' + c.id + '"]');
        if (el) el.classList.add('dragging');
    });
}

function finishDrag(e) {
    if (!dragInfo) {
        interactionState = 'idle';
        return;
    }

    if (dragInfo.ghostEl) {
        dragInfo.ghostEl.style.display = 'none';
    }

    const dropTarget = document.elementFromPoint(e.clientX, e.clientY);

    if (dragInfo.ghostEl) {
        dragInfo.ghostEl.remove();
    }

    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));

    if (dropTarget && dragInfo.cards && dragInfo.cards.length > 0) {
        const pileEl = dropTarget.closest('.pile');
        if (pileEl) {
            const firstCard = dragInfo.cards[0];
            const fromType = dragInfo.info.pile;
            const fromIndex = dragInfo.info.pileIndex;

            if (pileEl.classList.contains('tableau-pile')) {
                const toIdx = parseInt(pileEl.dataset.index);
                if (canPlaceOnTableau(firstCard, toIdx)) {
                    executeMove(dragInfo.cards, fromType, fromIndex, 'tableau', toIdx);
                }
            } else if (pileEl.classList.contains('foundation-pile') && dragInfo.cards.length === 1) {
                const toIdx = parseInt(pileEl.dataset.index);
                if (canPlaceOnFoundation(firstCard, toIdx)) {
                    executeMove(dragInfo.cards, fromType, fromIndex, 'foundation', toIdx);
                }
            }
        }
    }

    dragInfo = null;
    interactionState = 'idle';
}

// ── Double-Click: Auto-Move to Foundation ──

document.getElementById('game').addEventListener('dblclick', (e) => {
    const info = getCardInfo(e.target);
    if (!info || info.isFaceDown) return;

    const pile = getPileCards(info.pile, info.pileIndex);
    if (info.cardIndex !== pile.length - 1) return;

    const card = pile[info.cardIndex];
    const fIdx = findFoundationFor(card);
    if (fIdx >= 0) {
        clearSelection();
        executeMove([card], info.pile, info.pileIndex, 'foundation', fIdx);
    }
});

// ── Init ──

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('new-game-btn').addEventListener('click', () => {
        cancelDrag();
        clearSelection();
        deal();
        renderAll();
    });
    document.getElementById('undo-btn').addEventListener('click', () => {
        cancelDrag();
        clearSelection();
        undo();
    });
    document.getElementById('play-again-btn').addEventListener('click', () => {
        document.getElementById('win-overlay').classList.add('hidden');
        deal();
        renderAll();
    });

    deal();
    renderAll();
});
