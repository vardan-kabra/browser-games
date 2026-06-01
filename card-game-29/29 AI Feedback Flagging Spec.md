# 29 Card Game — AI Feedback Flagging Feature (spec for Claude Code)

A feature for the **29** card-game web app that lets the player flag specific tricks, attach free-text feedback, and export a self-contained per-hand file. That file is uploaded back to Claude Code to diagnose and improve the AI's play. Hand this spec to Claude Code together with the existing rulebook and AI spec.

---

## 1. Goal & shape

- Purpose is **AI improvement** (not player replay — that comes later).
- The player taps a **Flag** button, picks the trick it's about, optionally taps the exact card/play in question, optionally links other tricks, and types a free-text note.
- Flags accumulate during a hand and are written to **one file per hand** (multiple flags per file).
- The file is **fully self-describing** — it carries the entire hand (all tricks, all four hands), so a flag on trick 8 can reference trick 2 and Claude Code can look trick 2 up.
- No screenshots. No turn-by-turn replay UI in this version.

---

## 2. Foundation — the move log (build this first)

Nothing works without a complete, serializable record of each hand. Record, as the hand is played:

- **Match context:** match id, the running score before and after the hand (We / They).
- **Hand setup:** hand number, dealer, seating order (counter-clockwise), the **full deal** — all four players' original 8-card hands.
- **Bidding:** the ordered sequence of actions (seat → Raise value / Pass / Single Hand) and the final contract: winning bidder, **declared bid**, **trump** suit or **No Trump**, whether **Single Hand**, and any **Double / Redouble**.
- **Contract modifiers:** **Marriage** (who declared it, at which trick, ±4 effect), and the resulting **targets** (marriage-adjusted need for each team).
- **Trump concealment:** record the true trump from the start (this is a full-knowledge record), plus the **reveal event** — at which trick, by whom, which suit became public.
- **Every trick** (1…N): trick number, leader, the **plays in order** (seat → card), per-card role flags (was it the led suit? a trump? an *inert* trump played without revealing? the winning card?), the **winner**, the **points** in the trick (card points, plus +1 for the last trick), and any **events** during it (reveal, marriage).
- **Running points** after each trick (We / They).
- **Result:** points taken by the bidding team, made/failed, the **tier of the declared bid** (16–20 / 21–27 / 28–29), game points awarded (±, with Double/Redouble multiplier), the new match score, and the **end reason** — played out, **claim** accepted, or **concede** (with the trick it happened at and how the remainder was awarded).

**Card notation:** use structured cards, e.g. `{ "rank": "J", "suit": "C" }`, rendered as `♣J` in summaries. Include the game rank order somewhere in the file: **high → low: J 9 A 10 K Q 8 7**.

This log is the single source of truth — it also feeds the future replay UI, so design it cleanly now.

---

## 3. The Flag UI

- A small **Flag** control in the top-right cluster, alongside the notepad / help / refresh icons. Available **during play and at Hand Over**.
- Tapping it opens a **compact panel placed below the table** (do not cover the played cards — same principle as the void-prompt fix). The panel has:
  - **Anchor trick** — pre-filled to the current trick; editable to any trick from 1 to the current one.
  - **Tap-to-pin (optional)** — the player can tap a specific played card in the anchor trick to pin the exact play in question; records `{ seat, card, plyIndex }`. The free text is the *why*; the tap supplies the *what*.
  - **Related tricks (optional)** — selectable chips (tricks 1…current) to link other tricks the note refers to.
  - **Note** — free-text box ("What went wrong here?").
  - **Save / Cancel.**
- After saving, mark that trick as flagged (small marker) and show the hand's flag count. Allow editing/deleting a flag before export.

---

## 4. Persistence

- Store flags in browser storage (IndexedDB or localStorage), keyed by match id + hand number, so they survive refresh and accumulate across the hand and match.
- Storage is per-device / per-browser — acceptable for this use.
- Clear a hand's flags after its file is exported (or leave them and let the player clear manually).

---

## 5. Export — one file per hand

- An **Export feedback** button (in the flag panel and on the Hand Over modal).
- A hand's file is **finalized at Hand Over**, so it always contains the complete hand. Flags taken mid-hand are held until then.
- **Mechanism — "save to local file" in a browser = a download.** Generate the file in memory (Blob) and trigger a download to the device (works on PC and mobile). On desktop Chrome you may optionally offer the File System Access API (`showSaveFilePicker`) to choose a location, with the plain download as the fallback.
- **One file per flagged hand.** If several hands are flagged in a match, that's one file each; optionally provide an "Export all" that downloads them together.
- **Filename:** readable, no underscores — e.g. `29-feedback-hand-3.json`.

---

## 6. Export file format

JSON, one object per hand. Illustrative skeleton (strip the `//` comments in real output):

