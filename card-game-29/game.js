// ── Constants ─────────────────────────────────────────────────────────────────

const PHASE = {
  IDLE:         'idle',
  BIDDING:      'bidding',
  TRUMP_SELECT: 'trump_select',
  DOUBLE:       'double',          // double / redouble window (§7), before first trick
  PLAYING:      'playing',
  HAND_SCORING: 'hand_scoring',
  MATCH_OVER:   'match_over',
};

const TEAMS        = [[0, 2], [1, 3]]; // team0=N-S (human+partner), team1=E-W
const TEAM_NAMES   = ['North–South', 'East–West'];
const MIN_BID      = 16;
const MATCH_TARGET = 6;
const AI_DELAY_MS  = 750;

// Rules / Help content (three tabs).
const RULES_HTML = [
  // 0 — Basic Play
  `<h3>Players &amp; Deck</h3>
   <ul>
     <li>4 players, 2 fixed partnerships — North–South vs East–West; partners sit opposite.</li>
     <li>32 cards, 8 per suit. Rank high→low: <b>J&nbsp;9&nbsp;A&nbsp;10&nbsp;K&nbsp;Q&nbsp;8&nbsp;7</b>.</li>
   </ul>
   <h3>Card Points (29 total)</h3>
   <ul>
     <li>Jack&nbsp;=&nbsp;3, Nine&nbsp;=&nbsp;2, Ace&nbsp;=&nbsp;1, Ten&nbsp;=&nbsp;1; K/Q/8/7&nbsp;=&nbsp;0 (28 points).</li>
     <li>The <b>last trick</b> is worth +1 — 29 in all (the game's name).</li>
   </ul>
   <h3>Play</h3>
   <ul>
     <li>All 8 cards are dealt at once. You must <b>follow the led suit</b> if you can.</li>
     <li>A trick is won by the highest trump, else the highest card of the led suit.</li>
   </ul>`,
  // 1 — Rules & Scoring
  `<h3>Hidden Trump</h3>
   <ul>
     <li>The bid winner secretly picks a trump suit (or No Trump). It stays hidden until a player
         can't follow suit or a trump is played — then it's revealed and active.</li>
     <li>The declarer may not lead the concealed trump.</li>
   </ul>
   <h3>Marriage (K + Q of trump)</h3>
   <ul>
     <li>Declarable only after trump is revealed <b>and</b> your side has won a trick.</li>
     <li>Your side declares → target −4 (floor 15). Opponents declare → target +4 (cap 29).</li>
   </ul>
   <h3>Scoring</h3>
   <ul>
     <li>Make the bid → the bidding team gains; fall short → it loses. The other team never moves.</li>
     <li>Tiers by declared bid: 16–20 = ±1, 21–27 = ±2, 28–29 = ±3.</li>
     <li>Match is cumulative — first to <b>+6 wins</b>, drop to <b>−6 loses</b>.</li>
   </ul>
   <h3>Claim</h3>
   <ul>
     <li>On your turn you may claim the rest — accepted only if your <b>own</b> hand wins every remaining trick.</li>
   </ul>`,
  // 2 — Bidding & Contracts
  `<h3>Bidding</h3>
   <ul>
     <li>The player to the dealer's right opens and must bid at least <b>16</b> (can't pass).</li>
     <li>Others raise or pass; the highest bidder takes the contract and chooses trump.</li>
   </ul>
   <h3>Double / Redouble</h3>
   <ul>
     <li>Before the first trick, defenders may <b>Double</b> (×2 stakes); the bidders may then <b>Redouble</b> (×4).</li>
   </ul>
   <h3>No Trump</h3>
   <ul>
     <li>Played with no trump — every trick is won by the highest card of the led suit.</li>
   </ul>
   <h3>Single Hand (solo ±6)</h3>
   <ul>
     <li>A bid above 29: play alone, partner sits out, trump open from the start.</li>
     <li>Win all 8 tricks → <b>+6</b>; lose any trick → <b>−6</b>.</li>
   </ul>`,
];

// ── Game state ────────────────────────────────────────────────────────────────

let state = {
  phase:        PHASE.IDLE,
  dealer:       3,
  hands:        [[], [], [], []],
  gameScore:    [0, 0],
  handHistory:  [],          // per-hand records for the match-end score table

  // Bidding
  passed:        [false, false, false, false],
  currentBidder: 0,
  highBid:       MIN_BID - 1,
  highBidder:    null,
  bidLog:        [],         // {seat, call} per call, for the auction grid

  // Trump
  declarer:      null,
  trumpSuit:     null,
  trumpRevealed: false,
  isNoTrump:     false,

  // Royal pair
  marriageAdj: 0,
  marriageDeclared:   false,
  marriageHolder:     null,

  // Double / Redouble (§7) and Single Hand (§9)
  stakeMultiplier: 1,        // 1 normal · 2 doubled · 4 redoubled
  doubled:         false,
  redoubled:       false,
  isSingleHand:    false,    // solo ±6 contract
  soloSeat:        null,     // the lone declarer in a Single Hand
  tricksWonBy:     [0, 0],   // trick counts per team (for Marriage trick-gating)
  dealtHands:      [[], [], [], []],   // each seat's ORIGINAL 8 cards (for end-of-hand review)
  reviewMode:      null,     // null | 'remaining' (claim preview) | 'original' (open all hands)

  // Play
  tricks:           [],
  currentTrick:     [],
  trickPoints:      [0, 0],
  lastTrickWinner:  null,
  trickCount:       0,
  activePlayer:     0,
};

