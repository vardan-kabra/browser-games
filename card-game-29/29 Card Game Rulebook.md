# 29 Card Game — Custom Rulebook (My Playing Style)

> Authoritative ruleset for the base game. Rule *variations* that were considered but set aside are listed in the Appendix as candidates for a future settings menu — they are **not** part of this playing style.

---

## 1. Players, Deck & Card Values

- **Players:** 4, in two fixed partnerships. Partners sit opposite each other.
- **Direction of play:** counter-clockwise.
- **Deck:** 32 cards — eight per suit: **J, 9, A, 10, K, Q, 8, 7**.
- **Rank (high → low):** J > 9 > A > 10 > K > Q > 8 > 7.

**Card points**

| Card | Points |
|------|--------|
| Jack (J) | 3 |
| Nine (9) | 2 |
| Ace (A) | 1 |
| Ten (10) | 1 |
| K, Q, 8, 7 | 0 |

- Card points total **28**.
- **The last trick is worth +1 point**, bringing the deck total to **29 points** (the game's namesake). The last-trick point counts toward a team's captured total.

---

## 2. The Deal

- **All 8 cards are dealt to each player at once** (no 4-then-4 split).

---

## 3. Bidding

- Bidding happens **after** each player has seen their full 8-card hand.
- The **opening bidder is the player to the dealer's right**. They are **forced to open at the minimum bid of 16** and may **not** pass.
- Play proceeds counter-clockwise. Each subsequent player may **raise** (bid higher than the current bid) or **pass**. A pass eliminates that player from the auction.
- Bids ascend only. **Range: 16 to 29.**
- **Single Hand** sits above 29 as the top of the ladder (see §9).
- The **highest bidder wins** the contract and chooses the trump.
- Because the opener must bid 16, there is **always a bidder** — there is no all-pass redeal.

**The target:** the bidding team must capture **at least as many of the 29 points as their bid** (adjusted by Marriage, §6). The defending team sets the contract by holding the bidders below their target. The lowest possible target in any hand is **15** (a forced 16 bid reduced by a bidder's Marriage, floored at 15).

---

## 4. Trump Selection & Concealment

- The winning bidder secretly chooses a **trump suit** or declares **No Trump**.
- The choice is **held hidden by the system** — no card is removed from anyone's hand, and the bidder plays all 8 cards normally.
- A **low-rank indicator card** (e.g. 3♣) represents the chosen suit on screen. It is **cosmetic only**: it is not part of the 32-card deck, is never dealt or played, and exists purely to show "trump = clubs" more clearly than a text label. It appears face-down while concealed and face-up when revealed. **No Trump** is shown as a "No Trump" label (there is no suit to depict).
- During the concealed phase, the bidder **may not lead the trump suit**.
- *Default (UI, to confirm during build):* a named trump suit must be one the bidder actually holds at least one card in.

---

## 5. Play — The Two Phases

**Phase 1 — before the trump is revealed**
- Trumps are inactive. Each trick is won by the **highest card of the led suit**.
- Players **must follow the led suit** if able.
- A player who **cannot follow suit** may **call for the trump to be revealed**. On reveal, the trump is exposed; that player must then **play a trump if they hold one** (otherwise they discard).

**Phase 2 — after the trump is revealed**
- The **highest trump** in a trick wins it. Tricks containing no trump are won by the **highest card of the led suit**.

**Notes**
- There is **no "invalid if never revealed" rule** — a hand always plays out. If the trump is never revealed (no one is void, or no one calls), trumps simply never activate and the whole hand is decided on highest-of-led-suit.
- **No Trump rounds:** the choice is concealed like a suit; calling the reveal merely confirms "No Trump," and play continues on highest-of-led-suit for all 8 tricks.

---

## 6. Marriage (King + Queen of Trump)

- Declared **only after** the trump has been revealed **and** the declaring side has won a trick.
- **Bidding team declares:** target **reduced by 4** (floor **15**).
- **Defending team declares:** bidders' target **raised by 4** (cap **29**).
- The adjustment is a fixed **±4** and affects **only the card-point target**, never the scoring tier.
- **Unavailable in No Trump rounds** (no trump suit → no qualifying pair).

---

## 7. Scoring (Normal Hands)

Game points are awarded by **tier of the declared bid**:

| Declared bid | Win | Loss |
|--------------|-----|------|
| 16 – 20 | +1 | −1 |
| 21 – 27 | +2 | −2 |
| 28 – 29 | +3 | −3 |

- Meet or exceed the (Marriage-adjusted) target → the bidding team **gains** the tier value. Fall short → they **lose** it.
- The **defending team's score never changes** on a normal hand.
- The tier follows the **declared bid**, not the Marriage-adjusted target.

**Double / Redouble**
- **Double:** the **defending team**, before the first trick, may double the game-point stakes (**×2**).
- **Redouble:** the **bidding team** may respond with a redouble (**×4**).
- These multiply the stakes only; they do not change the card-point target.

---

## 8. The Claim

- Any player may **claim the remaining tricks** at any point in play.
- The engine, with full knowledge of all hands, **accepts** the claim if it holds under any defense (awarding those tricks and ending the hand), or **rejects** it and play continues.
- A rejected claim must **not leak hidden information** (such as a concealed trump) beyond the accept/reject result.

---

## 9. Single Hand — The Make-or-Break Contract

The top rung of the bid ladder, **above 29** — the only ±6 call.

- **Declaring:** it is a **bid**. Any player, on their turn in the auction, may declare **Single Hand** instead of a number or a pass. The **first to declare** gets it, and because nothing can top it, **it closes the auction**.
- **Solo play:** the declarer plays **alone**. Their **partner sits out** — cards face down, taking no part. The hand becomes **1 vs 2** (24 cards live, three per trick).
- **Trump:** the declarer names a **trump suit or No Trump**. In Single Hand the trump is **open from the start** (no concealment, no two-phase reveal).
- **Goal:** the declarer **leads the first trick and must win all 8 tricks** (equivalently, all points — they amount to the same thing).
- **No** Marriage, **no** tiers, **no** point target, **no** doubling.
- **Scoring:** win all 8 → **+6**; lose any trick → **−6**. The swing is **added** to the running score against the **±6 finish line** (overflow may display, e.g. +9, but any score ≥ +6 wins and ≤ −6 loses). From a level score this is genuinely make-or-break; from a lead, a failed Single Hand may not end the match (e.g. failing at +5 leaves you at −1, and play continues).
- **Claim** applies naturally — a lone player may claim the rest, adjudicated by the engine.

---

## 10. Match & Scorekeeping

- Each team tracks its score with the **red six / black six** (positive = red pips, negative = black pips).
- Scores are **cumulative** across hands; each result is added to the running tally.
- **First team to +6 wins.** A team dropping to **−6 loses.**

---

## 11. Cancellations / Misdeals

- **None.** The forced-16 opener guarantees a bidder every hand, so there is no all-pass redeal, and no other cancellation conditions apply.

---

## Appendix — Variations Deliberately Excluded

Considered and **set aside** for this playing style. Listed so they aren't reintroduced by accident, and as options that could become configurable in a future settings menu:

- **"7th Card" trump determination** — incompatible with dealing all 8 at once; removed.
- **"Thiri"** (win the first seven tricks) contract — dropped.
- **Separate "Slam / Kap"** contract (all 8 tricks *with* partner) — dropped; Single Hand is the sole make-or-break contract.
- **"C" / six-point bid** — dropped.
- **"Invalid if trump never revealed"** safeguard — removed.
- **West Bengal Marriage restriction** (no pair below a certain bid) — not used; Marriage is allowed at any bid.
- **Single-Hand cancellations** (void first trick, all-one-suit) — not used; the hand simply plays out.
- **No-Trump scoring bonus** — none; a No-Trump bid scores by the same tier as its number.
