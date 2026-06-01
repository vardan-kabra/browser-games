# 29 — Championship AI & Mechanics Spec (consolidated)

> Single upload for Claude Code. Bundles the three pieces we iterated on: the **bidding logic** (Part A), the **trump reveal & ruffing mechanics** (Part B), and the **championship AI behavior** (Part C).
>
> **Supersedes §3 (Bidding) and §4–§5 (Trump selection, concealment, two-phase play) of `29 Card Game Rulebook.md`.** Everything else in the rulebook stands unchanged: deck and card values, the +1 last-trick point (29 total), tiered scoring, marriage, double/redouble, the claim, single hand as the ±6 top contract, and match-to-±6.
>
> *(This doc replaces the earlier separate `Bidding Logic Update`, `Championship AI Spec`, and `Reveal and Overtake Update` files.)*
>
> Calibration figures in Part C come from Monte Carlo simulation of this variant (~60k deals per experiment, heuristic play — directional, not exact).

---

# Part A — Bidding (supersedes rulebook §3)

## A1. Foundations (unchanged)
4 players in fixed partnerships, counter-clockwise play. The player to the dealer's right is forced to open at **16** and may not pass. Bids run **16–29**, ascending. **Single Hand** sits above 29 as the top of the ladder. Because the opener can't pass, there is always a bidder — no all-pass redeal.

## A2. The model — localized 1-vs-1
The auction is **not** a free-for-all. At any moment it is a localized **1-vs-1** between the current **holder** (owner of the high bid) and **one challenger** (the next player in turn who hasn't yet had their chance). Each non-opener gets **exactly one challenge slot**, in counter-clockwise order; that 1-vs-1 plays out fully before the auction moves on.

## A3. The asymmetric matching rule
- A **challenger** entering or continuing a 1-vs-1 must bid **strictly higher** than the current bid.
- The **holder** may **MATCH** (same number, retain), **RAISE** (strictly higher, retain), or **PASS** (give up the contract, eliminated).
- The challenger, after each holder response, may **RAISE** or **PASS** — never match. Only the holder may match.

## A4. Flow
1. **Opening.** `P1` bids 16. `holder = P1`, `currentBid = 16`.
2. **For each `P` in `[P2, P3, P4]`, in order:**
   - **PASS** → `P` eliminated; next slot.
   - **CHALLENGE** → `P` bids `X > currentBid`; enter the 1-vs-1.
   - **1-vs-1** (turns alternate, holder responds first):
     - Holder: **MATCH** (retain, same), **RAISE** (retain, higher), or **PASS** (eliminated; `P` becomes holder).
     - Challenger: **RAISE** (higher) or **PASS** (eliminated; holder retains).
     - Loop until one passes (or Single Hand declared).
3. **End.** After `P4`'s slot resolves, the current holder wins the contract.

## A5. Single Hand in the auction
Declarable at **any decision point** — by `P` on their turn, or by holder/challenger inside a 1-vs-1 — instead of the usual options. Nothing can top it, so declaring it **ends the auction immediately**; the declarer holds the Single Hand contract.

## A6. Always terminates
`P1` is forced to open, every 1-vs-1 ends in a pass, and there are only three slots — so an all-pass / no-holder state is impossible.

## A7. Worked examples
**Opener retains:** East opens 16; North passes; West passes; South challenges 17 → East matches 17 → South raises 18 → East matches 18 → South passes. **East holds at 18.**

**Opener loses it:** East 16; North/West pass; South challenges 17; East matches 17; South raises 21; East passes. **South holds at 21.**

**Single Hand preempts:** East 16; North challenges 17; East declares Single Hand. **Auction ends; East plays Single Hand.**

---

# Part B — Trump reveal & ruffing (supersedes rulebook §4–§5)

## B1. Concealed state
The bidder's trump (a suit, or No Trump) is held hidden and **inactive** — it cannot win tricks — until revealed. It is known **only to the bidder** (not even the bidder's partner). While concealed, **every trick is won by the highest card of the led suit**.

## B2. Leading the trump suit
**Anyone may lead any suit at any time, including the (concealed) trump suit** — a non-bidder unknowingly, the bidder knowingly. **Leading the trump suit does not reveal it**: while concealed, a trump-suit trick plays exactly like any other suit (highest of the led suit wins, indicator stays face-down).
- *Example:* 7♦ is led and everyone follows with diamonds; if diamonds is the concealed trump, nothing special happens — highest diamond wins, trump stays hidden.

