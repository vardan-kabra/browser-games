---
name: tune-29-ai
description: >-
  Analyze AI play/bidding feedback for the 29 card game and maintain the AI Improvement Log.
  Use this whenever the user shares or points at a `29-feedback-hand-*.json` export (the in-game
  review/flag download), or says things like "add this game to the AI log", "analyze this 29 hand",
  "what did the AI do wrong here", "log this 29 feedback", or "improve/tune the 29 AI from the
  feedback". The skill reconstructs the hand from the export, evaluates each flag honestly against
  the 29 rules and the AI spec, maps every finding to the exact `ai.js` function, and appends a
  structured entry to `card-game-29/29 AI Improvement Log.md`. By default it does NOT edit the AI
  engine — it collects until ~7–8 games are logged, then (only when asked) distills the candidates
  into concrete `ai.js` changes. Do NOT use for general 29 gameplay, the in-game review/flag UI
  feature itself, or other games.
---

# Tune 29 AI — feedback analysis & improvement log

## What this is for
The 29 card game (`card-game-29/`) has a hand-written heuristic AI in `ai.js`. The in-game review
panel exports one JSON per hand (`29-feedback-hand-N.json`) containing the full deal, bidding,
every trick, the result, and the player's free-text **flags** on specific tricks or the bidding.

This skill turns one of those exports into a rigorous, honest analysis and records it in the
**AI Improvement Log** (`card-game-29/29 AI Improvement Log.md`) so that, after enough games, the
accumulated findings become a precise change-spec for `ai.js`. The whole point is to improve the
AI's play and bidding — but **driven by evidence, not vibes**.

## The one hard rule: collect, don't tune (yet)
**Do not edit `ai.js` (`AI_TUNING`, `aiPlayCard`/`aiLead`/`aiFollowSuit`/`aiDiscard`,
`aiBidValue*`) by default.** The user is deliberately gathering feedback across games before
changing the engine, because one or two hands aren't representative and premature tuning overfits.
The threshold is **~7–8 logged games**. Until then, the skill's job is to *analyze and log*.
Only when the user explicitly asks to "tune"/"apply the changes" (and the threshold is met) do you
move to proposing code — and even then, gated and reviewable, never silent. The log's status banner
tracks the count.

## Canonical files (read these — don't duplicate them)
- `card-game-29/29 AI Improvement Log.md` — the log you append to. **Read it first** every run: get
  the current "Games logged" count and the existing "Candidate AI changes" so you extend, not restate.
- `card-game-29/ai.js` — the engine. Every finding maps to a function here. The function cheat-sheet
  + known gaps live in `references/ai-js-map.md` (read it before attributing findings).
- `card-game-29/29 Card Game Rulebook.md` — the rules of truth (rank order, trump reveal, marriage,
  Single Hand, claim). Consult when a ruling is non-obvious.
- `card-game-29/29 Championship AI and Mechanics Spec.md` — the AI's design intent (bidding model,
  reveal logic, overtake rule C8). Cite it when judging whether a play is "by design."

## 29 quick reference (enough to adjudicate most flags)
- **Rank, high→low: J 9 A 10 K Q 8 7.** (J beats 9 beats A beats 10 beats K… — this trips people up;
  always recompute trick winners with this order, never standard rank.)
- **Card points: J=3, 9=2, A=1, 10=1, K/Q/8/7=0.** Total 28 + 1 for the last trick = **29**.
- **Honours in 29 are J and 9** (not K/Q — those score zero). Bidding value comes from J/9/A/10 +
  suit length, *not* from kings/queens. If a flag complains "no K/Q", that's a different game's
  mental model — say so.
