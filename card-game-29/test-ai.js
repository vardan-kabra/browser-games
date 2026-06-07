// ── Regression harness for the 29-card-game AI heuristics (ai.js) ────────────────
//
// Dependency-free. Eval-loads cards.js + ai.js (neither uses module.exports) into ONE
// shared scope, then asserts on hand-crafted positions that isolate each tuned heuristic.
// Every play-logic case also asserts the LEGACY path (seen = null) so the optional `seen`
// argument is provably *additive* — omitting it reproduces the original behaviour exactly.
//
//   node card-game-29/test-ai.js   →  prints ✓/✗ per case; exits non-zero on any failure.
//
// Keep this green when touching ai.js. Positions are computed by hand against the 29 rank
// order J(7) 9(6) A(5) 10(4) K(3) Q(2) 8(1) 7(0) and points J3 9·2 A1 10·1 (else 0).

const fs   = require('fs');
const path = require('path');

const dir      = __dirname;
const cardsSrc = fs.readFileSync(path.join(dir, 'cards.js'), 'utf8');
const aiSrc    = fs.readFileSync(path.join(dir, 'ai.js'),    'utf8');

// cards.js + ai.js declare top-level const/function; concatenating them into one eval keeps
// them in a single lexical scope (so ai.js sees SUITS/RANK_ORDER/etc). The glue then lifts the
// symbols we test onto globalThis for the assertions below.
const glue = `;Object.assign(globalThis, {
  SUITS, RANK_ORDER, POINT_VALUE, cardKey, cardBeats, trickWinner, sameCard, legalPlays,
  AI_TUNING, aiLead, aiFollowSuit, aiPlayCard, aiDiscard, aiBidValue, aiBidValueAgainstHolder,
  aiShouldReveal, aiShouldSingleHand, isBoss, highestCard, lowestCard, highestPointCard,
  trickCurrentWinner, ntLengthWinners, safeDiscard, computeClaimLine,
});`;
eval(cardsSrc + '\n' + aiSrc + '\n' + glue);

// ── tiny test framework ─────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const fails = [];
const SUIT  = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
const RSUIT = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };

const C    = (rank, suitCh) => ({ rank, suit: SUIT[suitCh] });          // C('J','s') → ♠J
const play = (seat, card)   => ({ playerIndex: seat, card });
const seen = (played = [], toActAfter = [], declarerTrump = null, noTrump = false, role = null, seat = null, voids = null) =>
  ({ played: new Set(played.map(cardKey)), toActAfter, declarerTrump, noTrump, role, seat, voids });

const isCard = (x) => x && typeof x === 'object' && 'rank' in x && 'suit' in x;
const cstr   = (c) => isCard(c) ? `${c.rank}${RSUIT[c.suit]}` : String(c);

