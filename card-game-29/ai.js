// ── Championship AI tuning (see 29 Championship AI and Mechanics Spec.md) ──────
//
// Calibration constants live here so future Monte-Carlo tuning is a single-place edit.
// All numbers are "directional, not exact" — refined against ~60k-deal simulations of
// the holder-match variant, expected to drift with stronger agents.
const AI_TUNING = {
  bid: {                                   // C2 — bidding ceiling table
    weakCeiling: 16,                       // <6 pts → don't raise past 16
    midBand:    { ptsMin:6,  ptsMax:9,  ceilingLo:17, ceilingHi:19 },  // needs 4-card suit
    strongBand: { ptsMin:10, ptsMax:11, ceiling:20 },                  // needs 4-card suit
    veryStrong: { ptsMin:12,            ceilingLo:21, ceilingHi:22 },  // needs 4-card suit
    fiveSuitBonus:   2,                    // +2 to band ceiling if a 5+ card suit
    perTrumpHonour:  1,                    // +1 per J/9 in the chosen trump candidate
    hardCap:        22,                    // never auto-bid past 22 — 28/29 only on a near-lock
  },
  partner:  { supportPtsMin: 10, takeoverSuitMin: 4, supportMax: 20 },   // C2 partner rule
  singleHand: { longTrumpMin: 6, midTrumpMin: 5, outsideAcesMin: 2 },  // C9
  scoreLean:  { ahead: 5, behind: -5, ceilingShift: 1 },  // C12 — ±1 to ceilings near ±5
};

// Team layout matches game.js: team 0 = N–S (seats 0,2), team 1 = E–W (seats 1,3).
const _teamOf = (seat) => seat & 1;
const _samePartnership = (a, b) => _teamOf(a) === _teamOf(b);

// ── C1 — Hand evaluation primitives ────────────────────────────────────────────

function handPoints(hand) { return hand.reduce((s, c) => s + POINT_VALUE[c.rank], 0); }
function cardsInSuit(hand, suit) { return hand.filter(c => c.suit === suit); }
function honoursInSuit(sc) {       // count of J / 9 (the "boss cards")
  return (sc.some(c => c.rank === 'J') ? 1 : 0) + (sc.some(c => c.rank === '9') ? 1 : 0);
}

// The suit the AI would name as trump if it won the bid (C3): longest suit; tie-break
// by honours (J/9 count), then by points held in the suit.
function preferredTrumpSuit(hand) {
  let best = null, bestKey = [-1, -1, -1];
  for (const suit of SUITS) {
    const sc = cardsInSuit(hand, suit);
    const key = [sc.length, honoursInSuit(sc), sc.reduce((s, c) => s + POINT_VALUE[c.rank], 0)];
    if (!best || key[0] > bestKey[0]
              || (key[0] === bestKey[0] && key[1] > bestKey[1])
              || (key[0] === bestKey[0] && key[1] === bestKey[1] && key[2] > bestKey[2])) {
      best = suit; bestKey = key;
    }
  }
  return best;
}

// ── C2 — Bidding value (ceiling for this hand) ─────────────────────────────────

/**
 * The maximum bid this hand justifies, per the C2 ceiling table. As a challenger
 * the AI raises while `value > currentBid`; as the holder it matches while
 * `value >= currentBid`. Returns < 16 (typically 0) for hands that should pass.
 *
 * Optional `lean` shifts the ceiling by ±1 — used by score-awareness (C12) and
 * by the partner rule (C2) to express "support raise: bid +1 once, then pass".
 */