```json
{
  "schemaVersion": 1,
  "kind": "29-ai-feedback",
  "readme": "<see section 7 — the how-to-read string>",
  "rankOrderHighToLow": ["J","9","A","10","K","Q","8","7"],
  "match": { "id": "m-...", "scoreBefore": {"we": 1, "they": 0}, "scoreAfter": {"we": -1, "they": 0} },
  "hand": {
    "number": 3,
    "dealer": "E",
    "seatingOrderCCW": ["S","E","N","W"],
    "bidding": [
      {"seat": "N", "action": "raise", "value": 16},
      {"seat": "W", "action": "pass"},
      {"seat": "S", "action": "raise", "value": 21},
      {"seat": "E", "action": "pass"}
    ],
    "contract": { "bidder": "S", "declaredBid": 21, "trump": "C", "singleHand": false, "double": "none" },
    "marriage": null,
    "targets": { "biddingTeamNeed": 21, "defenseNeed": 9 },
    "deal": {
      "N": [{"rank":"...","suit":"..."}, "... 8 cards"],
      "E": ["... 8 cards"], "S": ["... 8 cards"], "W": ["... 8 cards"]
    },
    "trumpReveal": { "atTrick": 4, "by": "W", "suit": "C" },
    "tricks": [
      {
        "number": 1,
        "leader": "S",
        "plays": [
          {"seat":"S","card":{"rank":"J","suit":"C"},"ledSuit":true,"isTrump":true,"inertTrump":true,"winning":false},
          {"seat":"W","card":{"rank":"7","suit":"C"},"ledSuit":true,"isTrump":true,"inertTrump":true,"winning":false},
          {"seat":"N","card":{"rank":"K","suit":"C"},"ledSuit":true,"isTrump":true,"inertTrump":true,"winning":false},
          {"seat":"E","card":{"rank":"9","suit":"C"},"ledSuit":true,"isTrump":true,"inertTrump":true,"winning":false}
        ],
        "winner": "S",
        "points": 6,
        "events": []
      }
      // ... tricks 2..N, each with full plays/winner/points/events
    ],
    "runningPoints": [ {"afterTrick": 1, "we": 6, "they": 0} ],
    "result": {
      "biddingTeamPoints": 17, "made": false, "tier": "21-27",
      "gamePointsAwarded": -2, "multiplier": 1,
      "endReason": "played-out", "claim": null
    }
  },
  "flags": [
    {
      "id": "f1",
      "anchorTrick": 2,
      "subjectPlay": { "seat": "E", "card": {"rank":"9","suit":"D"}, "plyIndex": 3 },
      "relatedTricks": [],
      "note": "East threw the diamond 9 here for no reason — should have held it to guard.",
      "createdAt": "..."
    },
    {
      "id": "f2",
      "anchorTrick": 8,
      "subjectPlay": null,
      "relatedTricks": [2],
      "note": "We lost the hand here, but the real cause was East's trick-2 discard.",
      "createdAt": "..."
    }
  ],
  "readableSummary": "<see section 8 — plain-text rendering>"
}
```

Every card is fully labeled (suit, rank, and its role in the trick) and each player's full original hand is present, so any natural-language note resolves to exact cards and positions, and legality / better-play questions are checkable.

---

## 7. Embedded read-me string (`readme` field)

Put a short instruction string in the file so it is self-explanatory on upload. Suggested text:

> This file is AI-play feedback for the 29 card game (one hand). For each entry in `flags`: (1) go to its `anchorTrick` and `subjectPlay`; (2) reconstruct the position at that point from `deal` plus the earlier entries in `tricks`; (3) work out the flagged player's legal options there; (4) evaluate their actual play against the rules and, where possible, the double-dummy best line; (5) judge whether the user's `note` is valid; (6) recommend the correct play and the change to the AI's decision logic that would produce it. Follow any `relatedTricks` links. Use the rulebook for terminology (ruff, void, marriage, Single Hand, trump reveal). Card rank order high→low: J 9 A 10 K Q 8 7.

Also tell the user (in a one-line UI hint or docs) to upload this file **together with the rulebook and AI spec**, which carry the rules and terminology.

---

## 8. Readable summary (`readableSummary` field)

Include a plain-text rendering so the file is glanceable without parsing — this replaces any need for screenshots. Example shape:

```
Hand 3 — Bidder South, bid 21, trump ♣ (revealed trick 4 by West). Marriage: none.
Result: FAILED — took 17 of 21 needed. −2 game pts. Match now We −1 / They 0.

Trick 1: S led ♣J; W ♣7; N ♣K; E ♣9  → N? no, S wins (+6)
Trick 2: ...
...
Trick 8: ...  (last trick +1)

FLAGS
- Trick 2 [subject: East ♦9]: "East threw the diamond 9 here for no reason..."
- Trick 8 [relates to: trick 2]: "We lost the hand here, but the real cause was East's trick-2 discard."
```

---

## 9. 29-specific rules the log must represent faithfully

- **Rank order:** J > 9 > A > 10 > K > Q > 8 > 7. Points: J=3, 9=2, A=1, 10=1; others 0; **last trick +1** (29 total).
- **Concealed trump:** known only to the bidder until revealed. A trump played *without* revealing is **inert** (acts as an ordinary card) — represent this (`inertTrump: true`). The **first reveal** activates trump for everyone for the rest of the hand.
- **Trick winner logic:** after reveal, highest trump wins; otherwise highest card of the led suit. Before any reveal, highest of the led suit.
- **Marriage:** ±4 to the **target only** (floor 15 / cap 29); the scoring **tier follows the declared bid**, not the adjusted target.
- **Single Hand:** 1-vs-2, declarer's partner sits out (their cards are not live), 24 cards in play, trump open from the start, ±6 scoring, no marriage / tier / target / doubling. Represent the sitting-out partner and the 3-card tricks.
- **Claim / Concede:** record early end (trick, who, awarded remainder).

---

## 10. Scope / non-goals (this version)

- No turn-by-turn replay UI (later; it will reuse this move log).
- No screenshot capture.
- No in-app double-dummy analysis — that's done by Claude Code on the uploaded file (and can become an in-app aid later).
- Keep the flag panel and any new surfaces consistent with the corrections already made (solid equal-sized buttons, small boxes placed below the cards rather than over them).
