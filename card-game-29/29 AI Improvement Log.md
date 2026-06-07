# 29 — AI Improvement Log

> **STATUS: first tuning pass APPLIED (2026-06-05).** Candidates **#1, #2, #4, #5a, #6** and both
> Non-AI follow-ups (move-log capture bug, reveal flash) are implemented + verified — see
> **“Changes applied — 2026-06-05”** below. Games logged: **5** (+ chat analysis of hands 8/9).
> The user explicitly chose to act now ("update the game AI… everything incl. bidding & reveal")
> rather than wait for the ~7–8-game threshold; bidding (#4) shipped as conservative, band-scoped,
> reversible dials behind a Node regression harness. **Status:** #3 (No-Trump strategy — **Phases 1–2
> applied 2026-06-07**; 3b hold-up won't-build, Phase 4 defender-inference deferred pending evidence) and
> **#5b** (stop drawing trump once both opponents are void, still open) — see the Changes sections.
> Resume collecting exports; the next pass can retighten `AI_TUNING` against the new behaviour.
>
> **POST-PASS (2026-06-05): Games 4–5 logged** (match `m-1780656179625`, hands 2–3) — **played on the
> NEW build** (confirmed: the #6 bare-Ace reveal fired at G4 trick 6, a new-build-only branch). They
> expose **two residual gaps the first pass did NOT cover**, now the priority for a 2nd pass: **(a) bank
> points under a *securely*-winning partner** — #2(i)/(ii) handle overtaking a *beatable* partner and
> banking when *you* win, but NOT "partner safely wins → throw my highest-POINT card" (G5 f1/f2); **(b)
> reveal-to-ruff on a *developing* trick / from the declaring side** — `aiShouldReveal`'s `worthIt` counts
> only points already on the table, so the declarer's partner ducked a 5-point ruff (G4 f2). The
> **card-tracking infra itself (`seen`/`isBoss`) is confirmed live and correct** — these are decision
> heuristics that don't yet *consume* it.

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
   - ⚠ **Residual gap after the first pass — sub-case (iii), the priority next play fix (G5 f1/f2, hand 3
     of `m-…625`).** The shipped #2 covers (i) overtake a *beatable* partner and (ii) bank when *you* win
     — but NOT the case where the partner is **securely** winning (you're last to act, or its card is
     unbeatable by what's left) and you must follow: the branch still dumps `lowestCard`. It should **bank
     your highest-POINT non-boss card** (give the points to the partner's sure trick). *Evidence:* North,
     last to act under partner South's winning ♦9 ruff, held ♣Q(0)/♣10(1)/**♣9(2)** and dumped ♣Q — should
     have thrown ♣9 (**+2**), which also frees the 0-point ♣Q to discard at trick 5 instead of leaking ♣10.
     Use `isBoss` so you don't bank a high card you can still cash yourself; the user's own reasoning is
     pure card-tracking ("the ♣J is still out → my ♣9 won't win later → cash its points now"). *(Minor
     sibling: `safeDiscard` breaks ties by lowest **rank**, not lowest **point** — a 0/1-pt refinement.)*

### No-Trump play (root cause of the play flags)
3. The play logic is **trump-centric**; there is **no No-Trump-specific strategy** (establish + cash
   long suits, manage tempo). NT contracts just run the same lead/follow rules with `trumpSuit = null`.
   This is the root of f2/f3/f4.
   - *Candidate:* an NT branch in `aiPlayCard`/`aiLead` that prioritizes cashing sure winners and
     establishing the longest suit.
   - ✅ **Phase 1 applied (2026-06-07)** — the "establish the longest suit" lead + the `seen.noTrump`
     gate. Cashing sure winners was already handled by #1; Phase 1 adds the *develop a long suit* half.
   - ✅ **Phase 2 applied (2026-06-07)** — role-aware declarer play (`seen.role`, `ntLengthWinners`): the
     NT declarer **establishes a strong long suit before cashing a lone side boss** (keeps it as a
     re-entry). This **folded in the planned Phase 3a** (re-entry retention) — they were one behaviour.
   - **Decision (2026-06-07): #3 concluded with Phases 1–2** — the declarer/leading side, where all the
     logged evidence (Game 1) actually was. **Phase 3b (hold-up): won't-build** — high regression surface
     on `aiFollowSuit`, low ROI in point-dense 8-trick 29 (ducking risks conceding point tricks), and no
     evidence. **Phase 4 (defender partner-suit): deferred** pending a logged NT-defense flag — 29 has no
     signaling, so it's pure played-card inference and speculative without evidence. Per the project's
     feedback-driven workflow, resume collecting NT exports; build 3b/4 only if a hand demonstrates the need.

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
   - ⚠ **Residual gap after the first pass (G4 f2, hand 2 of `m-…625`).** The shipped #6 (allow a bare
     non-led **Ace** ruffer on a ≥3-pt trick) didn't help where it mattered: `worthIt` is computed on
     **points already on the table**, so the declarer's PARTNER (North) — void in spades with a spare ♣7
     trump + two outside 9s — **ducked a developing 5-point trick** (only ♠Q=0 was down at its turn) and
     let West win with ♠J. Two refinements: **(a)** the **declaring side** (declarer *or* partner) should
     reveal-to-ruff an opponent-winning trick far more readily — it's their *own* trump and it can **enable
     the partner's marriage** (here S held the ♣ marriage); **(b)** `worthIt` should weigh the trick's
     *potential* (seats still to act), not just the current pot. *Counter-observation (same hand, t6):* the
     new bare-Ace branch fired for **West** holding **no trump** (its Ace was hearts, trump clubs) — a
     wasted reveal that *enabled* South's marriage, so the **defender** bare-Ace gamble may want a touch
     more caution even as the declaring-side floor rises. Map: `aiShouldReveal`.
   - ⚠ **God-mode reveal gate (G4 f1) — a *separate* fix from the threshold.** `doAIPlay` (game.js:667)
     gates the AI reveal on `ledIsTrump = ledSuit === state.trumpSuit` — the **real** trump — for **every**
     seat. A non-declarer can't know the trump, so this lets the AI "skip a pointless reveal" by *peeking*,
     inconsistent with the discovery model (and with the human, who via `revealApplicable` IS offered the
     reveal even when led=trump — deliberately, so its absence can't leak the trump). **Fix: remove the
     `!ledIsTrump` gate** and let `aiShouldReveal` decide purely from the AI's own hand. Consequence: the AI
     will sometimes reveal and find the led suit *was* trump (void in trump → discard) — a wasted reveal,
     but the *fair* one. (`knownTrump` itself is fine — `null` for non-declarers.) Pairs with the
     defender-caution refinement above, so a defender doesn't wake the declarer's trump cheaply.

### Trump husbandry — `ai.js`
7. **Don't squander trumps; draw them when long.** Two layers, both from hand 3 (declarer's partner, N):
   - ✅ **(a) applied 2026-06-07 (Thread 1a)** — `safeDiscard` pitched a trump as junk under a winning
     partner; it is now trump-aware (sheds non-trump first). See the 2026-06-07 trump-husbandry change.
   - ⏳ **(b) open (Thread 1b)** — proactive **trump-drawing**: with trump length/control the declaring
     side should *lead* trumps to strip the opponents' (hand 3 f2/f3), preventing late ruffs. Larger add.

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

## Changes applied — 2026-06-06 (reveal pass)

Second tuning pass — the reveal work from Candidate #6. **Defender and declarer behaviour are
unchanged**; the two edits affect only (a) whether a non-declarer's reveal is gated by god-mode, and
(b) how readily the bidder's *side* reveals.

- ✅ **Dropped the god-mode reveal gate (`game.js` `doAIPlay`).** Removed `const ledIsTrump = ledSuit ===
  state.trumpSuit` and the `!ledIsTrump` term from the AI-reveal condition. A non-declarer no longer
  "peeks" at the real trump to skip a reveal — it evaluates the reveal as a pure discovery gamble from its
  own hand (`aiShouldReveal`). If the led suit turns out to BE the trump, it reveals, finds itself void in
  trump, and discards (`mustRuffWithTrump` stays false) — the fair cost the human already takes via
  `revealApplicable`.
- ✅ **Declaring-side reveal readiness (`ai.js` `aiShouldReveal`).** The non-declarer gamble stays
  hand-only (never reads the trump). Added: on the **bidder's side** (declarer or partner) a J/9 ruffer
  reveals on a worth-it **OR still-developing** trick (`developing = trick.length < 3`) — fixing G4 f2
  (North ducked a 5-point ruff because only ♠Q=0 was on the table at its turn). A **defender** keeps the
  shipped thresholds (J/9 → ≥2 pts; bare Ace → ≥3 pts), since a defender wakes the *declarer's* trump.
- **Verification.** `node card-game-29/test-ai.js` → **41/41** (6 new declaring-side-vs-defender cases;
  every prior defender / declarer / `seen=null` case still green). Both edited files `node --check` clean.
  Live preview (no-cache): fresh boot **0 console errors**, `ai.js?v=12` / `game.js?v=16` loaded, the
  `ledIsTrump` reference gone from the running `doAIPlay`, and the page's own `aiShouldReveal` returns the
  corrected verdicts on the real G4-t4 position (declaring-side developing → reveal; defender same trick →
  hold; declaring-side last-to-act 0-pt → hold). Cache-busters: `ai.js v11→v12`, `game.js v15→v16`.

**Still open in the reveal area (left for more data):** a *defender*-caution dial (the G4-t6 bare-Ace
misfire) — kept at the shipped threshold to avoid over-tightening without self-play data. Separately still
queued: **Candidate #2 sub-case (iii)** bank-to-a-winning-partner, and the **Review trump-reveal display**.

## Changes applied — 2026-06-07 (No-Trump pass, Phase 1)

First phase of **Candidate #3** — a dedicated No-Trump play strategy, the root cause behind the Game-1
play flags. The full NT strategy ships in **staged, independently-testable phases** (plan: establish-lead
→ declarer winner-count → re-entry/hold-up → defender partner-suit). Phase 1 lands the foundational piece
and its plumbing; later phases add role-aware declarer/defender logic. As with the earlier passes every
change is **additive** and gated on a new `seen.noTrump` flag that is **false under any concealed/active
trump**, so concealed-trump play (#5/#6) is provably untouched.

**Enabling change.** `doAIPlay` (game.js) now sets `seen.noTrump = state.isNoTrump` on the card-tracking
bag — the first signal that lets the AI tell a genuine No-Trump deal from "trump concealed" (both used to
present as `trumpSuit = null` / `declarerTrump = null` to a non-declarer).

- ✅ **#3 Phase 1 — establish the longest suit on lead (`aiLead`).** A new NT-only branch sits **between**
  the boss-cash branch (#1) and the low-card fallback: with no Jack to lead and no boss to cash, the AI
  leads the **lowest card of its longest "developable" suit** (`ntLongestEstablishSuit`) to promote that
  suit's small cards into winners (no trump can ruff length away). A suit qualifies only if it is ≥4 long,
  is not a pure cash (all bosses — the boss branch owns those), and either holds a J/9 or is ≥5 long (so a
  ragged top-less suit isn't bled into opponents' tricks). Tie-break length → J/9 → points, mirroring
  `preferredTrumpSuit`. New play dials live in `AI_TUNING.play.nt` (`establishMin:4`, `establishStrong:5`)
  — the first *play*-strategy constants (only bidding had dials before). Replaces the old "dump the
  globally-lowest zero-point card" passivity that lost Game 1.

**Verification.** `node card-game-29/test-ai.js` → **49/49** (8 new #3 cases incl. the Game-1/f4
reconstruction — West now cashes the top club ♣9 instead of the logged ♥8 blunder; the legacy `seen=null`
path still reproduces the old ♥8, proving additivity; plus an explicit `noTrump=false → legacy` guard so
the branch can never fire under concealed trump). Every prior defender/declarer/`seen=null` case still
green. `node --check` clean on `ai.js`/`game.js`. Cache-busters: `ai.js v12→v13`, `game.js v16→v17`.

**Deferred to later phases (per the staged plan):** **Phase 2** declarer winner-count → length bias
(`seen.role`, `estimateNtTricks`); **Phase 3** re-entry retention (3a) + narrow hold-up (3b, may be
dropped — low ROI in point-dense 29); **Phase 4** defender partner-suit inference (`seen.history`). #3
stays **partially applied** until those land.

## Changes applied — 2026-06-07 (No-Trump pass, Phase 2)

Second phase of **Candidate #3** — role-aware declarer play, **merging in the planned Phase 3a** (they
were one behaviour). Still additive and `seen.noTrump`-gated (concealed trump untouched); now also
role-gated.

**Enabling change.** `doAIPlay` (game.js) sets `seen.role` (`'declarer'|'partner'|'defender'`, via the new
`_ntRole(seat, declarer)`; `null` outside NT) so the play heuristics can act by role.

- ✅ **#3 Phase 2 — declarer establishes a long suit before cashing a lone side boss (`aiLead`).** A new
  NT-declarer branch sits **before** the boss-cash branch: with a developable long suit that has real
  length potential (`ntLengthWinners(suit) >= declarerLengthMin`, i.e. genuinely 5+ at the table) and only
  a **lone side boss** (`<= reentryKeep`), the declarer leads low to **establish** the long suit, keeping
  the side boss as the **re-entry** to cash that length later — instead of cashing the boss immediately and
  losing the tempo to develop. Defenders/partner keep the normal cash-then-establish order. New helper
  `ntLengthWinners` (optimistic length-winner estimate from `seen.played`); new dials
  `AI_TUNING.play.nt.declarerLengthMin:2` / `reentryKeep:1`. (`estimateNtTricks` from the plan was *not*
  added — nothing consumed it; `ntLengthWinners` is the primitive the decision actually needs.)

**Verification.** `node card-game-29/test-ai.js` → **59/59** (10 new #3 Phase-2 cases: `ntLengthWinners`
estimates incl. `seen=null→0`; declarer-establishes-♠7 vs defender-cashes-♣A vs `noTrump=false`→cash gate;
the `reentryKeep` gate — 2 side bosses → cash; the `declarerLengthMin` gate — a 4-card suit → cash; every
prior case green). `node --check` clean. Live no-cache bundle: `ai.js v14`/`game.js v18`, `_ntRole` live
(`declarer`/`partner`/`defender`), `doAIPlay` wires `role`, the declarer/defender/gate verdicts correct,
0 console errors. Cache-busters: `ai.js v13→v14`, `game.js v17→v18`. **Note:** this only changes *which
legal card* the declarer leads — never legality — so the per-hand 29-point balance is unaffected.

**Deferred:** **Phase 3b** narrow hold-up (low ROI — likely dropped) and **Phase 4** defender partner-suit
inference (`seen.history`). #3 stays **partially applied** until Phase 4 lands.

## Changes applied — 2026-06-07 (trump husbandry — Thread 1a)

From the new batch of exports (hands 3, 5, 10, 12–15). **Thread 1a of the trump-management theme** —
`safeDiscard` wasted trumps. **Confirmed bug; fix is surgical and additive.**

- ✅ **#1a — `safeDiscard` keeps trump (ai.js).** When the AI is void and must discard (including under a
  winning partner — the C8 path in `aiDiscard`), `safeDiscard(hand, trumpSuit)` now pitches **non-trump**
  junk and only sheds a trump when the hand is all trump — preserving trump length for ruffing / drawing.
  `aiDiscard` passes `trumpSuit` through. With no active trump (concealed / No Trump → `trumpSuit` null)
  the pool is the whole hand, so behaviour is **byte-identical** to before.
  - *Evidence:* Hand 3, trick 2 — North, void in ♦ with partner South already winning the ruff (♣9),
    pitched **♣8 (a trump)** instead of ♠8. Root cause: the old `safeDiscard` filtered to zero-point cards
    with no trump-awareness, so a zero-point trump (♣8) tied with a non-trump (♠8) on rank and got dumped.
    Wasting that trump fed the later loss (East kept a club that ruffed the last trick — hand 3 f2/f3).

**Verification.** `node card-game-29/test-ai.js` → **64/64** (5 new #1a cases: trump-aware pitch, all-trump
forced, the `trumpSuit=null` legacy guard, the Hand-3 `aiDiscard` reproduction, and a partner-not-winning
fallback case that covers **both** `aiDiscard` call sites; every prior case green).
`node --check` clean. Live no-cache bundle: `ai.js?v=15`, `safeDiscard` arity 2, the Hand-3 position now
pitches ♠8 (keeps ♣8), legacy null path still ♣8, 0 console errors. Cache-buster: `ai.js v14→v15`
(game.js unchanged).

**Still open in this theme — Thread 1b (proactive trump-drawing):** when the declaring side has trump
length/control it should *lead* trumps to strip the opponents' (hand 3 f2/f3) — a larger strategic add,
not in this pass.

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

### Game 4 — match `m-1780656179625` · hand 2 · 2026-06-05  *(post-pass; NEW build)*
**Contract:** South bid **21, trump ♣** (revealed trick 6 by W). **Result: MADE** — N–S took **23** of 17
needed, **+2** (match We 4 / They 0). Marriage S −4 at trick 6.

**Bidding recap:** N 16 → W pass → **S 21** → N pass → E pass.
**Tricks** (♣ = concealed trump until trick 6; winner in **bold**):
1. **N♣J** W♥7 S♣8 E♣10 → N +4
2. **N♣9** W♠8 S♣A E♠7 → N +3  *(♣9 beats ♣A — rank 9 > A)*
3. N♦7 W♦8 S♦K **E♦10** → E +1
4. E♠Q N♣7 **W♠J** S♠9 → W +5  *(N void in spades, holds ♣7 trump + ♥9/♦9 — DID NOT reveal-and-ruff)*
5. W♥8 **S♥J** E♥10 N♥K → S +4
6. **S♦J** E♦A N♦Q W♥Q → S +4  *(W reveals ♣ on a bare-Ace gamble but holds no clubs → just discards ♥Q; this ENABLED S's marriage)*
7. **S♣K** E♠10 N♥9 W♠K → S +3
8. **S♣Q** E♠A N♦9 W♥A → S +5 (last trick +1)

**Flags:**
- **f1 (trick 1 — "AI, why not ruff and reveal?"):** *RECLASSIFIED → valid: the decline came from a
  GOD-MODE reveal gate (a real inconsistency).* West was the only void-in-clubs seat. The *outcome*
  (declining) is fine, but the *mechanism* is wrong: `doAIPlay` (game.js:667) computes
  `ledIsTrump = ledSuit === state.trumpSuit` from the **real** trump and uses it (`!ledIsTrump`) to
  suppress the reveal for **all** seats — including a non-declarer like West, which **cannot legally know
  the trump**. In a faithful model West evaluates the reveal as a discovery gamble on its own hand, and
  `aiShouldReveal` would in fact return **true** here (West holds ♠J + the trick is worth ♣J=3 →
  `honoursNonLed≥1 && worthIt`): West reveals and — trump being clubs — discovers it's void in trump and
  discards (a *wasted* reveal, the fair cost of the gamble, exactly what the human's `revealApplicable`
  already allows by NOT hiding the option when led=trump). The `knownTrump` plumbing (game.js:655) is
  correct (non-declarers get `null`; `aiShouldReveal` reads it only on the declarer branch); the
  `!ledIsTrump` gate is the *separate* leak. → **Candidate #6: drop the god-mode `!ledIsTrump` gate — a
  non-declarer's reveal must be hand-only.**
- **f2 (trick 4 — North didn't reveal to ruff):** *Valid → Candidate #6 refinement.* North (declarer's
  PARTNER), void in spades, held a spare **♣7** plus two outside 9s; revealing to ruff wins the whole trick
  (♠Q + West's ♠J + South's ♠9 = **5 points**, and neither opponent could over-ruff). `aiShouldReveal`
  declined because `worthIt` saw only ♠Q (0 pts) on the table at North's turn, ignoring the cards yet to
  fall and that **North is on the declaring side** (own trump; would also enable South's ♣ marriage).
  Costliest decision of the hand (a 5-point swing the contract happened to survive) → `aiShouldReveal`.

**Net for Game 4:** two reveal findings. **(1) f1 exposes a GOD-MODE reveal gate** — `doAIPlay`'s
`!ledIsTrump` suppresses a non-declarer's reveal using the *real* trump, which it can't know; drop it so the
AI gambles like the human (Candidate #6). **(2) the reveal heuristic is still too conservative** — even
post-#6 the declaring side won't reveal-to-ruff a developing trick (f2, #6 refinement). Side-note: the new
bare-Ace reveal misfired for West at t6 (no trump) and helped the opponents' marriage.

### Game 5 — match `m-1780656179625` · hand 3 · 2026-06-05  *(post-pass; NEW build)*
**Contract:** **West (AI)** bid **17, trump ♦** (revealed trick 2 by N). **Result: FAILED** — W–E took
**9** of 15 needed, **−1** (match We 4 / They −1). Marriage W −4 at trick 3. South is on defence (N–S).

**Bidding recap:** W 16 → S pass → E pass → N 17 → W 17 → N pass.
**Tricks** (♦ = concealed trump until trick 2; winner in **bold**):
1. W♥7 **S♥J** E♥K N♦7 → S +3
2. S♥A E♥9 **N♦10** (ruff, reveals ♦) W♥8 → N +4  *(good AI reveal: E's ♥9 was beating partner S's ♥A, so North ruffs to win)*
3. N♠Q **W♠K** S♠7 E♠8 → W +0  *(W declares marriage −4)*
4. W♣8 **S♦9** (ruff) E♣7 N♣Q → S +2  *(North, last to act under partner's winning ruff, dumped ♣Q — should have banked ♣9)*
5. S♥10 E♣K N♣10 **W♦8** (ruff) → W +2  *(North's ♣10 leaks — downstream of t4)*
6. W♠10 S♠9 **E♠J** N♠A → E +7
7. E♣J N♣9 W♦Q **S♦A** (ruff) → S +6  *(North's kept ♣9 just follows here and wins nothing — ♣J was the boss, as the user said)*
8. S♥Q E♣A **N♦J** W♦K → N +5 (last trick +1)  *(North's ♦J trump boss finally wins — hand was under control)*

**Flags:**
- **f1 (trick 4 — North should bank ♣9, not ♣Q):** *Strong, valid → Candidate #2, new sub-case (iii).*
  Partner South was **securely** winning (ruffed ♦9; North last to act). North must follow clubs and held
  ♣Q(0)/♣10(1)/**♣9(2)** — banking ♣9 gives the team **+2** it instead left behind (took 2, could've been
  4). The user's reasoning is explicit card-tracking: the **♣J is still out**, so North's ♣9 will not win
  on its own later → cash its points now into the partner's sure trick. #2(i)/(ii) don't cover a *safely*-
  winning partner; the branch dumped `lowestCard` = ♣Q → `aiFollowSuit` partner-winning branch.
- **f2 (trick 5 — the leak):** *Valid; downstream of f1.* Because North kept ♣9/♣10 (dumped ♣Q at t4), at
  t5 it had to discard a *point* card (♣10, −1) under West's ruff. Banking ♣9 at t4 would let it shed the
  0-point ♣Q here and leak nothing. Same fix. (Minor: `safeDiscard` had no zero-point card and chose by
  lowest **rank**, not lowest **point**.)

**Net for Game 5:** the **bank-to-a-winning-partner** gap (#2 sub-case iii) in its cleanest, card-tracking-
driven form — precisely the capability the user is asking about. The `seen`/`isBoss` foundation is present;
the follow-suit branch just doesn't consult it when the partner is already winning.

## Non-AI follow-ups
- **Move-log capture bug (surfaced by the hand-8 export).** Trick 1 carries two **phantom plays** —
  `S ♥8` and `E ♦A`, cards not in those seats' deals (the real trick is the four spades
  S♠8/E♠9/N♠J/W♠Q, N wins +5). Trick 7 attributes the **reveal to S** although **N** is the seat that
  ruffed/won with ♣A, and that ♣A is still flagged `inertTrump`. Likely in `feedback.js`
  `logPlay`/`trickBuf` (stale/duplicated plays) and/or `revealTrump(byWhom)` attribution. **Fix and add
  a guard** — each trick should log exactly `trickSize` plays, each a card the seat actually holds.
- **Trump-reveal flash too brief (UI).** ✅ *Done in the first pass* (flash 2.6 s / 5 reps, toast 2.7 s).
  When an AI reveals the trump, the on-screen indication doesn't stay long enough to read (hand 9 / f3).
- **Show the trump reveal inside the post-hand Review (UI request, G4/G5 f-side note).** The 🔁
  play-by-play review steps Bidding → tricks but never surfaces **when/what** trump was revealed. Add a
  reveal indication at the trick where it happened: flip the trump indicator face-up (the 3-of-suit) at
  `trumpReveal.atTrick`, keep it **face-down on earlier steps**, and show a small "Trump revealed: ♣ (by W)"
  marker — mirroring the in-game reveal (`renderTrumpIndicator` face-down→face-up, optionally the same
  flash). The review already reads core `state.tricks` / `state.dealtHands`; the reveal trick + suit live
  in `state` (and `feedbackLog.trumpReveal`). Payoff: the replay becomes honest about *when* trump woke up
  — why a given ruff worked, or why a trump card sat inert earlier. Self-contained, low-risk UI work.