let marriagePromptTimeout = null;
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

// In a Single Hand (§9) the declarer's partner sits out, so only 3 seats play.
function sittingOutSeat() {
  return state.isSingleHand ? (state.soloSeat + 2) % 4 : null;
}
function isSittingOut(seat) { return seat === sittingOutSeat(); }
function activeSeats() {
  const out = sittingOutSeat();
  return [0, 1, 2, 3].filter(s => s !== out);
}
function nextActiveSeat(seat) {
  let n = nextSeat(seat);
  if (state.isSingleHand && n === sittingOutSeat()) n = nextSeat(n);
  return n;
}
function trickSize() { return state.isSingleHand ? 3 : 4; }

// ── Entry points ──────────────────────────────────────────────────────────────

function startMatch() {
  state.gameScore = [0, 0];
  state.handHistory = [];
  state.dealer = 3;
  startHand();
}

// Record one hand's outcome for the match-end score table.
function recordHand(rec) {
  rec.hand = state.handHistory.length + 1;
  rec.score = [state.gameScore[0], state.gameScore[1]];
  state.handHistory.push(rec);
}

function startHand() {
  if (advanceTimeout !== null) { clearTimeout(advanceTimeout); advanceTimeout = null; }
  hideMarriagePrompt();
  show('hand-result-panel', false);
  show('match-over-panel', false);
  show('claim-btn', false);
  show('giveup-btn', false);
  hideRevealBanner();
  state.dealer = nextSeat(state.dealer);
  const deck = shuffle(buildDeck());
  state.hands = dealHands(deck);
  state.dealtHands = state.hands.map(h => h.map(c => ({ ...c })));   // snapshot for review

  state.passed         = [false, false, false, false];
  state.currentBidder  = nextSeat(state.dealer);
  state.highBid        = MIN_BID - 1;
  state.highBidder     = null;
  state.bidLog         = [];
  state.declarer       = null;
  state.trumpSuit      = null;
  state.trumpRevealed  = false;
  state.isNoTrump      = false;
  state.marriageAdj = 0;
  state.marriageDeclared   = false;
  state.marriageHolder     = null;
  state.stakeMultiplier = 1;
  state.doubled        = false;
  state.redoubled      = false;
  state.isSingleHand   = false;
  state.soloSeat       = null;
  state.tricksWonBy    = [0, 0];
  state.reviewMode     = null;
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

// The opener (first to act) is forced to bid ≥16 and may not pass (§3); this is
// true only for the very first call of the auction, before anyone has bid or passed.
function isForcedOpener() {
  return state.highBidder === null && !state.passed.some(Boolean);
}

function advanceBidding() {
  const passedCount = state.passed.filter(Boolean).length;

  // No all-pass redeal — the forced-16 opener guarantees a bidder every hand (§11).
  if (passedCount === 3 && state.highBidder !== null) {
    finishBidding();
    return;
  }

  while (state.passed[state.currentBidder]) {
    state.currentBidder = nextSeat(state.currentBidder);
  }

  renderInfo();
  renderBiddingPanel();   // refresh auction grid + toggle the human's controls

  if (isHuman(state.currentBidder)) {
    const hi = state.highBid >= MIN_BID ? state.highBid : 0;
    setStatus(hi
      ? `Current high bid: ${hi} by ${seatName(state.highBidder)}. Your move.`
      : 'No bids yet — you open; minimum bid 16.');
  } else {
    setStatus(`${seatName(state.currentBidder)} is thinking…`);
    setTimeout(doAIBid, AI_DELAY_MS);
  }
}

function doAIBid() {
  const seat = state.currentBidder;
  // A truly dominant hand may declare Single Hand, closing the auction (§9).
  if (aiShouldSingleHand(state.hands[seat])) { declareSingleHand(seat); return; }
  let bid = aiBid(state.hands[seat], state.highBid);
  if (bid === 0 && isForcedOpener()) bid = MIN_BID;   // opener can't pass — bid 16
  applyBid(seat, bid);
}

function humanBid(amount) {
  if (state.phase !== PHASE.BIDDING || !isHuman(state.currentBidder)) return;
  if (amount === 0 && isForcedOpener()) {
    setStatus('As the opener you must bid 16 — you cannot pass.');
    return;
  }
  if (amount !== 0 && amount <= state.highBid) {
    setStatus('Bid must be higher than the current high bid.');
    return;
  }
  applyBid(0, amount);
}

function applyBid(seat, amount) {
  if (amount === 0) {
    state.passed[seat] = true;
    state.bidLog.push({ seat, call: 'Pass' });
    setStatus(`${seatName(seat)} passes.`);
  } else {
    state.highBid    = amount;
    state.highBidder = seat;
    state.bidLog.push({ seat, call: amount });
    setStatus(`${seatName(seat)} bids ${amount}.`);
  }
  renderInfo();
  renderAuctionGrid();

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
      beginDoubleWindow();
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
    state.isNoTrump     = false;
    state.trumpRevealed = state.isSingleHand;   // Single Hand trump is open from the start
    setStatus(state.isSingleHand
      ? 'Trump chosen (open). Single Hand begins!'
      : 'Trump chosen (kept secret). Game begins!');
  }

  renderTrumpIndicator();
  beginDoubleWindow();
}

