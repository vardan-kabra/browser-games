// statsStore.js — session-scoped aggregate of completed games.
//
// FUTURE REPLACEMENT CONTRACT: a login/server-backed store can replace the
// internals here without touching the display layer, as long as these three
// signatures hold (addGame / getSessionStats / getGames). The display only
// ever calls through them and never touches internal state.
//
// - Mutations look synchronous to the display. A real backend would write to
//   a local cache here and fire-and-forget the network sync in the background;
//   no async leaks into the display code path.
// - addGame takes only { turns, secret }; the store assigns gameNumber and
//   timestamp. (A server-backed store will want its own authoritative values.)
// - All returned records and arrays are frozen, so the display can't mutate
//   internal state by accident — backend-side reconciliation never collides
//   with local mutations it didn't make.
// - A future getLifetimeStats() will slot in alongside these three when login
//   lands, without changing any current signatures.

const statsStore = (() => {
  const games = [];   // module-private; never exposed directly

  return Object.freeze({
    addGame(input) {
      const record = Object.freeze({
        gameNumber: games.length + 1,
        turns: input.turns,
        secret: input.secret,
        timestamp: Date.now(),
      });
      games.push(record);
      return record;
    },

    getSessionStats() {
      if (games.length === 0) {
        return Object.freeze({
          gamesPlayed: 0,
          averageTurns: null,
          bestTurns: null,
          worstTurns: null,
          spread: 0,
          games: Object.freeze([]),
        });
      }
      const turns = games.map(g => g.turns);
      const best = Math.min(...turns);
      const worst = Math.max(...turns);
      const avg = turns.reduce((s, t) => s + t, 0) / turns.length;
      return Object.freeze({
        gamesPlayed: games.length,
        averageTurns: Math.round(avg * 10) / 10,
        bestTurns: best,
        worstTurns: worst,
        spread: worst - best,
        games: Object.freeze(games.slice()),
      });
    },

    getGames() {
      return Object.freeze(games.slice());
    },
  });
})();