## B3. Revealing — a manual, ruff-only action
- Revealing happens **only** via the **"Reveal Trump"** action, and **only to ruff**. No other trigger.
- It is offered to **any player void in the led suit** — because the trump is concealed, you reveal partly *to find out* whether you can ruff.
- On reveal: the trump is exposed (and wakes for the rest of the hand). You **must play a trump if you hold one** (the ruff); if you hold none, you discard.
- A void player who does not reveal simply plays a card as an ordinary discard.

## B4. A trump played without revealing is **inert**
If a void player throws a card that happens to be of the trump suit **without revealing**, it acts as an ordinary card — it does **not** ruff, does not win, and does not reveal anything. The highest card of the led suit still takes the trick and trump stays concealed. (This is exactly how a player can "inadvertently" toss the trump suit without knowing it.)

A trump card therefore functions as a trump **only after a conscious reveal.**

## B5. What the reveal does
- The **first ruff-reveal of the hand activates trump for everyone** for the remainder. From then: highest trump wins a trick; no-trump tricks won by highest of the led suit.
- **No one — bidder included — can activate trump proactively.** Everyone waits for the first ruff-reveal.
- If **no ruff-reveal ever happens**, trump never activates and the whole hand is decided on highest-of-led-suit. (A hand is never invalidated for lack of a reveal.)

## B6. When the led suit *is* the trump suit
A player void in that suit holds no trump, so there is nothing to reveal or ruff — the trick just plays out on the highest card of the led suit.

