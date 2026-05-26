// ── Constants ─────────────────────────────────────────────────────────────────

const PHASE = {
  IDLE:         'idle',
  BIDDING:      'bidding',
  TRUMP_SELECT: 'trump_select',
  PLAYING:      'playing',
  HAND_SCORING: 'hand_scoring',
  MATCH_OVER:   'match_over',
};

const TEAMS        = [[0, 2], [1, 3]]; // team0=N-S (human+partner), team1=E-W
const TEAM_NAMES   = ['North–South', 'East–West'];
const MIN_BID      = 16;
const MATCH_TARGET = 6;
const AI_DELAY_MS  = 750;

// ── Game state ────────────────────────────────────────────────────────────────

let state = {
  phase:        PHASE.IDLE,
  dealer:       3,
  hands:        [[], [], [], []],
  gameScore:    [0, 0],

  // Bidding
  passed:        [false, false, false, false],
  currentBidder: 0,
  highBid:       MIN_BID - 1,
  highBidder:    null,

  // Trump
  declarer:      null,
  trumpSuit:     null,
  trumpRevealed: false,
  isNoTrump:     false,

  // Royal pair
  pairAdjustment: 0,
  pairDeclared:   false,
  pairHolder:     null,

  // Play
  tricks:           [],
  currentTrick:     [],
  trickPoints:      [0, 0],
  lastTrickWinner:  null,
  trickCount:       0,
  activePlayer:     0,
};

let pairPromptTimeout = null;
let advanceTimeout    = null;   // tracks the single pending advancePlay callback

/**
 * Schedule advancePlay() after `delay` ms, cancelling any previously
 * scheduled call.  This prevents duplicate callbacks from stacking up
 * (e.g. when the human plays a card before the beginPlay() 400 ms timer
 * fires, which would otherwise produce two simultaneous doAIPlay() calls
 * and make a player run out of cards mid-hand).
 */
function scheduleAdvance(delay) {
  if (advanceTimeout !== null) { clearTimeout(advanceTimeout); advanceTimeout = null; }
  advanceTimeout = setTimeout(() => { advanceTimeout = null; advancePlay(); }, delay);
}

// ── Seat utilities ────────────────────────────────────────────────────────────

function teamOf(seat) { return TEAMS[0].includes(seat) ? 0 : 1; }
function seatName(seat) {
  return ['South', 'East', 'North', 'West'][seat];
}
function nextSeat(seat) { return (seat + 1) % 4; }
function isHuman(seat)  { return seat === 0; }

// ── Entry points ──────────────────────────────────────────────────────────────

function startMatch() {
  state.gameScore = [0, 0];
  state.dealer = 3;
  startHand();
}

function startHand() {
  if (advanceTimeout !== null) { clearTimeout(advanceTimeout); advanceTimeout = null; }
  hidePairPrompt();
  state.dealer = nextSeat(state.dealer);
  const deck = shuffle(buildDeck());
  state.hands = dealHands(deck);

  state.passed         = [false, false, false, false];
  state.currentBidder  = nextSeat(state.dealer);
  state.highBid        = MIN_BID - 1;
  state.highBidder     = null;
  state.declarer       = null;
  state.trumpSuit      = null;
  state.trumpRevealed  = false;
  state.isNoTrump      = false;
  state.pairAdjustment = 0;
  state.pairDeclared   = false;
  state.pairHolder     = null;
  state.tricks         = [];
  state.currentTrick   = [];
  state.trickPoints    = [0, 0];
  state.lastTrickWinner = null;
  state.trickCount     = 0;

  setPhase(PHASE.BIDDING);
  renderAll();
  setTimeout(advanceBidding, 300);
}

// ── Phase ─────────────────────────────────────────────────────────────────────

function setPhase(p) {
  state.phase = p;
  renderPhase();
}

// ── Bidding ───────────────────────────────────────────────────────────────────

function advanceBidding() {
  const passedCount = state.passed.filter(Boolean).length;

  if (passedCount === 4) {
    setStatus('All players passed — redealing…');
    setTimeout(startHand, 1400);
    return;
  }

  if (passedCount === 3 && state.highBidder !== null) {
    finishBidding();
    return;
  }

  while (state.passed[state.currentBidder]) {
    state.currentBidder = nextSeat(state.currentBidder);
  }

  if (isHuman(state.currentBidder)) {
    const hi = state.highBid >= MIN_BID ? state.highBid : 0;
    setStatus(hi
      ? `Current high bid: ${hi} by ${seatName(state.highBidder)}. Your move.`
      : 'No bids yet. Minimum opening bid is 16.');
    renderBiddingPanel();
  } else {
    setStatus(`${seatName(state.currentBidder)} is thinking…`);
    setTimeout(doAIBid, AI_DELAY_MS);
  }
}

