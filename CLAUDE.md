# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A collection of self-contained, dependency-free browser games written in vanilla HTML/CSS/JavaScript. There is no build step, package manager, framework, or test suite — each game runs by opening its HTML file directly in a browser.

## Running

Open the entry HTML file in a browser (double-click, or `start <file>` on Windows). No server is required since everything is loaded relatively.

- **Tic Tac Toe** — `tic-tac-toe.html` (single self-contained file: markup, CSS, and JS are all inline)
- **Bulls & Cows** — `bulls-and-cows/index.html` (split into `index.html`, `style.css`, `game.js`)
- **29 Card Game** — `card-game-29/index.html` (split into `index.html`, `style.css`, `game.js`, `cards.js`, `ai.js`, `feedback.js`)

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

- **Bidding** (asymmetric holder-match model — `29 Championship AI and Mechanics Spec.md` Part A, supersedes Rulebook §3): the opener (dealer's right) is forced to open 16 (or Single Hand) and can't pass; no all-pass redeal. Then a per-slot **1-v-1**: `state.bidStage` ∈ `open`/`slot-open`/`vs-holder`/`vs-challenger`; only the **holder may match** (`state.highBid`=currentBid, `state.highBidder`=holder), the challenger must always raise. `applyBidAction(seat, kind, amount)` is the one mutator (`open16`/`challenge`/`match`/`raise`/`pass`/`sh`); `humanBidAction`/`humanRaise` drive the contextual human controls (built in `renderBiddingPanel` per stage). AI bidding is the **championship table (Part C2)**: `aiBidValue(hand, lean)` returns a ceiling from `AI_TUNING.bid` (pts/suit-length/J9-honour bands, hard-cap 22); `aiBidValueAgainstHolder` adds the **partner rule** (pass <10 pts; bounded support-raise ≤`supportMax`; take-over with a 4+ J/9 suit) and the **C12 score-lean** (±1 near ±5). Auction grid (`renderAuctionGrid`, W/N/E/S) from `state.bidLog`.
- **Trump** (manual reveal-to-ruff — `29 Championship AI and Mechanics Spec.md` Part B, supersedes Rulebook §4–§5): the declarer secretly picks a suit (or No Trump), known **only to the bidder** and kept **inert** (`trumpRevealed=false`) — `effectiveTrump()` returns `null` until revealed, so every `trickWinner` call adjudicates on highest-of-led-suit and a trump card played while concealed is just an ordinary card. **No one activates trump proactively** (no auto-reveal, anyone may lead the concealed trump). Trump only wakes via `revealTrump()`, fired by the **ruff-only reveal**: a player void in the led suit may reveal (`revealApplicable`); on reveal they **must play a trump if they hold one** — for the human this is the `#reveal-prompt` modal → `onRevealTrump`/`onRevealDiscard` (gated by `state.forceTrumpOnly`), for the AI it's `aiShouldReveal` (worth-it + likely-hold gamble; never over a winning partner). The left-panel indicator card (`renderTrumpIndicator`) is face-down while concealed, the 3-of-suit face-up on reveal.
- **Marriage** (K+Q of trump; `checkForMarriage`/`declareMarriage`): only after trump is revealed AND the declaring side has won a trick; shifts the card-point target ±4 (floor 15 / cap 29), never the scoring tier.
- **Scoring** (`finishHand`, `bidTier`): tiers by *declared* bid — 16–20:±1, 21–27:±2, 28–29:±3 — applied to the bidding team only; the match is cumulative to ±6 (`matchOver`, `MATCH_TARGET`).
- **Double / Redouble** (`beginDoubleWindow`, `state.stakeMultiplier` ∈ {1,2,4}): a pre-play window that multiplies the swing — **currently OFF behind `RULE_OPTIONS.doubleRedouble`** (the code is kept and gated, not deleted; flip the flag to restore). AI heuristics: `aiShouldDouble`/`aiShouldRedouble`.
- **`RULE_OPTIONS`** (top of `game.js`): the togglable-rules config and seed of a future settings screen (`doubleRedouble:false`, `bidding:'asymmetric'`).
- **Single Hand** (solo ±6): `declareSingleHand`; the partner sits out so only 3 seats play (`activeSeats`/`nextActiveSeat`/`trickSize`), trump is open from the start (`trumpRevealed=true`), the declarer leads. Scored in `finishSingleHand` (+6 for all 8 tricks, else −6) and **ends the instant a defender wins a trick** (early-termination in `resolveTrick`). The AI declares it only on a near-lock (`aiShouldSingleHand`, **C9**: a 6+ J+9 trump suit, or 5 top trumps J/9/A + ≥2 outside aces — thresholds in `AI_TUNING.singleHand`, relaxed/tightened one step by the C12 score-lean).
- **AI card play** (Part C6–C8 in `ai.js`): `aiPlayCard` receives `effectiveTrump()` (null while concealed), so the AI never wins with inert trump. The **overtake rule (C8)** is in `aiDiscard` — never trump a trick a partner is already winning unless forced (only trumps in hand); when an opponent leads, ruff to win if able. `aiShouldReveal` (C4) is the conscious ruff-reveal decision.
- **Claim / Concede**: `claimHolds` is a depth-capped double-dummy solver — a **solo** claim holds iff the claiming seat wins *every* remaining trick by itself (you can't claim your partner's tricks). `awardRemaining(toTeam)` powers both Claim (claimant's team) and the human-only **Concede** (opponents; button id still `#giveup-btn` / handler `onGiveUp`, label "Concede"); it merges the in-flight trick back into hands so all seats show equal counts. (There is no turn-direction arrow — the toolbar status line is the sole turn indicator.)
- **End-of-hand review**: `state.dealtHands` snapshots the deal; at hand end `concludeHand` (no dark backdrop) opens every seat's ORIGINAL 8 cards face-up (`state.reviewMode='original'`); claimed/conceded hands first show the cards still held (`'remaining'`) for ~2.5s. The match-end scorecard is `renderHistoryTable` from `state.handHistory`.
- **Deck**: every card is built by the single factory `createCardEl(card, faceUp)`, which renders one of two **card styles** chosen by the persisted `cardStyle` (`'graphic'`|`'text'`, toolbar 🂠 toggle `onToggleCardStyle`, localStorage `cg29-card-style`, default graphic): **graphic** = the **CardMeister** custom element (`cardCid` → `<playing-card cid="8S">`, from `elements.cardmeister.full.js`, offline data-URI SVG); **text** = `buildTextCard` — a simple CSS card with corner indices + a big centre (`rank+SUIT_SYMBOL`, coloured via `SUIT_COLOR`), sized by **container-query units** (`.card{container-type:size}`, `cqh`/`cqw`) so the text auto-scales to each card box; face-down is a plain green `.text-back`. Both styles share the `.card`/`.trump-card`/`.playable`/`.unplayable` state classes; switching calls `repaintCards()` (re-renders hands + trump indicator + trick area, no state change).
- **Layout**: an 800×600 landscape table (toolbar + felt + left status panel + right **We/They** Need/Taken scoreboard). `fitToViewport()` (load + resize) scales it on **wide** screens; on **portrait/narrow** it clears the transform and a `@media (max-aspect-ratio: 11/10)` block fills the viewport with **overlapping fan hands** (vw-sized). In-play events use `showToast` (center, auto-fade). Inline `onclick`/global functions, so handlers must stay in global scope.
- **AI-feedback flagging** (`feedback.js` — `29 AI Feedback Flagging Spec.md`): a DOM-light data module `feedbackLog` (frozen global, statsStore-style) records a complete **per-hand move log** (deal, bidding, contract, marriage, trump reveal, every trick with seat-order plays + per-card roles `ledSuit/isTrump/inertTrump/winning`, running points, result + `endReason`), holds the player's **flags**, and assembles one self-describing JSON per hand via `buildExport()` (incl. `readme`, `rankOrderHighToLow`, `readableSummary`). game.js feeds it via ~9 one-line hooks (`beginMatch` in `startMatch`; `beginHand` in `startHand`; `setContract/setBidding/setTargets` in `beginPlay`; `logPlay` in `playCard`; `logTrickResolved` in `resolveTrick`; `logReveal` from `revealTrump(byWhom)`; `logMarriage` in `declareMarriage`; `noteEnd` in `acceptClaim`/`onGiveUp`/SH-break; `logResult` in `finishHand`/`finishSingleHand`) — game logic never reads back from it. The UI (game.js) is the 🚩 toolbar button + `#flag-panel` bottom-sheet (`renderFlagPanel`: anchor-trick stepper, related-trick chips, note, Save/Cancel, flags list, Export) kept **below the played cards** (capped `max-height`), plus an Export button on Hand Over. Flags persist in **localStorage** (`cg29-fb-<matchId>-h<n>`); export is a **Blob download** (`29-feedback-hand-N.json`). The move log is full-knowledge (true trump from the start); seats serialize as S/E/N/W, suits as S/H/D/C. **R2 (deferred):** tap-to-pin the exact card (`subjectPlay`, currently always `null`) + per-trick table markers. When changing scoring/trick/reveal/marriage logic, keep the corresponding `feedbackLog.log*` hook in sync.

## Card Game 29 — Conventions

**Rulebook sync (IMPORTANT):** whenever you change any Card Game 29 rule, scoring, or contract logic, update BOTH the canonical `card-game-29/29 Card Game Rulebook.md` (source of truth) AND the in-game Rules screen (`RULES_HTML` in `game.js`, three tabs: Basic Play / Rules & Scoring / Bidding & Contracts) so the player-facing rulebook never drifts from the code.

**Cache-busting:** `index.html` loads scripts with `?v=N`; bump it when you change `game.js`/`ai.js`/`cards.js`/`feedback.js`/`style.css` so browsers refetch. The root `service-worker.js` is **network-first** (CACHE `browser-games-v2`) so the online (GitHub Pages) build updates immediately for players; bump CACHE if you ever need to force-purge.

**Verification:** raster screenshots of the heavy card DOM time out, so verify by driving the page via DOM/state inspection rather than screenshots.

## Backlog / Revisit later

- **Settings screen** — surface `RULE_OPTIONS` to the player (toggle Double/Redouble, and later alternate bidding/scoring variants). Double/Redouble is currently flag-gated **off** (it was too swingy: a redoubled tier-2 hand is ±8, ending a ±6 match in one hand); re-tune the stakes / AI eagerness before re-enabling.
- **AI calibration** (`AI_TUNING` at the top of `ai.js`) — the C2 bidding ceilings and C9 single-hand thresholds are Monte-Carlo *directional*, not exact. They're surfaced as named constants precisely so they can be re-tightened against stronger agents / real play without touching the heuristic bodies.
- **Portrait layout** is a first pass (vw-sized overlapping fans) — fine-tune card sizes/spacing on real phones.

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