function aiBidValue(hand, lean) {
  if (!hand || !hand.length) return 0;
  const pts = handPoints(hand);
  const cand = preferredTrumpSuit(hand);
  const sc   = cand ? cardsInSuit(hand, cand) : [];
  const suitLen = sc.length;
  const honours = honoursInSuit(sc);
  const T = AI_TUNING.bid;

  let ceiling;
  if (pts < T.midBand.ptsMin)            ceiling = T.weakCeiling;                   // <6 pts → 16
  else if (suitLen < 4)                  ceiling = T.weakCeiling;                   // no 4-card suit → 16 only
  else if (pts <= T.midBand.ptsMax)      ceiling = T.midBand.ceilingLo + Math.min(pts - T.midBand.ptsMin, T.midBand.ceilingHi - T.midBand.ceilingLo);
  else if (pts <= T.strongBand.ptsMax)   ceiling = T.strongBand.ceiling;            // 10–11 + 4-suit → 20
  else                                   ceiling = T.veryStrong.ceilingLo +         // 12+ + 4-suit → 21–22
                                          Math.min(Math.floor((pts - T.veryStrong.ptsMin) / 2), T.veryStrong.ceilingHi - T.veryStrong.ceilingLo);

  if (suitLen >= 5) ceiling += T.fiveSuitBonus;          // +2 for a 5+ card suit
  ceiling += honours * T.perTrumpHonour;                  // +1 per J/9 of the trump candidate
  ceiling = Math.min(ceiling, T.hardCap);                 // hard 22 cap
  ceiling += (lean || 0);                                  // C12 score-lean + C2 support-raise
  return Math.max(0, ceiling);
}

/**
 * The C2 partner rule — the bid ceiling when the current holder is the AI's partner.
 * Default is PASS (return 0). The AI escalates against its own side only with ≥10
 * card points (suit length alone is not a reason — sim: a long side-suit adds ~0):
 *   • Take-over (≥10 pts AND a 4+ suit headed by J/9) → full `aiBidValue`, so the AI
 *     can out-bid past the support band and name its own trump.
 *   • Support-raise (≥10 pts, no take-over suit) → a bounded modest ceiling (≤ supportMax),
 *     so the duel terminates and the ORIGINAL declarer keeps trump (per spec C2).
 * Returning a *ceiling* (not currentBid+1) lets the existing `value > cb` raise loop
 * bound the escalation: the AI raises +1 per round until cb hits the ceiling, then passes.
 */
function aiBidValueAgainstHolder(hand, holder, seat, gameScore) {
  const lean = _scoreLean(seat, gameScore);
  const base = aiBidValue(hand, lean);
  if (holder === null || !_samePartnership(holder, seat)) return base;   // normal opponent

  // Partner is holder — C2 partner rule.
  const pts = handPoints(hand);
  if (pts < AI_TUNING.partner.supportPtsMin) return 0;     // <10 pts → PASS (support is silent)
  const takeover = SUITS.some(s => {
    const sc = cardsInSuit(hand, s);
    return sc.length >= AI_TUNING.partner.takeoverSuitMin
        && sc.some(c => c.rank === 'J' || c.rank === '9');
  });
  if (takeover) return base;                                // full value — out-bid to take over
  // Support-raise: claim a modestly higher level, bounded so the declarer retains trump.
  return Math.min(supportCeiling(pts) + lean, AI_TUNING.partner.supportMax);
}

// Points-only support ceiling (suit length deliberately ignored, per C2). 10–11 → 18,
// 12–13 → 19, 14+ → 20 — never past the ±1 tier for a mere supporter.
function supportCeiling(pts) {
  if (pts >= 14) return 20;
  if (pts >= 12) return 19;
  return 18;
}

// C12 — score lean. Near +5 → bid more conservatively (−1); near −5 → aggressively (+1).
function _scoreLean(seat, gameScore) {
  if (!gameScore) return 0;
  const mine = gameScore[_teamOf(seat)] || 0;
  if (mine >= AI_TUNING.scoreLean.ahead)  return -AI_TUNING.scoreLean.ceilingShift;
  if (mine <= AI_TUNING.scoreLean.behind) return +AI_TUNING.scoreLean.ceilingShift;
  return 0;
}

// ── C9 — Single Hand declaration ───────────────────────────────────────────────

/**
 * Declare Single Hand only on a near-lock hand:
 *   (a) a 6+ trump suit headed by BOTH J and 9, or
 *   (b) 5 top trumps (J, 9, A) + ≥2 outside aces.
 * Score-lean (C12): relax/tighten by one honour when behind/ahead.
 */