function check(name, actual, expected) {
  const a = cstr(actual), e = cstr(expected);
  if (a === e) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name}\n      expected ${e}, got ${a}`); }
}
const checkTrue = (name, cond) => check(name, !!cond, true);
const section   = (title) => console.log(`\n── ${title}`);

// ══════════════════════════════════════════════════════════════════════════════════
// #2(ii) — aiFollowSuit banks the highest-POINT winner when sure to win a non-trump suit
// ══════════════════════════════════════════════════════════════════════════════════
section('#2(ii) bank high-point winner when surely winning (else legacy: cheapest)');
{
  const following = [C('J', 'h'), C('9', 'h')];   // we hold ♥J and ♥9, both beat ♥A
  // last to act (toActAfter empty), opponent ♥A currently winning
  const trick = [play(1, C('A', 'h')), play(3, C('7', 'h')), play(2, C('8', 'h'))];

  check('last-to-act + seen → bank ♥J',
        aiFollowSuit(following, trick, null, 'hearts', 0, seen([], [])), C('J', 'h'));
  check('legacy (no seen) → cheapest ♥9',
        aiFollowSuit(following, trick, null, 'hearts', 0, null), C('9', 'h'));

  // bossWin path: NOT last to act, but our winner is the led-suit boss (♥J = top heart)
  const trick2 = [play(1, C('A', 'h'))];
  check('boss-win (opp still to act) + seen → bank ♥J',
        aiFollowSuit(following, trick2, null, 'hearts', 0, seen([], [1])), C('J', 'h'));

  // guard: when the led suit IS trump, never burn the high trump — cheapest winner
  check('led suit == trump → cheapest ♥9 (no banking)',
        aiFollowSuit(following, trick2, 'hearts', 'hearts', 0, seen([], [])), C('9', 'h'));

  // guard: a single winner is unaffected
  check('single winner → that card',
        aiFollowSuit([C('9', 'h')], trick2, null, 'hearts', 0, seen([], [])), C('9', 'h'));
}

// ══════════════════════════════════════════════════════════════════════════════════
// #2(i) — secure a BEATABLE partner trick (concealed trump), else trust & dump low
// ══════════════════════════════════════════════════════════════════════════════════
section('#2(i) secure beatable partner vs dump-low guards');
{
  const following = [C('A', 'c'), C('7', 'c')];   // we hold ♣A (boss, since ♣J/♣9 are gone) + ♣7
  const playedJ9  = [C('J', 'c'), C('9', 'c')];   // makes ♣A the master club
  const partnerQ  = [play(2, C('Q', 'c'))];       // partner (seat 2) winning with a BEATABLE ♣Q

  check('beatable partner + opp to act + seen → secure with ♣A',
        aiFollowSuit(following, partnerQ, null, 'clubs', 0, seen(playedJ9, [1])), C('A', 'c'));
  check('legacy (no seen) → trust partner, dump ♣7',
        aiFollowSuit(following, partnerQ, null, 'clubs', 0, null), C('7', 'c'));

  // negative guard A: partner already holds the boss (♣J) → nothing to secure, dump low
  const partnerJ = [play(2, C('J', 'c'))];
  check('partner card is boss → dump ♣7',
        aiFollowSuit(following, partnerJ, null, 'clubs', 0, seen([], [1])), C('7', 'c'));

  // negative guard B: no opponent left to act → dump low
  check('no opp after us → dump ♣7',
        aiFollowSuit(following, partnerQ, null, 'clubs', 0, seen(playedJ9, [])), C('7', 'c'));

  // negative guard C: trump live → don't expose the master to a ruff, dump low
  check('trump live → dump ♣7 (gated to concealed)',
        aiFollowSuit(following, partnerQ, 'hearts', 'clubs', 0, seen(playedJ9, [1])), C('7', 'c'));
}

// ══════════════════════════════════════════════════════════════════════════════════
// #1 — aiLead cashes an established winner (boss); legacy leads the lowest zero-point card
// ══════════════════════════════════════════════════════════════════════════════════
section('#1 aiLead cashes a boss vs legacy low-lead');
{
  const hand = [C('9', 'd'), C('7', 'd'), C('8', 'h'), C('K', 'c')];   // no Jack
  const s    = seen([C('J', 'd')], []);   // ♦J gone ⇒ ♦9 is the boss of diamonds

  check('seen → cash boss ♦9', aiLead(hand, null, s),    C('9', 'd'));
  check('legacy → low zero ♦7', aiLead(hand, null, null), C('7', 'd'));
}

// ══════════════════════════════════════════════════════════════════════════════════
// #5a — the declarer must not lead its own CONCEALED trump (seen.declarerTrump)
// ══════════════════════════════════════════════════════════════════════════════════
section('#5a declarer avoids leading concealed trump');
{
  const hand = [C('J', 's'), C('A', 's'), C('8', 'h'), C('7', 'h')];   // ♠ is our hidden trump

  const led = aiLead(hand, null, seen([], [], 'spades'));
  checkTrue('declarerTrump set → does NOT lead a spade', led.suit !== 'spades');
  check    ('…leads ♥7 instead', led, C('7', 'h'));
  check    ('control: no declarerTrump → would lead ♠J',
            aiLead(hand, null, seen([], [], null)), C('J', 's'));
}

// ══════════════════════════════════════════════════════════════════════════════════
// #3 Phase 1 — No-Trump "establish the longest suit" lead (gated to seen.noTrump)
// ══════════════════════════════════════════════════════════════════════════════════
section('#3 Phase 1 — NT establish longest suit (else legacy low-lead)');
{
  // No Jack, no boss, a 4-card heart suit holding ♥9 (an honour) → establish: lead the LOWEST heart
  // (♥8). Legacy (no seen) ignores length and dumps the globally-lowest zero-point card (♦7).
  const hand = [C('K','h'), C('10','h'), C('9','h'), C('8','h'), C('7','d')];
  check('NT + seen → establish hearts, lead low ♥8',
        aiLead(hand, null, seen([], [], null, true)), C('8','h'));
  check('legacy (no seen) → lowest zero-point ♦7',
        aiLead(hand, null, null), C('7','d'));

  // NT gate: seen present but noTrump=false (concealed/active trump) → establish must NOT fire, so the
  // same hand falls through to the legacy low-lead. This protects concealed-trump play (#5/#6).
  check('noTrump=false → establish skipped, legacy low-lead ♦7',
        aiLead(hand, null, seen([], [], null, false)), C('7','d'));

  // Ordering: a boss to cash always precedes establishing. ♣A is the top club (♣J/♣9 gone) → cash it
  // even though hearts are establishable.
  check('boss present → cash ♣A (boss branch precedes establish)',
        aiLead([C('K','h'),C('10','h'),C('9','h'),C('8','h'),C('A','c')], null,
               seen([C('J','c'),C('9','c')], [], null, true)), C('A','c'));

  // Threshold guard: a ragged 4-card suit with no J/9 (♥K-Q-10-8) is not "developable" → rejected, so
  // we fall through to the legacy low-lead (♦7) rather than the lowest heart (♥8).
  check('ragged 4-suit (no J/9) → not established, legacy low-lead ♦7',
        aiLead([C('K','h'),C('Q','h'),C('10','h'),C('8','h'),C('7','d')], null,
               seen([], [], null, true)), C('7','d'));

  // Jack precedence: a Jack still leads first in NT (it wins AND develops).
  check('NT + Jack → Jack still leads first',
        aiLead([C('J','h'),C('10','h'),C('9','h'),C('8','h'),C('K','d')], null,
               seen([], [], null, true)), C('J','h'));
}

// ══════════════════════════════════════════════════════════════════════════════════
// #3 Phase 1 — Game-1 / f4 reconstruction (the headline NT blunder, now fixed)
// ══════════════════════════════════════════════════════════════════════════════════
section('#3 Phase 1 — Game-1 NT: cash the top club instead of leading ♥8');
{
  // Game 1, trick 5: West is on lead in a No-Trump contract holding ♥8 ♠Q ♣A ♣9. With ♣K/♣Q/♣J/♣10/♣7
  // already played, ♣9 and ♣A are the two highest clubs left (bosses) → cash a club (♣9). The logged
  // blunder was leading ♥8 (the lowest zero-point card), which the legacy (seen=null) path reproduces.
  const westHand = [C('8','h'), C('Q','s'), C('A','c'), C('9','c')];
  const g1played = [
    C('7','h'),C('Q','h'),C('A','h'),C('J','h'),   // trick 1
    C('K','c'),C('10','c'),C('7','s'),C('7','c'),  // trick 2
    C('8','c'),C('7','d'),C('Q','c'),C('8','s'),   // trick 3
    C('J','c'),C('8','d'),C('Q','d'),C('10','s'),  // trick 4
  ];
  check('NT → West cashes the top club ♣9 (not ♥8)',
        aiLead(westHand, null, seen(g1played, [], null, true)), C('9','c'));
  check('legacy (seen=null) reproduces the ♥8 blunder',
        aiLead(westHand, null, null), C('8','h'));
}

// ══════════════════════════════════════════════════════════════════════════════════
// #3 Phase 2 — NT declarer: estimate length winners; establish before cashing a lone side boss
// ══════════════════════════════════════════════════════════════════════════════════
section('#3 Phase 2 — ntLengthWinners estimate');
{
  const five = [C('K','s'),C('10','s'),C('8','s'),C('7','s'),C('Q','s')];
  const four = [C('K','s'),C('10','s'),C('8','s'),C('7','s')];
  check('5-card suit, none played → 2 length winners', ntLengthWinners('spades', five, seen([])), 2);
  check('4-card suit, none played → 0 length winners', ntLengthWinners('spades', four, seen([])), 0);
  check('5-card suit, 2 already played → 4 length winners',
        ntLengthWinners('spades', five, seen([C('J','s'),C('9','s')])), 4);
  check('no card-tracking (seen=null) → 0', ntLengthWinners('spades', five, null), 0);
}

section('#3 Phase 2 — declarer establishes before cashing a lone side boss');
{
  // Declarer holds 5 spades (developable, 2 length winners) + ♣A (a lone side boss; ♣J/♣9 gone). In
  // NT it should establish spades (lead low ♠7) and keep ♣A as the re-entry — NOT cash ♣A first.
  const hand = [C('K','s'),C('10','s'),C('8','s'),C('7','s'),C('Q','s'),C('A','c')];
  const pj9  = [C('J','c'),C('9','c')];   // makes ♣A the boss club
  check('declarer + NT → establish spades, lead low ♠7',
        aiLead(hand, null, seen(pj9, [], null, true, 'declarer')), C('7','s'));
  check('defender + NT → cash the boss ♣A (no establish-first)',
        aiLead(hand, null, seen(pj9, [], null, true, 'defender')), C('A','c'));
  check('declarer + noTrump=false → cash ♣A (NT gate)',
        aiLead(hand, null, seen(pj9, [], null, false, 'declarer')), C('A','c'));
  check('legacy (seen=null) → lowest zero-point ♠7',
        aiLead(hand, null, null), C('7','s'));

  // reentryKeep gate: with TWO side bosses (♣A + ♥A) the declarer has enough entries → just cash
  // (boss-cash picks ♥A: hearts before clubs at equal length), don't establish-first.
  const hand2 = [C('K','s'),C('10','s'),C('8','s'),C('7','s'),C('Q','s'),C('A','c'),C('A','h')];
  check('declarer + 2 side bosses → cash a boss (♥A), not establish',
        aiLead(hand2, null, seen([C('J','c'),C('9','c'),C('J','h'),C('9','h')], [], null, true, 'declarer')),
        C('A','h'));

  // declarerLengthMin gate: a 4-card suit (♥10-9-8-7 — an honour but 0 length winners) lacks length
  // potential → the declarer cashes the side boss ♣A normally instead of establishing.
  const hand3 = [C('10','h'),C('9','h'),C('8','h'),C('7','h'),C('A','c')];
  check('declarer + 4-card suit (no length winners) → cash ♣A',
        aiLead(hand3, null, seen([C('J','c'),C('9','c')], [], null, true, 'declarer')), C('A','c'));
}

// ══════════════════════════════════════════════════════════════════════════════════
// #1b — draw trumps: declaring side leads the boss trump while opponents hold trump
// ══════════════════════════════════════════════════════════════════════════════════
section('#1b draw trumps (void-inference; stops once opponents are void = #5b)');
{
  const declHand = [C('J','s'),C('10','s'),C('A','h'),C('8','d')];   // ♠ trump; ♠J is the boss trump
  const none     = [new Set(),new Set(),new Set(),new Set()];        // nobody known void
  // declarer (seat 0), ♠ revealed, holds boss ♠J, opponents (1,3) not known void → draw ♠J
  check('declarer + boss trump + opp may hold trump → lead ♠J (draw)',
        aiLead(declHand, 'spades', seen([], [], null, false, 'declarer', 0, none)), C('J','s'));
  // partner (seat 2) draws too
  check('partner + boss trump → also draws ♠J',
        aiLead([C('J','s'),C('7','s'),C('K','h'),C('8','d')], 'spades', seen([], [], null, false, 'partner', 2, none)),
        C('J','s'));
  // #5b STOP: both opponents (1,3) known void in ♠ → outstanding ♠ are partner's → don't draw, lead ♦8
  const oppsVoid = [new Set(),new Set(['spades']),new Set(),new Set(['spades'])];
  check('both opponents void in trump → stop drawing, lead low ♦8',
        aiLead(declHand, 'spades', seen([], [], null, false, 'declarer', 0, oppsVoid)), C('8','d'));
  // defender never draws trumps
  check('defender + boss trump → does NOT draw, lead low ♦8',
        aiLead(declHand, 'spades', seen([], [], null, false, 'defender', 0, none)), C('8','d'));
  // no boss trump in hand → don't initiate drawing
  check('declaring side without the boss trump → no draw, lead low ♦8',
        aiLead([C('10','s'),C('8','s'),C('A','h'),C('8','d')], 'spades', seen([], [], null, false, 'declarer', 0, none)),
        C('8','d'));
  // legacy: no void-tracking, or no seen → byte-identical (no draw; declarer avoids own trump → ♦8)
  check('no seen.voids (legacy) → no draw, lead low ♦8',
        aiLead(declHand, 'spades', seen([], [], null, false, 'declarer', 0, null)), C('8','d'));
  check('seen=null legacy → no draw, lead low ♦8',
        aiLead(declHand, 'spades', null), C('8','d'));
}

// ══════════════════════════════════════════════════════════════════════════════════
// #3 review — computeClaimLine returns the forced sweep (Hand 15 ending)
// ══════════════════════════════════════════════════════════════════════════════════
section('#3 computeClaimLine — forced claim sweep (Hand 15)');
{
  // Hand 15 trick-6 ending: N(2) on lead, trump ♦, West(3) claims and wins all 3 tricks.
  const hands = [
    [C('A','c'),C('9','d'),C('J','c')],   // S
    [C('9','s'),C('K','s'),C('A','s')],   // E
    [C('A','d'),C('10','c'),C('9','c')],  // N
    [C('J','d'),C('K','d'),C('10','d')],  // W (holds boss ♦J)
  ];
  const line = computeClaimLine(hands, 2, 'diamonds', 3, [0,1,2,3]);
  checkTrue('line found, 3 tricks', !!line && line.length === 3);
  checkTrue('claimant W(3) wins every trick', !!line && line.every(t => t.winner === 3));
  checkTrue('each synthetic trick has 4 plays', !!line && line.every(t => t.plays.length === 4));
  // control: move the boss ♦J to South → West can no longer sweep → null
  const noSweep = [
    [C('A','c'),C('J','d'),C('J','c')],   // S now holds the boss ♦J
    [C('9','s'),C('K','s'),C('A','s')],
    [C('A','d'),C('10','c'),C('9','c')],
    [C('9','d'),C('K','d'),C('10','d')],  // W lost the boss
  ];
  checkTrue('no forced sweep → null', computeClaimLine(noSweep, 2, 'diamonds', 3, [0,1,2,3]) === null);
}

// ══════════════════════════════════════════════════════════════════════════════════
// #1a — safeDiscard / aiDiscard keep trump: pitch NON-TRUMP junk, not a trump
// ══════════════════════════════════════════════════════════════════════════════════
section('#1a safeDiscard preserves trump when pitching junk');
{
  // zero-point trump (♣8) and zero-point non-trump (♠8) both present, trump ♣ → pitch ♠8, keep ♣8.
  check('trump-aware → pitch non-trump ♠8 (keep ♣8)',
        safeDiscard([C('8','c'),C('8','s'),C('K','h')], 'clubs'), C('8','s'));
  // all-trump hand → forced to pitch the lowest trump
  check('all trump → forced lowest trump ♣8',
        safeDiscard([C('8','c'),C('K','c'),C('J','c')], 'clubs'), C('8','c'));
  // no active trump (null) → original behaviour: lowest zero-point card by rank (here ♣8 first)
  check('trumpSuit null → legacy lowest zero-point ♣8',
        safeDiscard([C('8','c'),C('8','s'),C('K','h')], null), C('8','c'));
}

section('#1a aiDiscard preserves trump under a winning partner (Hand 3, trick 2)');
{
  // Trump ♣ (revealed). Trick: W led ♦9, partner S ruffed ♣9 (winning), E ♦K. North (seat 2) is void
  // in diamonds and must discard — it should pitch a NON-trump (♠8), NOT waste a trump (♣8).
  const north = [C('8','c'),C('J','c'),C('8','s'),C('K','h'),C('J','s'),C('A','s'),C('10','h')];
  const trick = [play(3,C('9','d')), play(0,C('9','c')), play(1,C('K','d'))];
  check('partner ruffing-winner + void → pitch ♠8, keep ♣8 trump',
        aiDiscard(north, trick, 'clubs', 2), C('8','s'));
}

section('#1a aiDiscard keeps a non-winning trump (partner-not-winning fallback path)');
{
  // Trump ♣. Opponent E ruffed (♣J) and is winning; North (seat 2) is void in spades, holds a low trump
  // ♣7 that can't beat ♣J plus non-trump junk. It must discard — keep ♣7, pitch ♦8 (covers ai.js:423).
  const north = [C('7','c'),C('8','d'),C('K','h')];
  const trick = [play(0,C('K','s')), play(1,C('J','c'))];
  check('cannot ruff-win, opp winning → pitch ♦8, keep ♣7 trump',
        aiDiscard(north, trick, 'clubs', 2), C('8','d'));
}

// ══════════════════════════════════════════════════════════════════════════════════
// #4 — bidding valuation dials (band-scoped; hardCap 22 intact)
// ══════════════════════════════════════════════════════════════════════════════════
section('#4 bidding valuation');
{
  const H = (...cs) => cs;
  // untargeted bands must NOT have shifted:
  check('0 pts → 16',
        aiBidValue(H(C('8','s'),C('7','s'),C('8','h'),C('7','h'),C('8','d'),C('7','d'),C('8','c'),C('7','c')), 0), 16);
  check('4 pts, no 4-suit → 16',
        aiBidValue(H(C('A','s'),C('10','s'),C('A','h'),C('10','h'),C('K','d'),C('Q','d'),C('8','c'),C('7','c')), 0), 16);
  check('J9xx 4-suit but only 5 pts → 16 (pts floor dominates)',
        aiBidValue(H(C('J','s'),C('9','s'),C('8','s'),C('7','s'),C('K','h'),C('Q','h'),C('8','d'),C('7','c')), 0), 16);
  check('6 pts, plain 4-suit (no honours) → 17',
        aiBidValue(H(C('A','s'),C('10','s'),C('K','s'),C('8','s'),C('A','h'),C('10','h'),C('A','d'),C('A','c')), 0), 17);
  check('10 pts, J9A10 4-suit → 22',
        aiBidValue(H(C('J','s'),C('9','s'),C('A','s'),C('10','s'),C('A','h'),C('10','h'),C('A','d'),C('7','c')), 0), 22);
  check('13 pts, very strong → 22',
        aiBidValue(H(C('J','s'),C('9','s'),C('A','s'),C('K','s'),C('J','h'),C('9','h'),C('A','d'),C('A','c')), 0), 22);

  // strong-3 relaxation: a J-9-A tripleton (7 pts) is no longer dumped to 16…
  const strong3 = H(C('J','s'),C('9','s'),C('A','s'),C('K','h'),C('Q','h'),C('10','d'),C('8','d'),C('7','c'));
  const noA     = H(C('J','s'),C('9','s'),C('8','s'),C('K','h'),C('Q','h'),C('10','d'),C('8','d'),C('7','c'));
  check('strong-3 (J9A) 7 pts → 20', aiBidValue(strong3, 0), 20);
  check('…sibling without the A (not strong-3) → 18', aiBidValue(noA, 0), 18);
  checkTrue('strong-3 relaxed above the 16 floor', aiBidValue(strong3, 0) >= 17);

  // hard cap: a monster never auto-bids past 22
  check('monster hand capped at 22',
        aiBidValue(H(C('J','s'),C('9','s'),C('A','s'),C('10','s'),C('K','s'),C('J','h'),C('9','h'),C('A','d')), 0), 22);

  // marriage bonus: K+Q in the trump candidate adds exactly 1
  const noMarr = H(C('A','s'),C('10','s'),C('8','s'),C('7','s'),C('A','h'),C('10','h'),C('A','d'),C('A','c')); // ♠ trump, no KQ
  const marr   = H(C('A','s'),C('10','s'),C('K','s'),C('Q','s'),C('A','h'),C('10','h'),C('A','d'),C('A','c')); // ♠ trump w/ K+Q
  check('marriage (K+Q of trump) adds +1 over the same shape',
        aiBidValue(marr, 0), aiBidValue(noMarr, 0) + 1);
}

// ══════════════════════════════════════════════════════════════════════════════════
// #6 — aiShouldReveal: J/9 ruffer reveals on a worth-it trick; a bare Ace needs ≥3 pts
// ══════════════════════════════════════════════════════════════════════════════════
section('#6 reveal-to-ruff thresholds');
{
  const J9hand  = [C('J','s'), C('8','d'), C('7','c'), C('7','h')];   // J in a non-led suit
  const Acehand = [C('A','s'), C('8','d'), C('7','c'), C('7','h')];   // bare Ace, no J/9
  const KThand  = [C('K','s'), C('10','d'), C('7','c'), C('7','h')];  // only K/10 — too weak
  const trick2  = [play(1, C('9','h'))];   // led hearts, 2 points on the table (opp winning)
  const trick3  = [play(1, C('J','h'))];   // led hearts, 3 points on the table (opp winning)

  checkTrue('non-declarer J/9 ruffer, 2-pt trick → reveal',  aiShouldReveal(0, J9hand,  trick2, 1, null));
  checkTrue('non-declarer Ace, 2-pt trick → hold',          !aiShouldReveal(0, Acehand, trick2, 1, null));
  checkTrue('non-declarer Ace, 3-pt trick → reveal',         aiShouldReveal(0, Acehand, trick3, 1, null));
  checkTrue('non-declarer K/10 only, 3-pt trick → hold',    !aiShouldReveal(0, KThand,  trick3, 1, null));
  checkTrue('never reveal over a winning partner',          !aiShouldReveal(0, J9hand, [play(2, C('A','h'))], 1, null));

  // declarer path (knows the trump suit + whether they hold it)
  checkTrue('declarer holds trump, worth it → reveal',      aiShouldReveal(0, [C('A','s'),C('8','d')], trick2, 0, 'spades'));
  checkTrue('declarer void in trump → hold',               !aiShouldReveal(0, [C('A','d'),C('8','d')], trick2, 0, 'spades'));

  // declaring SIDE (bidder's partner: seat 2, declarer 0 → same team) reveals more readily than a
  // DEFENDER (seat 2, declarer 1) — it counts a still-developing trick as worth a ruff. This is the
  // hand-2-trick-4 fix: void in the led suit, holding outside 9s, on a 0-point but growing trick.
  const partnerJ9  = [C('9','h'), C('9','d'), C('K','h'), C('7','c')];                 // void spades; ♥9/♦9 ruffers
  const devTrick   = [play(1, C('Q','s'))];                                            // 0 pts, opp winning, still developing
  const lastTrick0 = [play(1, C('Q','s')), play(0, C('8','s')), play(3, C('7','s'))];  // 0 pts, we're last to act
  const lastTrick2 = [play(1, C('9','s')), play(0, C('8','s')), play(3, C('7','s'))];  // 2 pts, we're last to act
  checkTrue('declaring side, developing 0-pt trick, J/9 ruffer → reveal',  aiShouldReveal(2, partnerJ9, devTrick,   0, null));
  checkTrue('DEFENDER, same developing 0-pt trick → hold (contrast)',     !aiShouldReveal(2, partnerJ9, devTrick,   1, null));
  checkTrue('declaring side, last-to-act 0-pt trick → hold',             !aiShouldReveal(2, partnerJ9, lastTrick0, 0, null));
  checkTrue('declaring side, last-to-act 2-pt trick → reveal',            aiShouldReveal(2, partnerJ9, lastTrick2, 0, null));
  // a bare Ace gets no developing bonus, even on the declaring side (weaker ruffer than a J/9)
  const partnerAce = [C('A','h'), C('8','d'), C('K','d'), C('7','c')];                 // void spades, bare ♥A, no J/9
  checkTrue('declaring side, bare Ace, developing 0-pt → hold',           !aiShouldReveal(2, partnerAce, devTrick,            0, null));
  checkTrue('declaring side, bare Ace, 2-pt trick → reveal',              aiShouldReveal(2, partnerAce, [play(1,C('9','s'))], 0, null));
}

// ══════════════════════════════════════════════════════════════════════════════════
// #2 — defenders relax reveal-to-ruff bars in the ENDGAME (Hand 14)
// ══════════════════════════════════════════════════════════════════════════════════
section('#2 defender endgame reveal relaxation');
{
  // Hand 14, trick 6: West (defender, seat 3; declarer N=2) is void in spades with bare aces (10♦ A♣
  // A♦) on a developing 2-pt trick (N led ♠9). 3 cards left = endgame → reveal (mid-hand it would hold).
  const wEnd = [C('10','d'),C('A','c'),C('A','d')];
  const t9s  = [play(2, C('9','s'))];
  checkTrue('Hand 14: defender bare-Ace, endgame (3 cards), 2-pt trick → reveal',
            aiShouldReveal(3, wEnd, t9s, 2, null));
  // same shape but mid-hand (5 cards) → still holds (endgame-gated; bare Ace needs ≥3 off-endgame)
  const wMid = [C('10','d'),C('A','c'),C('A','d'),C('8','h'),C('7','c')];
  checkTrue('same defender bare-Ace mid-hand (5 cards), 2-pt trick → hold',
            !aiShouldReveal(3, wMid, t9s, 2, null));
  // endgame also relaxes a J/9 ruffer onto a developing 0-pt trick
  const wJ9 = [C('9','h'),C('A','c'),C('7','d')];
  checkTrue('defender J/9 ruffer, endgame, developing 0-pt trick → reveal',
            aiShouldReveal(3, wJ9, [play(2, C('Q','s'))], 2, null));
}

// ══════════════════════════════════════════════════════════════════════════════════
// C9 — Single Hand declaration sanity (unchanged logic, guards against accidental edits)
// ══════════════════════════════════════════════════════════════════════════════════
section('C9 single-hand sanity');
{
  checkTrue('6-card J9 trump suit → declare SH',
            aiShouldSingleHand([C('J','s'),C('9','s'),C('A','s'),C('10','s'),C('K','s'),C('Q','s'),C('A','h'),C('A','d')], 1, null));
  checkTrue('weak 3-card trump → no SH',
           !aiShouldSingleHand([C('J','s'),C('9','s'),C('8','s'),C('K','h'),C('Q','h'),C('10','d'),C('8','d'),C('7','c')], 1, null));
}

// ── summary ──────────────────────────────────────────────────────────────────────
console.log(`\n${failed ? '✗ FAIL' : '✓ PASS'} — ${passed} passed, ${failed} failed`);
if (failed) { console.log('Failed: ' + fails.join('; ')); process.exit(1); }
