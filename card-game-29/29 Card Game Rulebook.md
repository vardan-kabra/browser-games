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

## 3. Bidding (asymmetric holder-match model)

> The full mechanic — terms, flow, and worked examples — is in **`29 Championship AI and Mechanics Spec.md`** (Part A), the source of truth for bidding. Summary:

- Bidding happens **after** each player has seen their full 8-card hand. Range **16–29**; **Single Hand** sits above 29 (§9).
- The **opener** (player to the dealer's right) is **forced to open at 16** (or declare Single Hand) and may **not** pass.
- The auction is a sequence of **localized 1-vs-1 duels**, not a free escalation. Each of the other three players gets **exactly one challenge slot**, in counter-clockwise order: **pass** (eliminated) or **challenge** (bid strictly higher), which starts a duel with the current **holder**.
- **Asymmetric matching:** inside a duel only the **holder** may **match** (bid the same number to retain) or raise; the **challenger** must always **raise** (never match) or pass. The duel ends when one side passes — if the holder passes, the challenger becomes the new holder.
- At **29** (the cap) the holder may match/pass; the challenger can only declare Single Hand or pass.
- After the last slot resolves, the **current holder wins** the contract and chooses trump. The forced opener guarantees a bidder, so there is **no all-pass redeal**.

**The target:** the bidding team must capture **at least as many of the 29 points as their bid** (adjusted by Marriage, §6). The lowest possible target is **15** (a forced 16 reduced by a bidder's Marriage, floored at 15).

---

## 4. Trump Selection & Concealment

> Full detail in **`29 Championship AI and Mechanics Spec.md`** (Part B), the source of truth for trump reveal & ruffing. Summary:

- The winning bidder secretly chooses a **trump suit** or declares **No Trump**.
- The choice is **held hidden by the system** and known **only to the bidder** (not even the bidder's partner) — no card is removed from anyone's hand, and the bidder plays all 8 cards normally.
- A **low-rank indicator card** (e.g. 3♣) represents the chosen suit on screen. It is **cosmetic only**: not part of the 32-card deck, never dealt or played, and exists purely to show "trump = clubs" more clearly than a text label. It appears face-down while concealed and face-up after the reveal. **No Trump** is shown as a "No Trump" label.
- While concealed the trump is **inert** — it cannot win a trick. **Anyone may lead any suit, including the (concealed) trump suit**; leading it does **not** reveal it (a trump-suit trick plays like any other — highest of the led suit wins).
- *Default (UI):* a named trump suit must be one the bidder actually holds at least one card in.

---

## 5. Play — Reveal-to-ruff (manual)

**Before any reveal**
- Trump is inactive. Each trick is won by the **highest card of the led suit**.
- Players **must follow the led suit** if able.
- A player **void in the led suit** may use the **"Reveal Trump"** action — the *only* way trump is ever revealed, and **only to ruff**. On reveal the trump is exposed (and wakes for the rest of the hand); that player **must then play a trump if they hold one** (the ruff), otherwise they discard.
- A void player who does **not** reveal simply discards. A trump-suit card thrown without revealing is **inert** — it does not ruff, win, or reveal anything.
- When the **led suit *is* the trump suit**, a void player is **still offered** Reveal Trump / Discard — suppressing it would deny a real choice and *leak the trump's identity* (its absence would signal "led suit = trump"). Revealing wakes trump for the rest of the hand, but since they hold no trump they simply discard; the current trick still resolves on highest-of-led-suit (which is the highest trump), so its winner is unchanged.

**After the first reveal (trump active for everyone)**
- The **highest trump** in a trick wins it; tricks with no trump are won by the **highest card of the led suit**.
- A void player **may trump or discard** — ruffing is **not** forced.

**Notes**
- **No one — bidder included — can activate trump proactively.** Trump only wakes on the first ruff-reveal.
- There is **no "invalid if never revealed" rule** — a hand always plays out. If no one ever reveals, trump never activates and the whole hand is decided on highest-of-led-suit.
- **No Trump / Single Hand:** No Trump has nothing to reveal (highest-of-led throughout); Single Hand's trump is open from the start.

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