function doAIBid() {
  const seat = state.currentBidder;
  const bid  = aiBid(state.hands[seat], state.highBid);
  applyBid(seat, bid);
}

function humanBid(amount) {
  if (state.phase !== PHASE.BIDDING || !isHuman(state.currentBidder)) return;
  if (amount !== 0 && amount <= state.highBid) {
    setStatus('Bid must be higher than the current high bid.');
    return;
  }
  applyBid(0, amount);
}

function applyBid(seat, amount) {
  if (amount === 0) {
    state.passed[seat] = true;
    setStatus(`${seatName(seat)} passes.`);
  } else {
    state.highBid    = amount;
    state.highBidder = seat;
    setStatus(`${seatName(seat)} bids ${amount}.`);
  }
  renderScoreBar();

  let next = nextSeat(seat), loops = 0;
  while (state.passed[next] && loops < 4) { next = nextSeat(next); loops++; }
  state.currentBidder = next;

  setTimeout(advanceBidding, 500);
}

function finishBidding() {
  state.declarer = state.highBidder;
  updateDeclarerLabels();
  setStatus(`${seatName(state.declarer)} wins the bid at ${state.highBid}! Choosing trump…`);
  renderAll();

  if (isHuman(state.declarer)) {
    setPhase(PHASE.TRUMP_SELECT);
  } else {
    setTimeout(() => {
      state.trumpSuit     = aiChooseTrump(state.hands[state.declarer]);
      state.trumpRevealed = false;
      state.isNoTrump     = false;
      setStatus(`${seatName(state.declarer)} has chosen trump (hidden).`);
      beginPlay();
    }, AI_DELAY_MS);
  }
}

function updateDeclarerLabels() {
  for (let i = 0; i < 4; i++) {
    const el = document.getElementById(`label-${i}`);
    if (el) el.classList.toggle('declarer', i === state.declarer);
  }
}

// ── Trump selection ───────────────────────────────────────────────────────────

function humanSelectTrump(suit) {
  if (state.phase !== PHASE.TRUMP_SELECT || !isHuman(state.declarer)) return;

  if (suit === 'none') {
    state.trumpSuit     = null;
    state.trumpRevealed = true;  // nothing to reveal
    state.isNoTrump     = true;
    setStatus('No Trump chosen. Game begins — no suit outranks another!');
  } else {
    state.trumpSuit     = suit;
    state.trumpRevealed = false;
    state.isNoTrump     = false;
    setStatus('Trump chosen (kept secret). Game begins!');
  }

  setPhase(PHASE.PLAYING);
  renderTrumpBadge();
  beginPlay();
}

// ── Play phase ────────────────────────────────────────────────────────────────

function beginPlay() {
  state.activePlayer = nextSeat(state.dealer);
  setPhase(PHASE.PLAYING);
  renderAll();
  scheduleAdvance(400);
}

function advancePlay() {
  if (state.trickCount === 8) { finishHand(); return; }

  updateTrickArea();
  setStatus(isHuman(state.activePlayer)
    ? 'Your turn — click a card to play.'
    : `${seatName(state.activePlayer)} is thinking…`);

  if (isHuman(state.activePlayer)) {
    renderHand(0);
  } else {
    setTimeout(doAIPlay, AI_DELAY_MS);
  }
}

function doAIPlay() {
  // Safety guards — bail if game state is no longer valid for AI play
  if (state.phase !== PHASE.PLAYING) return;
  const seat = state.activePlayer;
  if (!state.hands[seat] || state.hands[seat].length === 0) {
    console.warn(`${seatName(seat)} has empty hand — skipping play`);
    return;
  }

  const knownTrump = (state.trumpRevealed || seat === state.declarer)
    ? state.trumpSuit : null;

  const ledSuit = state.currentTrick.length ? state.currentTrick[0].card.suit : null;
  if (!state.isNoTrump && ledSuit && !state.trumpRevealed && seat !== state.declarer) {
    const canFollow = state.hands[seat].some(c => c.suit === ledSuit);
    if (!canFollow) revealTrump();
  }

  const card = aiPlayCard(state.hands[seat], state.currentTrick, knownTrump, state.declarer, seat);
  if (!card) { console.warn(`${seatName(seat)} aiPlayCard returned null — skipping`); return; }
  playCard(seat, card);
}

