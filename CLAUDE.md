# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A collection of self-contained, dependency-free browser games written in vanilla HTML/CSS/JavaScript. There is no build step, package manager, framework, or test suite — each game runs by opening its HTML file directly in a browser.

## Running

Open the entry HTML file in a browser (double-click, or `start <file>` on Windows). No server is required since everything is loaded relatively.

- **Tic Tac Toe** — `tic-tac-toe.html` (single self-contained file: markup, CSS, and JS are all inline)
- **Bulls & Cows** — `bulls-and-cows/index.html` (split into `index.html`, `style.css`, `game.js`)
- **29 Card Game** — `card-game-29/index.html` (split into `index.html`, `style.css`, `game.js`, `cards.js`, `ai.js`)

## Git / GitHub

The repository is hosted on GitHub at **https://github.com/vardan-kabra/browser-games** (remote `origin`, default branch `main`).

Standard workflow:

```
git add <files>
git commit -m "message"
git push origin main
```

**Pending work is auto-committed and pushed when the session ends.** A `SessionEnd` hook in `.claude/settings.json` runs `git add -A`, commits anything staged with a timestamped "Auto-commit on session end" message, and pushes to `origin main` — so work is never lost between sessions even if no explicit commit was made.

When you reach a meaningful, self-contained milestone *during* a session (a finished feature, a fix), prefer making a real commit with a clean, descriptive message scoped to that one change, rather than leaving it for the catch-all session-end commit. The auto-commit is a safety net, not a substitute for good commit messages. After pushing, a commit is viewable at `https://github.com/vardan-kabra/browser-games/commit/<sha>`.

## Architecture

Each game is independent — they share no code. Both follow the same pattern: module-level mutable state variables, an `init`/`newGame` reset function called on load, and DOM event handlers wired up at the bottom of the script. UI updates happen by directly mutating DOM nodes (`textContent`, `classList`, `innerHTML`); there is no virtual DOM or reactive layer.

**Tic Tac Toe** (`tic-tac-toe.html`): Board state is a flat 9-element array. The CPU opponent has three difficulty tiers in `computerMove()`:
- `easy` → `randomMove()`
- `medium` → `mediumMove()` (take a winning move, else block the opponent, else random)
- `hard` → `bestMove()`, a full minimax where CPU maximizes and human minimizes

`winningLine()` checks all 8 lines and is reused by both the end-game check and the minimax leaf evaluation. When editing AI behavior, note that minimax and the threat-detection helpers (`winningMoveFor`) mutate `state` in place and restore it.

**Bulls & Cows** (`bulls-and-cows/game.js`): The secret is a 4-digit number with unique digits, **leading zero allowed** (the 5040-code variant: 10·9·8·7), produced by `generateSecret()` via a Fisher–Yates shuffle. `evaluateGuess()` returns `{ bulls, cows }` (bulls = right digit + right position; cows = right digit, wrong position). `validateGuess()` enforces the 4-unique-digits rule before a guess is scored. Inline `onclick` handlers in `index.html` call global functions (`submitGuess`, `newGame`), so those functions must stay in global scope.

The file's second half is a self-contained **Training Engine** (pure functions, no DOM except the `render*` functions). It rests on the fact that the legal secret space is only 5040 numbers — enumerated once into `ALL_CANDIDATES`. `filterCandidates()` reuses `evaluateGuess()` as a consistency oracle (bulls/cows are symmetric for distinct-digit numbers, so candidate and guess are interchangeable).

