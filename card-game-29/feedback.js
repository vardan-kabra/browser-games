// ── 29 — AI-feedback move log + flags + export ────────────────────────────────
//
// A self-contained, DOM-light data module (the UI lives in game.js). It records a
// complete, serializable move log of each hand — the backbone of the AI-feedback
// feature — plus the player's flags, and assembles one self-describing JSON file per
// hand for upload to Claude Code. Game logic never reads back from here; game.js only
// CALLS the log* hooks. Exposed as the frozen global `feedbackLog`.
//
// Seat indices match game.js: 0=South, 1=East, 2=North, 3=West. Team 0 = N–S ("We"),
// team 1 = E–W ("They").

const feedbackLog = (() => {
  const SEAT_CODE   = ['S', 'E', 'N', 'W'];
  const SUIT_CODE   = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' };
  const SYM_BY_CODE = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const RANK_HI_LO  = ['J', '9', 'A', '10', 'K', 'Q', '8', '7'];
  const PTS         = { J: 3, '9': 2, A: 1, '10': 1, K: 0, Q: 0, '8': 0, '7': 0 };
  const teamOf      = (seat) => (seat === 0 || seat === 2) ? 0 : 1;   // 0 = We, 1 = They
  const card        = (c) => ({ rank: c.rank, suit: SUIT_CODE[c.suit] });
  const sym         = (sc) => (SYM_BY_CODE[sc.suit] || '') + sc.rank;  // serialized card → "♣J"

  const README =
    "This file is AI-play feedback for the 29 card game (one hand). For each entry in " +
    "`flags`: (1) go to its `anchorTrick` and `subjectPlay`; (2) reconstruct the position at " +
    "that point from `deal` plus the earlier entries in `tricks`; (3) work out the flagged " +
    "player's legal options there; (4) evaluate their actual play against the rules and, where " +
    "possible, the double-dummy best line; (5) judge whether the user's `note` is valid; " +
    "(6) recommend the correct play and the change to the AI's decision logic that would " +
    "produce it. Follow any `relatedTricks` links. Use the rulebook for terminology (ruff, " +
    "void, marriage, Single Hand, trump reveal). Upload this together with the rulebook and AI " +
    "spec. Card rank order high→low: J 9 A 10 K Q 8 7.";

  // ── private state ───────────────────────────────────────────────────────────
  let matchId   = null;
  let scoreBefore = [0, 0];
  let hand      = null;     // the in-progress hand-log object
  let flags     = [];       // flags for the current hand
  let pendingEvents = [];   // events (reveal) accrued during the in-progress trick
  let running   = { we: 0, they: 0 };
  let endNote   = null;     // { reason, atTrick, by, awardedToTeam } set by noteEnd
  let flagSeq   = 0;

  const storageKey = () => `cg29-fb-${matchId}-h${hand ? hand.number : 0}`;
  function saveFlags() {
    try { localStorage.setItem(storageKey(), JSON.stringify(flags)); } catch (e) {}
  }
  function loadFlags() {
    try {
      const raw = localStorage.getItem(storageKey());
      flags = raw ? JSON.parse(raw) : [];
      flagSeq = flags.reduce((m, f) => Math.max(m, parseInt(String(f.id).replace(/\D/g, ''), 10) || 0), 0);
    } catch (e) { flags = []; flagSeq = 0; }
  }

  // ── hooks (called from game.js) ───────────────────────────────────────────────
  function beginMatch(id) { matchId = id; }

  function beginHand({ number, dealer, seatingOrderCCW, deal, scoreBefore: sb }) {
    scoreBefore = [sb[0], sb[1]];
    const dealOut = {};
    deal.forEach((h, seat) => { dealOut[SEAT_CODE[seat]] = h.map(card); });
    hand = {
      number, dealer: SEAT_CODE[dealer], seatingOrderCCW,
      bidding: [], contract: null, marriage: null, targets: null,
      deal: dealOut, trumpReveal: null, tricks: [], runningPoints: [], result: null,
    };
    pendingEvents = [];
    running = { we: 0, they: 0 };
    endNote = null;
    loadFlags();
  }

  function setBidding(bidLog) {
    if (!hand) return;
    hand.bidding = (bidLog || []).map(b => {
      const seat = SEAT_CODE[b.seat];
      if (b.call === 'Pass') return { seat, action: 'pass' };
      if (b.call === 'SH')   return { seat, action: 'sh' };
      return { seat, action: 'raise', value: b.call };
    });
  }

  function setContract({ bidder, declaredBid, trump, isNoTrump, singleHand, soloSeat, double }) {
    if (!hand) return;
    hand.contract = {
      bidder: SEAT_CODE[bidder],
      declaredBid,
      trump: isNoTrump ? 'NT' : (SUIT_CODE[trump] || null),
      noTrump: !!isNoTrump,
      singleHand: !!singleHand,
      soloSeat: (soloSeat == null) ? null : SEAT_CODE[soloSeat],
      sittingOut: (singleHand && soloSeat != null) ? SEAT_CODE[(soloSeat + 2) % 4] : null,
      double: double || 'none',
    };
  }

  function setTargets(t) { if (hand) hand.targets = t ? { ...t } : null; }

  function logReveal({ atTrick, by, suit }) {
    if (!hand) return;
    hand.trumpReveal = { atTrick, by: SEAT_CODE[by], suit: SUIT_CODE[suit] || suit };
    pendingEvents.push({ type: 'reveal', atTrick, by: SEAT_CODE[by], suit: SUIT_CODE[suit] || suit });
  }

  function logMarriage({ atTrick, by, adj, targets }) {
    if (!hand) return;
    hand.marriage = { atTrick, by: SEAT_CODE[by], adjust: adj };
    if (targets) hand.targets = { ...targets };
    if (hand.tricks.length) hand.tricks[hand.tricks.length - 1].events.push({ type: 'marriage', by: SEAT_CODE[by], adjust: adj });
  }

  // buffer of plays for the in-progress trick
  let trickBuf = { leader: null, plays: [] };
  function logPlay({ leader, seat, card: c, ledSuit, isTrump, inertTrump }) {
    if (!hand) return;
    if (trickBuf.plays.length === 0) trickBuf.leader = SEAT_CODE[leader];
    trickBuf.plays.push({
      seat: SEAT_CODE[seat], card: card(c),
      ledSuit: !!ledSuit, isTrump: !!isTrump, inertTrump: !!inertTrump, winning: false,
    });
  }

  function logTrickResolved({ trickNumber, winner, cardPoints, isLastTrick }) {
    if (!hand) return;
    const plays = trickBuf.plays;
    const wc = SEAT_CODE[winner];
    plays.forEach(p => { if (p.seat === wc) p.winning = true; });
    const points = cardPoints + (isLastTrick ? 1 : 0);
    const trick = {
      number: trickNumber, leader: trickBuf.leader, plays,
      winner: wc, points, events: pendingEvents,
    };
    hand.tricks.push(trick);
    // running team totals (winner's team gets the trick points)
    if (teamOf(winner) === 0) running.we += points; else running.they += points;
    hand.runningPoints.push({ afterTrick: trickNumber, we: running.we, they: running.they });
    trickBuf = { leader: null, plays: [] };
    pendingEvents = [];
  }

  function noteEnd({ reason, atTrick, by, awardedToTeam }) {
    endNote = { reason, atTrick: atTrick == null ? null : atTrick,
                by: by == null ? null : SEAT_CODE[by], awardedToTeam: awardedToTeam == null ? null : awardedToTeam };
  }

  function logResult({ biddingTeamPoints, made, tier, gamePointsAwarded, multiplier, scoreAfter }) {
    if (!hand) return;
    hand.result = {
      biddingTeamPoints, made: !!made, tier: tier || null,
      gamePointsAwarded, multiplier: multiplier || 1,
      endReason: endNote ? endNote.reason : 'played-out',
      claim: endNote && endNote.reason !== 'played-out'
        ? { by: endNote.by, atTrick: endNote.atTrick, awardedToTeam: endNote.awardedToTeam }
        : null,
    };
    hand.scoreAfter = [scoreAfter[0], scoreAfter[1]];
  }

  // ── flags ─────────────────────────────────────────────────────────────────────
  function addFlag({ anchorTrick, relatedTricks, note, subjectPlay }) {
    const f = {
      id: 'f' + (++flagSeq),
      anchorTrick,
      subjectPlay: subjectPlay || null,    // R2: { seat, card, plyIndex }
      relatedTricks: relatedTricks ? relatedTricks.slice() : [],
      note: note || '',
      createdAt: new Date().toISOString(),
    };
    flags.push(f); saveFlags();
    return f.id;
  }
  function updateFlag(id, patch) {
    const f = flags.find(x => x.id === id);
    if (!f) return;
    if (patch.anchorTrick   != null) f.anchorTrick   = patch.anchorTrick;
    if (patch.relatedTricks != null) f.relatedTricks = patch.relatedTricks.slice();
    if (patch.note          != null) f.note          = patch.note;
    if ('subjectPlay' in patch)      f.subjectPlay    = patch.subjectPlay;
    saveFlags();
  }
  function deleteFlag(id) { flags = flags.filter(x => x.id !== id); saveFlags(); }
  function getFlags() { return flags.map(f => ({ ...f })); }
  function flagCount() { return flags.length; }
  function getHandNumber() { return hand ? hand.number : null; }
  function hasHand() { return !!hand; }

  // ── readable summary (section 8) ───────────────────────────────────────────────
  function buildReadableSummary() {
    if (!hand) return '';
    const c = hand.contract || {};
    const tr = hand.trumpReveal;
    const trumpStr = c.noTrump ? 'No Trump'
      : `${SYM_BY_CODE[c.trump] || c.trump}${tr ? ` (revealed trick ${tr.atTrick} by ${tr.by})` : ' (never revealed)'}`;
    const mar = hand.marriage ? `${hand.marriage.by} ${hand.marriage.adjust > 0 ? '+4' : '−4'} at trick ${hand.marriage.atTrick}` : 'none';
    const r = hand.result || {};
    const need = hand.targets ? hand.targets.biddingTeamNeed : (c.declaredBid || '?');
    const head =
      `Hand ${hand.number} — Bidder ${c.bidder}, bid ${c.declaredBid}${c.singleHand ? ' (Single Hand)' : ''}, ` +
      `trump ${trumpStr}. Marriage: ${mar}.\n` +
      (r.endReason ? `Result: ${r.made ? 'MADE' : 'FAILED'} — took ${r.biddingTeamPoints} of ${need} needed. ` +
        `${r.gamePointsAwarded > 0 ? '+' : ''}${r.gamePointsAwarded} game pts` +
        `${r.endReason !== 'played-out' ? ` (${r.endReason})` : ''}. ` +
        `Match now We ${hand.scoreAfter ? hand.scoreAfter[0] : '?'} / They ${hand.scoreAfter ? hand.scoreAfter[1] : '?'}.` : '');
    const trickLines = hand.tricks.map(t => {
      const seq = t.plays.map(p => `${p.seat} ${sym(p.card)}`).join('; ');
      const last = t.number === hand.tricks.length && t.points > t.plays.reduce((s, p) => s + (PTS[p.card.rank] || 0), 0) ? '  (last trick +1)' : '';
      return `Trick ${t.number}: ${seq}  → ${t.winner} wins (+${t.points})${last}`;
    }).join('\n');
    const flagLines = flags.length
      ? '\n\nFLAGS\n' + flags.map(f => {
          const subj = f.subjectPlay ? ` [subject: ${f.subjectPlay.seat} ${sym(card(f.subjectPlay.card))}]` : '';
          const rel = f.relatedTricks && f.relatedTricks.length ? ` [relates to: trick ${f.relatedTricks.join(', ')}]` : '';
          const where = f.anchorTrick === 0 ? 'Bidding' : `Trick ${f.anchorTrick}`;   // anchorTrick 0 = the auction
          return `- ${where}${subj}${rel}: "${f.note}"`;
        }).join('\n')
      : '';
    return `${head}\n\n${trickLines}${flagLines}`;
  }

  // ── export ──────────────────────────────────────────────────────────────────────
  function buildExport() {
    return {
      schemaVersion: 1,
      kind: '29-ai-feedback',
      readme: README,
      rankOrderHighToLow: RANK_HI_LO.slice(),
      match: { id: matchId, scoreBefore: { we: scoreBefore[0], they: scoreBefore[1] },
               scoreAfter: hand && hand.scoreAfter ? { we: hand.scoreAfter[0], they: hand.scoreAfter[1] } : null },
      hand: hand ? {
        number: hand.number, dealer: hand.dealer, seatingOrderCCW: hand.seatingOrderCCW,
        bidding: hand.bidding, contract: hand.contract, marriage: hand.marriage, targets: hand.targets,
        deal: hand.deal, trumpReveal: hand.trumpReveal, tricks: hand.tricks,
        runningPoints: hand.runningPoints, result: hand.result,
      } : null,
      flags: getFlags(),
      readableSummary: buildReadableSummary(),
    };
  }

  return Object.freeze({
    beginMatch, beginHand, setBidding, setContract, setTargets,
    logReveal, logMarriage, logPlay, logTrickResolved, noteEnd, logResult,
    addFlag, updateFlag, deleteFlag, getFlags, flagCount, getHandNumber, hasHand,
    buildExport, buildReadableSummary,
  });
})();
