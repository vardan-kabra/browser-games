// ── Card definitions ────────────────────────────────────────────────────────

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANKS = ['J', '9', 'A', '10', 'K', 'Q', '8', '7']; // high → low

// Numerical rank order (higher = stronger)
const RANK_ORDER = { J:7, '9':6, A:5, '10':4, K:3, Q:2, '8':1, '7':0 };

// Point values for scoring
const POINT_VALUE = { J:3, '9':2, A:1, '10':1, K:0, Q:0, '8':0, '7':0 };

// Suit display symbols
const SUIT_SYMBOL = { spades:'♠', hearts:'♥', diamonds:'♦', clubs:'♣' };
const SUIT_COLOR  = { spades:'black', hearts:'red', diamonds:'red', clubs:'black' };

// ── Deck operations ──────────────────────────────────────────────────────────

function buildDeck() {
  const deck = [];
  for (const suit of SUITS)
    for (const rank of RANKS)
      deck.push({ suit, rank });
  return deck; // 32 cards
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Deal deck into 4 equal hands
function dealHands(deck) {
  const hands = [[], [], [], []];
  deck.forEach((card, i) => hands[i % 4].push(card));
  return hands;
}

// ── Card comparison ──────────────────────────────────────────────────────────

/**
 * Returns true if `challenger` beats `incumbent` given the led suit and
 * (possibly null/hidden) trump suit.
 * Trump beats non-trump; within the same suit, higher RANK_ORDER wins.
 */
function cardBeats(challenger, incumbent, ledSuit, trumpSuit) {
  const cTrump = trumpSuit && challenger.suit === trumpSuit;
  const iTrump = trumpSuit && incumbent.suit   === trumpSuit;

  if (cTrump && !iTrump) return true;
  if (!cTrump && iTrump) return false;

  // Both trump or both non-trump: only the led-suit card (or trump) matters
  if (challenger.suit !== incumbent.suit) {
    // challenger is not same suit as incumbent — can't beat unless trump (handled above)
    return false;
  }
  return RANK_ORDER[challenger.rank] > RANK_ORDER[incumbent.rank];
}

/**
 * Determine who wins a completed trick.
 * `trick` is an array of { playerIndex, card } in play order.
 * Returns the playerIndex of the winner.
 */
function trickWinner(trick, trumpSuit) {
  const ledSuit = trick[0].card.suit;
  let best = trick[0];
  for (let i = 1; i < trick.length; i++) {
    if (cardBeats(trick[i].card, best.card, ledSuit, trumpSuit)) {
      best = trick[i];
    }
  }
  return best.playerIndex;
}

// ── Scoring ──────────────────────────────────────────────────────────────────

/** Sum of point-card values in an array of cards */
function cardsPoints(cards) {
  return cards.reduce((sum, c) => sum + POINT_VALUE[c.rank], 0);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function cardKey(card) { return card.rank + '-' + card.suit; }

function sameCard(a, b) { return a.rank === b.rank && a.suit === b.suit; }

/** Cards in `hand` that follow the led suit (or any card if none) */
function legalPlays(hand, ledSuit) {
  if (!ledSuit) return hand.slice(); // leading a trick
  const following = hand.filter(c => c.suit === ledSuit);
  return following.length ? following : hand.slice();
}

/** Sort a hand: by suit grouping then rank descending */
function sortHand(hand) {
  return hand.slice().sort((a, b) => {
    const si = SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
    if (si !== 0) return si;
    return RANK_ORDER[b.rank] - RANK_ORDER[a.rank];
  });
}
