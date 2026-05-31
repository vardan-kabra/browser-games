# 29 — Bidding Logic Update

> This document **supersedes Section 3 ("Bidding")** of `29 Card Game Rulebook.md`.
>
> Foundations are unchanged: 4 players in fixed partnerships, counter-clockwise play, the player to the dealer's right is forced to open at 16 and may not pass, bids range 16–29, and Single Hand sits above 29 as the top of the ladder.
>
> What changes is **how** subsequent bidders interact with the current high bid.

---

## 1. Concept

The auction is **not** a free-for-all of escalating bids. At any given moment it is a **localized 1-vs-1** between the **current holder** (the player who owns the current high bid) and **one challenger** (the next player in turn order who has not yet had their chance).

Each non-opener gets **exactly one challenge slot**, taken in counter-clockwise turn order. When their slot opens, they either pass (eliminated from the auction) or enter a 1-vs-1 with the current holder. That 1-vs-1 plays out to completion before the auction moves to the next slot.

---

## 2. Terms

- **Turn order:** the four players in counter-clockwise order starting with the player to the dealer's right — `[P1, P2, P3, P4]`. `P1` is the forced opener; `P2`, `P3`, `P4` each have one challenge slot.
- **Holder:** the player who currently owns the high bid.
- **Current bid:** the highest bid level reached so far.
- **Eliminated:** a player who has passed; they cannot re-enter the auction.

---

## 3. The asymmetric matching rule

This is the heart of the change.

- A **challenger** entering or continuing a 1-vs-1 must bid **strictly higher** than the current bid.
- The **holder**, responding inside a 1-vs-1, may **match** (bid the same number to retain), **raise** (bid strictly higher and retain), or **pass** (give up the contract and be eliminated).
- The challenger, after each holder response, may again **raise** or **pass** — the challenger cannot match. Only the holder can.

The holder has the right to retain via equal bidding; the challenger must keep paying a higher price to keep threatening.

---

## 4. Auction flow

**Step 1 — Opening.** `P1` bids 16. Set `holder = P1`, `currentBid = 16`.

**Step 2 — Slots, for each `P` in `[P2, P3, P4]` in order:**

1. **P's choice:** PASS or CHALLENGE.
   - **PASS** → `P` is eliminated. Move to the next `P` in Step 2.
   - **CHALLENGE** → `P` bids `X` where `X > currentBid`. Set `currentBid = X`. Enter the 1-vs-1.

2. **1-vs-1 between `holder` and `P`.** Turns alternate, beginning with the holder responding:

   - **Holder's options:**
     - **MATCH** — bid `currentBid` (same number). Holder retains; `currentBid` unchanged. Turn to `P`.
     - **RAISE** — bid `Y > currentBid`. Holder retains; `currentBid = Y`. Turn to `P`.
     - **PASS** — holder is eliminated. `P` becomes the new holder at `currentBid`. 1-vs-1 ends; move on to the next slot.
   - **Challenger's options (after each holder response):**
     - **RAISE** — bid `Z > currentBid`. `P` still challenging; `currentBid = Z`. Turn to holder.
     - **PASS** — `P` is eliminated. Holder retains. 1-vs-1 ends; move on to the next slot.

   Loop until one of the two passes (or Single Hand is declared — see §5).

**Step 3 — End.** After `P4`'s slot resolves, the current holder wins the contract at `currentBid`.

---

## 5. Single Hand within this model

Single Hand may be declared at **any decision point** in the auction:

- by `P` on their turn (instead of PASS or CHALLENGE), or
- by either the holder or the challenger inside a 1-vs-1 (instead of MATCH / RAISE / PASS).

Since nothing can top Single Hand, declaring it **ends the auction immediately**: the declarer becomes the Single Hand contract holder.

---

## 6. Why the auction always terminates with a contract

`P1` is forced to open, so a holder always exists going into Step 2. Every 1-vs-1 terminates (someone eventually passes), and there are at most three slots. Whenever the holder passes, the challenger inherits the contract — so there is never a moment with no holder. An all-pass / no-bidder state therefore cannot occur, and no redeal is required.

---

## 7. Worked examples

### Example A — opener retains throughout

Turn order: `P1 = East, P2 = North, P3 = West, P4 = South`.

| # | Action | Holder | Current bid |
|---|--------|--------|-------------|
| 1 | East opens (forced) at 16 | East | 16 |
| 2 | North passes (eliminated) | East | 16 |
| 3 | West passes (eliminated) | East | 16 |
| 4 | South challenges, bids 17 | East | 17 |
| 5 | East matches 17 ("mine") | East | 17 |
| 6 | South raises to 18 | East | 18 |
| 7 | East matches 18 | East | 18 |
| 8 | South passes (eliminated) | East | 18 |

**Auction ends.** East holds the contract at 18.

### Example B — opener loses the contract to a later challenger

Same turn order.

| # | Action | Holder | Current bid |
|---|--------|--------|-------------|
| 1 | East opens at 16 | East | 16 |
| 2 | North passes | East | 16 |
| 3 | West passes | East | 16 |
| 4 | South challenges, bids 17 | East | 17 |
| 5 | East matches 17 | East | 17 |
| 6 | South raises to 21 | East | 21 |
| 7 | East passes (eliminated) — South takes the contract | South | 21 |

**Auction ends** (no more slots). South holds at 21.

### Example C — Single Hand preempts

| # | Action | Outcome |
|---|--------|---------|
| 1 | East opens at 16 | holder = East at 16 |
| 2 | North challenges, bids 17 | currentBid = 17, 1-vs-1 begins |
| 3 | East declares Single Hand | auction ends; East plays Single Hand |