Two feedback layers render on the win screen:
- **Performance debrief** (always, via `renderDebrief`): a **headline band** + **supporting label** from `headlineForTurns`, plus a "vs a perfect solver" line (`optimalComparisonLine`) and a turn-distribution bar chart (`renderDistribution`) marking the player's bucket. The bands are 1-5 = "at or better than optimal average", 6-7 = "within optimal range", 8+ = "room to improve"; the per-turn label (Miraculous / Exceptional / Excellent / Very Good / Good / Average / Below Average / Much Room to Improve) is supporting detail, never a 0-100 score (the previous `humanScoreForTurns`/`scoreForTurns`/`SCORING_TABLE`/`HUMAN_SCORING` model was retired per the spec — knowledge JSON is explicit: "It is NOT a 0-100 score"). Constants are bundled from `bulls cows knowledge.json` / `bulls cows training prompt.md` (a static `file://` page can't reliably `fetch` a sibling JSON).
- **Training-mode panel** (`#training-panel`, gated by the `#training-checkbox`): contains the **turn-by-turn analysis** (`renderCoachingRounds` — per round: guess→response, 0–9 digit-knowledge grid from `classifyDigits` → `dchip-bull`/`-cow`/`-out`/`-unknown`, plain-language `coachingLogic` line, and a `roundAside` that is either **praise** `coach-aside-praise` teal for an S7 discriminating probe or **warn** `coach-aside-warn` amber for S1-filler-heavy / S2 missed-present / S3 missed-lock), the **info-gain summary** (`renderTrainingSummary`), the **final digit-knowledge tracker** (`renderDigitTracker`, reusing `classifyDigits`), the **solver replay** (`renderSolverTable` + `computerReplay`, seeded from the player's first guess), and a second Play-Again button at the bottom. `showWinScreen` pre-renders all of this on every win and `#training-panel.hidden` is driven by the checkbox; a `change` listener on the checkbox flips visibility live post-win (gated by the module-level `gameOver` flag). The earlier `missedTip` was replaced by `roundAside`; the older grade-chip / narrowing-bar / "sharper move" coaching (`gradeRound`/`computeImprovement`/`improvementLine`) was removed.

`gameOver` (set in `showWinScreen`, cleared in `newGame`) also short-circuits `submitGuess` so a stray post-win guess can't be processed. Note: `style.css` has a top-level `[hidden] { display: none !important; }` rule — required because id-selector `display:` rules (e.g. `#input-area { display: flex }`) otherwise override the user-agent `[hidden]` default, silently breaking any future `element.hidden = true`.

**Dev-mode version badge (temporary):** `bulls-and-cows/game.js` has a top-level `const VERSION = "V5";` rendered into `#version-badge` (in the header) on `DOMContentLoaded`. When bumping `VERSION` (e.g. V5 → V6), also bump the `?v=N` cache-busters on `style.css` / `statsStore.js` / `game.js` in `index.html` AND in `service-worker.js`'s `ASSETS` list, plus the `CACHE` name there — so the visible badge doubles as confirmation that fresh assets actually loaded after deploy. To retire the badge: delete the `VERSION` const, the `#version-badge` `<span>` in `index.html`, the `.version-badge` CSS rule, and the one-line render in the `DOMContentLoaded` handler. Nothing else depends on it.

**Session statistics:** `bulls-and-cows/statsStore.js` is a session-scoped, in-memory aggregate of completed games, exposed as a frozen global `statsStore` with three methods: `addGame({turns, secret})` returns the newly-frozen record `{gameNumber, turns, secret, timestamp}` (store-assigned, not caller-supplied); `getSessionStats()` returns a frozen snapshot `{gamesPlayed, averageTurns (1-decimal, null when 0), bestTurns, worstTurns, spread, games}`; `getGames()` returns a frozen copy of all records. The display layer reads only through these methods, so a future login/server-backed implementation can replace the internals (probably local-cache-first with background network sync) without any display change. `submitGuess` calls `addGame` on 4-bull win **before** `showWinScreen`. `renderSessionStats` (called from `showWinScreen` after `renderDebrief`) populates `#session-stats` inside `#win-screen`: header (`#session-header`), session-average line vs the literal 5.21 optimal, best+spread line (hidden until `gamesPlayed >= 2`), per-game pills (`#session-games` → `.game-pill-great` ≤5 turns / `-ok` 6–7 / `-poor` 8+; reuses existing palette tints), and a "stats reset on refresh" footer. A lifetime tier slot (an HTML comment after `#session-stats`) marks where a future `<section id="lifetime-stats">` will render data from a future `statsStore.getLifetimeStats()` method — without changing any of the current three signatures.

Coaching-signal implementation in `analyzeGame`: per R11, a known-absent digit as filler is **neutral**, so `fillerHeavyCount` (renamed from the old `slipCount`) only increments when round ≥ 3 AND ≥ 3 dead digits AND pool > 5 (truly excessive filler, not a clean discriminating probe). `probeCount` counts S7 — round ≥ 3 with a small pruned set (2–5) that the guess productively split. `analysis.sharpest` is filtered to round ≥ 3 so opener luck (rounds 1–2 baseline per `round_weighting`) isn't praised as skill.

The whole thing is built on **information gain**, not candidate membership — deliberately guessing a number that can't be the answer is a valid probe (it's what the solver does), never a mistake. `deriveKnowledge(pool)` extracts provable facts straight from the pruned pool (digit in/out if in every/no candidate; position locked if all agree) — the source of the digit grid/tracker, the logic lines, and the S1/S2/S3 signals, so feedback never overclaims (a digit only goes green/yellow/grey once it is genuinely forced). The rules R1–R10 / signals S1–S6 in `bulls cows deductive logic.json` are special cases of this pruned-set approach.

