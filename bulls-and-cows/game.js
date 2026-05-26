let secret = '';
let turnCount = 0;
let guessLog = [];        // [{ guess, bulls, cows }] — the only in-memory record of the game

function generateSecret() {
  // 4 distinct digits from 0-9; the first digit may be 0 (5040-code variant).
  const digits = [0,1,2,3,4,5,6,7,8,9];
  for (let i = digits.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [digits[i], digits[j]] = [digits[j], digits[i]];
  }
  return '' + digits[0] + digits[1] + digits[2] + digits[3];
}

function evaluateGuess(secret, guess) {
  let bulls = 0, cows = 0;
  for (let i = 0; i < 4; i++) {
    if (guess[i] === secret[i]) {
      bulls++;
    } else if (secret.includes(guess[i])) {
      cows++;
    }
  }
  return { bulls, cows };
}

function validateGuess(input) {
  if (!/^\d{4}$/.test(input)) return 'Enter exactly 4 digits (0–9).';
  if (new Set(input).size !== 4) return 'No repeated digits allowed.';
  return null;
}

function submitGuess() {
  const input = document.getElementById('guess-input');
  const errorMsg = document.getElementById('error-msg');
  const guess = input.value.trim();

  const error = validateGuess(guess);
  if (error) {
    errorMsg.textContent = error;
    input.select();
    return;
  }

  errorMsg.textContent = '';
  turnCount++;

  const { bulls, cows } = evaluateGuess(secret, guess);
  guessLog.push({ guess, bulls, cows });

  appendHistoryRow(turnCount, guess, bulls, cows);
  updateTurnCounter();

  input.value = '';
  input.focus();

  if (bulls === 4) {
    showWinScreen();
  }
}