function humanPlayCard(card) {
  if (state.phase !== PHASE.PLAYING || !isHuman(state.activePlayer)) return;
  const ledSuit = state.currentTrick.length ? state.currentTrick[0].card.suit : null;
  const legal   = legalPlays(state.hands[0], ledSuit);
  if (!legal.some(c => sameCard(c, card))) {
    setStatus('You must follow the led suit if you can!');
    return;
  }

  if (!state.isNoTrump && ledSuit && !state.trumpRevealed && !isHuman(state.declarer)) {
    const canFollow = state.hands[0].some(c => c.suit === ledSuit);
    if (!canFollow) revealTrump();
  }

  playCard(0, card);
}

function playCard(seat, card) {
  state.hands[seat] = state.hands[seat].filter(c => !sameCard(c, card));
  state.currentTrick.push({ playerIndex: seat, card });

  // Playing a trump card reveals trump suit
  if (!state.isNoTrump && !state.trumpRevealed && state.trumpSuit && card.suit === state.trumpSuit) {
    revealTrump();
  }

  renderHand(seat);
  renderTrickCard(seat, card);

  if (state.currentTrick.length === 4) {
    setTimeout(resolveTrick, 1000);
  } else {
    state.activePlayer = nextSeat(seat);
    scheduleAdvance(300);
  }
}

function revealTrump() {
  if (state.isNoTrump || state.trumpRevealed) return;
  state.trumpRevealed = true;
  renderTrumpBadge();
  setStatus(`Trump revealed: ${SUIT_SYMBOL[state.trumpSuit]} ${state.trumpSuit}!`);
  for (let i = 0; i < 4; i++) renderHand(i);
  // Check for royal pair declaration opportunity
  setTimeout(checkForPair, 200);
}

function resolveTrick() {
  const winner = trickWinner(state.currentTrick, state.trumpSuit);
  const pts    = state.currentTrick.reduce((s, t) => s + POINT_VALUE[t.card.rank], 0);
  state.trickPoints[teamOf(winner)] += pts;
  state.lastTrickWinner = winner;
  state.tricks.push({ winner, cards: state.currentTrick.map(t => t.card) });
  state.trickCount++;
  state.currentTrick = [];
  state.activePlayer = winner;

  // Flash the winning trick slot and label
  const winSlot  = document.getElementById(`trick-slot-${winner}`);
  const winLabel = document.getElementById(`label-${winner}`);
  winSlot?.classList.add('trick-winner');
  winLabel?.classList.add('trick-winner');
  setTimeout(() => {
    winSlot?.classList.remove('trick-winner');
    winLabel?.classList.remove('trick-winner');
  }, 900);

  setStatus(`${seatName(winner)} wins the trick (+${pts} pts). Trick ${state.trickCount}/8`);
  updateTrickArea();
  renderPointsRow();
  renderScoreBar();

  scheduleAdvance(1000);
}

// ── Royal pair ────────────────────────────────────────────────────────────────

function checkForPair() {
  if (state.pairDeclared || state.isNoTrump || !state.trumpSuit) return;
  for (let seat = 0; seat < 4; seat++) {
    const hand = state.hands[seat];
    const hasK = hand.some(c => c.rank === 'K' && c.suit === state.trumpSuit);
    const hasQ = hand.some(c => c.rank === 'Q' && c.suit === state.trumpSuit);
    if (hasK && hasQ) {
      if (isHuman(seat)) {
        showPairPrompt();
      } else {
        declarePair(seat);
      }
      return;
    }
  }
}

function declarePair(seat) {
  state.pairDeclared  = true;
  state.pairHolder    = seat;
  const holderTeam   = teamOf(seat);
  const declarerTeam = teamOf(state.declarer);
  state.pairAdjustment = (holderTeam === declarerTeam) ? -4 : +4;
  const dir = holderTeam === declarerTeam ? 'Bid −4 (easier)!' : 'Bid +4 (harder)!';
  setStatus(`${seatName(seat)} declares the Royal Pair (K+Q of trump)! ${dir}`);
  hidePairPrompt();
  renderPointsRow();
}

