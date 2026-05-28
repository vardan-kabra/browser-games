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

Three feedback layers render on the win screen:
- **Performance debrief** (always, via `renderDebrief`): a **headline band** + **supporting label** from `headlineForTurns`, plus a "vs a perfect solver" line (`optimalComparisonLine`) and a turn-distribution bar chart (`renderDistribution`) marking the player's bucket. The bands are 1-5 = "at or better than optimal average", 6-7 = "within optimal range", 8+ = "room to improve"; the per-turn label (Miraculous / Exceptional / Excellent / Very Good / Good / Average / Below Average / Much Room to Improve) is supporting detail, never a 0-100 score (the previous `humanScoreForTurns`/`scoreForTurns`/`SCORING_TABLE`/`HUMAN_SCORING` model was retired per the spec — knowledge JSON is explicit: "It is NOT a 0-100 score"). Constants are bundled from `bulls cows knowledge.json` / `bulls cows training prompt.md` (a static `file://` page can't reliably `fetch` a sibling JSON).
- **Turn-by-turn analysis** (always, via `renderCoachingRounds`): per round, the guess→response, a **0–9 digit-knowledge grid** (`classifyDigits` → `dchip-bull`/`-cow`/`-out`/`-unknown` = green placed / yellow in-code / grey ruled-out / plain unknown), a plain-language **logic** statement of what that turn's response provably established (`coachingLogic`, phrased to mirror the grid colours), and a turn-specific aside (`roundAside`) that is either **praise** (`coach-aside-praise`, teal) for an S7 discriminating probe at the endgame, or **warn** (`coach-aside-warn`, amber) when the guess ignored something already provable (S1 only when filler-heavy per R11; S2 missed-present; S3 missed-lock). This deliberately *replaced* the older grade-chip / narrowing-bar / "sharper move" coaching (`gradeRound`/`computeImprovement`/`improvementLine` were removed); the earlier `missedTip` was likewise replaced by `roundAside`.
- **Training extras** (only when the checkbox is ticked, via `renderTrainingExtras`): the info-gain summary (`renderTrainingSummary`), the final digit-knowledge tracker (`renderDigitTracker`, reusing `classifyDigits`), and the solver replay (`renderSolverTable` + `computerReplay`, seeded from the player's first guess).

Coaching-signal implementation in `analyzeGame`: per R11, a known-absent digit as filler is **neutral**, so `fillerHeavyCount` (renamed from the old `slipCount`) only increments when round ≥ 3 AND ≥ 3 dead digits AND pool > 5 (truly excessive filler, not a clean discriminating probe). `probeCount` counts S7 — round ≥ 3 with a small pruned set (2–5) that the guess productively split. `analysis.sharpest` is filtered to round ≥ 3 so opener luck (rounds 1–2 baseline per `round_weighting`) isn't praised as skill.

The whole thing is built on **information gain**, not candidate membership — deliberately guessing a number that can't be the answer is a valid probe (it's what the solver does), never a mistake. `deriveKnowledge(pool)` extracts provable facts straight from the pruned pool (digit in/out if in every/no candidate; position locked if all agree) — the source of the digit grid/tracker, the logic lines, and the S1/S2/S3 signals, so feedback never overclaims (a digit only goes green/yellow/grey once it is genuinely forced). The rules R1–R10 / signals S1–S6 in `bulls cows deductive logic.json` are special cases of this pruned-set approach.

**Performance invariant:** per-round metrics (`deriveKnowledge`, `classifyDigits`, info bits) are O(pool). Minimax (O(n²)) now runs only in `computerReplay` (training-extras solver replay, seeded by the player's turn-1 guess) — the always-on coaching no longer invokes it, so the turn-1 pool of 5040 is never run through minimax.

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
