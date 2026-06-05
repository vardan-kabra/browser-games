# 29 — AI Improvement Log

> **STATUS: first tuning pass APPLIED (2026-06-05).** Candidates **#1, #2, #4, #5a, #6** and both
> Non-AI follow-ups (move-log capture bug, reveal flash) are implemented + verified — see
> **“Changes applied — 2026-06-05”** below. Games logged: **3** (+ chat analysis of hands 8/9).
> The user explicitly chose to act now ("update the game AI… everything incl. bidding & reveal")
> rather than wait for the ~7–8-game threshold; bidding (#4) shipped as conservative, band-scoped,
> reversible dials behind a Node regression harness. **Still open:** #3 (No-Trump strategy) and #5b
> (stop drawing trump once both opponents are void) — deferred, see the Changes section.
> Resume collecting exports; the next pass can retighten `AI_TUNING` against the new behaviour.

## How this works
- Each exported hand (`29-feedback-hand-N.json`, from the in-game **⬇ Export** button) gets a dated
  entry under **Game log**.
- Every flag is analyzed: **what the AI did** → **the `ai.js` function it came from** → **what it
  arguably should have done** → **does the user's critique hold?** → **candidate fix**.
- Recurring themes roll up into **Candidate AI changes** (this section becomes the change-spec once
  we hit the threshold).
- Rank order (high→low): **J 9 A 10 K Q 8 7**. Card points: J=3, 9=2, A=1, 10=1, K/Q/8/7=0
  (+1 for the last trick) = 29. Honours in 29 are **J and 9** (NOT K/Q — those are worth 0).

## Candidate AI changes (distilled — grows per game)

### Play engine — `ai.js`
1. **Cash established winners / run a long suit (on lead).** `aiLead` (ai.js:260–279) only ever
   (a) leads a non-trump **Jack** (longest such suit), else (b) the **lowest zero-point card**. It
   never detects "I hold the highest unplayed card(s) of a suit" and cashes them, nor runs a long
   established suit.
   - *Evidence:* Game 1 / **f4** (strong, reproducible) — on lead at trick 5 West held **♣9 + ♣A**
     (the two highest clubs left) but led **♥8** (its lowest zero-point card). Pure fall-through to
     rule (b).
   - *Candidate:* before the lowest-card fallback, if the AI holds the top unplayed card of a suit,
     cash down that suit (needs played-card tracking vs. the 8-card suit). Highest value in **No Trump**.

2. **Bank high-point winners; don't blindly dump under a beatable partner.** *(Top recurring theme —
   5 hands so far.)* Two rules in `aiFollowSuit` (ai.js:284–300) leak points: (a) **"partner winning →
   dump lowest"** (:289–291) ducks even when the partner's winning card can still be beaten by an
   un-played seat and the AI holds the boss; (b) **"win with the lowest winning card"** (:296) cashes
   the cheapest winner even when the AI holds a high-**point** winner (J=3 / 9=2) that's about to be
   stranded or ruffed. Both throw away points of high cards the AI could have banked.
   - *Evidence:* Game 1 f2 (ducked ♣7 under partner instead of overtaking ♣J for control); hand 3 f1
     (won trick 1 with ♥9 not the at-risk ♥J); hand 4 f2 (ducked ♣Q keeping ♣J → swept by a claim);
     **hand 9 f2** (3rd hand dumped ♥K under partner's ♥10 — but West's ♥9 beats ♥10; North held the
     boss ♥J and should have secured it); **hand 9 f3/f4** (won trick 4 with ♣A not ♣J; the kept ♣J was
     ruffed by East at trick 5 for −4, then East claimed → the contract failed).
   - *Candidate:* in `aiFollowSuit`, (i) when a partner is "winning" but an un-played seat can still
     beat that card, **secure the trick with your master**; (ii) when you'll win anyway, prefer winning
     with a **high-point** card (J/9) if it's at risk of being ruffed/stranded, not the cheapest winner.
     Unifying rule: **bank the points of high cards you can't safely keep.** (Still be careful —
     overtaking a *safe* partner winner is usually wrong.)