function showPairPrompt() {
  show('pair-prompt', true);
  pairPromptTimeout = setTimeout(() => {
    hidePairPrompt();
    setStatus('Royal Pair window passed.');
  }, 6000);
}

function hidePairPrompt() {
  show('pair-prompt', false);
  if (pairPromptTimeout) { clearTimeout(pairPromptTimeout); pairPromptTimeout = null; }
}

// ── Hand scoring ──────────────────────────────────────────────────────────────

function finishHand() {
  state.trickPoints[teamOf(state.lastTrickWinner)] += 1;

  const declarerTeam = teamOf(state.declarer);
  const effectiveBid = state.highBid + state.pairAdjustment;
  const bidMade      = state.trickPoints[declarerTeam] >= effectiveBid;

  if (bidMade) {
    state.gameScore[declarerTeam] += 1;
  } else {
    state.gameScore[1 - declarerTeam] += 2;
  }

  setPhase(PHASE.HAND_SCORING);
  renderHandResult(bidMade, declarerTeam, effectiveBid);

  if (state.gameScore[0] >= MATCH_TARGET || state.gameScore[1] >= MATCH_TARGET) {
    setTimeout(renderMatchOver, 200);
  }
}

// ── Status ────────────────────────────────────────────────────────────────────

function setStatus(msg) {
  const el = document.getElementById('status-msg');
  if (el) el.textContent = msg;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderAll() {
  renderScoreBar();
  renderTrumpBadge();
  renderPointsRow();
  for (let i = 0; i < 4; i++) renderHand(i);
  updateTrickArea();
  renderPhase();
}

function renderPhase() {
  show('bidding-panel',      state.phase === PHASE.BIDDING && isHuman(state.currentBidder));
  show('trump-select-panel', state.phase === PHASE.TRUMP_SELECT);
  show('hand-result-panel',  state.phase === PHASE.HAND_SCORING);
  show('match-over-panel',   state.phase === PHASE.MATCH_OVER);
}

function renderScoreBar() {
  setText('score-team0', state.gameScore[0]);
  setText('score-team1', state.gameScore[1]);
  const bidInfo = state.highBidder !== null
    ? ` · Bid: ${state.highBid} (${seatName(state.highBidder)})`
    : '';
  setText('bid-label', bidInfo);
}

function renderPointsRow() {
  setText('pts-team0', `N–S: ${state.trickPoints[0]} pts`);
  setText('pts-team1', `E–W: ${state.trickPoints[1]} pts`);
  if (state.declarer !== null) {
    const eff    = state.highBid + state.pairAdjustment;
    const adjStr = state.pairAdjustment !== 0
      ? ` (${state.pairAdjustment > 0 ? '+' : ''}${state.pairAdjustment} pair)`
      : '';
    const ntStr  = state.isNoTrump ? ' · NT' : '';
    setText('pts-bid-target', `Bid: ${eff}${adjStr}${ntStr} · ${seatName(state.declarer)}`);
  } else {
    setText('pts-bid-target', '');
  }
}

function renderTrumpBadge() {
  const el = document.getElementById('trump-badge');
  if (!el) return;
  if (state.isNoTrump) {
    el.textContent = 'No Trump';
    el.className   = 'trump-badge no-trump';
  } else if (state.trumpRevealed && state.trumpSuit) {
    el.textContent = `Trump: ${SUIT_SYMBOL[state.trumpSuit]} ${state.trumpSuit}`;
    el.className   = `trump-badge visible suit-${state.trumpSuit}`;
  } else if (state.declarer !== null && !state.trumpRevealed) {
    el.textContent = 'Trump: hidden';
    el.className   = 'trump-badge hidden-trump';
  } else {
    el.textContent = '';
    el.className   = 'trump-badge';
  }
}

function renderHand(seat) {
  const el = document.getElementById(`hand-${seat}`);
  if (!el) return;
  el.innerHTML = '';
  const sorted  = sortHand(state.hands[seat]);
  const ledSuit = state.currentTrick.length ? state.currentTrick[0].card.suit : null;
  const legal   = (seat === 0 && state.phase === PHASE.PLAYING && isHuman(state.activePlayer))
    ? legalPlays(state.hands[0], ledSuit) : [];

  sorted.forEach(card => {
    const div = createCardEl(card, seat === 0);
    if (legal.length) {
      if (legal.some(c => sameCard(c, card))) {
        div.classList.add('playable');
        div.onclick = () => humanPlayCard(card);
      } else {
        div.classList.add('unplayable');
      }
    }
    el.appendChild(div);
  });
}

function createCardEl(card, faceUp) {
  const div = document.createElement('div');
  if (!faceUp) {
    div.className = 'card face-down';
    return div;
  }
  div.className = `card face-up suit-${card.suit}`;
  if (state.trumpRevealed && !state.isNoTrump && state.trumpSuit === card.suit) {
    div.classList.add('trump-card');
  }
  const sym = SUIT_SYMBOL[card.suit];
  div.innerHTML =
    `<div class="corner corner-tl"><span class="c-rank">${card.rank}</span><span class="c-suit">${sym}</span></div>` +
    `<span class="card-center">${sym}</span>` +
    `<div class="corner corner-br"><span class="c-rank">${card.rank}</span><span class="c-suit">${sym}</span></div>`;
  return div;
}

function updateTrickArea() {
  for (let seat = 0; seat < 4; seat++) {
    const slot = document.getElementById(`trick-slot-${seat}`);
    if (!slot) continue;
    const played = state.currentTrick.find(t => t.playerIndex === seat);
    // Preserve trick-winner class if present, then update content
    const hadWinner = slot.classList.contains('trick-winner');
    slot.innerHTML = '';
    if (hadWinner) slot.classList.add('trick-winner');
    if (played) slot.appendChild(createCardEl(played.card, true));
  }
}

function renderTrickCard(seat, card) {
  const slot = document.getElementById(`trick-slot-${seat}`);
  if (slot) { slot.innerHTML = ''; slot.appendChild(createCardEl(card, true)); }
}

function renderBiddingPanel() {
  const minNext = Math.max(state.highBid + 1, MIN_BID);
  const inp = document.getElementById('bid-amount');
  if (inp) { inp.min = minNext; inp.max = 29; inp.value = minNext; }
  show('bidding-panel', true);
}

function renderHandResult(bidMade, declarerTeam, effectiveBid) {
  const dName  = TEAM_NAMES[declarerTeam];
  const actual = state.trickPoints[declarerTeam];
  const pairNote = state.pairDeclared
    ? ` (pair: ${state.pairAdjustment > 0 ? '+' : ''}${state.pairAdjustment})`
    : '';
  const ntNote = state.isNoTrump ? ' [No Trump]' : '';
  const result = bidMade
    ? `✅ ${dName} made the bid of ${effectiveBid}${pairNote}${ntNote} with ${actual} pts! (+1 game pt)`
    : `❌ ${dName} failed — bid ${effectiveBid}${pairNote}${ntNote}, scored ${actual} pts. Opponents +2.`;
  setText('hand-result-text', result);
  setText('hand-score-team0', `${TEAM_NAMES[0]}: ${state.gameScore[0]} pts`);
  setText('hand-score-team1', `${TEAM_NAMES[1]}: ${state.gameScore[1]} pts`);
  show('hand-result-panel', true);
}

function renderMatchOver() {
  const winner = state.gameScore[0] >= MATCH_TARGET ? 0 : 1;
  setText('match-winner-text', `${TEAM_NAMES[winner]} win the match! 🎉`);
  setText('match-score-text',
    `${TEAM_NAMES[0]} ${state.gameScore[0]} — ${state.gameScore[1]} ${TEAM_NAMES[1]}`);
  show('match-over-panel', true);
  show('hand-result-panel', false);
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function show(id, visible) {
  const el = document.getElementById(id);
  if (el) el.hidden = !visible;
}
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// ── Button handlers ───────────────────────────────────────────────────────────

function onBidSubmit() {
  const val = parseInt(document.getElementById('bid-amount').value, 10);
  show('bidding-panel', false);
  humanBid(val);
}
function onPass()           { show('bidding-panel', false); humanBid(0); }
function onSelectTrump(suit){ humanSelectTrump(suit); }
function onDeclarePair()    { declarePair(0); }
function onSkipPair()       { hidePairPrompt(); setStatus('Royal Pair skipped.'); }
function onNextHand()       { show('hand-result-panel', false); startHand(); }
function onNewMatch()       { show('match-over-panel', false); startMatch(); }

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', startMatch);
