// ── AI: Bidding ───────────────────────────────────────────────────────────────

/**
 * The maximum bid this hand justifies — the most the AI will commit to.
 * Used by the holder-match auction: as a challenger the AI raises while
 * `value > currentBid`; as the holder it matches while `value >= currentBid`.
 * (A weak hand returns < 16 and so never challenges; opener is forced separately.)
 */
function aiBidValue(hand) {
  const totalHandPts = hand.reduce((s, c) => s + POINT_VALUE[c.rank], 0);

  // Trump control bonus per suit: J+9 = 1.5, J alone = 0.5, +0.5 per card beyond 2.
  let trumpBonus = 0;
  for (const suit of SUITS) {
    const sc   = hand.filter(c => c.suit === suit);
    const hasJ = sc.some(c => c.rank === 'J');
    const has9 = sc.some(c => c.rank === '9');
    let suitBonus = hasJ && has9 ? 1.5 : hasJ ? 0.5 : 0;
    suitBonus += Math.max(0, sc.length - 2) * 0.5;
    trumpBonus = Math.max(trumpBonus, suitBonus);
  }

  // own points + conservative partner estimate (7.5) + trump control, capped at 22.
  return Math.min(Math.floor(totalHandPts + 7.5 + trumpBonus), 22);
}

// ── AI: Single Hand declaration (§9) ───────────────────────────────────────────

/**
 * Declare Single Hand only with a near-unbeatable hand: a suit holding both the
 * Jack and Nine, a very strong point count, and several top cards overall.
 * Winning all 8 tricks solo is hard, so this stays rare.
 */
function aiShouldSingleHand(hand) {
  if (!hand || hand.length < 8) return false;
  // Winning all 8 tricks alone (1-v-2) needs a monster: a suit with BOTH the Jack and
  // Nine AND at least 5 cards (dominant trump control), a top-heavy hand, and high points.
  const dominantTrump = SUITS.some(s => {
    const sc = hand.filter(c => c.suit === s);
    return sc.length >= 5 && sc.some(c => c.rank === 'J') && sc.some(c => c.rank === '9');
  });
  const handPts  = hand.reduce((sum, c) => sum + POINT_VALUE[c.rank], 0);
  const topCards = hand.filter(c => ['J', '9', 'A', '10'].includes(c.rank)).length;
  return dominantTrump && handPts >= 11 && topCards >= 6;
}

// ── AI: Double / Redouble (§7) ─────────────────────────────────────────────────

/**
 * A defender doubles when the contract looks ambitious (high bid) and this
 * defender holds enough point-strength to help hold the bidders short.
 * Deliberately conservative — doubling is the exception, not the rule.
 */
function aiShouldDouble(hand, bid) {
  if (!hand || !hand.length) return false;
  const handPts = hand.reduce((s, c) => s + POINT_VALUE[c.rank], 0);
  return bid >= 20 && handPts >= 6;
}

/**
 * The declarer redoubles only with a dominant hand — at least two of the top
 * trumps (J/9) in the chosen suit (or 3+ J/9 overall in No Trump). Very rare.
 */
function aiShouldRedouble(hand, trumpSuit) {
  if (!hand || !hand.length) return false;
  if (trumpSuit) {
    const t = hand.filter(c => c.suit === trumpSuit);
    return t.filter(c => c.rank === 'J' || c.rank === '9').length >= 2;
  }
  return hand.filter(c => c.rank === 'J' || c.rank === '9').length >= 3;
}

// ── AI: Trump selection ───────────────────────────────────────────────────────

/**
 * Choose the trump suit that gives maximum control.
 * Prefer suits with a Jack; break ties by overall rank sum.
 */
function aiChooseTrump(hand) {
  let best = null, bestScore = -1;
  for (const suit of SUITS) {
    const cards = hand.filter(c => c.suit === suit);
    const hasJack = cards.some(c => c.rank === 'J');
    const rankSum = cards.reduce((s, c) => s + RANK_ORDER[c.rank], 0);
    const score = rankSum + (hasJack ? 20 : 0);
    if (score > bestScore) { bestScore = score; best = suit; }
  }
  return best;
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
 * Can't follow suit — choose to trump or discard.
 */
function aiDiscard(hand, trick, trumpSuit, seatIndex) {
  const partnerIndex = (seatIndex + 2) % 4;
  const currentWinner = trickCurrentWinner(trick, trumpSuit);
  const partnerWinning = currentWinner === partnerIndex;

  if (partnerWinning) {
    // Partner winning — discard lowest non-point card, or lowest overall
    return safeDiscard(hand);
  }

  // Try to trump to win
  if (trumpSuit) {
    const trumpCards = hand.filter(c => c.suit === trumpSuit);
    const ledSuit = trick[0].card.suit;
    const winning = trumpCards.filter(c => trickBeatsAll(c, trick, ledSuit, trumpSuit));
    if (winning.length) return lowestCard(winning);
  }

  // No winning trump or no trump — discard safest card
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