function aiShouldSingleHand(hand, seat, gameScore) {
  if (!hand || hand.length < 8) return false;
  const T = AI_TUNING.singleHand;
  const lean = _scoreLean(seat, gameScore);     // +1 behind → easier, −1 ahead → harder
  for (const suit of SUITS) {
    const sc = cardsInSuit(hand, suit);
    const hasJ = sc.some(c => c.rank === 'J');
    const has9 = sc.some(c => c.rank === '9');
    const hasA = sc.some(c => c.rank === 'A');
    // (a) Long J+9 trump suit (behind → need one fewer; ahead → need one more)
    if (sc.length >= T.longTrumpMin - lean && hasJ && has9) return true;
    // (b) 5 solid top trumps (J, 9, A) + outside aces (lean shifts the ace requirement)
    if (sc.length >= T.midTrumpMin && hasJ && has9 && hasA) {
      const outsideAces = SUITS.filter(s => s !== suit)
        .filter(s => cardsInSuit(hand, s).some(c => c.rank === 'A')).length;
      if (outsideAces >= T.outsideAcesMin - lean) return true;
    }
  }
  return false;
}

// ── Double / Redouble (currently flag-off; behaviour kept for when re-enabled) ──

function aiShouldDouble(hand, bid) {
  if (!hand || !hand.length) return false;
  return bid >= 20 && handPoints(hand) >= 6;
}
function aiShouldRedouble(hand, trumpSuit) {
  if (!hand || !hand.length) return false;
  if (trumpSuit) {
    return cardsInSuit(hand, trumpSuit).filter(c => c.rank === 'J' || c.rank === '9').length >= 2;
  }
  return hand.filter(c => c.rank === 'J' || c.rank === '9').length >= 3;
}

// ── C3 — Trump selection ───────────────────────────────────────────────────────

/**
 * Name your longest suit; tie-break by most honours (J/9), then by points held in
 * the suit. (The named suit must be one the AI holds, which `preferredTrumpSuit`
 * guarantees because the hand has 8 cards across at most 4 suits.)
 */
function aiChooseTrump(hand) { return preferredTrumpSuit(hand); }

// ── C4 — Reveal-to-ruff decision ───────────────────────────────────────────────

/**
 * Should the AI reveal trump (the void-player ruff)? Conscious, never automatic
 * — the AI never reveals just because it is void. Reveal only when:
 *   • the trick is worth taking (point-rich enough), AND
 *   • the AI is *likely* to hold trump (the declarer always knows; others gamble), AND
 *   • revealing doesn't waste a trump over a partner already winning (C8).
 *
 *   seat        — AI seat acting
 *   hand        — AI's remaining cards
 *   trick       — cards played so far this trick (≥ 1)
 *   declarer    — the contract holder (knows their own trump suit)
 *   knownTrump  — null for non-declarer; the trump suit for the declarer
 */
function aiShouldReveal(seat, hand, trick, declarer, knownTrump) {
  if (!trick || !trick.length) return false;
  // C8 short-circuit: never reveal-and-ruff over a partner already winning.
  const ledSuit = trick[0].card.suit;
  const winner  = trickCurrentWinner(trick, null);   // pre-reveal, no trump active
  if (winner !== null && _samePartnership(winner, seat)) return false;

  // Trick value: points already in the pot + the (unknown) cards yet to fall. Use
  // points-on-the-table as a lower bound — only reveal if it's worth a trump.
  const trickPts = trick.reduce((s, t) => s + POINT_VALUE[t.card.rank], 0);
  const worthIt  = trickPts >= 2;   // at least a 9, an A+10, or two A/10 cards

  if (seat === declarer) {
    // Bidder knows the trump suit and whether they hold it.
    return worthIt && hand.some(c => c.suit === knownTrump);
  }
  // Non-bidder: gamble. With 7 unseen suits (excluding led), trump is one of 3 candidates;
  // estimate p(hand contains trump in some non-led suit) by counting how many of the AI's
  // own non-led suits are present (longer holdings → more likely to include trump).
  const nonLed = hand.filter(c => c.suit !== ledSuit);
  if (!nonLed.length) return false;                            // nothing to ruff with
  const honoursNonLed = nonLed.filter(c => c.rank === 'J' || c.rank === '9').length;
  // Reveal only if the trick is worth it AND the AI has at least one J/9 across non-led
  // suits — a non-trivial top card to ruff with.
  return worthIt && honoursNonLed >= 1;
}