// ── Single Hand declaration (§9) ────────────────────────────────────────────────

function declareSingleHand(seat) {
  state.isSingleHand = true;
  state.declarer     = seat;
  state.soloSeat     = seat;
  state.highBidder   = seat;
  state.highBid      = 30;          // above 29 on the ladder (no tier; scored ±6)
  state.bidLog.push({ seat, call: 'SH' });
  updateDeclarerLabels();
  setStatus(`${seatName(seat)} declares SINGLE HAND — playing alone for ±6!`);
  renderInfo();

  if (isHuman(seat)) {
    setPhase(PHASE.TRUMP_SELECT);   // human picks an OPEN trump (or No Trump)
  } else {
    setTimeout(() => {
      state.trumpSuit     = aiChooseTrump(state.hands[seat]);
      state.isNoTrump     = false;
      state.trumpRevealed = true;   // open from the start
      setStatus(`${seatName(seat)} chose trump (open). Single Hand begins!`);
      beginPlay();
    }, AI_DELAY_MS);
  }
}

// ── Double / Redouble window (§7) ───────────────────────────────────────────────

let stakeResolve = null;   // resolver for the human Double?/Redouble? prompt

function askStake(title, text) {
  return new Promise(resolve => {
    setText('stake-title', title);
    setText('stake-text', text);
    show('stake-panel', true);
    stakeResolve = (ans) => { show('stake-panel', false); stakeResolve = null; resolve(ans); };
  });
}
function onStakeYes() { if (stakeResolve) stakeResolve(true); }
function onStakeNo()  { if (stakeResolve) stakeResolve(false); }

const aiPause = () => new Promise(r => setTimeout(r, AI_DELAY_MS));

async function beginDoubleWindow() {
  // Single Hand has no doubling (§9); go straight to play.
  if (state.isSingleHand) { beginPlay(); return; }

  setPhase(PHASE.DOUBLE);
  const declTeam = teamOf(state.declarer);
  const defTeam  = 1 - declTeam;
  const humanIsDefender = teamOf(0) === defTeam;
  const humanIsBidder   = teamOf(0) === declTeam;

  // 1) Defending team may double (×2).
  let doubleIt;
  if (humanIsDefender) {
    doubleIt = await askStake('Double?',
      `Double ${seatName(state.declarer)}'s bid of ${state.highBid}? Stakes ×2.`);
  } else {
    setStatus(`${TEAM_NAMES[defTeam]} considering a double…`);
    await aiPause();
    doubleIt = TEAMS[defTeam].some(s => aiShouldDouble(state.hands[s], state.highBid));
  }

  if (doubleIt) {
    state.doubled = true;
    state.stakeMultiplier = 2;
    setStatus(`${TEAM_NAMES[defTeam]} DOUBLE — stakes ×2.`);
    renderInfo();

    // 2) Bidding team may redouble (×4).
    let redo;
    if (humanIsBidder) {
      redo = await askStake('Redouble?', `Opponents doubled. Redouble for ×4 stakes?`);
    } else {
      setStatus(`${TEAM_NAMES[declTeam]} considering a redouble…`);
      await aiPause();
      redo = aiShouldRedouble(state.hands[state.declarer], state.trumpSuit);
    }
    if (redo) {
      state.redoubled = true;
      state.stakeMultiplier = 4;
      setStatus(`${TEAM_NAMES[declTeam]} REDOUBLE — stakes ×4!`);
      renderInfo();
      await aiPause();
    }
  }

  beginPlay();
}

// ── Play phase ────────────────────────────────────────────────────────────────

