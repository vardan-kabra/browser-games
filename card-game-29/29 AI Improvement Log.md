# 29 — AI Improvement Log

> **STATUS: collecting feedback — do NOT change the AI engine yet.**
> Games logged: **1** · Threshold before acting: **~7–8 games**.
> Until then, leave `ai.js` untouched (`AI_TUNING`, `aiPlayCard`/`aiLead`/`aiFollowSuit`/`aiDiscard`,
> `aiBidValue`/`aiBidValueAgainstHolder`). Accumulate hands, distill the recurring patterns under
> **Candidate AI changes**, then make the changes + re-verify in one focused pass.

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

2. **Overtake-for-control exception (following).** `aiFollowSuit` (ai.js:284–300) and `aiDiscard`
   (ai.js:307–327, the C8 rule) **always duck under a winning partner** (`partnerWinning → lowestCard`).
   No exception for "I hold the long solid suit — overtake to seize the lead and run it."
   - *Evidence:* Game 1 / **f2** (valid nuance) — trick 2, partner East winning with ♣10; West
     (holding ♣J/9/A — the long club suit) dumped ♣7 instead of overtaking with ♣J to take control.
   - *Candidate:* permit a deliberate overtake when the AI holds a long, top-heavy suit and seizing
     the lead lets it cash several tricks (NT especially). Careful — overtaking a partner is usually wrong.

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