// ── AI: Card play ─────────────────────────────────────────────────────────────

/**
 * Decide which card the AI at `seatIndex` should play.
 *
 * `trick`      — array of { playerIndex, card } played so far (may be empty if leading)
 * `hand`       — AI's current hand
 * `trumpSuit`  — null if hidden, string if revealed
 * `declarerIndex` — who holds trump knowledge (for "call for trump" logic)
 * `seatIndex`  — this AI's seat (0-3)
 */
function aiPlayCard(hand, trick, trumpSuit, declarerIndex, seatIndex) {
  const isLeading = trick.length === 0;

  if (isLeading) {
    return aiLead(hand, trumpSuit);
  }

  const ledSuit = trick[0].card.suit;
  const legal = legalPlays(hand, ledSuit);
  const canFollow = legal.some(c => c.suit === ledSuit);

  if (canFollow) {
    return aiFollowSuit(legal.filter(c => c.suit === ledSuit), trick, trumpSuit, ledSuit, seatIndex);
  } else {
    return aiDiscard(hand, trick, trumpSuit, seatIndex);
  }
}

/**
 * Leading a trick (soft heuristic — not a hard rule):
 *  1. If we hold a Jack in a non-trump suit, lead it — it wins the trick and pulls points.
 *  2. Otherwise lead a LOW zero-point card (7/8/Q/K), preferring a non-trump suit, so we
 *     don't expose a valuable 9 / A / 10 to capture. Because the 9 is the highest-ranked
 *     of these, "lowest rank" never selects a bare 9 unless it is literally the only card.
 *  3. Trumps are led only when nothing else is left.
 */
function aiLead(hand, trumpSuit) {
  if (!hand || hand.length === 0) return null;
  const inSuit = (suit) => hand.filter(c => c.suit === suit);

  // 1) Lead a Jack we hold in a non-trump suit (prefer the longest such suit for follow-up).
  const jackSuits = SUITS.filter(s => s !== trumpSuit && inSuit(s).some(c => c.rank === 'J'));
  if (jackSuits.length) {
    jackSuits.sort((a, b) => inSuit(b).length - inSuit(a).length);
    return inSuit(jackSuits[0]).find(c => c.rank === 'J');
  }

  // 2) Lead the lowest zero-point card, preferring non-trump.
  const lowestZero = (cards) => {
    const zero = cards.filter(c => POINT_VALUE[c.rank] === 0);
    const pool = zero.length ? zero : cards;
    return pool.reduce((lo, c) => RANK_ORDER[c.rank] < RANK_ORDER[lo.rank] ? c : lo);
  };
  const nonTrump = hand.filter(c => c.suit !== trumpSuit);
  return lowestZero(nonTrump.length ? nonTrump : hand);
}

/**
 * Must follow suit. Decide whether to try to win or dump.
 */
function aiFollowSuit(following, trick, trumpSuit, ledSuit, seatIndex) {
  const currentWinner = trickCurrentWinner(trick, trumpSuit);
  const partnerIndex = (seatIndex + 2) % 4;
  const partnerWinning = currentWinner === partnerIndex;

  if (partnerWinning) {
    // Partner is winning — dump the lowest card to save good cards
    return lowestCard(following);
  }

  // Try to win with lowest winning card
  const winning = following.filter(c => trickBeatsAll(c, trick, ledSuit, trumpSuit));
  if (winning.length) return lowestCard(winning);

  // Can't win — dump lowest
  return lowestCard(following);
}

/**
 * Can't follow suit — choose to trump or discard. The C8 overtake rule gates any
 * trumping: the AI never trumps a trick its partner is already winning except in
 * very narrow conditions (currently: "forced" — only trumps in hand).
 */
