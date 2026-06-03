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

// "tap" on touch devices, "click" on pointer devices — for user-facing copy.
const POINTER_VERB = (typeof matchMedia === 'function' &&
  matchMedia('(hover: none) and (pointer: coarse)').matches) ? 'tap' : 'click';

// Togglable rule options (seed of a future settings screen). Flip a flag to switch a rule.
const RULE_OPTIONS = {
  doubleRedouble: false,      // Double/Redouble window (×2/×4). Off: bid tiers grade stakes.
  bidding:        'asymmetric', // 'asymmetric' holder-match auction (the only model implemented)
};

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
     <li>Trump starts <b>hidden &amp; inert</b> — each trick goes to the highest card of the led suit. If you're <b>void</b> in the led suit you may press <b>Reveal Trump</b> to ruff.</li>
     <li>Once revealed, a trick is won by the highest trump, else the highest card of the led suit.</li>
   </ul>`,
  // 1 — Rules & Scoring
  `<h3>Hidden Trump &amp; Reveal-to-ruff</h3>
   <ul>
     <li>The bid winner secretly picks a trump suit (or No Trump), known only to them. While hidden it is
         <b>inert</b> — it can't win a trick, and anyone (the bidder included) may lead it without revealing it.</li>
     <li>If you <b>can't follow</b> the led suit you may press <b>Reveal Trump</b> to ruff — the only way trump is ever
         revealed. You must then play a trump if you hold one; otherwise you discard. A trump thrown <i>without</i>
         revealing is just an ordinary card.</li>
     <li>The first reveal wakes trump for everyone for the rest of the hand. If no one ever reveals, trump never activates.</li>
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
  `<h3>Bidding — holder vs challenger</h3>
   <ul>
     <li>The player to the dealer's right opens at <b>16</b> (or declares Single Hand) — they cannot pass.</li>
     <li>Each other player, in turn, gets <b>one chance</b>: pass, or <b>challenge</b> by bidding higher.</li>
     <li>A challenge starts a duel with the current <b>holder</b>. Only the holder may <b>match</b> (bid the
         same number to keep the contract); the challenger must keep <b>raising</b>. The duel ends when one
         side stops — the holder, by matching, has the edge.</li>
     <li>Bids run 16–29; Single Hand sits above 29.</li>
     <li>The winner names a trump suit (or No Trump), kept <b>concealed and inert</b> until a void player reveals it to ruff.</li>
   </ul>
   <h3>No Trump</h3>
   <ul><li>Played with no trump — every trick is won by the highest card of the led suit.</li></ul>
   <h3>Single Hand (solo ±6)</h3>
   <ul>
     <li>Above 29 on the ladder: play alone, partner sits out, trump open from the start.</li>
     <li>Win all 8 tricks → <b>+6</b>; lose any trick → <b>−6</b> (the hand ends the moment a trick is lost).</li>
   </ul>`,
];

// ── Game state ────────────────────────────────────────────────────────────────

