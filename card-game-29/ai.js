// ── AI: Bidding ───────────────────────────────────────────────────────────────

/**
 * Estimate how many points the hand can win and return a bid or 0 (pass).
 * `currentHighBid` is the current auction high (or 15 if no bids yet).
 */
function aiBid(hand, currentHighBid) {
  const totalHandPts = hand.reduce((s, c) => s + POINT_VALUE[c.rank], 0);

  // For each possible trump suit, compute a control bonus:
  //   J+9 of same suit = 1.5 (strong control — both high trumps)
  //   J alone          = 0.5 (moderate control)
  //   +0.5 per card beyond 2 in the suit (length = additional tricks)
  let trumpBonus = 0;
  for (const suit of SUITS) {
    const sc    = hand.filter(c => c.suit === suit);
    const hasJ  = sc.some(c => c.rank === 'J');
    const has9  = sc.some(c => c.rank === '9');
    let suitBonus = hasJ && has9 ? 1.5 : hasJ ? 0.5 : 0;
    suitBonus += Math.max(0, sc.length - 2) * 0.5;
    trumpBonus = Math.max(trumpBonus, suitBonus);
  }

  // Confidence = own hand points + conservative partner estimate (7.5)
  // + trump control bonus. Cap bid at 22 regardless of hand.
  const confidenceBid = totalHandPts + 7.5 + trumpBonus;

  if (confidenceBid > currentHighBid && confidenceBid >= MIN_BID) {
    return Math.min(currentHighBid + 1, Math.min(Math.floor(confidenceBid), 22));
  }
  return 0; // pass
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

/** Leading a trick: lead the highest card in the strongest (most-points) suit */
function aiLead(hand, trumpSuit) {
  if (!hand || hand.length === 0) return null;
  // Rank suits by total point value held
  let bestSuit = null, bestPts = -1;
  for (const suit of SUITS) {
    const cards = hand.filter(c => c.suit === suit);
    const pts = cards.reduce((s, c) => s + POINT_VALUE[c.rank] + RANK_ORDER[c.rank] * 0.1, 0);
    if (pts > bestPts) { bestPts = pts; bestSuit = suit; }
  }
  const suitCards = hand.filter(c => c.suit === bestSuit);
  if (!suitCards.length) return hand[0]; // fallback
  // Lead highest card of that suit
  return suitCards.reduce((best, c) => RANK_ORDER[c.rank] > RANK_ORDER[best.rank] ? c : best);
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