- **Teams:** South+North vs East+West. South is the human ("we" = S+N in the export's runningPoints).
- **Trump is concealed** until revealed: opponents (non-bidders) do **not** know the trump suit. A
  card played while trump is concealed is `inertTrump` (acts ordinary). This matters enormously for
  judging "wasteful" plays — see the hindsight caveat below.
- **Reveal-to-ruff:** a player void in the led suit may reveal the trump and then must play a trump.
- **Marriage:** K+Q of trump shifts the bidding team's point target by ±4 (after reveal + a trick won).
- **Claim/Concede:** a side can claim the rest if it provably wins every remaining trick.

## Procedure
Work one export at a time. Reconstruct, evaluate, attribute, classify, then log.

### 1. Load and orient
- Read the export JSON: `hand.deal` (all four 8-card hands), `hand.bidding`, `hand.contract`
  (bidder/declaredBid/trump/noTrump), `hand.tricks` (each with `leader`, ordered `plays`
  [{seat, card, ledSuit, isTrump, inertTrump, winning}], `winner`, `points`), `hand.result`, and
  `flags` (each: `anchorTrick` where 0 = the Bidding step, free-text `note`).
- Read the current `29 AI Improvement Log.md` (count + existing candidates).

### 2. For each flag, do the work — don't take the note at face value
The user's notes are domain-expert intuition, but they're sometimes imprecise, occasionally wrong,
and often written with **full knowledge of all four hands** (the review shows every hand) even though
the AI played with hidden information. Your value is an *honest* adjudication, so:

1. **Reconstruct the exact position** at the flagged trick: who holds what (deal minus cards played
   in earlier tricks), who led, who was winning when the flagged seat played.
2. **Enumerate the flagged seat's legal options** (must follow the led suit if able).
3. **Recompute the outcome** with the 29 rank order and point values — verify the winner and points
   the export reports, and work out what each alternative play would have scored.
4. **Judge the user's critique** and classify it (be specific about *why*):
   - **valid bug** — the AI clearly misplayed and a real rule/heuristic produces the better line.
   - **valid nuance** — a better line exists but it's subtle/situational.
   - **weak / incorrect** — the AI's play was actually fine (e.g., it already won with the cheapest
     sufficient card, or it was forced). Say so plainly; don't rubber-stamp.
   - **by design** — the AI behaved per a documented heuristic/threshold (cite the spec). E.g.
     `aiShouldReveal` declining a low-value reveal.
   - **hindsight (concealed trump)** — the critique only holds with full knowledge the AI didn't
     have (the opponent couldn't know the trump suit / others' hands). Record it, but flag it as not
     actionable as a bug.
   - **player's own play** — the note is the human narrating their *own* good move, not an AI
     critique. Note it as reinforcement of a candidate (it models behavior the AI lacks), not a bug.
   - **UI / non-AI** — the note reports an interface bug (e.g., a missing Claim button). Route it to
     "Non-AI follow-ups", not the AI candidates.
5. **Attribute** the finding to the exact `ai.js` function (see `references/ai-js-map.md`): which
   function produced the actual play, and which function/constant a fix would touch.

### 3. The concealed-trump caveat (apply consistently)
Opponents don't know the trump suit, and `aiPlayCard` receives a null trump while it's concealed, so
the AI literally cannot "save its trumps" or "ruff" until a reveal. Many natural-looking critiques
("don't waste your clubs", "you should have ruffed") are **full-knowledge hindsight**. The legitimate
forward-looking question is usually subtler (e.g., "should the AI husband high cards under unknown
trump?"). Name the distinction every time it applies — it keeps the log trustworthy.

### 4. Write the log entry
Append to `card-game-29/29 AI Improvement Log.md`, matching its existing format:
- **Bump the status counter** ("Games logged: N → N+1").
- Add a **Game entry** (see template below).
- **Roll findings into "Candidate AI changes"**: if a finding repeats a theme already listed, add a
  one-line citation to that candidate (e.g. "also G4 f2") and bump its priority if it's recurring;
  if it's new, add a new candidate pointing at the `ai.js` function. Recurring themes are the signal —
  make them visible.
- Put UI/non-AI items under a **"Non-AI follow-ups"** subsection.
- Then give the user a tight chat summary: contract/result, the per-flag verdicts (especially any
  you judged weak/by-design/hindsight), and how the candidates shifted.

### Game entry template
Match the prose style already in the log. Shape:
```
### Game <N> — match `<id>` · hand <hand.number> · <date>
**Contract:** <S> bid <X> <trump or "NT">. **Result:** <MADE/FAILED> (<took>/<need><, by claim?>), <±pts>.

**Bidding recap:** <one line of the auction>.
**Tricks** (winner in bold): <8 one-line trick recaps, e.g. "1. E♥7 N♥Q W♥A **S♥J** → S +4">.

**Flags:**
- **f1 (<where>):** <verdict tag>. <one-paragraph analysis> → <ai.js function / candidate ref>.
- ...
**Net:** <one line: what this hand adds to the picture>.
```

## Recurring candidate themes seen so far (keep recognizing these)
These have already emerged; new exports usually reinforce or refine them. Details + line refs in
`references/ai-js-map.md`.
- **Overtake to bank a high-point card** (`aiFollowSuit`): the AI dumps its lowest card under a
  winning partner and never overtakes to secure a J/9's points — the strongest recurring gap.
- **Cash established winners / run a long suit** (`aiLead`): no "I hold the top card of this suit →
  cash it" logic; it leads a Jack or the lowest zero-point card. Worst in No Trump.
- **No-Trump strategy absent**: play logic is trump-centric; NT just runs the same rules.
- **Bidding valuation**: ignores K-Q **marriage** potential (undervalues marriage hands) AND can
  stack length+J/9 bonuses to over-bid weak hands — both sides need a look (`aiBidValue`/`AI_TUNING`).
- **Concealed-trump play / reveal threshold**: mostly *by design*; watch for hindsight.

## When the threshold is reached (only if the user asks to tune)
Once ~7–8 games are logged and the user explicitly wants to act: re-read the whole
"Candidate AI changes" section, propose a concrete, prioritized set of `ai.js` edits (cite the
functions/constants), and — only after the user approves — implement them and verify with the
project's preview-driver/simulation approach. Bump the relevant `?v=` cache-busters. This is a
separate, deliberate step; never fold code changes into a routine "log this game" run.