let state = {
  phase:        PHASE.IDLE,
  dealer:       3,
  hands:        [[], [], [], []],
  gameScore:    [0, 0],
  handHistory:  [],          // per-hand records for the match-end score table

  // Bidding (asymmetric holder-match model)
  bidOrder:      [0, 1, 2, 3],
  eliminated:    [false, false, false, false],
  currentBidder: 0,
  highBid:       MIN_BID - 1,   // currentBid
  highBidder:    null,          // holder
  challenger:    null,
  slotIdx:       0,
  bidStage:      'open',
  bidLog:        [],            // {seat, call} per action, for the auction grid

  // Trump
  declarer:      null,
  trumpSuit:     null,
  trumpRevealed: false,
  isNoTrump:     false,
  forceTrumpOnly: false,        // human chose Reveal-to-ruff → bound to play a trump this turn

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
  resolving:        false,        // true during the 1s pause after a trick fills (input locked)
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

// Trump is INERT until the manual ruff-reveal (Part B1/B4) — only after that is it
// active for trick adjudication. No Trump and Single Hand are unaffected (NT has no
// trump; SH starts with trumpRevealed=true).
function effectiveTrump() {
  return (state.isNoTrump || !state.trumpRevealed) ? null : state.trumpSuit;
}

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

let matchId = null;

function startMatch() {
  state.gameScore = [0, 0];
  state.handHistory = [];
  state.dealer = 3;
  matchId = 'm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  feedbackLog.beginMatch(matchId);
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
  clearBidTimeout();
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

  // Start a fresh move log for this hand (AI-feedback feature).
  feedbackLog.beginHand({
    number: state.handHistory.length + 1,
    dealer: state.dealer,
    seatingOrderCCW: ['S', 'E', 'N', 'W'],
    deal: state.dealtHands,
    scoreBefore: [state.gameScore[0], state.gameScore[1]],
  });
  updateFlagBadge();

  state.bidOrder       = [0, 1, 2, 3].map(i => (state.dealer + 1 + i) % 4);
  state.eliminated     = [false, false, false, false];
  state.currentBidder  = state.bidOrder[0];
  state.highBid        = MIN_BID - 1;
  state.highBidder     = null;
  state.challenger     = null;
  state.slotIdx        = 0;
  state.bidStage       = 'open';
  state.bidLog         = [];
  state.declarer       = null;
  state.trumpSuit      = null;
  state.trumpRevealed  = false;
  state.isNoTrump      = false;
  state.forceTrumpOnly = false;
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
  state.resolving      = false;
  state.tricks         = [];
  state.currentTrick   = [];
  state.trickPoints    = [0, 0];
  state.lastTrickWinner = null;
  state.trickCount     = 0;
  setReviewBtnEnabled(false);   // the review unlocks only once this hand concludes

  setPhase(PHASE.BIDDING);
  renderAll();
  laterBid(startBidding, 300);
}

// ── Phase ─────────────────────────────────────────────────────────────────────

function setPhase(p) {
  state.phase = p;
  renderPhase();
}

// ── Bidding ───────────────────────────────────────────────────────────────────

// Asymmetric holder-match auction (supersedes Rulebook §3 — see 29 Bidding Logic Update.md).
// `state.highBid` = currentBid, `state.highBidder` = holder. bidStage ∈
//   'open'          → P1 opens 16 or Single Hand (forced, no pass)
//   'slot-open'     → a challenger Px chooses Pass / Challenge / Single Hand
//   'vs-holder'     → the holder responds Match / Raise / Pass / Single Hand
//   'vs-challenger' → the challenger responds Raise / Pass / Single Hand (never match)

let bidTimeout = null;
function laterBid(fn, delay) {
  if (bidTimeout !== null) { clearTimeout(bidTimeout); bidTimeout = null; }
  bidTimeout = setTimeout(() => { bidTimeout = null; fn(); }, delay);
}
function clearBidTimeout() { if (bidTimeout !== null) { clearTimeout(bidTimeout); bidTimeout = null; } }

function startBidding() {
  state.bidOrder   = [0, 1, 2, 3].map(i => (state.dealer + 1 + i) % 4); // P1..P4 ccw from dealer's right
  state.eliminated = [false, false, false, false];
  state.highBid    = MIN_BID - 1;   // currentBid
  state.highBidder = null;          // holder
  state.challenger = null;
  state.slotIdx    = 0;
  state.bidStage   = 'open';
  state.currentBidder = state.bidOrder[0];
  state.bidLog     = [];
  bidStep();
}

// Render + hand off to the human (await click) or the AI (delayed).
function bidStep() {
  renderInfo();
  renderBiddingPanel();
  const seat = state.currentBidder;
  if (isHuman(seat)) {
    const cb = state.highBid;
    const msg = {
      'open':          'You open — bid 16 or Single Hand.',
      'slot-open':     `Bid ${cb} by ${seatName(state.highBidder)} — your move.`,
      'vs-holder':     `${seatName(state.challenger)} challenged at ${cb} — your move.`,
      'vs-challenger': `Challenging at ${cb} — your move.`,
    }[state.bidStage];
    setStatus(msg);
  } else {
    setStatus(`${seatName(seat)} is thinking…`);
    laterBid(doAIBid, AI_DELAY_MS);
  }
}

function doAIBid() {
  const seat = state.currentBidder, hand = state.hands[seat];
  const cb = state.highBid, canRaise = cb < 29;
  // Challenger-side value (slot-open / vs-challenger): holder is the current high bidder.
  // Applies the C2 partner rule + C12 score-lean.
  const challengerValue = aiBidValueAgainstHolder(hand, state.highBidder, seat, state.gameScore);
  // Holder-side value is the plain ceiling with score-lean (holder defends its own bid).
  const holderValue     = aiBidValue(hand, scoreLeanFor(seat));
  switch (state.bidStage) {
    case 'open':
      // Single Hand only on a near-lock; otherwise the forced 16. No partner rule on the open.
      return aiShouldSingleHand(hand, seat, state.gameScore)
        ? applyBidAction(seat, 'sh') : applyBidAction(seat, 'open16');
    case 'slot-open':
      if (aiShouldSingleHand(hand, seat, state.gameScore)) return applyBidAction(seat, 'sh');
      return (challengerValue > cb && canRaise)
        ? applyBidAction(seat, 'challenge', cb + 1)
        : applyBidAction(seat, 'pass');
    case 'vs-holder':                                   // this seat is the holder, responding
      // Facing one's own partner as challenger: retain (keep trump) through the support
      // band, and concede only if partner pushes past it (a take-over) — per C2.
      if (state.challenger !== null && _samePartnershipSeats(state.challenger, seat))
        return (cb <= AI_TUNING.partner.supportMax)
          ? applyBidAction(seat, 'match') : applyBidAction(seat, 'pass');
      return (holderValue >= cb) ? applyBidAction(seat, 'match') : applyBidAction(seat, 'pass');
    case 'vs-challenger':                               // this seat is the challenger
      return (challengerValue > cb && canRaise)
        ? applyBidAction(seat, 'raise', cb + 1)
        : applyBidAction(seat, 'pass');
  }
}

// Thin wrappers around the ai.js helpers so we can call them with game.js's state.
function _samePartnershipSeats(a, b) { return teamOf(a) === teamOf(b); }
function scoreLeanFor(seat) {
  if (!state.gameScore) return 0;
  const mine = state.gameScore[teamOf(seat)] || 0;
  if (mine >= 5)  return -1;     // ahead — bid conservatively
  if (mine <= -5) return +1;     // behind — bid aggressively
  return 0;
}

// Human entry point (called from the dynamic bid controls).
function humanBidAction(kind, amount) {
  if (state.phase !== PHASE.BIDDING || !isHuman(state.currentBidder)) return;
  if ((kind === 'challenge' || kind === 'raise') && !(amount > state.highBid && amount <= 29)) {
    setStatus(`Bid must be higher than ${state.highBid}.`);
    return;
  }
  show('bid-controls', false);
  applyBidAction(0, kind, amount);
}
function humanRaise() {
  const v = parseInt((document.getElementById('bid-amount') || {}).value, 10);
  humanBidAction(state.bidStage === 'slot-open' ? 'challenge' : 'raise', v);
}

function applyBidAction(seat, kind, amount) {
  switch (kind) {
    case 'sh':
      clearBidTimeout();
      declareSingleHand(seat);                          // ends the auction
      return;
    case 'open16':
      state.highBid = MIN_BID; state.highBidder = seat;
      state.bidLog.push({ seat, call: MIN_BID });
      setStatus(`${seatName(seat)} opens at 16.`);
      startSlot(1);
      return;
    case 'challenge':
      state.highBid = amount; state.challenger = seat;
      state.bidLog.push({ seat, call: amount });
      setStatus(`${seatName(seat)} challenges with ${amount}.`);
      state.bidStage = 'vs-holder'; state.currentBidder = state.highBidder;
      bidStep();
      return;
    case 'match':                                       // holder retains at currentBid
      state.bidLog.push({ seat, call: state.highBid });
      setStatus(`${seatName(seat)} holds at ${state.highBid}.`);
      state.bidStage = 'vs-challenger'; state.currentBidder = state.challenger;
      bidStep();
      return;
    case 'raise':
      state.highBid = amount; state.bidLog.push({ seat, call: amount });
      setStatus(`${seatName(seat)} raises to ${amount}.`);
      if (state.bidStage === 'vs-holder') { state.bidStage = 'vs-challenger'; state.currentBidder = state.challenger; }
      else                                { state.bidStage = 'vs-holder';     state.currentBidder = state.highBidder; }
      bidStep();
      return;
    case 'pass':
      state.eliminated[seat] = true;
      state.bidLog.push({ seat, call: 'Pass' });
      if (state.bidStage === 'vs-holder') {             // holder concedes → challenger takes over
        setStatus(`${seatName(seat)} passes — ${seatName(state.challenger)} takes the contract.`);
        state.highBidder = state.challenger;
      } else {
        setStatus(`${seatName(seat)} passes.`);
      }
      startSlot(state.slotIdx + 1);
      return;
  }
}

// Open the next challenge slot (P2..P4); if none remain the holder wins.
function startSlot(idx) {
  state.challenger = null;
  while (idx <= 3 && (state.eliminated[state.bidOrder[idx]] || state.bidOrder[idx] === state.highBidder)) idx++;
  state.slotIdx = idx;
  if (idx > 3) { finishBidding(); return; }
  state.bidStage = 'slot-open';
  state.currentBidder = state.bidOrder[idx];
  bidStep();
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
  // Single Hand has no doubling (§9); and the whole feature is gated off by default
  // (RULE_OPTIONS.doubleRedouble) — code kept for a future settings toggle.
  if (!RULE_OPTIONS.doubleRedouble || state.isSingleHand) { beginPlay(); return; }

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
  // Capture the finalized contract into the move log (AI-feedback feature).
  feedbackLog.setBidding(state.bidLog);
  feedbackLog.setContract({
    bidder: state.declarer, declaredBid: state.highBid, trump: state.trumpSuit,
    isNoTrump: state.isNoTrump, singleHand: state.isSingleHand, soloSeat: state.soloSeat,
    double: state.stakeMultiplier === 4 ? 'redouble' : state.stakeMultiplier === 2 ? 'double' : 'none',
  });
  feedbackLog.setTargets(state.isSingleHand ? null
    : { biddingTeamNeed: state.highBid, defenseNeed: 30 - state.highBid });

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
    ? `Your turn — ${POINTER_VERB} a card to play.`
    : `${seatName(state.activePlayer)} is thinking…`);

  if (isHuman(state.activePlayer)) {
    state.forceTrumpOnly = false;
    renderHand(0);
    const canAct = !isSittingOut(0);
    show('claim-btn', canAct && tricksRemaining() >= 2);   // claim needs ≥2 tricks (§8)
    show('giveup-btn', canAct);                            // give up available any turn
    maybePromptHumanReveal();                              // void + concealed trump → ask (Part B3)
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

  // Reveal-to-ruff (Part B3) — when void in led suit and trump still concealed, ask
  // the AI whether to reveal. On reveal, the AI MUST play a trump if it holds one.
  const ledSuit = state.currentTrick.length ? state.currentTrick[0].card.suit : null;
  let mustRuffWithTrump = false;
  if (!state.isNoTrump && ledSuit && !state.trumpRevealed && state.trumpSuit) {
    const canFollow  = state.hands[seat].some(c => c.suit === ledSuit);
    // When led=trump the AI is void in trump too, so revealing can't ruff and only helps
    // opponents — the AI declines (correct play; AI hands are hidden, so no info leak. The
    // human, by contrast, is always offered the choice — see revealApplicable).
    const ledIsTrump = ledSuit === state.trumpSuit;
    if (!canFollow && !ledIsTrump &&
        aiShouldReveal(seat, state.hands[seat], state.currentTrick, state.declarer, knownTrump)) {
      revealTrump(seat);
      mustRuffWithTrump = state.hands[seat].some(c => c.suit === state.trumpSuit);
    }
  }

  let card;
  if (mustRuffWithTrump) {
    // Forced ruff — play the lowest trump card.
    const trumps = state.hands[seat].filter(c => c.suit === state.trumpSuit);
    card = lowestCard(trumps);
  } else {
    card = aiPlayCard(state.hands[seat], state.currentTrick, effectiveTrump(), state.declarer, seat);
  }
  if (!card) { console.warn(`${seatName(seat)} aiPlayCard returned null — skipping`); return; }
  playCard(seat, card);
}

function humanPlayCard(card) {
  if (state.phase !== PHASE.PLAYING || !isHuman(state.activePlayer)) return;
  // Ignore clicks during the trick-resolve pause (a full trick awaiting resolveTrick) —
  // otherwise a fast second click would push a 5th card and corrupt the trick.
  if (state.resolving || state.currentTrick.length >= trickSize()) return;
  const ledSuit = state.currentTrick.length ? state.currentTrick[0].card.suit : null;
  const legal   = legalPlays(state.hands[0], ledSuit);
  if (!legal.some(c => sameCard(c, card))) {
    setStatus('You must follow the led suit if you can!');
    return;
  }
  // If the human chose "Reveal Trump" while void, they are bound to ruff — play a
  // trump if they hold one (Part B3).
  if (state.forceTrumpOnly) {
    if (card.suit !== state.trumpSuit) {
      setStatus('You revealed trump — you must play a trump card.');
      return;
    }
    state.forceTrumpOnly = false;
  }

  playCard(0, card);
}

// The active human is void in the led suit and trump is still concealed — let them
// choose to reveal-and-ruff or simply discard (Part B3). Returns true if a prompt
// was shown (so advancePlay should wait for the choice).
function maybePromptHumanReveal() {
  if (!revealApplicable(0)) return false;
  // The prompt's overlay captures clicks; hide the floating chips behind it for clarity.
  show('claim-btn', false);
  show('giveup-btn', false);
  show('reveal-prompt', true);
  setStatus("You're void — reveal trump to ruff, or discard.");
  return true;
}

// Gate for the human void-player reveal option. Offered whenever a suit was led that the
// seat cannot follow, trump exists and is still concealed — INCLUDING when the led suit is
// the trump itself. Suppressing it there would deny a legitimate choice AND leak the trump's
// identity (its absence would signal "led suit = trump"). When void in led=trump the player
// holds no trump, so on reveal they simply discard (handled in onRevealTrump).
function revealApplicable(seat) {
  if (state.isNoTrump || state.isSingleHand || state.trumpRevealed || !state.trumpSuit) return false;
  const ledSuit = state.currentTrick.length ? state.currentTrick[0].card.suit : null;
  if (!ledSuit) return false;
  return !state.hands[seat].some(c => c.suit === ledSuit);   // void in led suit
}

// Human pressed "Reveal Trump": expose trump, then bind them to ruff if they hold one.
function onRevealTrump() {
  show('reveal-prompt', false);
  revealTrump(0);
  state.forceTrumpOnly = state.hands[0].some(c => c.suit === state.trumpSuit);
  renderHand(0);   // re-grey: only trump cards remain playable when forced
  setStatus(state.forceTrumpOnly
    ? 'Trump revealed — play a trump card to ruff.'
    : 'Trump revealed — discard any card.');
}

// Human pressed "Discard": keep trump concealed, play any card (they're void).
function onRevealDiscard() {
  show('reveal-prompt', false);
  state.forceTrumpOnly = false;
  setStatus('Discard any card.');
  renderHand(0);
}

function playCard(seat, card) {
  // Move-log capture (AI-feedback): record the play with its roles, using full knowledge
  // of the (possibly still-concealed) trump.
  const isLead    = state.currentTrick.length === 0;
  const ledSuitOf = isLead ? card.suit : state.currentTrick[0].card.suit;
  const isTrumpC  = !state.isNoTrump && state.trumpSuit && card.suit === state.trumpSuit;
  feedbackLog.logPlay({
    leader: isLead ? seat : state.currentTrick[0].playerIndex,
    seat, card,
    ledSuit: card.suit === ledSuitOf,
    isTrump: !!isTrumpC,
    inertTrump: !!isTrumpC && !state.trumpRevealed,
  });

  state.hands[seat] = state.hands[seat].filter(c => !sameCard(c, card));
  state.currentTrick.push({ playerIndex: seat, card });

  renderHand(seat);
  renderTrickCard(seat, card);

  if (state.currentTrick.length === trickSize()) {
    state.resolving = true;     // lock input during the 1s trick-resolve pause
    setTimeout(resolveTrick, 1000);
  } else {
    state.activePlayer = nextActiveSeat(seat);
    scheduleAdvance(300);
  }
}

function revealTrump(byWhom) {
  if (state.isNoTrump || state.trumpRevealed) return;
  state.trumpRevealed = true;
  // Move-log capture (AI-feedback): who revealed, at which (in-progress) trick.
  feedbackLog.logReveal({ atTrick: state.tricks.length + 1, by: byWhom == null ? state.declarer : byWhom, suit: state.trumpSuit });
  renderTrumpIndicator();
  setStatus(`🔔 TRUMP REVEALED — ${SUIT_SYMBOL[state.trumpSuit]} ${state.trumpSuit.toUpperCase()}!`);
  const ind = document.getElementById('trump-card-slot');
  if (ind) { ind.classList.add('reveal-flash'); setTimeout(() => ind.classList.remove('reveal-flash'), 1600); }
  showToast(`🔔 Trump is ${SUIT_SYMBOL[state.trumpSuit]} ${state.trumpSuit}!`);
  for (let i = 0; i < 4; i++) renderHand(i);
  // A side's Marriage window may now open (gated on having won a trick).
  setTimeout(checkForMarriage, 200);
}

function resolveTrick() {
  state.resolving = false;      // pause over — input unlocks for the next turn
  const winner = trickWinner(state.currentTrick, effectiveTrump());
  const pts    = state.currentTrick.reduce((s, t) => s + POINT_VALUE[t.card.rank], 0);
  state.trickPoints[teamOf(winner)] += pts;
  state.tricksWonBy[teamOf(winner)]++;          // trick count per team (Marriage gating §6)
  state.lastTrickWinner = winner;
  state.tricks.push({
    winner,
    leader: state.currentTrick[0].playerIndex,
    plays:  state.currentTrick.map(t => ({ seat: t.playerIndex, card: t.card })),
    points: pts,
    cards:  state.currentTrick.map(t => t.card),   // retained — harmless (zero readers), keeps the diff non-destructive
  });
  state.trickCount++;
  // Move-log capture (AI-feedback): finalize this trick (+1 on the normal-hand last trick).
  feedbackLog.logTrickResolved({
    trickNumber: state.trickCount, winner, cardPoints: pts,
    isLastTrick: !state.isSingleHand && state.trickCount === 8,
  });
  state.currentTrick = [];
  state.activePlayer = winner;

  // Flash the winning card + label WITH all four cards still on the table, then collect
  // the trick in the timeout — so the glow highlights the winning card, not an empty slot.
  const winSlot  = document.getElementById(`trick-slot-${winner}`);
  const winLabel = document.getElementById(`label-${winner}`);
  winSlot?.classList.add('trick-winner');
  winLabel?.classList.add('trick-winner');
  setStatus(`${seatName(winner)} wins the trick (+${pts} pts). Trick ${state.trickCount}/8`);
  renderInfo();
  setTimeout(() => {
    winSlot?.classList.remove('trick-winner');
    winLabel?.classList.remove('trick-winner');
    updateTrickArea();   // clear the collected trick (currentTrick already emptied)
  }, 900);

  // Single Hand (§9): the declarer must win ALL tricks, so the instant a defender takes
  // one the contract is broken — end the hand now instead of playing on.
  if (state.isSingleHand && winner !== state.soloSeat) {
    setStatus(`${seatName(winner)} takes a trick — Single Hand is broken!`);
    feedbackLog.noteEnd({ reason: 'single-hand-broken', atTrick: state.trickCount, by: winner, awardedToTeam: teamOf(winner) });
    if (advanceTimeout !== null) { clearTimeout(advanceTimeout); advanceTimeout = null; }
    setTimeout(finishHand, 1300);
    return;
  }

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
  showToast(`💍 ${seatName(seat)} declares Marriage — ${dir}`);
  hideMarriagePrompt();
  // Move-log capture (AI-feedback): marriage timing + the re-adjusted targets.
  {
    const newNeed = Math.max(15, Math.min(29, state.highBid + state.marriageAdj));
    feedbackLog.logMarriage({ atTrick: state.trickCount, by: seat, adj: state.marriageAdj,
      targets: { biddingTeamNeed: newNeed, defenseNeed: 30 - newNeed } });
  }
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
  feedbackLog.noteEnd({ reason: 'claim', atTrick: state.tricks.length + 1, by: claimSeat, awardedToTeam: teamOf(claimSeat) });
  awardRemaining(teamOf(claimSeat),
    `★ ${seatName(claimSeat)} claims the remaining ${t} ${t === 1 ? 'trick' : 'tricks'} — accepted!`);
}

// Human concedes: the opposing team takes every remaining trick.
function onGiveUp() {
  if (state.phase !== PHASE.PLAYING || !isHuman(state.activePlayer)) return;
  const toTeam = 1 - teamOf(0);
  const t = tricksRemaining();
  feedbackLog.noteEnd({ reason: 'concede', atTrick: state.tricks.length + 1, by: 0, awardedToTeam: toTeam });
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

  // Move-log capture (AI-feedback): final result (endReason set earlier by claim/concede).
  feedbackLog.logResult({
    biddingTeamPoints: state.trickPoints[declarerTeam], made: bidMade,
    tier: state.highBid <= 20 ? '16-20' : state.highBid <= 27 ? '21-27' : '28-29',
    gamePointsAwarded: bidMade ? swing : -swing, multiplier: state.stakeMultiplier,
    scoreAfter: [state.gameScore[0], state.gameScore[1]],
  });

  setPhase(PHASE.HAND_SCORING);
  const actual = state.trickPoints[declarerTeam];
  const banner = (bidMade ? '✅ ' : '❌ ') +
    `${TEAM_NAMES[declarerTeam]} ${bidMade ? 'made' : 'fell short of'} ${effectiveBid} — took ${actual}`;
  setStatus(banner);   // override any lingering "… is thinking…" / claim status (Issue 9)
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

// Transient center toast for in-play events (trump reveal, Marriage, claim) — auto-fades.
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  t.classList.remove('toast-show'); void t.offsetWidth; t.classList.add('toast-show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('toast-show'); t.hidden = true; }, 1700);
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
      setReviewBtnEnabled(true);
      hideRevealBanner();
      showPanel();
    }, 2600);
  } else {
    state.reviewMode = 'original';
    renderReview();
    showRevealBanner(resultBanner);
    setTimeout(() => { hideRevealBanner(); setReviewBtnEnabled(true); showPanel(); }, 2500);
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderAll() {
  renderInfo();
  renderTrumpIndicator();
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
  let legal     = (!reviewing && seat === 0 && !isSittingOut(0) && !state.resolving &&
                   state.phase === PHASE.PLAYING && isHuman(state.activePlayer))
    ? legalPlays(state.hands[0], ledSuit) : [];
  // After choosing Reveal-to-ruff, only trump cards are playable this turn (Part B3).
  if (legal.length && state.forceTrumpOnly) {
    const trumps = legal.filter(c => c.suit === state.trumpSuit);
    if (trumps.length) legal = trumps;
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

// Card rendering style: 'graphic' (CardMeister SVG) or 'text' (simple text card). Persisted.
let cardStyle = (typeof localStorage !== 'undefined' && localStorage.getItem('cg29-card-style') === 'text')
  ? 'text' : 'graphic';

function createCardEl(card, faceUp) {
  const div = document.createElement('div');
  div.className = `card ${faceUp ? 'face-up' : 'face-down'}`;
  if (faceUp && state.trumpRevealed && !state.isNoTrump && state.trumpSuit === card.suit) {
    div.classList.add('trump-card');
  }
  if (cardStyle === 'text') {
    buildTextCard(div, card, faceUp);
  } else {
    const pc = document.createElement('playing-card');
    if (faceUp) {
      pc.setAttribute('cid', cardCid(card));
    } else {
      pc.setAttribute('rank', '0');             // 0 = face-down back
      pc.setAttribute('backcolor', '#0f7a3d');  // green back to match the felt
    }
    div.appendChild(pc);
  }
  return div;
}

// Simple text card: corner indices (TL + BR-rotated) + a big centre, coloured red/black.
// Face-down is a plain green back. Sizing is handled by container-query units in CSS.
function buildTextCard(div, card, faceUp) {
  div.classList.add('text-card');
  if (!faceUp) { div.classList.add('text-back'); return; }
  div.classList.add(SUIT_COLOR[card.suit]);   // 'red' | 'black'
  const label = card.rank + SUIT_SYMBOL[card.suit];
  div.innerHTML =
    `<span class="tc-corner tc-tl">${label}</span>` +
    `<span class="tc-center">${label}</span>` +
    `<span class="tc-corner tc-br">${label}</span>`;
}

// Repaint every visible card surface (after a style switch) without touching game state.
function repaintCards() {
  for (let i = 0; i < 4; i++) renderHand(i);
  renderTrumpIndicator();
  updateTrickArea();
}
function updateCardStyleBtn() {
  const btn = document.getElementById('cardstyle-btn');
  if (btn) btn.title = `Card style: ${cardStyle === 'text' ? 'text' : 'graphic'} — tap to switch`;
}
function onToggleCardStyle() {
  cardStyle = (cardStyle === 'text') ? 'graphic' : 'text';
  try { localStorage.setItem('cg29-card-style', cardStyle); } catch (e) {}
  updateCardStyleBtn();
  repaintCards();
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

// Build the human's bid controls for the current stage (opener / challenger / holder).
function renderBiddingPanel() {
  renderAuctionGrid();
  const myTurn = state.phase === PHASE.BIDDING && isHuman(state.currentBidder);
  const ctrls  = document.getElementById('bid-controls');
  show('bid-controls', myTurn);
  if (!myTurn || !ctrls) return;

  const cb = state.highBid, canRaise = cb < 29;
  // Compact stepper sits INLINE with the action buttons (one row), so the panel is wider+shorter.
  const stepper = (min) =>
    `<button class="step-btn" onclick="stepBid(-1)">−</button>
     <input id="bid-amount" type="number" min="${min}" max="29" value="${min}" readonly>
     <button class="step-btn" onclick="stepBid(1)">+</button>`;
  const sh = `<button class="btn-shlink" onclick="humanBidAction('sh')">Single Hand (solo ±6)</button>`;

  let row;   // the action row contents (stepper + buttons inline)
  if (state.bidStage === 'open') {
    row = `<button class="btn btn-primary" onclick="humanBidAction('open16')">Open at 16</button>`;
  } else if (state.bidStage === 'vs-holder') {       // human is the holder, defending
    row = `<button class="btn btn-primary" onclick="humanBidAction('match')">Hold at ${cb}</button>
           ${canRaise ? stepper(cb + 1) : ''}
           ${canRaise ? `<button class="btn btn-secondary" onclick="humanRaise()">Raise</button>` : ''}
           <button class="btn btn-secondary" onclick="humanBidAction('pass')">Pass</button>`;
  } else {                                            // slot-open or vs-challenger: human is the challenger
    row = canRaise
      ? `${stepper(cb + 1)}
         <button class="btn btn-primary" onclick="humanRaise()">Raise</button>
         <button class="btn btn-secondary" onclick="humanBidAction('pass')">Pass</button>`
      : `<span class="bid-hint">At the 29 cap — Single Hand or pass.</span>
         <button class="btn btn-secondary" onclick="humanBidAction('pass')">Pass</button>`;
  }
  ctrls.innerHTML = `<div class="bid-action-row">${row}</div><div class="single-hand-row">${sh}</div>`;
}

// Nudge the human's pending bid within [min, 29] (min taken from the input).
function stepBid(delta) {
  const inp = document.getElementById('bid-amount');
  if (!inp) return;
  const min = parseInt(inp.min, 10) || MIN_BID, max = 29;
  let v = (parseInt(inp.value, 10) || min) + delta;
  inp.value = Math.max(min, Math.min(max, v));
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
  // Show the DECLARED bid, with the marriage-adjusted target spelled out separately —
  // never substitute the adjusted target for the bid (the tier follows the declared bid).
  const pairNote = state.marriageDeclared
    ? ` (marriage ${state.marriageAdj > 0 ? '+' : ''}${state.marriageAdj} → needed ${effectiveBid})`
    : '';
  const ntNote = state.isNoTrump ? ' [No Trump]' : '';
  const stakeNote = state.stakeMultiplier === 4 ? ' ×4 redoubled'
                  : state.stakeMultiplier === 2 ? ' ×2 doubled' : '';
  const gp = `${swing} game pt${swing > 1 ? 's' : ''}`;
  const result = bidMade
    ? `✅ ${dName} made it — bid ${state.highBid}${pairNote}${ntNote}, took ${actual}. +${gp}${stakeNote}.`
    : `❌ ${dName} fell short — bid ${state.highBid}${pairNote}${ntNote}, took ${actual}. −${gp}${stakeNote}.`;
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
  // Move-log capture (AI-feedback): Single Hand result (±6, no tier/target).
  feedbackLog.logResult({
    biddingTeamPoints: state.tricksWonBy[declTeam], made: wonAll, tier: 'single-hand',
    gamePointsAwarded: wonAll ? 6 : -6, multiplier: 1,
    scoreAfter: [state.gameScore[0], state.gameScore[1]],
  });
  setPhase(PHASE.HAND_SCORING);
  const banner = (wonAll ? '🏆 ' : '💥 ') +
    `${seatName(state.declarer)} ${wonAll ? 'won all 8 — Single Hand made' : 'dropped a trick — Single Hand failed'}`;
  setStatus(banner);   // override any lingering "… is thinking…" status (Issue 9)
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
  // Cards-first: the compact panel shows the result; the full table is one tap away
  // (Scorecard button → #scorecard-panel) so the opened hands stay visible.
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

// Bidding actions are wired via humanBidAction()/humanRaise() (see the bidding engine).
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

// ── Play-by-play review + note-per-trick feedback (UI layer; data lives in feedback.js) ──
// Mid-play flagging was removed (it laid a card-blocking overlay over live play and felt stuck).
// The review opens only AFTER a hand concludes and steps through that hand's tricks; a note added
// while viewing a trick auto-anchors to it. The replay reads CORE state.tricks (enriched in
// resolveTrick), so it keeps working when feedback.js is later removed for production.
let reviewTrickIndex = 0;                          // 0-based cursor into state.tricks while open
let reviewNoteDraft  = { note: '', editingId: null };

function escHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function updateFlagBadge() {                       // #flag-count now counts this hand's notes
  const n = feedbackLog.flagCount();
  const el = document.getElementById('flag-count');
  if (el) { el.textContent = n; el.hidden = n === 0; }
}
function setReviewBtnEnabled(on) {
  const b = document.getElementById('review-btn');
  if (b) b.disabled = !on;
}
function reviewAvailable() {
  return state.phase === PHASE.HAND_SCORING && Array.isArray(state.tricks) && state.tricks.length > 0;
}

// Open / close the post-hand review (a bottom sheet that keeps the centre cards visible above it).
function onShowReview() {
  show('hand-result-panel', false);                // never stack the centred Hand Over card over the cards
  if (!reviewAvailable()) { setStatus('Finish a hand first — then step through its tricks.'); return; }
  reviewTrickIndex = 0;
  if (state.reviewMode !== 'original') { state.reviewMode = 'original'; for (let i = 0; i < 4; i++) renderHand(i); }
  renderReviewTrick(0);
  show('review-panel', true);
}
function onCloseReview() {
  reviewTrickIndex = -1;
  show('review-panel', false);
  clearReviewWinner();
  updateTrickArea();                               // restore the empty centre (currentTrick is [] at hand end)
}

// Paint one trick's cards into the centre slots and highlight the winning card + label.
function renderReviewTrick(i) {
  const tricks = state.tricks || [];
  if (!tricks.length) return;
  reviewTrickIndex = Math.max(0, Math.min(i, tricks.length - 1));
  const trick = tricks[reviewTrickIndex];
  reviewNoteDraft = { note: '', editingId: null };   // no draft bleed across tricks (the old trap)
  clearReviewWinner();
  for (let seat = 0; seat < 4; seat++) {
    const slot = document.getElementById(`trick-slot-${seat}`);
    if (slot) slot.innerHTML = '';
  }
  for (const p of trick.plays) {                     // length 3 in a Single Hand → sitting-out slot stays empty
    const slot = document.getElementById(`trick-slot-${p.seat}`);
    if (slot) slot.appendChild(createCardEl(p.card, true));
  }
  document.getElementById(`trick-slot-${trick.winner}`)?.classList.add('trick-winner');
  document.getElementById(`label-${trick.winner}`)?.classList.add('trick-winner');
  updateReviewIndicator();
  renderReviewNote();
}
function clearReviewWinner() {
  for (let seat = 0; seat < 4; seat++) {
    document.getElementById(`trick-slot-${seat}`)?.classList.remove('trick-winner');
    document.getElementById(`label-${seat}`)?.classList.remove('trick-winner');
  }
}
function onReviewPrev() { if (reviewTrickIndex > 0) renderReviewTrick(reviewTrickIndex - 1); }
function onReviewNext() { if (reviewTrickIndex < state.tricks.length - 1) renderReviewTrick(reviewTrickIndex + 1); }
function updateReviewIndicator() {
  const n = state.tricks.length;
  const t = state.tricks[reviewTrickIndex];
  setText('review-count', `Trick ${reviewTrickIndex + 1} / ${n}`);
  const prev = document.getElementById('review-prev');
  const next = document.getElementById('review-next');
  if (prev) prev.disabled = reviewTrickIndex <= 0;
  if (next) next.disabled = reviewTrickIndex >= n - 1;
  setText('review-meta', t ? `${seatName(t.winner)} wins (+${t.points})` : '');
}

// Note-per-trick: the note anchors to the trick currently in view.
function renderReviewNote() {
  const body = document.getElementById('review-note-body');
  if (!body) return;
  const anchor = reviewTrickIndex + 1;
  const all = feedbackLog.getFlags();
  const list = all.length ? all.map(f => `
      <div class="note-row">
        <span class="note-row-t">T${f.anchorTrick}</span>
        <span class="note-row-text">${escHtml(f.note)}</span>
        <button class="note-mini" onclick="onEditReviewNote('${f.id}')">Edit</button>
        <button class="note-mini note-del" onclick="onDeleteReviewNote('${f.id}')">✕</button>
      </div>`).join('') : '<div class="note-empty">No notes yet this hand.</div>';
  body.innerHTML = `
    <div class="note-line">
      <span class="note-lbl">Note · Trick ${anchor}</span>
      <span class="note-sub">Hand ${feedbackLog.getHandNumber() ?? '–'} · ${all.length} note${all.length === 1 ? '' : 's'}</span>
    </div>
    <textarea id="review-note" class="note-ta" placeholder="What happened in this trick?">${escHtml(reviewNoteDraft.note)}</textarea>
    <div class="bid-actions">
      <button class="btn btn-primary" onclick="onSaveReviewNote()">${reviewNoteDraft.editingId ? 'Update' : 'Save note'}</button>
      <button class="btn btn-secondary" onclick="onClearReviewNote()">Clear</button>
      <button class="btn btn-secondary" onclick="onExportFeedback()">⬇ Export (hand ${feedbackLog.getHandNumber() ?? '–'})</button>
    </div>
    <div class="note-list">${list}</div>`;
}
function syncReviewNote() {
  const ta = document.getElementById('review-note');
  if (ta) reviewNoteDraft.note = ta.value;
}
function onSaveReviewNote() {
  syncReviewNote();
  const text = reviewNoteDraft.note.trim();
  if (!text) { document.getElementById('review-note')?.classList.add('note-need'); return; }
  const anchor = reviewTrickIndex + 1;
  if (reviewNoteDraft.editingId) {
    feedbackLog.updateFlag(reviewNoteDraft.editingId, { anchorTrick: anchor, relatedTricks: [], note: text });
  } else {
    feedbackLog.addFlag({ anchorTrick: anchor, relatedTricks: [], note: text });
  }
  reviewNoteDraft = { note: '', editingId: null };
  updateFlagBadge();
  renderReviewNote();
}
function onClearReviewNote() { reviewNoteDraft = { note: '', editingId: null }; renderReviewNote(); }
function onEditReviewNote(id) {
  const f = feedbackLog.getFlags().find(x => x.id === id);
  if (!f) return;
  if (typeof f.anchorTrick === 'number' && state.tricks[f.anchorTrick - 1]) {
    renderReviewTrick(f.anchorTrick - 1);          // snap the viewer to the note's trick…
  }
  reviewNoteDraft = { note: f.note, editingId: id };   // …then set the draft (renderReviewTrick reset it)
  renderReviewNote();
}
function onDeleteReviewNote(id) {
  feedbackLog.deleteFlag(id);
  if (reviewNoteDraft.editingId === id) reviewNoteDraft = { note: '', editingId: null };
  updateFlagBadge();
  renderReviewNote();
}

// Export one self-contained JSON file for this hand (Blob download).
function onExportFeedback() {
  if (!feedbackLog.hasHand()) { setStatus('Nothing to export yet.'); return; }
  const data = feedbackLog.buildExport();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `29-feedback-hand-${feedbackLog.getHandNumber()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  showToast('📄 Feedback file downloaded.');
}

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

// ── Responsive scaling ─────────────────────────────────────────────────────────

// Landscape: scale the fixed 800×600 table to fit (preserve aspect ratio).
// Portrait/narrow: clear the transform — the @media portrait layout fills the viewport.
function fitToViewport() {
  const root = document.getElementById('game-root');
  if (!root) return;
  if (window.innerWidth / window.innerHeight < 1.1) {
    root.style.transform = 'none';
  } else {
    const s = Math.min(window.innerWidth / 800, window.innerHeight / 600);
    root.style.transform = `translate(-50%,-50%) scale(${s})`;
  }
}
window.addEventListener('resize', fitToViewport);

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => { fitToViewport(); updateCardStyleBtn(); startMatch(); });
