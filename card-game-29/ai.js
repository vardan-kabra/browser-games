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
    marriageBonus:   1,                    // +1 if the trump candidate holds K+Q (a marriage, ±4 target)
    shapeStackPtsMin: 8,                   // below this, cap the (5-suit + honour) shape stack at +2
    hardCap:        22,                    // never auto-bid past 22 — 28/29 only on a near-lock
  },
  partner:  { supportPtsMin: 10, takeoverSuitMin: 4, supportMax: 20 },   // C2 partner rule
  singleHand: { longTrumpMin: 6, midTrumpMin: 5, outsideAcesMin: 2 },  // C9
  scoreLean:  { ahead: 5, behind: -5, ceilingShift: 1 },  // C12 — ±1 to ceilings near ±5
  play: { nt: { establishMin: 4, establishStrong: 5, declarerLengthMin: 2, reentryKeep: 1 } },  // #3 — No-Trump play
  reveal: { endgameMax: 3 },  // #2 — defenders relax the reveal-to-ruff bars in the last few tricks
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

  // A 3-card suit headed by a J/9 plus an A or K (e.g. J-9-A, J-9-K, J-A) plays like a
  // short trump — strong enough to bid on, so it isn't dumped to the weakCeiling by the
  // 4-card gate. It's still weaker than a real 4-card suit, so it caps one tier lower.
  const strong3 = suitLen === 3 && honours >= 1 && sc.some(c => c.rank === 'A' || c.rank === 'K');

  let ceiling;
  if (pts < T.midBand.ptsMin)            ceiling = T.weakCeiling;                   // <6 pts → 16
  else if (suitLen < 4 && !strong3)      ceiling = T.weakCeiling;                   // no 4-card / strong-3 suit → 16
  else if (pts <= T.midBand.ptsMax)      ceiling = T.midBand.ceilingLo + Math.min(pts - T.midBand.ptsMin, T.midBand.ceilingHi - T.midBand.ceilingLo);
  else if (pts <= T.strongBand.ptsMax)   ceiling = strong3 ? T.midBand.ceilingHi : T.strongBand.ceiling;   // 10–11: 4-suit→20, strong-3→19
  else                                   ceiling = strong3 ? T.midBand.ceilingHi   // 12+: strong-3 caps at 19
                                          : T.veryStrong.ceilingLo + Math.min(Math.floor((pts - T.veryStrong.ptsMin) / 2), T.veryStrong.ceilingHi - T.veryStrong.ceilingLo);

  // Shape bonuses (5-card length + J/9 honours). On thin hands (<8 pts) cap the stack at +2
  // so a shapely 7-pointer can't ride length+J9 all the way to the 22 cap.
  if (pts >= T.midBand.ptsMin) {
    let shape = (suitLen >= 5 ? T.fiveSuitBonus : 0) + honours * T.perTrumpHonour;
    if (pts < T.shapeStackPtsMin) shape = Math.min(shape, 2);
    ceiling += shape;
  }
  // Marriage (K+Q of the trump candidate) shifts the target ±4 — give it a small bump.
  if (sc.some(c => c.rank === 'K') && sc.some(c => c.rank === 'Q')) ceiling += T.marriageBonus;

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
  // Non-bidder: a DISCOVERY gamble decided ONLY from our own hand — we never read the real trump
  // (only the bidder knows it). The proxy for "do I likely hold a trump to ruff with?" is a high card
  // in some non-led suit (the trump turns out to be one of those suits often enough to gamble on).
  // NOTE: the old `!ledIsTrump` god-mode gate in doAIPlay was removed — if the led suit happens to BE
  // the trump, the AI reveals, finds itself void in trump, and discards (the fair cost of the gamble).
  const nonLed = hand.filter(c => c.suit !== ledSuit);
  if (!nonLed.length) return false;                            // nothing to ruff with in any suit
  const honoursNonLed = nonLed.filter(c => c.rank === 'J' || c.rank === '9').length;
  const aceNonLed     = nonLed.some(c => c.rank === 'A');
  if (!honoursNonLed && !aceNonLed) return false;              // no plausible ruffer → don't gamble

  // Whose trump do we wake? On the BIDDER'S SIDE (declarer or its partner) the revealed trump is our
  // own — cheap, and it can enable our partner's marriage — so we reveal to ruff an opponent's trick
  // readily, counting a still-DEVELOPING trick (seats yet to act will add cards/points) as worth it.
  // A DEFENDER wakes the bidder's trump for everyone (costly), so it keeps the conservative bars.
  const declaringSide = declarer != null && _samePartnership(seat, declarer);
  const developing    = trick.length < 3;                      // 4-player trick; reveal never fires in Single Hand

  if (declaringSide) {
    if (honoursNonLed >= 1) return worthIt || developing;      // strong ruffer: worth-it OR still-growing
    return worthIt;                                            // bare Ace: only a worth-it trick
  }
  // Defender: wakes the bidder's trump for everyone (costly), so keeps the conservative #6 bars — J/9 →
  // worth-it; bare Ace → a richer ≥3-pt trick. EXCEPT in the ENDGAME (few cards left, #2): waking trump
  // then costs little (little hand left for the declarer to exploit it), so relax — J/9 → worth-it OR
  // developing, bare Ace → worth-it. (Hand 14: West, void with bare aces on a developing 2-pt trick at
  // trick 6, should ruff.)
  const endgame = hand.length <= AI_TUNING.reveal.endgameMax;
  if (honoursNonLed >= 1) return endgame ? (worthIt || developing) : worthIt;
  return endgame ? worthIt : (trickPts >= 3);
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
 * `seen`       — optional card-tracking { played:Set<cardKey>, toActAfter:[seats], declarerTrump }
 *                supplied by game.js. When omitted (null), all enhanced branches are skipped and
 *                the function behaves exactly as the original (kept for purity + regression tests).
 */
