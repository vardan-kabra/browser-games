# `ai.js` function map (where findings attribute)

Line numbers are approximate — `ai.js` is edited occasionally, so **grep for the function name to
confirm** before citing a line. Behaviour and known gaps are the durable part.

## Bidding
- **`aiBidValue(hand, lean)`** (~59–81) — computes a bid **ceiling** from `handPoints` (J=3, 9=2,
  A=1, 10=1) + the preferred trump suit's **length** + its **J/9 honours**, using the bands in
  `AI_TUNING.bid`, then `+2` for a 5-card suit, `+1` per J/9, hard-capped at **22**.
  - **Known gaps:** (a) **ignores K-Q marriage potential** — a hand with the K+Q of a long suit is
    worth more (marriage shifts the target ±4) but K/Q score 0 and aren't counted, so marriage hands
    are *under*-valued. (b) the `fiveSuitBonus(+2)` + `perTrumpHonour(+1)` stack can push a ~7-point
    hand to the 22 cap, arguably *over*-valuing shapely-but-thin hands.
- **`aiBidValueAgainstHolder(...)`** (~94–110) — the partner rule: pass under `supportPtsMin` (10);
  bounded support-raise capped at `supportMax` (20); take-over with a 4+ suit holding a J/9; plus the
  C12 score-lean (±1 near ±5).
- **`AI_TUNING`** (~6–19) — all the dials: `bid` bands (weak 16; mid 6–9→17–19; strong 10–11→20;
  veryStrong 12+→21–22; fiveSuitBonus 2; perTrumpHonour 1; hardCap 22), `partner`
  {supportPtsMin 10, takeoverSuitMin 4, supportMax 20}, `singleHand`, `scoreLean`
  {ahead 5, behind −5, ceilingShift 1}.

## Card play
- **`aiPlayCard(hand, trick, trumpSuit, declarerIndex, seatIndex)`** (~234) — dispatcher: leads via
  `aiLead`, follows via `aiFollowSuit`, can't-follow via `aiDiscard`. **`trumpSuit` is null while
  concealed**, so the AI treats trump as ordinary until a reveal (root of the hindsight caveat).
- **`aiLead(hand, trumpSuit)`** (~260–279) — leads a **non-trump Jack** (longest such suit) if it has
  one, else the **lowest zero-point card** (preferring non-trump).
  - **Known gaps:** no "I hold the highest unplayed card of a suit → cash it"; no "run a long
    established suit"; no No-Trump-specific strategy. (Causes "led a low card instead of cashing my
    winners" critiques.)
- **`aiFollowSuit(following, trick, trumpSuit, ledSuit, seatIndex)`** (~284–300) — if a **partner is
  winning**, dumps the **lowest** card (~:289–291); else wins with the **lowest winning card**; else
  dumps lowest.
  - **Known gaps:** never **overtakes a winning partner to bank a high-point card** (a J=3 or 9=2 it
    can't otherwise cash safely); "win cheapest" ignores point-banking under ruff risk. This is the
    most-cited gap across games.
- **`aiDiscard(hand, trick, trumpSuit, seatIndex)`** (~307–327) — the **C8 overtake rule**: if a
  partner is winning, never trump (safe discard) unless holding only trumps; else if trump is active,
  trump to win with the **lowest winning trump**; else safe discard. Reasonable as written.
- **`aiShouldReveal(seat, hand, trick, declarer, knownTrump)`** (~196–221) — reveal-to-ruff decision.
  Won't reveal over a winning partner (C8). Reveals only if the trick is **worth ≥2 points** AND the
  declarer holds the trump suit / a non-bidder holds a non-led **J/9** to ruff with. **Sound by
  design** — low-value reveals are correctly declined (and revealing hands trump knowledge to a
  strong declarer), so "should have revealed for 1 point" critiques are usually wrong.

## Recurring candidate themes (with the evidence so far)
1. **Overtake to bank a high-point card** — `aiFollowSuit` (:289–291). Seen Game 1 f2, Game 2 (hand 3)
   f1, Game 3 (hand 4) f2 — in hand 4 it cost East a ♣J (3 pts) swept by a claim. Top priority.
2. **Cash established winners / run a long suit** — `aiLead` (:260–279). Game 1 f4 (strong: led ♥8
   holding ♣9+♣A). Reinforced by Game 2 f2 (the human models the behavior).
3. **No-Trump strategy absent** — root of several Game-1 play flags.
4. **Bidding valuation** — `aiBidValue`/`AI_TUNING.bid`. Game 1 f1 (length+J9 over-bids a 7-pt hand
   to 22) and Game 3 f1 (ignores K-Q marriage → under-bids a marriage hand). Needs a two-sided look.
5. **Concealed-trump play / reveal** — Game 2 f4/f5 were defensible/hindsight; the `aiShouldReveal`
   worth-it ≥2 threshold is sound. Mostly *not* bugs.