function appendHistoryRow(turn, guess, bulls, cows) {
  const tbody = document.getElementById('history-body');

  // Remove highlight from previous latest row
  const prev = tbody.querySelector('tr.latest');
  if (prev) prev.classList.remove('latest');

  const tr = document.createElement('tr');
  tr.classList.add('latest');
  tr.innerHTML = `
    <td>${turn}</td>
    <td class="guess-cell">${guess}</td>
    <td class="bulls-cell">${bulls} B</td>
    <td class="cows-cell">${cows} C</td>
  `;
  tbody.appendChild(tr);
  tr.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function updateTurnCounter() {
  document.getElementById('turn-counter').textContent = `Turn ${turnCount}`;
}

function showWinScreen() {
  // The result is the focus now — clear the pre-game chrome out of the way so the
  // win screen floats to the top of the card (see #win-screen { order: 0 }).
  document.getElementById('input-area').hidden = true;
  document.getElementById('rules').hidden = true;
  document.getElementById('training-toggle').hidden = true;
  const win = document.getElementById('win-screen');
  win.hidden = false;
  document.getElementById('win-turns').textContent = turnCount;
  renderDebrief(turnCount);

  const analysis = analyzeGame(guessLog);
  renderCoachingRounds(analysis);                 // always shown
  if (document.getElementById('training-checkbox').checked) renderTrainingExtras(analysis);
}

function newGame() {
  secret = generateSecret();
  turnCount = 0;
  guessLog = [];
  document.getElementById('history-body').innerHTML = '';
  document.getElementById('turn-counter').textContent = 'Turn 0';
  document.getElementById('error-msg').textContent = '';
  document.getElementById('guess-input').value = '';
  document.getElementById('win-screen').hidden = true;
  document.getElementById('input-area').hidden = false;
  document.getElementById('training-panel').hidden = true;
  document.getElementById('rules').hidden = false;
  document.getElementById('training-toggle').hidden = false;
  const solverDetails = document.getElementById('solver-details');
  if (solverDetails) solverDetails.open = false;
  document.getElementById('guess-input').focus();
}

// ---------------------------------------------------------------------------
// Knowledge packet (bundled from "bulls cows knowledge.json" /
// "bulls cows training prompt.md"). Stats are for the 5040-code variant.
// ---------------------------------------------------------------------------

// Score / label / percentile by turns taken (8+ is the fallback row).
const SCORING_TABLE = {
  1: { score: 100, label: 'Miraculous',    percentile: 99.98, context: 'Only 1 in 5040 codes can be solved on the first guess. Pure luck — but extraordinary.' },
  2: { score: 95,  label: 'Exceptional',   percentile: 99.80, context: 'Top 0.2% of all possible games. An elite first guess that dramatically narrowed the field.' },
  3: { score: 85,  label: 'Excellent',     percentile: 98.61, context: 'Top ~1.4% of games. Superb deduction — even optimal algorithms rarely finish this fast.' },
  4: { score: 75,  label: 'Very Good',     percentile: 84.72, context: 'Better than ~85% of all possible games. Strong, efficient play.' },
  5: { score: 60,  label: 'Good',          percentile: 37.10, context: 'Right at the optimal average of 5.21 turns. Solid, competent play.' },
  6: { score: 40,  label: 'Average',       percentile: 0.99,  context: 'Within the normal human range — even the best algorithms need 6 turns for ~36% of codes.' },
  7: { score: 20,  label: 'Below Average', percentile: 0.0,   context: 'The theoretical maximum. Only ~50 codes require this many turns under optimal play.' },
  '8+': { score: 5, label: 'Needs Practice', percentile: null, context: 'Beyond the proven maximum for optimal play. Lean on systematic elimination.' },
};

// Estimated turn distribution under optimal play (sums to 5040 games).
const TURN_DISTRIBUTION = [
  { turns: 1, games: 1,    percentage: 0.02 },
  { turns: 2, games: 9,    percentage: 0.18 },
  { turns: 3, games: 60,   percentage: 1.19 },
  { turns: 4, games: 700,  percentage: 13.89 },
  { turns: 5, games: 2400, percentage: 47.62 },
  { turns: 6, games: 1820, percentage: 36.11 },
  { turns: 7, games: 50,   percentage: 0.99 },
];

function scoreForTurns(turns) {
  return SCORING_TABLE[turns] || SCORING_TABLE['8+'];
}

// Human-fair score/label, anchored to human benchmarks (optimal avg 5.21,
// intermediate elimination ~5.9, novice 7-9). A 7-turn solve is "Good", not
// "Below Average" — the packet's table above is kept only for the vs-optimal line.
const HUMAN_SCORING = {
  1:  { score: 100, label: 'Miraculous', context: 'A first-guess solve — pure magic.' },
  2:  { score: 98,  label: 'Phenomenal', context: 'All but unheard of. Stunning read.' },
  3:  { score: 95,  label: 'Brilliant',  context: 'Outstanding deduction — among the very best possible.' },
  4:  { score: 90,  label: 'Excellent',  context: 'Excellent, efficient play.' },
  5:  { score: 82,  label: 'Great',      context: 'Great — right around the optimal average.' },
  6:  { score: 74,  label: 'Very Good',  context: 'Very good — comfortably strong play.' },
  7:  { score: 66,  label: 'Good',       context: 'Good — a solid, efficient solve.' },
  8:  { score: 56,  label: 'Solid',      context: 'Solid — a sound result.' },
  9:  { score: 46,  label: 'Fair',       context: 'Fair — a bit more elimination will tighten it up.' },
  10: { score: 36,  label: 'Keep Practicing', context: 'Getting there — focus on ruling digits out faster.' },
};

function humanScoreForTurns(turns) {
  if (HUMAN_SCORING[turns]) return HUMAN_SCORING[turns];
  // 11+: taper from 30 down to a floor of 10.
  return { score: Math.max(10, 30 - (turns - 10) * 6), label: 'Needs Practice',
           context: 'Lean on the elimination method — cross out every digit a 0/0 result rules out.' };
}

// The packet's optimal-solver benchmark, stated as a plain fact — deliberately NOT
// a second grade, so it can't contradict the human-fair label above (e.g. "Good"
// vs the table's harsher "Below Average" for the same 7-turn game).
function optimalComparisonLine(turns) {
  return `For reference, a perfect computer solver averages 5.21 turns and never needs more than 7 — you did it in ${turns}.`;
}

// ---------------------------------------------------------------------------
// Training Engine
//
// All functions below are pure (no DOM) except renderTraining(). They reuse
// evaluateGuess() as a consistency oracle: a candidate `c` is still possible
// after a guess `g` scored (b, cw) iff evaluateGuess(c, g) === (b, cw). Bulls
// and cows are symmetric for distinct-digit numbers, so the guess and a
// candidate secret can be swapped freely.
//
// INVARIANT: evaluateGuess is only well-defined when BOTH arguments are valid
// 4-digit, distinct-digit strings. Every candidate from buildCandidateSpace()
// satisfies this by construction, and every logged guess passed validateGuess().
// ---------------------------------------------------------------------------

// All 5040 legal secrets: 4 distinct digits 0-9, leading zero allowed (10·9·8·7).
function buildCandidateSpace() {
  const out = [];
  for (let a = 0; a <= 9; a++) {
    for (let b = 0; b <= 9; b++) {
      if (b === a) continue;
      for (let c = 0; c <= 9; c++) {
        if (c === a || c === b) continue;
        for (let d = 0; d <= 9; d++) {
          if (d === a || d === b || d === c) continue;
          out.push('' + a + b + c + d);
        }
      }
    }
  }
  return out;
}

const ALL_CANDIDATES = buildCandidateSpace();

// Keep only candidates that would have produced the same feedback for `guess`.
function filterCandidates(candidates, guess, bulls, cows) {
  return candidates.filter(c => {
    const r = evaluateGuess(c, guess);
    return r.bulls === bulls && r.cows === cows;
  });
}

// Largest feedback-partition bucket `guess` would leave against `pool` — i.e. the
// worst case for that guess. Works for any guess, including non-candidate probes.
function worstBucket(pool, guess) {
  const buckets = new Map();
  let worst = 0;
  for (const c of pool) {
    const r = evaluateGuess(c, guess);
    const key = r.bulls * 10 + r.cows;
    const n = (buckets.get(key) || 0) + 1;
    buckets.set(key, n);
    if (n > worst) worst = n;
  }
  return worst;
}

// Knuth-style minimax over the remaining candidates: the guess whose worst-case
// bucket leaves the fewest possibilities, plus that worst-case size. Restricting
// the guess pool to remaining candidates keeps it bounded and near-optimal.
// Deterministic tie-break: first candidate (by build order) wins.
function minimaxGuess(candidates) {
  if (candidates.length <= 1) return { guess: candidates[0], worst: candidates.length };
  let best = candidates[0];
  let bestWorst = Infinity;
  for (const guess of candidates) {
    const worst = worstBucket(candidates, guess);
    if (worst < bestWorst) {
      bestWorst = worst;
      best = guess;
    }
  }
  return { guess: best, worst: bestWorst };
}

function pickMinimax(candidates) {
  return minimaxGuess(candidates).guess;
}

// Derive what is PROVABLY known from a candidate pool — no guessing involved.
// A digit is "in" if it appears in every surviving candidate, "out" if in none;
// a position is "locked" if all candidates agree on its digit. O(pool).
function deriveKnowledge(pool) {
  if (!pool.length) return { knownIn: [], knownOut: [], lockedPositions: [] };

  const inCount = new Array(10).fill(0);   // # candidates containing digit d
  const posCount = [{}, {}, {}, {}];       // per-position digit frequency
  for (const c of pool) {
    const seen = new Set();
    for (let i = 0; i < 4; i++) {
      const ch = c[i];
      posCount[i][ch] = (posCount[i][ch] || 0) + 1;
      if (!seen.has(ch)) { inCount[+ch]++; seen.add(ch); }
    }
  }

  const n = pool.length;
  const knownIn = [], knownOut = [];
  for (let d = 0; d <= 9; d++) {
    if (inCount[d] === n) knownIn.push(d);
    else if (inCount[d] === 0) knownOut.push(d);
  }
  const lockedPositions = [];
  for (let i = 0; i < 4; i++) {
    const digits = Object.keys(posCount[i]);
    if (digits.length === 1) lockedPositions.push({ pos: i, digit: digits[0] });
  }
  return { knownIn, knownOut, lockedPositions };
}

// Walk the guess log front-to-back, tracking how the pool shrinks and what
// each round established. Information-gain framing: probes are valued, and the
// only flagged slip is reusing a digit already proven absent.
function analyzeGame(log) {
  let pool = ALL_CANDIDATES;
  let lockedAtRound = null;
  let slipCount = 0;
  let missedCount = 0;
  const rounds = [];

  log.forEach((entry, idx) => {
    const round = idx + 1;
    const poolBefore = pool.length;
    const knowledgeBefore = deriveKnowledge(pool);
    const guessDigits = entry.guess.split('').map(Number);

    // S1: digits in this guess the player could already have known were absent.
    const deadSet = new Set(knowledgeBefore.knownOut);
    const reusedDeadDigits = [...new Set(guessDigits)].filter(d => deadSet.has(d));
    if (reusedDeadDigits.length && entry.bulls !== 4) slipCount++;

    // S2: digits already proven present that this guess left out.
    const guessSet = new Set(guessDigits);
    const missedPresent = knowledgeBefore.knownIn.filter(d => !guessSet.has(d));
    // S3: positions already locked that this guess didn't honor.
    const missedLock = knowledgeBefore.lockedPositions.filter(l => entry.guess[l.pos] !== l.digit);
    if ((missedPresent.length || missedLock.length) && entry.bulls !== 4) missedCount++;

    pool = filterCandidates(pool, entry.guess, entry.bulls, entry.cows);
    const poolAfter = pool.length;
    const knowledgeAfter = deriveKnowledge(pool);
    if (lockedAtRound === null && poolAfter === 1) lockedAtRound = round;

    // What this response newly established (knowledge delta) — drives the per-turn line.
    const beforeOut = new Set(knowledgeBefore.knownOut);
    const beforeIn = new Set(knowledgeBefore.knownIn);
    const beforeLocked = new Set(knowledgeBefore.lockedPositions.map(l => l.pos));
    const deduction = {
      newlyOut: knowledgeAfter.knownOut.filter(d => !beforeOut.has(d)),
      newlyIn: knowledgeAfter.knownIn.filter(d => !beforeIn.has(d)),
      newlyLocked: knowledgeAfter.lockedPositions.filter(l => !beforeLocked.has(l.pos)),
      presentCount: entry.bulls + entry.cows,   // R4: total digits present
      zeroBulls: entry.bulls === 0,             // R6: none in those positions
      zeroZero: entry.bulls === 0 && entry.cows === 0, // R1: all four absent
    };

    const rec = {
      round,
      guess: entry.guess,
      bulls: entry.bulls,
      cows: entry.cows,
      poolBefore,
      poolAfter,
      eliminated: poolBefore - poolAfter,
      fractionEliminated: poolBefore > 0 ? (poolBefore - poolAfter) / poolBefore : 0,
      infoBits: poolAfter > 0 ? Math.log2(poolBefore / poolAfter) : 0,
      reusedDeadDigits,
      missedPresent,
      missedLock,
      deduction,
      knownIn: knowledgeAfter.knownIn,
      knownOut: knowledgeAfter.knownOut,
      lockedPositions: knowledgeAfter.lockedPositions,
      forced: poolBefore === 1,
    };
    rounds.push(rec);
  });

  const turnCount = log.length;
  const scored = rounds.filter(r => r.bulls !== 4 && !r.forced);
  const sharpest = scored.reduce((best, r) => (!best || r.infoBits > best.infoBits) ? r : best, null);
  const avgBits = scored.length ? scored.reduce((s, r) => s + r.infoBits, 0) / scored.length : 0;

  return {
    rounds,
    turnCount,
    lockedAtRound,
    slipCount,
    missedCount,
    sharpest,
    avgBits,
    freeRounds: lockedAtRound === null ? 0 : Math.max(0, turnCount - lockedAtRound),
  };
}

// Per-digit knowledge state after a round, in the player-facing colour language:
//   'bull'    — proven in the code AND its position is pinned (green)
//   'cow'     — proven in the code, position not yet known (yellow)
//   'out'     — proven absent (grey)
//   'unknown' — not yet determined (no highlight)
// All four states come straight from the pruned candidate set (deriveKnowledge),
// so the colours never claim more than is actually provable.
function classifyDigits(r) {
  const lockedDigits = new Set(r.lockedPositions.map(l => +l.digit));
  const inSet = new Set(r.knownIn);
  const outSet = new Set(r.knownOut);
  const states = [];
  for (let d = 0; d <= 9; d++) {
    if (lockedDigits.has(d)) states.push('bull');
    else if (inSet.has(d)) states.push('cow');
    else if (outSet.has(d)) states.push('out');
    else states.push('unknown');
  }
  return states;
}

// The logic that turns this round's bulls/cows response into provable facts —
// the reasoning a careful player should have done. Phrased to mirror the colour
// grid (grey / yellow / green) drawn beside it.
function coachingLogic(r) {
  if (r.bulls === 4) return 'All four digits correct and in place — solved.';
  if (r.forced) return 'Only one possible code was left, so this guess was already a certainty.';

  const digits = r.guess.split('').join(', ');
  if (r.deduction.zeroZero) {
    return `0 bulls and 0 cows: none of ${digits} are in the code — rule all four out (grey).`;
  }

  const present = r.deduction.presentCount;        // bulls + cows
  let line = `${r.bulls} bull${r.bulls === 1 ? '' : 's'} + ${r.cows} cow${r.cows === 1 ? '' : 's'}: `
    + `${present} of (${digits}) ${present === 1 ? 'is' : 'are'} in the code`;
  if (r.bulls === 0 && r.cows > 0) line += ', but none in the positions you tried';
  line += '.';

  // Mention only the facts this turn newly established, mapped to the grid colours.
  const lockedDigits = new Set(r.deduction.newlyLocked.map(l => +l.digit));
  const newCows = r.deduction.newlyIn.filter(d => !lockedDigits.has(d));
  const facts = [];
  if (r.deduction.newlyOut.length) facts.push(`rules out ${r.deduction.newlyOut.join(', ')} (grey)`);
  if (newCows.length) facts.push(`confirms ${newCows.join(', ')} in the code (yellow)`);
  if (r.deduction.newlyLocked.length) {
    facts.push(r.deduction.newlyLocked.map(l => `pins position ${l.pos + 1} to ${l.digit} (green)`).join(', '));
  }
  if (facts.length) line += ` Cross-referenced with earlier turns, this ${facts.join('; ')}.`;
  return line;
}

// S1/S2/S3: gentle nudge when a guess wasted a slot or ignored something provable.
function missedTip(r) {
  if (r.bulls === 4) return '';
  const tips = [];
  if (r.reusedDeadDigits.length) {
    const s = r.reusedDeadDigits.length === 1;
    tips.push(`digit${s ? '' : 's'} ${r.reusedDeadDigits.join(', ')} ${s ? 'was' : 'were'} already ruled out, `
      + `so ${s ? 'that slot' : 'those slots'} couldn't pay off`);
  }
  if (r.missedPresent.length) {
    const s = r.missedPresent.length === 1;
    tips.push(`you already knew ${r.missedPresent.join(', ')} ${s ? 'was' : 'were'} in the code — this guess left ${s ? 'it' : 'them'} out`);
  }
  if (r.missedLock.length) {
    const s = r.missedLock.length === 1;
    tips.push(r.missedLock.map(l => `position ${l.pos + 1} was already pinned to ${l.digit}`).join('; ')
      + ` — this guess didn't place ${s ? 'it' : 'them'} there`);
  }
  return tips.length ? 'You could have analyzed this differently: ' + tips.join('; ') + '.' : '';
}

// Replay the same secret with a perfect solver, seeded with the user's first
// guess so the turn counts are comparable.
function computerReplay(secret, firstGuess) {
  const turns = [];
  let pool = ALL_CANDIDATES;
  let guess = firstGuess;

  for (let i = 0; i < 12; i++) {        // generous cap; solver finishes well under this
    const { bulls, cows } = evaluateGuess(secret, guess);
    pool = filterCandidates(pool, guess, bulls, cows);
    turns.push({ guess, bulls, cows, poolAfter: pool.length });
    if (bulls === 4) break;
    if (pool.length === 0) break;       // inconsistency guard — should never happen
    guess = pickMinimax(pool);
  }

  return { turns, turnCount: turns.length };
}

// ---------------------------------------------------------------------------
// Win-screen debrief (shown on every win, training mode or not)
// ---------------------------------------------------------------------------
function scoreBand(score) {
  if (score >= 85) return 'great';
  if (score >= 60) return 'good';
  if (score >= 40) return 'ok';
  return 'low';
}

function renderDebrief(turns) {
  const s = humanScoreForTurns(turns);

  const badge = document.getElementById('score-badge');
  badge.innerHTML = '';
  const num = document.createElement('span');
  num.className = 'score-num';
  num.textContent = s.score;
  const label = document.createElement('span');
  label.className = 'score-label score-' + scoreBand(s.score);
  label.textContent = s.label;
  badge.appendChild(num);
  badge.appendChild(label);

  document.getElementById('score-context').textContent = s.context;
  document.getElementById('optimal-line').textContent = optimalComparisonLine(turns);

  renderDistribution(turns);
}

// Bar chart of the optimal-play turn distribution with the player's bucket marked.
function renderDistribution(turns) {
  const host = document.getElementById('distribution-chart');
  host.innerHTML = '';
  const beyond = turns >= 8;
  const maxPct = Math.max(...TURN_DISTRIBUTION.map(d => d.percentage));

  const barsRow = document.createElement('div');
  barsRow.className = 'dist-bars';
  const axisRow = document.createElement('div');
  axisRow.className = 'dist-axis';

  const addCol = (label, pct, isYou) => {
    const colBar = document.createElement('div');
    colBar.className = 'dist-colbar';
    if (isYou) {
      const you = document.createElement('span');
      you.className = 'dist-you';
      you.textContent = 'You';
      colBar.appendChild(you);
    }
    const bar = document.createElement('div');
    bar.className = 'dist-bar' + (isYou ? ' you' : '');
    bar.style.height = Math.max(4, Math.round((pct / maxPct) * 100)) + '%';
    colBar.appendChild(bar);
    barsRow.appendChild(colBar);

    const tick = document.createElement('div');
    tick.className = 'dist-tick' + (isYou ? ' you' : '');
    tick.textContent = label;
    axisRow.appendChild(tick);
  };

  for (const d of TURN_DISTRIBUTION) addCol(d.turns, d.percentage, !beyond && d.turns === turns);
  if (beyond) addCol('8+', 2, true);

  host.appendChild(barsRow);
  host.appendChild(axisRow);
}

// ---------------------------------------------------------------------------
// Turn-by-turn coaching (shown on EVERY win) + Training extras (toggle only)
// ---------------------------------------------------------------------------

// The always-on per-round breakdown. For each turn it shows the 0–9 digit grid
// coloured by what was provable AFTER that turn (grey = out, yellow = cow,
// green = bull, plain = unknown) and a plain-language statement of the logic.
function renderCoachingRounds(analysis) {
  const ol = document.getElementById('coaching-rounds');
  ol.innerHTML = '';
  for (const r of analysis.rounds) {
    const li = document.createElement('li');
    li.className = 'coach-round';

    const head = document.createElement('div');
    head.className = 'coach-head';
    head.innerHTML = `Round ${r.round} &middot; <strong>${r.guess}</strong> &rarr; ${r.bulls}B ${r.cows}C`;
    li.appendChild(head);

    // 0–9 knowledge grid as it stood after this turn.
    const grid = document.createElement('div');
    grid.className = 'digit-grid';
    const states = classifyDigits(r);
    for (let d = 0; d <= 9; d++) {
      const chip = document.createElement('span');
      chip.className = 'dchip dchip-' + states[d];
      chip.textContent = d;
      grid.appendChild(chip);
    }
    li.appendChild(grid);

    // The deductive logic for this turn.
    const logic = document.createElement('div');
    logic.className = 'coach-logic';
    logic.textContent = coachingLogic(r);
    li.appendChild(logic);

    // Turn-specific note when the guess ignored something already provable.
    const aside = missedTip(r);
    if (aside) {
      const a = document.createElement('div');
      a.className = 'coach-aside';
      a.textContent = aside;
      li.appendChild(a);
    }

    ol.appendChild(li);
  }
}

// Deep-dive extras, only when the Training checkbox is ticked.
function renderTrainingExtras(analysis) {
  const replay = computerReplay(secret, guessLog[0].guess);
  renderTrainingSummary(analysis, replay);
  renderDigitTracker(analysis.rounds);
  renderSolverTable(replay.turns);
  document.getElementById('training-panel').hidden = false;
}

function renderTrainingSummary(analysis, replay) {
  const el = document.getElementById('training-summary');
  el.innerHTML = '';
  const lines = [];

  // Solve + certainty.
  if (analysis.turnCount === 1 && analysis.rounds[0].bulls === 4) {
    lines.push('Cracked it on the very first guess — a fearless (or very lucky) opener!');
  } else if (analysis.lockedAtRound !== null && analysis.freeRounds === 0) {
    lines.push(`Solved in ${analysis.turnCount} turns, with no spare rounds once the answer was certain. Tight play.`);
  } else if (analysis.lockedAtRound !== null) {
    lines.push(`Solved in ${analysis.turnCount} turns. The answer became logically certain after round ${analysis.lockedAtRound} — ` +
      `that left ${analysis.freeRounds} round${analysis.freeRounds === 1 ? '' : 's'} where it could be read straight off.`);
  } else {
    lines.push(`Solved in ${analysis.turnCount} turns.`);
  }

  // Sharpest probe (skipped on a first-guess win — nothing to compare).
  if (analysis.sharpest) {
    const s = analysis.sharpest;
    lines.push(`Your sharpest probe was ${s.guess} in round ${s.round} — ${s.infoBits.toFixed(1)} bits, ` +
      `${Math.round(s.fractionEliminated * 100)}% of the field gone in one move.`);
    lines.push(`On average each guess gave you ${analysis.avgBits.toFixed(1)} bits of information.`);
  }

  // Dead-digit slips (the only genuine inefficiency).
  if (analysis.slipCount === 0) {
    lines.push('Every digit you tried was still live — no wasted slots. Clean probing.');
  } else {
    lines.push(`${analysis.slipCount} guess${analysis.slipCount === 1 ? '' : 'es'} reused a digit already proven absent — ` +
      `those slots gave nothing. Glance at the grey (ruled-out) digits before committing.`);
  }

  // Missed forced deductions (S2/S3).
  if (analysis.missedCount > 0) {
    lines.push(`${analysis.missedCount} time${analysis.missedCount === 1 ? '' : 's'} you had a forced deduction on hand — ` +
      `a digit known to be present, or a position already pinned — that your next guess didn’t use.`);
  }

  // Takeaway.
  let takeaway;
  if (analysis.slipCount > 0) {
    takeaway = 'Takeaway: before each guess, avoid the grey (ruled-out) digits — every one is a guaranteed dead slot.';
  } else if (analysis.freeRounds > 0) {
    takeaway = 'Takeaway: once the IN digits and locked positions pin a single number, just guess it — you’d already solved it on paper.';
  } else if (analysis.avgBits < 1.5 && analysis.sharpest) {
    takeaway = 'Takeaway: aim to roughly halve the remaining field each turn — guesses that split it evenly learn the most.';
  } else {
    takeaway = 'Takeaway: your guesses tracked the optimal information curve closely. Excellent deduction.';
  }
  lines.push(takeaway);

  for (const text of lines) {
    const p = document.createElement('p');
    p.textContent = text;
    el.appendChild(p);
  }

  // Solver comparison, emphasized.
  const cmp = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = `You: ${analysis.turnCount} turns · Solver: ${replay.turnCount} turns.`;
  cmp.appendChild(strong);
  el.appendChild(cmp);
}

// Final provable digit knowledge, in the same colour language as the per-turn
// grids: green = bull (placed), yellow = cow (in code), grey = out, plain = unknown.
function renderDigitTracker(rounds) {
  const host = document.getElementById('digit-chips');
  host.innerHTML = '';
  const states = classifyDigits(rounds[rounds.length - 1]);
  for (let d = 0; d <= 9; d++) {
    const chip = document.createElement('span');
    chip.className = 'dchip dchip-' + states[d];
    chip.textContent = d;
    host.appendChild(chip);
  }
}

function renderSolverTable(turns) {
  const tbody = document.getElementById('solver-body');
  tbody.innerHTML = '';
  turns.forEach((t, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td class="guess-cell">${t.guess}</td>
      <td class="bulls-cell">${t.bulls} B</td>
      <td class="cows-cell">${t.cows} C</td>
    `;
    tbody.appendChild(tr);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('guess-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitGuess();
    else document.getElementById('error-msg').textContent = '';
  });
  newGame();
});