**Performance invariant:** per-round metrics (`deriveKnowledge`, `classifyDigits`, info bits) are O(pool). Minimax (O(n²)) now runs only in `computerReplay` (training-extras solver replay, seeded by the player's turn-1 guess) — the always-on coaching no longer invokes it, so the turn-1 pool of 5040 is never run through minimax.

**29 Card Game** (`card-game-29/` — `game.js` engine, `ai.js` opponent, `cards.js` deck/comparison, `index.html`, `style.css`). The most complex game here. The canonical ruleset is `card-game-29/29 Card Game Rulebook.md` (source of truth), mirrored to the player by the in-game Rules screen (see the rulebook-sync rule below).

State lives in one mutable `state` object; `state.phase` (`PHASE`) drives the machine: IDLE → BIDDING → TRUMP_SELECT → DOUBLE → PLAYING → HAND_SCORING → MATCH_OVER. One human (South, seat 0) + 3 AI (East 1, North 2, West 3); fixed partnerships `TEAMS = [[0,2],[1,3]]` (N–S vs E–W). Rank J>9>A>10>K>Q>8>7 (`RANK_ORDER`); points J3/9·2/A1/10·1 (`POINT_VALUE`) = 28, plus 1 for the last trick = 29. All 8 cards dealt at once; play is counter-clockwise (`nextSeat`).

- **Bidding**: the opener (dealer's right) is forced to bid ≥16 and may not pass (`isForcedOpener`); there is no all-pass redeal. `aiBid` returns a strictly-increasing raise (`currentHighBid+1`) only when confidence supports it, capped at 22, else passes. The bridge-style auction grid (`renderAuctionGrid`, columns West/North/East/South) is built from `state.bidLog`.
- **Trump**: the declarer secretly picks a suit (or No Trump), kept hidden (`trumpRevealed=false`) until a player can't follow or a trump is played (`revealTrump`); the declarer may not lead the concealed trump. The left-panel indicator card (`renderTrumpIndicator`) is face-down while concealed, the 3-of-suit face-up on reveal.
- **Marriage** (K+Q of trump; `checkForMarriage`/`declareMarriage`): only after trump is revealed AND the declaring side has won a trick; shifts the card-point target ±4 (floor 15 / cap 29), never the scoring tier.
- **Scoring** (`finishHand`, `bidTier`): tiers by *declared* bid — 16–20:±1, 21–27:±2, 28–29:±3 — applied to the bidding team only; the match is cumulative to ±6 (`matchOver`, `MATCH_TARGET`).
- **Double / Redouble** (`beginDoubleWindow`, `state.stakeMultiplier` ∈ {1,2,4}): a window before the first trick — defenders may double, bidders redouble — multiplying the game-point swing. AI heuristics: `aiShouldDouble`/`aiShouldRedouble`.
- **Single Hand** (solo ±6): `declareSingleHand`; the partner sits out so only 3 seats play (`activeSeats`/`nextActiveSeat`/`trickSize`), trump is open from the start, the declarer leads. Scored in `finishSingleHand` (+6 for all 8 tricks, else −6) and **ends the instant a defender wins a trick** (early-termination in `resolveTrick`). The AI declares it only on a monster hand (`aiShouldSingleHand` — long J+9 trump + high points).
- **Claim / Give Up**: `claimHolds` is a depth-capped double-dummy solver — a **solo** claim holds iff the claiming seat wins *every* remaining trick by itself (you can't claim your partner's tricks). `awardRemaining(toTeam)` powers both Claim (claimant's team) and the human-only **Give Up** (opponents); it merges the in-flight trick back into hands so all seats show equal counts.
- **End-of-hand review**: `state.dealtHands` snapshots the deal; at hand end `concludeHand` (no dark backdrop) opens every seat's ORIGINAL 8 cards face-up (`state.reviewMode='original'`); claimed/conceded hands first show the cards still held (`'remaining'`) for ~2.5s. The match-end scorecard is `renderHistoryTable` from `state.handHistory`.
- **Deck**: cards render via the **CardMeister** custom element (`createCardEl`/`cardCid` → `<playing-card cid="8S">`), loaded from `elements.cardmeister.full.js` — crisp, bold, fully offline (data-URI SVG, works on `file://`).
- **Layout**: a fixed 800×600 landscape table (toolbar + felt + left status panel + right Need/Taken scoreboard) scaled to any viewport by `fitToViewport()` (load + resize). Inline `onclick`/global functions, so handlers must stay in global scope.

## Card Game 29 — Conventions

**Rulebook sync (IMPORTANT):** whenever you change any Card Game 29 rule, scoring, or contract logic, update BOTH the canonical `card-game-29/29 Card Game Rulebook.md` (source of truth) AND the in-game Rules screen (`RULES_HTML` in `game.js`, three tabs: Basic Play / Rules & Scoring / Bidding & Contracts) so the player-facing rulebook never drifts from the code.

**Cache-busting:** `index.html` loads scripts with `?v=N`; bump it when you change `game.js`/`ai.js`/`cards.js`/`style.css` so browsers refetch. The root `service-worker.js` is **network-first** (CACHE `browser-games-v2`) so the online (GitHub Pages) build updates immediately for players; bump CACHE if you ever need to force-purge.

**Verification:** raster screenshots of the heavy card DOM time out, so verify by driving the page via DOM/state inspection rather than screenshots.

## Backlog / Revisit later

- **Double/Redouble is too swingy** — a redoubled tier-2 hand is ±8, which can end a ±6 match in a single hand; revisit the stakes and/or how eagerly the AI doubles/redoubles (`aiShouldDouble`/`aiShouldRedouble`).
- **AI Single-Hand threshold** (`aiShouldSingleHand`) is hand-tuned (long J+9 trump + points ≥ 11 + 6 top cards); revisit against real play.
- **Mobile portrait** — currently scale-to-fit (small on a portrait phone); a portrait-specific layout is a possible future redesign.

## Bulls and Cows — Training Mode Context

You are the training coach for a Bulls and Cows game (4-digit secret, distinct digits, 0-9).

Knowledge files to read each session:
@bulls-and-cows/bulls cows knowledge.json
@bulls-and-cows/bulls cows training prompt.md
@bulls-and-cows/bulls cows deductive logic.json

Scoring is benchmark-based, NOT a 0-100 score. A perfect solver averages 5.21 turns and never needs
more than 7. Single-game bands: 1-5 = at/better than optimal average; 6-7 = within optimal range;
8+ = room to improve. Per-user percentile is a future (login) feature.

When a game finishes:
1. Take the player's full guess history (each turn: guess + bulls/cows).
2. Apply rules R1-R11 to reconstruct the pruned set after each turn.
3. Identify coaching signals S1-S7. Known-absent filler digits are NOT mistakes (S1 neutral);
   a discriminating probe (S7) is praiseworthy.
4. Weight feedback by round: rounds 1-2 are baseline/guesswork (neutral); reserve real praise for round-3+ deduction.
5. Generate a debrief in the format and tone from bulls cows training prompt.md.

Rules: never reveal the secret during play; in training mode show exactly ONE collapsible hint per turn
(closed by default); if asked "what should I guess?", apply rule R10 on the current pruned set; be warm
and specific; never over-praise early-round eliminations.