function aiDiscard(hand, trick, trumpSuit, seatIndex) {
  const currentWinner = trickCurrentWinner(trick, trumpSuit);
  const partnerWinning = currentWinner !== null && _samePartnership(currentWinner, seatIndex);

  // Partner already winning → never overtake with a trump (C8 default).
  if (partnerWinning) {
    const onlyTrumps = trumpSuit && hand.every(c => c.suit === trumpSuit);
    if (onlyTrumps) return lowestCard(hand);   // forced — play the lowest trump
    return safeDiscard(hand);
  }

  // Try to trump to win — only if trump is active (caller passes null when concealed).
  if (trumpSuit) {
    const trumpCards = hand.filter(c => c.suit === trumpSuit);
    const ledSuit = trick[0].card.suit;
    const winning = trumpCards.filter(c => trickBeatsAll(c, trick, ledSuit, trumpSuit));
    if (winning.length) return lowestCard(winning);
  }

  return safeDiscard(hand);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function trickCurrentWinner(trick, trumpSuit) {
  if (!trick.length) return null;
  const ledSuit = trick[0].card.suit;
  let best = trick[0];
  for (let i = 1; i < trick.length; i++) {
    if (cardBeats(trick[i].card, best.card, ledSuit, trumpSuit)) best = trick[i];
  }
  return best.playerIndex;
}

function trickBeatsAll(card, trick, ledSuit, trumpSuit) {
  for (const played of trick) {
    if (!cardBeats(card, played.card, ledSuit, trumpSuit)) return false;
  }
  return true;
}

function lowestCard(cards) {
  if (!cards || cards.length === 0) return null;
  return cards.reduce((low, c) =>
    RANK_ORDER[c.rank] < RANK_ORDER[low.rank] ? c : low
  );
}

function highestCard(cards) {
  if (!cards || cards.length === 0) return null;
  return cards.reduce((high, c) =>
    RANK_ORDER[c.rank] > RANK_ORDER[high.rank] ? c : high
  );
}

/** Discard lowest-point card; prefer zero-point cards */
function safeDiscard(hand) {
  const zeroPt = hand.filter(c => POINT_VALUE[c.rank] === 0);
  return lowestCard(zeroPt.length ? zeroPt : hand);
}

// ── Claim solver (§8) ───────────────────────────────────────────────────────────

/**
 * Double-dummy adjudication of a SOLO claim: returns true iff the single seat
 * `claimSeat` can win EVERY remaining trick *by itself* against the best play of
 * all three other seats (including its own partner — you can never claim tricks
 * your partner's cards would win). Full knowledge of all hands (engine knows the
 * concealed trump).
 *
 *   hands        — array[seat] = remaining cards for that seat
 *   currentTrick — cards already played in the in-progress trick
 *   toPlay       — seat to move next
 *   trumpSuit    — active trump (null for No Trump)
 *   claimSeat    — the lone claimant seat (0-3)
 *   seatsInPlay  — active seats this hand (3 in Single Hand, else 4)
 *
 * Hard pruning (any trick the claimant doesn't personally win fails the line),
 * capped at MAX_NODES; on the cap it conservatively returns false.
 */
function claimHolds(hands, currentTrick, toPlay, trumpSuit, claimSeat, seatsInPlay) {
  const numSeats   = seatsInPlay.length;
  const nextInPlay = (s) => seatsInPlay[(seatsInPlay.indexOf(s) + 1) % numSeats];
  const MAX_NODES  = 200000;
  let nodes = 0;

  function rec(hs, trick, seat) {
    if (++nodes > MAX_NODES) return { capped: true, ok: false };

    if (trick.length === numSeats) {
      const winner = trickWinner(trick, trumpSuit);
      if (winner !== claimSeat) return { ok: false };   // claimant must win it personally
      const remaining = seatsInPlay.reduce((n, s) => n + hs[s].length, 0);
      if (remaining === 0) return { ok: true };
      return rec(hs, [], winner);
    }

    const led        = trick.length ? trick[0].card.suit : null;
    const legal      = legalPlays(hs[seat], led);
    const maximizing = seat === claimSeat;   // only the claimant tries to win

    for (const card of legal) {
      const hs2 = hs.slice();
      hs2[seat] = hs[seat].filter(c => !sameCard(c, card));
      const res = rec(hs2, trick.concat([{ playerIndex: seat, card }]), nextInPlay(seat));
      if (res.capped) return res;
      if (maximizing && res.ok)  return { ok: true };    // claimant has a winning line
      if (!maximizing && !res.ok) return { ok: false };  // someone else can break it
    }
    return { ok: !maximizing };
  }

  return rec(hands, currentTrick.slice(), toPlay).ok;
}