### No-Trump play (root cause of the play flags)
3. The play logic is **trump-centric**; there is **no No-Trump-specific strategy** (establish + cash
   long suits, manage tempo). NT contracts just run the same lead/follow rules with `trumpSuit = null`.
   This is the root of f2/f3/f4.
   - *Candidate:* an NT branch in `aiPlayCard`/`aiLead` that prioritizes cashing sure winners and
     establishing the longest suit.

### Bidding — `ai.js`
4. **Aggressiveness of the ceiling stack.** `aiBidValue` (ai.js:59–81) stacks `fiveSuitBonus (+2)` and
   `perTrumpHonour (+1 per J/9)` on the base band (`AI_TUNING.bid`, ai.js:7–14), hard-capped at **22**.
   - *Evidence:* Game 1 / **f1** (directionally valid) — West's **7-point** hand (5 clubs incl. **J+9**)
     computes to the **22 cap**: midBand(7)=18, +2 (5-card suit), +2 (two club honours) = 22 → the AI
     climbed the auction to 22.
   - *Candidate (after more data):* reconsider whether 5-suit + two J/9 should reach the very top on a
     7-point hand — e.g. soften the `fiveSuitBonus`/`perTrumpHonour` stacking, or gate the top of the
     band on minimum points.
   - *Honest correction to the user's note:* in **29 the honours ARE J and 9** (K/Q score 0). "None had
     a K/Q" reflects a K/Q-centric (bridge/whist) mental model; the AI rightly ignores K/Q. The real
     question is the **weight** on J/9 + length, not the absence of K/Q. (For the record the AI hands
     *did* hold high cards: E had K♠/K♦/Q♦/K♥; W had A♣/A♥/Q♠/Q♣/J♣.)
   - *Other direction (hand 9 / f1):* the model also **under-values strong-but-short suits**. North's
     3-card **J-9-A of clubs** + a second jack (♥J), ~10 pts, fell to the `weakCeiling` (16) because
     `aiBidValue` gates the mid/strong bands on a **4-card** suit — then the C12 score-lean (N–S ahead
     by 5) shaved another point, so North capped ~17 and passed where the user expected 18–19. So the
     valuation errs in *both* directions (over-values shape+J9 on thin hands, under-values short-strong
     suits + multi-jack hands). *Caveat:* the hand still **failed** at 18 — the real loss there was the
     **play** (Candidate #2), not the bid; logged as a valuation data point, not "bid higher."

### Declarer play — `ai.js`
5. **Declarer over-draws trump / is blind to its own (concealed) trump.** When the AI is the
   **declarer**, `aiPlayCard`/`aiLead` still receive `effectiveTrump()` = `null` while the trump is
   concealed, so the declarer can't see its *own* trump suit. Consequences: it may **lead its own
   trump** (to `aiLead` it just looks like the longest suit), and it keeps **drawing trumps after both
   opponents are already void** — pulling only its partner's trumps — instead of switching to a side suit.
   - *Evidence:* Game 2 (hand 8) / **f2 + f3** — North (declarer, ♣ trump) drew East's only club at
     trick 2, then kept leading ♣K/♣10 at tricks 4–5 (E & W already void) before finally turning to
     hearts at trick 6 — straight into East's boss ♥J, leaking two 10-point cards.
   - *Candidate:* give the declarer its **known** trump for play decisions (it chose it); have
     `aiLead` avoid leading its own trump, **stop drawing trumps once both opponents are void**, and
     develop a side suit. Distinct from the defender-side themes above.

### Concealed-trump / reveal — `ai.js`
6. **Reveal-gamble aggressiveness.** `aiShouldReveal` (ai.js:196–221) lets a **non-declarer** reveal
   only when the trick is worth ≥2 points **and** it holds a non-led **J/9** to ruff with. Because the
   reveal is a *discovery* (a non-declarer doesn't know the trump until it asks) and *not* holding the
   revealed suit merely costs a discard, this threshold may be **too conservative** — a high non-led
   card (A/K/10) could also win if its suit turns out to be trump.
   - *Evidence:* Game 2 (hand 8) / **f1** — West (no non-led J/9) declined; the user argues it should
     gamble on the reveal.
   - *Counter-weight (don't over-correct):* revealing **activates trump for everyone**, which usually
     helps a strong-trump declarer, so revealing freely can backfire for a defender. The right setting
     weighs reveal-EV (ruff a worth-it trick) against that cost.
   - *Candidate:* re-examine the reveal threshold (allow strong non-J/9 ruffers? factor "am I likely
     just waking the declarer's trumps?"). **Important framing fix:** never evaluate a reveal as if the
     player already knows the trump — it doesn't until it reveals.

## Changes applied — 2026-06-05

First tuning pass. All play-logic changes are **additive and backward-compatible**: `aiPlayCard` /
`aiLead` / `aiFollowSuit` gained an optional trailing `seen` arg (`{ played:Set<cardKey>, toActAfter,
declarerTrump }`, built in `game.js` `doAIPlay`); when it's omitted (`seen = null`) every new branch is
skipped and behaviour is byte-identical to before — the regression harness asserts both paths.

**Enabling change (E1).** `doAIPlay` (game.js) now builds `seen` and passes it through. The AI still
receives `effectiveTrump()` (null while concealed) as the *active* trump — the concealed declarer's own
trump rides separately in `seen.declarerTrump`, so the AI never treats inert trump as live. New pure
helper `isBoss(card, myHand, seen)` (every higher-ranked card of the suit is played or in hand).

- ✅ **#1 — cash established winners (`aiLead`).** Between the Jack rule and the low-card fallback, a
  `seen`-gated **boss branch**: if we hold the top unplayed card of a non-avoid suit, run the longest
  such suit and lead its highest boss.
- ✅ **#2 — bank winners / secure a beatable partner (`aiFollowSuit`).** (i) When a partner is winning
  but its card isn't the boss, an opponent is still to act, and we hold a master → secure with the
  cheapest master (gated to **concealed/No-Trump** so we don't expose a master to a live ruff).
  (ii) When sure to win a non-trump suit (last to act, or our winner is the led-suit boss) and we hold
  several winners → bank the **highest-POINT** one (`highestPointCard`) instead of the cheapest.
- ✅ **#4 — bidding valuation dials (`aiBidValue` / `AI_TUNING.bid`).** Band structure + hard-cap 22
  intact. (a) `strong3`: a 3-card suit headed by a J/9 **plus an A or K** now reaches the mid band
  instead of being dumped to `weakCeiling` (addresses the hand-9 under-bid). (b) `marriageBonus +1`
  when the trump candidate holds K+Q. (c) `shapeStackPtsMin`: on thin hands (<8 pts) the
  (5-suit + honours) shape stack is capped at +2 (curbs the Game-1 over-bid). No `_scoreLean` change.
- ✅ **#5a — declarer stops leading its own concealed trump (`aiLead`).** `avoidSuit = trumpSuit ||
  seen.declarerTrump`, applied in the Jack filter, boss branch, and low-lead fallback. (The full C8
  reveal/marriage logic was already correct.)
- ✅ **#6 — reveal-to-ruff threshold (`aiShouldReveal`).** Keeps J/9-ruffer → reveal on a worth-it
  (≥2-pt) trick; **adds**: a bare non-led **Ace** reveals on a richer (≥3-pt) trick. K/10 still excluded;
  declarer path + the C8 "never reveal over a winning partner" short-circuit untouched.
- ✅ **Non-AI: move-log capture bug (`feedback.js` / `game.js`).** `trickBuf` moved into the private
  state block and **reset in `beginHand`** — the root cause of phantom plays (a claim/concede ends a
  hand without `logTrickResolved`, so the in-flight buffer used to leak into the next hand's trick 1).
  Plus a defensive `trickSize` guard in `logTrickResolved` (warn + truncate on a desync; `trickSize()`
  passed from `resolveTrick`) and a `console.warn` if `revealTrump` is ever called without a revealer.
- ✅ **Non-AI: reveal flash too brief (`game.js` / `style.css`).** Flash 1600→**2600 ms**, CSS reps
  3→**5** (2.5 s), and the reveal toast holds **2700 ms** (`showToast` gained an optional duration).
- ✅ **UI: declarer can Claim/Concede pre-reveal (`game.js`).** Chip visibility factored into
  `refreshActionChips()` (self-gating on `phase===PLAYING && human turn && !resolving`) and re-asserted
  after every transient overlay closes (reveal prompt, marriage, rejected claim) — the chips used to
  stay hidden after a reveal prompt. `onClaim` already evaluated with the real `state.trumpSuit`.

**Deferred (not in this pass):** **#3** (a dedicated No-Trump strategy in `aiPlayCard`/`aiLead`) and
**#5b** (stop drawing trump once both opponents are void — needs void-tracking the AI can't legally have
under concealment). Both remain in the Candidate list above.

**Verification.** New committed harness `card-game-29/test-ai.js` (zero-dep; eval-loads cards.js + ai.js)
— **35/35 green**, asserting each heuristic *and* its legacy (`seen=null`) path. Preview-driven hands
(no-cache serve): clean load, **0 console errors** across 3 hands; a played-out hand's move-log sums to
**29** with every trick = 4 plays; a hand following an AI claim has **no phantom** in trick 1 (4 plays);
Claim/Concede chips **visible on South's pre-reveal turn** (and hidden during the resolve pause / on AI
turns). Cache-busters bumped: `ai.js v11`, `game.js v15`, `feedback.js v13`, `style.css v15`.

## Game log

### Game 1 — match `m-1780499431173` · 2026-06-03
**Contract:** South bid **23, No Trump.** **Result: FAILED** — N–S took **20** of 23 needed, **−2** game
points (match: We −2 / They 0). Played out; no marriage; trump never relevant (NT).

**Bidding recap:** E 16 → N 17 → E 17 → N 18 → E pass → W 19 → N 19 → W 20 → N 20 → W 21 → N 21 →
**W 22** → N pass → **S 23** → W pass. (The AI W↔N escalated to 22 before the human took it to 23 NT.)

**Tricks** (NT — highest of the led suit wins; winner in **bold**):
1. E♥7 N♥Q W♥A **S♥J** → S +4
2. S♣K **E♣10** N♠7 W♣7 → E +1
3. E♣8 N♦7 **W♣Q** S♠8 → W +0
4. **W♣J** S♦8 E♦Q N♠10 → W +4
5. W♥8 S♥10 **E♥9** N♦10 → E +4
6. E♠K **N♠9** W♠Q S♠A → N +3
7. **N♠J** W♣A S♦A E♦K → N +5
8. N♦9 W♣9 **S♦J** E♥K → S +8 (incl. last-trick +1)

**Flags:**
- **f1 — Bidding (too aggressive):** *Valid in direction; premise off.* → Candidate #4. W's
  7-pt / 5-club / J+9 hand maxes to the 22 cap; re-tune the J9+length weight (not "require K/Q", since
  K/Q are 0 in 29). One game isn't enough to act — logged for the pattern.
- **f2 — Trick 2 (West ducked ♣7 under partner's ♣10):** *Valid nuance.* → Candidate #2. With the long
  solid club suit, West overtaking with ♣J to seize control is the stronger line; the C8 rule always
  ducks a winning partner.
- **f3 — Trick 3 ("same stupidity"):** *Critique weak here.* West won with **♣Q** — the AI's correct
  "win with the lowest sufficient card" (`aiFollowSuit`). Not a blunder; the real theme (own and run the
  club suit) is already captured by f2/f4.
- **f4 — Trick 5 (West led ♥8 holding ♣9+♣A):** *Strongest, fully valid + reproducible.* → Candidate #1.
  `aiLead` has no cash-winners branch, so on lead it dumped its lowest zero-point card (♥8) and ignored
  the two top clubs it held. Clearest, highest-value fix target.

**Net for Game 1:** one strong play bug (f4 → cash winners), one valid play nuance (f2 →
overtake-for-control), one over-harsh flag (f3), one bidding-tuning data point (f1). The cross-cutting
root cause behind the play flags: **the engine has no No-Trump strategy.**

### Game 2 — match `m-1780548206076` · hand 8 · 2026-06-04
**Contract:** **North (AI)** bid **18, trump ♣** (revealed trick 7). **Result: MADE** — N–S took
**24** of 18 needed, **+1** (match We 5 / They 0). First logged hand where the **AI partner declared**.

**Bidding recap:** S 16 → E 17 → S 17 → E pass → **N 18** → S pass → W pass.

**Tricks** (♣ = concealed trump until trick 7; winner in **bold**). ⚠ trick 1 & 7 have move-log
glitches (see Non-AI follow-ups) — the clean reconstruction is shown:
1. S♠8 E♠9 **N♠J** W♠Q → N +5  *(log prepends two phantom plays "S♥8" / "E♦A" — not in those hands)*
2. **N♣J** W♥8 S♣9 E♣8 → N +5
3. **N♦J** W♦8 S♥A E♦7 → N +4
4. **N♣K** W♦K S♣7 E♠7 → N +0
5. **N♣10** W♥K S♣Q E♥Q → N +1
6. N♥10 W♦10 S♥7 **E♥J** → E +5
7. E♦Q **N♣A** (ruff) W♦A S♠K → N +2  *(reveal logged "by S" + ♣A still flagged inertTrump — metadata bug; N is the ruffer)*
8. **N♥9** W♠10 S♠A E♦9 → N +7 (last trick +1)

**Flags:**
- **f1 — Trick 2 (West didn't reveal):** *Corrected → valid design question* (my first pass got this
  wrong, retracted). **Non-declarers don't know the trump** — revealing is the *discovery* gamble
  (ask → the trump flips face-up → ruff if you hold that suit, else discard). The earlier "West is
  void in trump, so it can't ruff" was hindsight (I knew trump = clubs) and is wrong: West can't know
  its trump status until it reveals. What actually happened: `aiShouldReveal` declined because West
  holds no non-led **J/9** to ruff with (its gamble threshold) — not because it "knew" anything. Is
  that threshold too conservative? The user's instinct (reveal more readily — not holding the revealed
  trump just costs a discard) is a legitimate tunable → **Candidate #6**. Counter-weight (why it's a
  question, not a clear bug): revealing **activates trump for everyone**, generally aiding a
  strong-trump declarer — and here the trump *was* the led suit (clubs) with West void, so revealing
  would have gained nothing while helping declarer North, so declining wasn't punished *this* hand.
  The actionable item is the reveal heuristic, not this one play.
- **f2 — Trick 5 (North kept leading trump):** *Valid* → new **Candidate #5**. North (declarer) had
  already drawn the opponents' only trump (East's ♣8 at trick 2); leading ♣K/♣10 at tricks 4–5 pulled
  only partner South's trumps. Mechanism: the declarer plays blind to its own concealed trump, so
  `aiLead` leads clubs as "the longest suit" and never stops drawing.
- **f3 — Trick 6 (the leak):** *Valid nuance.* The trump over-draw meant North turned to hearts only
  at trick 6, leading ♥10 into East's boss ♥J and leaking two 10-point cards (N's ♥10 + W's ♦10) for
  East's +5. Direction is right; the exact "extra point" counterfactual would need a double-dummy solve.
  Reinforces #5.

**Net for Game 2:** f1 → *corrected* to a valid design question about reveal aggressiveness (new
Candidate #6), not the dismissal I first wrote; f2 + f3 valid → the new **declarer trump-management**
candidate (#5). Also surfaced a real **data-integrity bug** in the export (below) —
worth fixing, since corrupt logs would poison this whole feedback pipeline. (Aside: North made 18
easily with a 3-Jack monster; bidding 21 for the ±2 tier would have scored +2 not +1 — minor, unflagged.)

### Game 3 — match `m-1780548206076` · hand 9 · 2026-06-04
**Contract:** South bid **18, trump ♦** (revealed trick 5 by East). **Result: FAILED** — N–S took only
**6** of 18, **−1** (East **claimed** at trick 6). Match We 4 / They 0. The **AI partner (North)**
misplayed a strong hand into a rout.

**Bidding recap:** E 16 → N 17 → E 17 → **N pass** → W pass → **S 18** → E pass.
**Tricks** (♦ = concealed trump until trick 5; winner in **bold**):
1. E♦7 N♦K W♦9 **S♦J** → S +5
2. S♥10 E♥7 N♥K **W♥9** → W +3  *(W's ♥9 beats S's ♥10)*
3. **W♠J** S♠8 E♠7 N♠Q → W +3
4. W♣8 S♣7 E♣Q **N♣A** → N +1  *(N had ♣J/9/A — all winners — but took the cheapest)*
5. N♣J W♣10 S♣K **E♦Q** (ruff) → E +4  *(trump ♦ revealed by East)*
— then **East claims the last 3 tricks** → N–S finish 6/18.

**Flags:**
- **f1 — Bidding (North under-bid):** *Valid valuation point, with a caveat* → Candidate #4. North's
  3-card **J-9-A clubs** + ♥J (~10 pts) only reached ~17 (weakCeiling — no 4-card suit — plus the
  score-lean −1 when ahead), so it passed where the user wanted 18–19; the model under-rates
  short-but-strong / multi-jack hands. *Caveat:* the hand FAILED at 18 (took 6) — the disaster was the
  **play**, not the bid level.
- **f2 — Trick 2 (North dumped ♥K under partner's ♥10):** *Strong, valid* → Candidate #2. South's ♥10
  was winning but **beatable** — West (last to play) held ♥9 (beats ♥10). North, holding the boss **♥J**,
  should have secured the trick; `aiFollowSuit`'s "partner winning → dump lowest" played ♥K, West won,
  and the ♥J was later stranded.
- **f3 — Trick 4 (North won with ♣A, not ♣J):** *Strong, valid* → Candidate #2. North held ♣J/9/A (all
  beat East's ♣Q); the "win with the lowest winning card" rule took ♣A, keeping the at-risk **♣J**.
  It should have banked the 3-point ♣J. *(Plus a UI note — see Non-AI follow-ups.)*
- **f4 — Trick 5 (the payoff):** *Valid — confirms f2/f3.* North led the kept ♣J; East ruffed with ♦Q
  (revealing trump) for +4 and then **claimed the rest**, sweeping North's stranded ♥J too. Banking the
  jacks at tricks 2 and 4 would have saved those points and very likely the hand.

**Net for Game 3:** the **bank-high-point-winners** theme (Candidate #2) in its clearest, costliest
form — two un-banked jacks (♥J, ♣J) directly lost the hand (6/18, −1). Plus a bidding-valuation data
point (under-rating short-strong suits, #4) and a UI request (trump-reveal flash too brief).

## Non-AI follow-ups
- **Move-log capture bug (surfaced by the hand-8 export).** Trick 1 carries two **phantom plays** —
  `S ♥8` and `E ♦A`, cards not in those seats' deals (the real trick is the four spades
  S♠8/E♠9/N♠J/W♠Q, N wins +5). Trick 7 attributes the **reveal to S** although **N** is the seat that
  ruffed/won with ♣A, and that ♣A is still flagged `inertTrump`. Likely in `feedback.js`
  `logPlay`/`trickBuf` (stale/duplicated plays) and/or `revealTrump(byWhom)` attribution. **Fix and add
  a guard** — each trick should log exactly `trickSize` plays, each a card the seat actually holds.
- **Trump-reveal flash too brief (UI).** When an AI reveals the trump, the on-screen indication
  doesn't stay long enough to read (hand 9 / f3). Lengthen the reveal flash/toast by ~1 s so the
  player can register what happened.