function aiPlayCard(hand, trick, trumpSuit, declarerIndex, seatIndex, seen = null) {
  const isLeading = trick.length === 0;

  if (isLeading) {
    return aiLead(hand, trumpSuit, seen);
  }

  const ledSuit = trick[0].card.suit;
  const legal = legalPlays(hand, ledSuit);
  const canFollow = legal.some(c => c.suit === ledSuit);

  if (canFollow) {
    return aiFollowSuit(legal.filter(c => c.suit === ledSuit), trick, trumpSuit, ledSuit, seatIndex, seen);
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
function aiLead(hand, trumpSuit, seen = null) {
  if (!hand || hand.length === 0) return null;
  const inSuit = (suit) => hand.filter(c => c.suit === suit);

  // 0) Draw trumps (#1b): on the declaring side, once trump is revealed, lead the boss trump to strip
  //    the opponents — but only while an OPPONENT may still hold trump (void-inference via seen.voids).
  //    Once both opponents are known void we stop, so we never pull our partner's trumps (the #5b guard).
  //    Gated on seen.voids + seen.seat; without them (legacy) this branch is skipped.
  if (seen && seen.voids && seen.seat != null && trumpSuit &&
      (seen.role === 'declarer' || seen.role === 'partner')) {
    const trumps = inSuit(trumpSuit);
    const bossTrump = trumps.find(c => isBoss(c, hand, seen));
    if (bossTrump) {
      let playedTrumps = 0;
      for (const k of seen.played) if (k.endsWith('-' + trumpSuit)) playedTrumps++;
      const outstanding = 8 - trumps.length - playedTrumps;
      const oppHoldsTrump = [0, 1, 2, 3].some(s =>
        !_samePartnership(s, seen.seat) && !(seen.voids[s] && seen.voids[s].has(trumpSuit)));
      if (outstanding > 0 && oppHoldsTrump) return bossTrump;   // win the round and draw a trump
    }
  }

  // Avoid leading our own trump. While trump is concealed the declarer still knows it
  // (seen.declarerTrump) — without this it would lead its own hidden trump as "the longest suit"
  // and over-draw it. `trumpSuit` is the active (revealed) trump for everyone.
  const avoidSuit = trumpSuit || (seen && seen.declarerTrump) || null;

  // 1) Lead a Jack we hold in a non-avoid suit (prefer the longest such suit for follow-up).
  const jackSuits = SUITS.filter(s => s !== avoidSuit && inSuit(s).some(c => c.rank === 'J'));
  if (jackSuits.length) {
    jackSuits.sort((a, b) => inSuit(b).length - inSuit(a).length);
    return inSuit(jackSuits[0]).find(c => c.rank === 'J');
  }

  // 1.5) No Trump DECLARER (#3 Phase 2): with a developable long suit that has real length potential,
  //      establish it (lead LOW) BEFORE cashing a lone side boss — keep that boss as the re-entry to
  //      cash the established length later. Only when side bosses are scarce (<= reentryKeep), so we
  //      don't strand cashable winners. Defenders/partner fall through to the normal cash-then-
  //      establish order. Gated to seen.noTrump so concealed/active trump is untouched.
  if (seen && seen.noTrump && seen.role === 'declarer') {
    const T = AI_TUNING.play.nt;
    const longSuit = ntLongestEstablishSuit(hand, avoidSuit, seen);
    if (longSuit && ntLengthWinners(longSuit, hand, seen) >= T.declarerLengthMin) {
      const sideBosses = hand.filter(c => c.suit !== longSuit && isBoss(c, hand, seen));
      if (sideBosses.length <= T.reentryKeep) return lowestCard(inSuit(longSuit));
    }
  }

  // 2) Cash established winners: if we hold the boss (highest unseen card) of a non-avoid suit,
  //    run the longest such suit, leading its highest boss. Needs played-card tracking (`seen`).
  if (seen) {
    const bossSuits = SUITS.filter(s => s !== avoidSuit && inSuit(s).some(c => isBoss(c, hand, seen)));
    if (bossSuits.length) {
      bossSuits.sort((a, b) => inSuit(b).length - inSuit(a).length);
      const bosses = inSuit(bossSuits[0]).filter(c => isBoss(c, hand, seen));
      return highestCard(bosses);
    }
  }

  // 2.5) No Trump only (#3): no Jack to lead and no boss to cash → establish our longest
  //      developable suit by leading LOW; its small cards promote to winners once the suit is
  //      exhausted elsewhere. Gated to seen.noTrump so it never fires under a concealed/active
  //      trump (where developing a side suit could feed a ruff). Needs card tracking (`seen`).
  if (seen && seen.noTrump) {
    const establishSuit = ntLongestEstablishSuit(hand, avoidSuit, seen);
    if (establishSuit) return lowestCard(inSuit(establishSuit));
  }

  // 3) Lead the lowest zero-point card, preferring a non-avoid suit.
  const lowestZero = (cards) => {
    const zero = cards.filter(c => POINT_VALUE[c.rank] === 0);
    const pool = zero.length ? zero : cards;
    return pool.reduce((lo, c) => RANK_ORDER[c.rank] < RANK_ORDER[lo.rank] ? c : lo);
  };
  const nonAvoid = hand.filter(c => c.suit !== avoidSuit);
  return lowestZero(nonAvoid.length ? nonAvoid : hand);
}

/**
 * Must follow suit. Decide whether to try to win or dump.
 */
function aiFollowSuit(following, trick, trumpSuit, ledSuit, seatIndex, seen = null) {
  const currentWinner = trickCurrentWinner(trick, trumpSuit);
  const partnerIndex = (seatIndex + 2) % 4;
  const partnerWinning = currentWinner === partnerIndex;

  if (partnerWinning) {
    // (i) Secure a BEATABLE partner trick. Default is to dump low and trust the partner —
    //     but if the partner's winning card is NOT the boss of the led suit, an opponent
    //     still plays after us, and we hold a master (a card that beats it and is itself the
    //     boss), take the trick with our cheapest master instead. Gated to concealed/no trump
    //     (`!trumpSuit`) so we don't expose a master to a ruff when trump is live.
    if (seen && !trumpSuit) {
      const pc = trick.find(t => t.playerIndex === partnerIndex);
      const partnerCard = pc && pc.card;
      const oppToAct = (seen.toActAfter || []).some(s => !_samePartnership(s, seatIndex));
      if (partnerCard && oppToAct && !isBoss(partnerCard, following, seen)) {
        const masters = following.filter(c =>
          cardBeats(c, partnerCard, ledSuit, trumpSuit) && isBoss(c, following, seen));
        if (masters.length) return lowestCard(masters);   // cheapest sufficient master
      }
    }
    return lowestCard(following);                          // partner safe → dump low
  }

  // Try to win.
  const winning = following.filter(c => trickBeatsAll(c, trick, ledSuit, trumpSuit));
  if (winning.length) {
    // (ii) When we'll surely win and hold several winners in a NON-trump suit, bank the
    //      highest-POINT winner (a J=3/9=2 we'd otherwise keep can be ruffed/stranded later).
    //      "Surely win" = we're last to act, or (trump concealed) our winner is the led-suit boss.
    if (seen && winning.length > 1 && ledSuit !== trumpSuit) {
      const lastToAct = (seen.toActAfter || []).length === 0;
      const bossWin = !trumpSuit && winning.some(c => isBoss(c, following, seen));
      if (lastToAct || bossWin) return highestPointCard(winning);
    }
    return lowestCard(winning);                            // default: cheapest sufficient winner
  }

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
    return safeDiscard(hand, trumpSuit);
  }

  // Try to trump to win — only if trump is active (caller passes null when concealed).
  if (trumpSuit) {
    const trumpCards = hand.filter(c => c.suit === trumpSuit);
    const ledSuit = trick[0].card.suit;
    const winning = trumpCards.filter(c => trickBeatsAll(c, trick, ledSuit, trumpSuit));
    if (winning.length) return lowestCard(winning);
  }

  return safeDiscard(hand, trumpSuit);
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

// Highest-POINT card; tie-break to the LOWER rank so we bank points as cheaply as possible.
function highestPointCard(cards) {
  return cards.reduce((best, c) =>
    (POINT_VALUE[c.rank] > POINT_VALUE[best.rank] ||
     (POINT_VALUE[c.rank] === POINT_VALUE[best.rank] && RANK_ORDER[c.rank] < RANK_ORDER[best.rank]))
      ? c : best);
}

// True iff `card` is the boss of its suit from our seat's view — every higher-ranked card of
// that suit is already played (in seen.played) or in our own hand. Exact for a 4-player full
// deal. Returns false when `seen` is null (no card tracking → no boss reasoning).
function isBoss(card, myHand, seen) {
  if (!seen || !seen.played) return false;
  for (const rank in RANK_ORDER) {
    if (RANK_ORDER[rank] <= RANK_ORDER[card.rank]) continue;           // only strictly higher cards
    if (seen.played.has(rank + '-' + card.suit)) continue;            // already played
    if (myHand.some(c => c.rank === rank && c.suit === card.suit)) continue;  // we hold it
    return false;                                                      // a higher card is still out
  }
  return true;
}

// NT only (#3): pick our longest "developable" suit to establish by leading LOW — its small cards
// become winners once the suit is exhausted in the other hands (no trump can ruff length away). A
// suit qualifies only if it is long enough (establishMin), is NOT a pure cash (all bosses → the
// boss branch already runs it), and either holds a J/9 or is very long (establishStrong) so we
// don't bleed a ragged top-less suit into opponents' tricks. Tie-break mirrors preferredTrumpSuit:
// length → honours(J/9) → points. Returns the suit, or null (→ fall through to the low-lead).
function ntLongestEstablishSuit(hand, avoidSuit, seen) {
  const T = AI_TUNING.play.nt;
  let best = null, bestKey = [-1, -1, -1];
  for (const suit of SUITS) {
    if (suit === avoidSuit) continue;
    const sc = cardsInSuit(hand, suit);
    if (sc.length < T.establishMin) continue;
    if (sc.every(c => isBoss(c, hand, seen))) continue;            // pure cash — the boss branch owns it
    const hasJ9 = honoursInSuit(sc) > 0;
    if (!hasJ9 && sc.length < T.establishStrong) continue;         // ragged top-less suit — don't bleed it
    const key = [sc.length, honoursInSuit(sc), handPoints(sc)];
    if (!best || key[0] > bestKey[0]
              || (key[0] === bestKey[0] && key[1] > bestKey[1])
              || (key[0] === bestKey[0] && key[1] === bestKey[1] && key[2] > bestKey[2])) {
      best = suit; bestKey = key;
    }
  }
  return best;
}

// NT length-winner estimate (#3 Phase 2): once every other hand is void in a suit, our remaining
// cards all win regardless of rank. outstanding = cards still out (8 − what we hold − what's been
// played); after they fall, max(0, myLen − outstanding) of our cards are length winners. An
// OPTIMISTIC lower-bound (assumes we keep the lead to run the suit) — used only to bias the declarer
// toward developing a genuinely long suit, never as a claim. Returns 0 without card tracking.
function ntLengthWinners(suit, hand, seen) {
  if (!seen || !seen.played) return 0;
  const myLen = cardsInSuit(hand, suit).length;
  let playedInSuit = 0;
  for (const k of seen.played) if (k.endsWith('-' + suit)) playedInSuit++;
  const outstanding = Math.max(0, 8 - myLen - playedInSuit);
  return Math.max(0, myLen - outstanding);
}

/** Discard the least valuable card. Prefer pitching NON-TRUMP junk so trump length is kept for
 *  ruffing / drawing trumps later (#1a); only pitch a trump when the hand is all trump. Within the
 *  chosen pool, prefer zero-point cards, then the lowest rank. With no active trump (trumpSuit
 *  null / No Trump) the pool is the whole hand — byte-identical to the original behaviour. */
function safeDiscard(hand, trumpSuit) {
  const nonTrump = trumpSuit ? hand.filter(c => c.suit !== trumpSuit) : hand;
  const pool     = nonTrump.length ? nonTrump : hand;   // forced to pitch trump only if nothing else
  const zeroPt   = pool.filter(c => POINT_VALUE[c.rank] === 0);
  return lowestCard(zeroPt.length ? zeroPt : pool);
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

// Forced line for a SOLO claim (#3 review playout): returns an array of synthetic tricks (shape
// {leader, winner, plays:[{seat,card}], points, claimed:true}) in which `claimSeat` wins EVERY remaining
// trick against the defenders' best play, or null if it doesn't sweep / the search exceeds the cap. Same
// full-knowledge model as claimHolds; call only after claimHolds confirmed a sweep exists.
function computeClaimLine(hands, leader, trumpSuit, claimSeat, seatsInPlay) {
  const numSeats   = seatsInPlay.length;
  const nextInPlay = (s) => seatsInPlay[(seatsInPlay.indexOf(s) + 1) % numSeats];
  const MAX_NODES  = 200000;
  let nodes = 0;

  function rec(hs, trick, seat, leaderSeat) {
    if (++nodes > MAX_NODES) return null;
    if (trick.length === numSeats) {
      const winner   = trickWinner(trick, trumpSuit);
      const nonClaim = winner === claimSeat ? 0 : 1;
      const pts      = trick.reduce((a, t) => a + POINT_VALUE[t.card.rank], 0);
      const here = { leader: leaderSeat, winner, points: pts, claimed: true,
                     plays: trick.map(t => ({ seat: t.playerIndex, card: t.card })) };
      const remaining = seatsInPlay.reduce((a, s) => a + hs[s].length, 0);
      if (remaining === 0) return { score: nonClaim, line: [here] };
      const sub = rec(hs, [], winner, winner);
      return sub ? { score: nonClaim + sub.score, line: [here].concat(sub.line) } : null;
    }
    const led        = trick.length ? trick[0].card.suit : null;
    const legal      = legalPlays(hs[seat], led);
    const maximizing = seat !== claimSeat;        // defenders maximize non-claimant tricks; claimant minimizes
    let best = null;
    for (const card of legal) {
      const hs2 = hs.slice();
      hs2[seat] = hs[seat].filter(c => !sameCard(c, card));
      const sub = rec(hs2, trick.concat([{ playerIndex: seat, card }]), nextInPlay(seat), leaderSeat);
      if (!sub) return null;                       // node cap hit below
      if (best === null || (maximizing ? sub.score > best.score : sub.score < best.score)) best = sub;
      if (!maximizing && best.score === 0) break;  // claimant: 0 non-claimant tricks is optimal — stop early
    }
    return best;
  }

  const res = rec(hands, [], leader, leader);
  return res && res.score === 0 ? res.line : null;
}