function beginPlay() {
  // Single Hand: the declarer leads the first trick. Otherwise play opens to the
  // dealer's right.
  state.activePlayer = state.isSingleHand ? state.soloSeat : nextSeat(state.dealer);
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
    const canAct = !isSittingOut(0);
    show('claim-btn', canAct && tricksRemaining() >= 2);   // claim needs ≥2 tricks (§8)
    show('giveup-btn', canAct);                            // give up available any turn
  } else {
    show('claim-btn', false);
    show('giveup-btn', false);
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

  // An AI may claim the rest once the trump is live and the endgame is small (§8).
  // Solo: the AI seat must win every remaining trick by itself.
  if (state.trumpRevealed && tricksRemaining() >= 2 && state.hands[seat].length <= 5 &&
      claimHolds(state.hands, state.currentTrick, seat, state.trumpSuit, seat, activeSeats())) {
    acceptClaim(seat);
    return;
  }

  const knownTrump = (state.trumpRevealed || seat === state.declarer)
    ? state.trumpSuit : null;

  const ledSuit = state.currentTrick.length ? state.currentTrick[0].card.suit : null;
  if (!state.isNoTrump && ledSuit && !state.trumpRevealed && seat !== state.declarer) {
    const canFollow = state.hands[seat].some(c => c.suit === ledSuit);
    if (!canFollow) revealTrump();
  }

  let card = aiPlayCard(state.hands[seat], state.currentTrick, knownTrump, state.declarer, seat);
  // Declarer may not lead the concealed trump (§4) — redirect to a non-trump lead.
  if (card && state.currentTrick.length === 0 && seat === state.declarer &&
      !state.trumpRevealed && !state.isNoTrump && card.suit === state.trumpSuit) {
    const nonTrump = state.hands[seat].filter(c => c.suit !== state.trumpSuit);
    if (nonTrump.length) card = aiLead(nonTrump, null) || nonTrump[0];
  }
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
  // Rulebook §4: the declarer may not LEAD the concealed trump (it would reveal it).
  if (!ledSuit && isHuman(state.declarer) && !state.isNoTrump &&
      !state.trumpRevealed && card.suit === state.trumpSuit &&
      state.hands[0].some(c => c.suit !== state.trumpSuit)) {
    setStatus("You can't lead your concealed trump — lead another suit.");
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

  if (state.currentTrick.length === trickSize()) {
    setTimeout(resolveTrick, 1000);
  } else {
    state.activePlayer = nextActiveSeat(seat);
    scheduleAdvance(300);
  }
}

function revealTrump() {
  if (state.isNoTrump || state.trumpRevealed) return;
  state.trumpRevealed = true;
  renderTrumpIndicator();
  setStatus(`🔔 TRUMP REVEALED — ${SUIT_SYMBOL[state.trumpSuit]} ${state.trumpSuit.toUpperCase()}!`);
  const ind = document.getElementById('trump-card-slot');
  if (ind) { ind.classList.add('reveal-flash'); setTimeout(() => ind.classList.remove('reveal-flash'), 1600); }
  showRevealBanner(`🔔 Trump is ${SUIT_SYMBOL[state.trumpSuit]} ${state.trumpSuit}!`);
  setTimeout(hideRevealBanner, 1400);
  for (let i = 0; i < 4; i++) renderHand(i);
  // A side's Marriage window may now open (gated on having won a trick).
  setTimeout(checkForMarriage, 200);
}

function resolveTrick() {
  const winner = trickWinner(state.currentTrick, state.trumpSuit);
  const pts    = state.currentTrick.reduce((s, t) => s + POINT_VALUE[t.card.rank], 0);
  state.trickPoints[teamOf(winner)] += pts;
  state.tricksWonBy[teamOf(winner)]++;          // trick count per team (Marriage gating §6)
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
  renderInfo();
  renderInfo();

  // A side's Marriage window opens once it has won a trick (post-reveal).
  setTimeout(checkForMarriage, 250);

  scheduleAdvance(1000);
}

// ── Royal pair ────────────────────────────────────────────────────────────────

function checkForMarriage() {
  // Marriage (§6) is declarable only after the trump is revealed AND the
  // declaring side has already won at least one trick. No Trump has no pair.
  if (state.marriageDeclared || state.isNoTrump || !state.trumpSuit) return;
  if (state.isSingleHand) return;          // no Marriage in a Single Hand (§9)
  if (!state.trumpRevealed) return;
  for (let seat = 0; seat < 4; seat++) {
    if (state.tricksWonBy[teamOf(seat)] < 1) continue;   // side must have won a trick
    const hand = state.hands[seat];
    const hasK = hand.some(c => c.rank === 'K' && c.suit === state.trumpSuit);
    const hasQ = hand.some(c => c.rank === 'Q' && c.suit === state.trumpSuit);
    if (hasK && hasQ) {
      if (isHuman(seat)) showMarriagePrompt();
      else              declareMarriage(seat);
      return;
    }
  }
}

function declareMarriage(seat) {
  state.marriageDeclared  = true;
  state.marriageHolder    = seat;
  const holderTeam   = teamOf(seat);
  const declarerTeam = teamOf(state.declarer);
  state.marriageAdj = (holderTeam === declarerTeam) ? -4 : +4;
  const dir = holderTeam === declarerTeam ? 'Bid −4 (easier)!' : 'Bid +4 (harder)!';
  setStatus(`${seatName(seat)} declares the Marriage (K+Q of trump)! ${dir}`);
  hideMarriagePrompt();
  renderInfo();
}

function showMarriagePrompt() {
  show('marriage-prompt', true);
  marriagePromptTimeout = setTimeout(() => {
    hideMarriagePrompt();
    setStatus('Marriage window passed.');
  }, 6000);
}

function hideMarriagePrompt() {
  show('marriage-prompt', false);
  if (marriagePromptTimeout) { clearTimeout(marriagePromptTimeout); marriagePromptTimeout = null; }
}

// ── Claim (§8) ──────────────────────────────────────────────────────────────────

// Tricks still to be played this hand (>= 2 means a claim is meaningful).
function tricksRemaining() {
  const seats = activeSeats();
  let cards = state.currentTrick.length;
  for (const s of seats) cards += state.hands[s].length;
  return Math.ceil(cards / seats.length);
}

function onClaim() {
  if (state.phase !== PHASE.PLAYING || !isHuman(state.activePlayer)) return;
  if (tricksRemaining() < 2) return;      // nothing to claim with one trick left
  // A claim is SOLO: South must win every remaining trick with its own hand.
  const holds = claimHolds(state.hands, state.currentTrick, 0,
                           state.trumpSuit, 0, activeSeats());
  if (holds) {
    show('claim-btn', false);
    acceptClaim(0);
  } else {
    show('claim-reject-panel', true);     // accept/reject only — no hidden info leaks
  }
}

function onClaimRejectOk() {
  show('claim-reject-panel', false);
  setStatus('Claim rejected — play continues. Your turn.');
  renderHand(0);                          // restore clickable hand
}

// Award every remaining trick + card-point to `toTeam`, merge the in-flight trick back
// into hands so all seats show equal counts, then run the end-of-hand sequence.
// Used by both Claim (toTeam = claimant's team) and Give Up (toTeam = opponents).
function awardRemaining(toTeam, banner) {
  const seats = activeSeats();
  let pts = 0, remainingCards = state.currentTrick.length;
  for (const s of seats) {
    remainingCards += state.hands[s].length;
    for (const c of state.hands[s]) pts += POINT_VALUE[c.rank];
  }
  for (const t of state.currentTrick) pts += POINT_VALUE[t.card.rank];
  const tricksLeft = Math.round(remainingCards / seats.length);

  state.trickPoints[toTeam] += pts;
  state.tricksWonBy[toTeam] += tricksLeft;
  state.lastTrickWinner = seats.find(s => teamOf(s) === toTeam);
  state.trickCount = 8;

  // Put the in-flight trick back so every active seat shows the same number of cards.
  for (const t of state.currentTrick) state.hands[t.playerIndex].push(t.card);
  state.currentTrick = [];
  if (advanceTimeout !== null) { clearTimeout(advanceTimeout); advanceTimeout = null; }

  show('claim-btn', false);
  show('giveup-btn', false);
  hideMarriagePrompt();
  pendingClaimBanner = banner;     // concludeHand shows this during the reveal
  finishHand();
}

// A solo claim by `claimSeat` — that seat wins every remaining trick by itself.
function acceptClaim(claimSeat) {
  const t = tricksRemaining();
  awardRemaining(teamOf(claimSeat),
    `★ ${seatName(claimSeat)} claims the remaining ${t} ${t === 1 ? 'trick' : 'tricks'} — accepted!`);
}

// Human concedes: the opposing team takes every remaining trick.
function onGiveUp() {
  if (state.phase !== PHASE.PLAYING || !isHuman(state.activePlayer)) return;
  const toTeam = 1 - teamOf(0);
  const t = tricksRemaining();
  awardRemaining(toTeam,
    `🏳 South gives up — ${TEAM_NAMES[toTeam]} take the remaining ${t} ${t === 1 ? 'trick' : 'tricks'}.`);
}

// ── Hand scoring ──────────────────────────────────────────────────────────────

// Game-point tier by the DECLARED bid (rulebook §7): 16-20 → 1, 21-27 → 2, 28-29 → 3.
function bidTier(bid) { return bid <= 20 ? 1 : bid <= 27 ? 2 : 3; }

// Match ends when either team reaches +6 or −6 (rulebook §10; cumulative, ±6 finish line).
function matchOver() {
  return state.gameScore.some(s => s >= MATCH_TARGET || s <= -MATCH_TARGET);
}

function finishHand() {
  show('claim-btn', false);
  show('giveup-btn', false);
  // Single Hand (§9) is a solo ±6 contract scored separately.
  if (state.isSingleHand) { finishSingleHand(); return; }

  state.trickPoints[teamOf(state.lastTrickWinner)] += 1;   // +1 for the last trick

  const declarerTeam = teamOf(state.declarer);
  // Marriage shifts the card-point target ±4, floored at 15 and capped at 29 (§6).
  const effectiveBid = Math.max(15, Math.min(29, state.highBid + state.marriageAdj));
  const bidMade      = state.trickPoints[declarerTeam] >= effectiveBid;
  const swing        = bidTier(state.highBid) * state.stakeMultiplier;

  // Only the bidding team's score moves on a normal hand (§7).
  state.gameScore[declarerTeam] += bidMade ? swing : -swing;

  const stakeTag = state.stakeMultiplier === 4 ? ' ×4' : state.stakeMultiplier === 2 ? ' ×2' : '';
  recordHand({
    declarerTeam,
    declarer: seatName(state.declarer),
    contract: `${state.highBid}${stakeTag}`,
    trump:    state.isNoTrump ? 'NT' : SUIT_SYMBOL[state.trumpSuit],
    marriage: state.marriageDeclared ? (state.marriageAdj > 0 ? '+4' : '−4') : '',
    target:   effectiveBid,
    took:     state.trickPoints[declarerTeam],
    result:   bidMade ? 'Made' : 'Set',
    delta:    bidMade ? swing : -swing,
  });

  setPhase(PHASE.HAND_SCORING);
  const actual = state.trickPoints[declarerTeam];
  const banner = (bidMade ? '✅ ' : '❌ ') +
    `${TEAM_NAMES[declarerTeam]} ${bidMade ? 'made' : 'fell short of'} ${effectiveBid} — took ${actual}`;
  concludeHand(banner, () => {
    if (matchOver()) renderMatchOver();
    else renderHandResult(bidMade, declarerTeam, effectiveBid, swing);
  });
}

// ── Status ────────────────────────────────────────────────────────────────────

function setStatus(msg) {
  const el = document.getElementById('status-msg');
  if (el) el.textContent = msg;
}

function showRevealBanner(text) {
  const b = document.getElementById('reveal-banner');
  if (b) { b.textContent = text; b.hidden = false; }
}
function hideRevealBanner() {
  const b = document.getElementById('reveal-banner');
  if (b) b.hidden = true;
}

let pendingClaimBanner = null;   // set by a claim/give-up so concludeHand shows it first

function renderReview() {
  for (let i = 0; i < 4; i++) renderHand(i);
  updateTrickArea();   // centre is empty during review (played cards are back in hand)
  renderInfo();
}

// End-of-hand sequence. No backdrop, so cards stay visible throughout.
//  • Claimed / conceded: Phase 1 (~2.5s) opens the cards STILL HELD with the claim banner
//    so the player sees what was taken; Phase 2 opens every seat's ORIGINAL 8 cards + panel.
//  • Natural hand: straight to Phase 2 (original hands) with the result banner, then the panel.
function concludeHand(resultBanner, showPanel) {
  const claimBanner = pendingClaimBanner;
  pendingClaimBanner = null;
  if (claimBanner) {
    state.reviewMode = 'remaining';
    renderReview();
    showRevealBanner(claimBanner);
    setTimeout(() => {
      state.reviewMode = 'original';
      renderReview();
      hideRevealBanner();
      showPanel();
    }, 2600);
  } else {
    state.reviewMode = 'original';
    renderReview();
    showRevealBanner(resultBanner);
    setTimeout(() => { hideRevealBanner(); showPanel(); }, 2500);
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderAll() {
  renderInfo();
  renderTrumpIndicator();
  renderTurnArrow();
  for (let i = 0; i < 4; i++) renderHand(i);
  updateTrickArea();
  renderPhase();
}

function renderPhase() {
  show('bidding-panel',      state.phase === PHASE.BIDDING);
  show('trump-select-panel', state.phase === PHASE.TRUMP_SELECT);
  // The hand-result / match-over panels are shown by concludeHand() after the reveal
  // window, not driven directly by phase, so they never pre-empt the card reveal.
}

// Combined left-panel + scoreboard refresh.
function renderInfo() { renderStatusPanel(); renderScoreboard(); renderNeedTaken(); }

function renderStatusPanel() {
  setText('sp-dealer', seatName(state.dealer));
  const bidderName = state.highBidder !== null ? seatName(state.highBidder)
                   : (state.phase === PHASE.BIDDING ? seatName(state.currentBidder) : '–');
  setText('sp-bidder', bidderName);
  let bidStr = '–';
  if (state.isSingleHand) bidStr = 'Single Hand';
  else if (state.highBidder !== null) {
    const stake = state.stakeMultiplier === 4 ? ' RDBL' : state.stakeMultiplier === 2 ? ' DBL' : '';
    bidStr = `${state.highBid}${stake}`;
  }
  setText('sp-bid', bidStr);
}

function renderScoreboard() {
  setText('sb-score0', state.gameScore[0]);
  setText('sb-score1', state.gameScore[1]);
}

function renderNeedTaken() {
  if (state.isSingleHand && state.declarer !== null) {
    const d = teamOf(state.declarer);
    setText('sb-need0', d === 0 ? '8 trk' : '1 trk');
    setText('sb-need1', d === 1 ? '8 trk' : '1 trk');
    setText('sb-taken0', state.tricksWonBy[0]);
    setText('sb-taken1', state.tricksWonBy[1]);
    return;
  }
  if (state.declarer !== null) {
    const eff = Math.max(15, Math.min(29, state.highBid + state.marriageAdj));
    const d = teamOf(state.declarer);
    setText(d === 0 ? 'sb-need0' : 'sb-need1', eff);
    setText(d === 0 ? 'sb-need1' : 'sb-need0', 30 - eff);
  } else {
    setText('sb-need0', '–'); setText('sb-need1', '–');
  }
  setText('sb-taken0', state.trickPoints[0]);
  setText('sb-taken1', state.trickPoints[1]);
}

// Indicator card next to the "Trump" label: face-down concealed, face-up 3-of-suit
// on reveal, "No Trump" label for NT.
function renderTrumpIndicator() {
  const slot = document.getElementById('trump-card-slot');
  if (!slot) return;
  slot.innerHTML = '';
  const oldNt = document.getElementById('trump-nt');
  if (oldNt) oldNt.remove();
  if (state.declarer === null) return;
  if (state.isNoTrump) {
    const nt = document.createElement('span');
    nt.id = 'trump-nt'; nt.textContent = 'No Trump';
    slot.parentElement.appendChild(nt);
    return;
  }
  if (!state.trumpSuit) return;
  slot.appendChild(createCardEl({ rank: '3', suit: state.trumpSuit }, state.trumpRevealed));
}

// Green "your turn" arrow — shown ONLY on the human's turn, just above the South hand.
function renderTurnArrow() {
  const arrow = document.getElementById('turn-arrow');
  if (!arrow) return;
  const yourTurn = state.phase === PHASE.PLAYING && state.activePlayer === 0 && !isSittingOut(0);
  if (!yourTurn) { arrow.hidden = true; return; }
  arrow.hidden = false;
  arrow.style.left = '50%';
  arrow.style.top  = '78%';
  arrow.style.transform = 'translate(-50%,-50%) rotate(0deg)';   // point down at your hand
}

function renderHand(seat) {
  const el = document.getElementById(`hand-${seat}`);
  if (!el) return;
  el.innerHTML = '';
  // Review modes (end of hand): 'original' opens every seat's ORIGINAL 8 cards;
  // 'remaining' opens the cards still held (claim/give-up preview). Otherwise normal play.
  const reviewing = state.reviewMode === 'original' || state.reviewMode === 'remaining';
  const source  = state.reviewMode === 'original' ? (state.dealtHands[seat] || []) : state.hands[seat];
  const sorted  = sortHand(source);
  const ledSuit = state.currentTrick.length ? state.currentTrick[0].card.suit : null;
  // The human's own cards are face-up — unless they are the Single Hand partner sitting
  // out. During review every hand is face-up.
  const faceUp  = reviewing || (seat === 0 && !isSittingOut(0));
  let legal     = (!reviewing && seat === 0 && !isSittingOut(0) &&
                   state.phase === PHASE.PLAYING && isHuman(state.activePlayer))
    ? legalPlays(state.hands[0], ledSuit) : [];
  // Declarer may not lead the concealed trump — grey those cards out (§4).
  if (legal.length && !ledSuit && isHuman(state.declarer) &&
      !state.isNoTrump && !state.trumpRevealed) {
    const nonTrump = legal.filter(c => c.suit !== state.trumpSuit);
    if (nonTrump.length) legal = nonTrump;   // unless trump is all they hold
  }

  sorted.forEach(card => {
    const div = createCardEl(card, faceUp);
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

// Map a {rank,suit} card to a CardMeister cid: rank char (A,2-9,T,J,Q,K) + suit
// (S/H/D/C). 10 → 'T'. CardMeister renders crisp, bold, clearly-indexed cards.
const CM_RANK = { J:'J', '9':'9', A:'A', '10':'T', K:'K', Q:'Q', '8':'8', '7':'7', '3':'3' };
const CM_SUIT = { spades:'S', hearts:'H', diamonds:'D', clubs:'C' };
function cardCid(card) { return CM_RANK[card.rank] + CM_SUIT[card.suit]; }

function createCardEl(card, faceUp) {
  const div = document.createElement('div');
  div.className = `card ${faceUp ? 'face-up' : 'face-down'}`;
  if (faceUp && state.trumpRevealed && !state.isNoTrump && state.trumpSuit === card.suit) {
    div.classList.add('trump-card');
  }
  const pc = document.createElement('playing-card');
  if (faceUp) {
    pc.setAttribute('cid', cardCid(card));
  } else {
    pc.setAttribute('rank', '0');             // 0 = face-down back
    pc.setAttribute('backcolor', '#0f7a3d');  // green back to match the felt
  }
  div.appendChild(pc);
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
  renderAuctionGrid();
  const myTurn = state.phase === PHASE.BIDDING && isHuman(state.currentBidder);
  show('bid-controls', myTurn);
  if (myTurn) {
    const minNext = Math.max(state.highBid + 1, MIN_BID);
    const inp = document.getElementById('bid-amount');
    if (inp) { inp.min = minNext; inp.max = 29; inp.value = minNext; }
    const pass = document.getElementById('pass-btn');
    if (pass) pass.disabled = isForcedOpener();
  }
}

// Nudge the human's pending bid within [minNext, 29].
function stepBid(delta) {
  const inp = document.getElementById('bid-amount');
  if (!inp) return;
  const min = Math.max(state.highBid + 1, MIN_BID), max = 29;
  let v = (parseInt(inp.value, 10) || min) + delta;
  v = Math.max(min, Math.min(max, v));
  inp.value = v;
}

// Bridge-style auction grid: columns West · North · East · South, one row per round.
function renderAuctionGrid() {
  const el = document.getElementById('auction-grid');
  if (!el) return;
  const COLS = [3, 2, 1, 0];                 // West, North, East, South (seat indices)
  const cells = COLS.map(() => []);          // calls per column, in round order
  // Place each call under its bidder's column; a new row starts when a column repeats.
  const rowFor = COLS.map(() => 0);
  state.bidLog.forEach(({ seat, call }) => {
    const ci = COLS.indexOf(seat);
    cells[ci].push(call);
  });
  const rounds = Math.max(1, ...cells.map(c => c.length));
  let body = '';
  for (let r = 0; r < rounds; r++) {
    body += '<tr>' + COLS.map((seat, ci) => {
      const call = cells[ci][r];
      const you = seat === 0 ? ' ac-you' : '';
      if (call === undefined) return `<td class="${you.trim()}"></td>`;
      const cls = call === 'Pass' ? 'ac-pass' : call === 'SH' ? 'ac-sh' : 'ac-bid';
      const txt = call === 'SH' ? 'SH' : call;
      return `<td class="${cls}${you}">${txt}</td>`;
    }).join('') + '</tr>';
  }
  el.innerHTML =
    `<table class="auction-table"><thead><tr>
      <th>West</th><th>North</th><th>East</th><th class="ac-you">South</th>
    </tr></thead><tbody>${body}</tbody></table>`;
}

function renderHandResult(bidMade, declarerTeam, effectiveBid, swing) {
  const dName  = TEAM_NAMES[declarerTeam];
  const actual = state.trickPoints[declarerTeam];
  const pairNote = state.marriageDeclared
    ? ` (marriage ${state.marriageAdj > 0 ? '+' : ''}${state.marriageAdj})`
    : '';
  const ntNote = state.isNoTrump ? ' [No Trump]' : '';
  const stakeNote = state.stakeMultiplier === 4 ? ' ×4 redoubled'
                  : state.stakeMultiplier === 2 ? ' ×2 doubled' : '';
  const gp = `${swing} game pt${swing > 1 ? 's' : ''}`;
  const result = bidMade
    ? `✅ ${dName} made it — bid ${effectiveBid}${pairNote}${ntNote}, took ${actual}. +${gp}${stakeNote}.`
    : `❌ ${dName} fell short — bid ${effectiveBid}${pairNote}${ntNote}, took ${actual}. −${gp}${stakeNote}.`;
  setText('hand-result-text', result);
  setText('hand-score-team0', `${TEAM_NAMES[0]}: ${state.gameScore[0]}`);
  setText('hand-score-team1', `${TEAM_NAMES[1]}: ${state.gameScore[1]}`);
  show('hand-result-panel', true);
}

// Single Hand (§9): the lone declarer must win ALL 8 tricks. +6 if so, −6 otherwise.
function finishSingleHand() {
  const declTeam = teamOf(state.declarer);
  const wonAll   = state.tricksWonBy[declTeam] === 8;
  state.gameScore[declTeam] += wonAll ? 6 : -6;
  recordHand({
    declarerTeam: declTeam,
    declarer: seatName(state.declarer),
    contract: 'Single Hand',
    trump:    state.isNoTrump ? 'NT' : SUIT_SYMBOL[state.trumpSuit],
    marriage: '',
    target:   'all',
    took:     `${state.tricksWonBy[declTeam]}/8`,
    result:   wonAll ? 'Made' : 'Set',
    delta:    wonAll ? 6 : -6,
  });
  setPhase(PHASE.HAND_SCORING);
  const banner = (wonAll ? '🏆 ' : '💥 ') +
    `${seatName(state.declarer)} ${wonAll ? 'won all 8 — Single Hand made' : 'dropped a trick — Single Hand failed'}`;
  concludeHand(banner, () => {
    if (matchOver()) renderMatchOver();
    else renderSingleHandResult(wonAll);
  });
}

function renderSingleHandResult(wonAll) {
  const dName = seatName(state.declarer);
  setText('hand-result-text', wonAll
    ? `🏆 ${dName} won all 8 tricks — Single Hand made! +6 game points.`
    : `💥 ${dName} dropped a trick — Single Hand failed. −6 game points.`);
  setText('hand-score-team0', `${TEAM_NAMES[0]}: ${state.gameScore[0]}`);
  setText('hand-score-team1', `${TEAM_NAMES[1]}: ${state.gameScore[1]}`);
  show('hand-result-panel', true);
}

function renderMatchOver() {
  // Winner: a team at/above +6, or the opponent of a team at/below −6 (§10).
  const winner = (state.gameScore[0] >= MATCH_TARGET || state.gameScore[1] <= -MATCH_TARGET) ? 0 : 1;
  setText('match-winner-text', `${TEAM_NAMES[winner]} win the match! 🎉`);
  setText('match-score-text',
    `${TEAM_NAMES[0]} ${state.gameScore[0]} — ${state.gameScore[1]} ${TEAM_NAMES[1]}`);
  renderHistoryTable('match-history');
  show('match-over-panel', true);
  show('hand-result-panel', false);
}

// Build the per-hand score table from state.handHistory into element `id`.
function renderHistoryTable(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const rows = state.handHistory.map(h => {
    const dlt = `${h.delta > 0 ? '+' : ''}${h.delta}`;
    const dcls = h.delta >= 0 ? 'h-pos' : 'h-neg';
    const mar  = h.marriage ? ` <span class="h-mar">${h.marriage}</span>` : '';
    return `<tr>
      <td>${h.hand}</td>
      <td>${h.declarer} <span class="h-team">(${TEAM_NAMES[h.declarerTeam]})</span></td>
      <td>${h.contract} ${h.trump}${mar}</td>
      <td>${h.took}${typeof h.target === 'number' ? '/' + h.target : ''}</td>
      <td class="${h.result === 'Made' ? 'h-pos' : 'h-neg'}">${h.result}</td>
      <td class="${dcls}">${dlt}</td>
      <td>${h.score[0]} : ${h.score[1]}</td>
    </tr>`;
  }).join('');
  el.innerHTML =
    `<table class="history-table">
      <thead><tr>
        <th>#</th><th>Declarer</th><th>Contract</th><th>Took</th><th>Result</th><th>±</th><th>N–S : E–W</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
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
  show('bid-controls', false);
  humanBid(val);
}
function onPass()           { show('bid-controls', false); humanBid(0); }
function onSingleHand() {
  if (state.phase !== PHASE.BIDDING || !isHuman(state.currentBidder)) return;
  show('bid-controls', false);
  declareSingleHand(0);
}
function onSelectTrump(suit){ humanSelectTrump(suit); }
function onDeclareMarriage()    { declareMarriage(0); }
function onSkipMarriage()       { hideMarriagePrompt(); setStatus('Marriage skipped.'); }
function onNextHand()       { show('hand-result-panel', false); startHand(); }
function onNewMatch()       { show('match-over-panel', false); show('hand-result-panel', false); startMatch(); }

// Scorecard (running table) — open any time from the toolbar.
function onShowScorecard() {
  renderHistoryTable('scorecard-history');
  show('scorecard-panel', true);
}
function onCloseScorecard() { show('scorecard-panel', false); }

// Rules / Help
let rulesTab = 0;
function onShowRules() { rulesTab = 0; renderRules(); show('rules-panel', true); }
function onCloseRules() { show('rules-panel', false); }
function onRulesTab(i) { rulesTab = i; renderRules(); }
function renderRules() {
  document.querySelectorAll('.rules-tab').forEach((t, i) => t.classList.toggle('active', i === rulesTab));
  const body = document.getElementById('rules-body');
  if (body) body.innerHTML = RULES_HTML[rulesTab];
}

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', startMatch);
