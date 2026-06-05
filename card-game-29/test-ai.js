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
  trickCurrentWinner,
});`;
eval(cardsSrc + '\n' + aiSrc + '\n' + glue);

// ── tiny test framework ─────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const fails = [];
const SUIT  = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
const RSUIT = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };

const C    = (rank, suitCh) => ({ rank, suit: SUIT[suitCh] });          // C('J','s') → ♠J
const play = (seat, card)   => ({ playerIndex: seat, card });
const seen = (played = [], toActAfter = [], declarerTrump = null) =>
  ({ played: new Set(played.map(cardKey)), toActAfter, declarerTrump });

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