## B7. After the reveal (trump active)
A player void in the led suit **may trump or discard** — trumping is **not** forced. (See Part C's overtake rule.)

## B8. No Trump / Single Hand
- **No Trump:** nothing to conceal or reveal — every trick is won by the highest card of the led suit throughout.
- **Single Hand:** trump is open from the start — no concealment, no reveal.

---

# Part C — Championship AI behavior

## C0. Risk posture
Single AI strength, tuned to **championship level**: opportunistic but disciplined — it reaches for higher contracts and special calls only when the odds favour it, leaning in hardest when its own hand is point-rich or its partner has shown strength. Risk modulates with the match score (C11).

## C1. Hand evaluation
Combine three things, not raw points alone:
- **Card points** (J=3, 9=2, A=1, 10=1).
- **Control / honours** — the **J and 9 of any suit are the two boss cards**, worth far more in play than face value; count them separately.
- **Suit length** — a 4+ card suit is trump material, **but only for the player who will name trump.**

## C2. Bidding — how high to go

**Base ceiling (from simulation).** The declaring side averages ~16.7 of 29 just from naming trump and leading, so the forced 16 is safe for almost any opener; the discipline is in **not over-raising**. Push only to roughly the level made ~60% of the time:

| Your hand (would-be declarer) | Bid ceiling |
|---|---|
| under 6 points | 16 only — don't raise |
| 6–9 pts with a 4-card suit | 17–19 |
| 10–11 pts with a 4-card suit | 20 |
| 12+ pts with a 4-card suit | 21–22 |
| holding a 5-card suit | +2 to the row above |
| each J/9 of the trump candidate | nudge up ~1 |

Don't enter the 21–27 tier (±2) without comfortably clearing ~60% make probability; don't touch 28–29 (±3) without a near-lock hand.

**Forced opener.** Open 16 regardless; with a weak hand, do not raise.

**The partner rule (simulation-revised).** When the current holder is the AI's **partner**, default to **PASS**. Escalate against your own side **only with ≥10 card points** — simulation: ≥10 points adds ~+2.5 to the team's expected take, while a long side-suit alone adds ~0, so **suit length is not a reason for a supporter to escalate.**
- *Support-raise:* ≥10 points, no strong long suit → raise only modestly (claim the higher level, let the original declarer keep trump).
- *Take-over:* ≥10 points **and** a 4+ suit headed by J/9 → out-bid to take the contract and name your own trump, then size by the table above.
- A royal pair counts only if it's in the trump suit (a marriage) or the suit a taking-over partner would name.

**Inside the 1-vs-1.** As holder: MATCH cheaply, RAISE only within your supported ceiling, PASS once the challenger pushes past it. As challenger: RAISE only within your ceiling, PASS beyond it.

## C3. Trump selection
Name your **longest suit**; tie-break by most honours (J/9), then most points. **No Trump** only with a balanced, high-control hand (no suit longer than 3, multiple A/10/J across suits). The named suit must be one the AI holds.

## C4. Reveal & ruff timing
Ruffing is a **conscious, weighed decision — never automatic.** The AI never auto-plays a trump to win simply because it is void.
- Reveal (to ruff) only when the **trick is worth it** — typically to take a point-rich trick or to begin pulling trumps once it intends to.
- Because the trump is concealed (and a non-bidder doesn't know it), revealing also **gambles on actually holding the trump**; reveal only when the trick is worth that gamble. The bidder, knowing its own trump, decides precisely.
- As a defender, the prime use is to **ruff the bidder's points** when void.
- Hold the reveal when exposing trump would mainly help the opponents, or there's no worthwhile trump to play.
- Remember the reveal also wakes trump for everyone for the rest of the hand.

## C5. Marriage (K+Q of trump) timing
Declare after your side wins a trick, as soon as it helps: **bidding side** to cut the target by 4 when the contract looks tight (earlier rather than later); **defending side** to raise the bidder's target by 4 when a +4 swing could set them. Skip it only when it can't change the made/set outcome.

## C6. Card play — offence (you hold the contract)
**Pull trumps** once revealed if you have control, then **cash winners**. Lead the J/9 of trump early to draw the top trumps. **Bank point-cards** into tricks you control; don't leave them open to a ruff. **Protect the last trick (+1)** when the hand is close to target. Lead toward partner's known strength.

## C7. Card play — defence (you don't hold the contract)
**Capture point-cards and the last trick**, and **ruff the bidder's points** when void (via a deliberate reveal). Second hand low, third hand high. Don't waste high trumps on point-empty tricks. Lead through strength / up to weakness as the bidding has located holdings.

## C8. Overtaking a partner's winning card
**Premise:** a void player is never forced to trump (Part B7), so the AI always has the option to discard.

**Default:** the AI **never trumps a trick its partner is already winning** — that wastes a trump on a trick the side already holds.

**Permitted only with a clear, stated reason:**
1. **Forced** — only trumps in hand (play the lowest).
2. **Securing a trick at risk** — an opponent **still to play this trick** could beat the partner's card (usually a ruff), and the AI's trump both wins it *and* can't be over-trumped by who's left.
3. **Seizing the lead for a concrete plan** it can't get otherwise — e.g. pull the last outstanding trumps or run established winners, when the partner can't lead them and the gain outweighs the trump spent.

**Never reflexively** — being void, or "no harm in it," is not a reason. The seat-order test for #2: if the AI is **last to play** and the partner is winning, the trick is locked — never trump. And since revealing is ruff-only, the AI must not reveal-and-ruff over its own winning partner unless one of these reasons genuinely applies; usually it simply doesn't reveal.

## C9. Single hand (the ±6 solo call)
Declare **only on a near-lock hand**. Simulated solo sweep rates (even drawing trumps correctly): four top trumps ~4%, five ~8%, six ~16% — a point count alone is not enough.
- **Trigger:** the AI can essentially **count 8 tricks** — a near-solid trump suit of **6+ headed by both J and 9**, or 5 solid top trumps (J, 9, A) plus outside aces giving full control.
- **Score lean:** more willing when behind, more protective when ahead.
- Never on a merely "good" hand — the bar is dominance.

## C10. Double / redouble
**Double (defender):** only with clear defensive strength against a stretched bid (top trumps / controlling honours over the likely trump). **Redouble (bidder):** rare, only when confident of making. Single hand is never doubled. Score-aware: readier to double when ahead, warier when a doubled loss would cost the match.

## C11. Claim
Claim the rest the moment the AI's remaining cards are **all certain winners under any defence**. The engine adjudicates, so a confident claim only speeds play — never claim speculatively.

## C12. Score-awareness (over everything)
The running match score tilts every risk call:
- **Near +5 (about to win):** play safe — conservative bids, skip single hand and risky doubles.
- **Near −5 (about to lose):** take the high-variance line — stretch bids, single-hand on a merely strong hand, double aggressively.
- **Level / mid-match:** play the straight EV-maximising lines above.

---

*Calibration source: Monte Carlo simulation of this variant, ~60k deals per experiment, heuristic agents. The bidding ceilings (C2) and single-hand thresholds (C9) are the figures most worth re-tightening later with stronger agents.*
