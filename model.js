// Analitika i projekcije. Bez UI-a — samo računanje nad data/data.json.
(function () {
  'use strict';

  // Redosled polja u data.lines (vidi scripts/fetch-data.mjs)
  const F = { gc: 0, code: 1, team: 2, opp: 3, home: 4, min: 5, pir: 6, pts: 7, f2m: 8, f2a: 9, f3m: 10, f3a: 11, ftm: 12, fta: 13, oreb: 14, dreb: 15, ast: 16, stl: 17, tov: 18, blk: 19, blka: 20, pf: 21, fd: 22, start: 23 };

  const POSITIONS = ['G', 'F', 'C'];
  const POS_NAME = { G: 'Bek', F: 'Krilo', C: 'Centar' };
  const ARCHETYPES = ['Organizator', 'Šuter', 'Prodorni', 'Unutrašnji', 'Svestrani'];
  const ARCH_HINT = {
    'Organizator': '6+ asistencija na 36 min',
    'Šuter': 'više od pola šuteva za 3',
    'Prodorni': 'mnogo slobodnih bacanja / šuteva za 2',
    'Unutrašnji': 'centar ili 9+ skokova na 36 min bez trojke',
    'Svestrani': 'ništa od navedenog ne preovlađuje',
  };

  // Pravila EuroLeague Fantasy Challenge (klasični režim)
  const RULES = {
    winBonus: 0.10,               // +10% fantasy poena igraču čiji tim pobedi
    coach: [                      // [donja granica razlike, poeni] — gledano iz ugla trenerovog tima
      [20.5, 25], [10.5, 20], [0, 10], [-10.5, -5], [-20.5, -10], [-Infinity, -20],
    ],
    roster: { G: 4, F: 4, C: 2 },
    tradesPerRound: 4,
    maxPerClub: 6,
    unlimitedAfterRounds: [6, 13, 18, 23, 28, 34],
  };

  const HOME_ADV = 2.5;        // poena prednosti domaćina u očekivanoj razlici
  const MARGIN_SD = 12;        // standardna devijacija razlike na utakmici
  const HOME_PIR = 0.6;        // PIR igrača kod kuće / u gostima +/-
  const ROUND_WEIGHTS = [1, 0.8, 0.65, 0.5, 0.4, 0.35];

  const avg = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const round1 = x => Math.round(x * 10) / 10;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  function erf(x) {
    const s = Math.sign(x); x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  const normCdf = (x, m, sd) => 0.5 * (1 + erf((x - m) / (sd * Math.SQRT2)));

  function prettyName(raw) {
    if (!raw) return '';
    const [last, first] = raw.split(',').map(s => s.trim());
    const tc = s => (s || '').toLowerCase().replace(/(^|[\s\-'’.])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
    return first ? `${tc(first)} ${tc(last)}` : tc(last);
  }
  const normalize = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // Bonus za pobedu je 10% apsolutne vrednosti, pa i negativan PIR dobija +10%
  function fpOfLine(l, won) {
    return l[F.pir] + (won ? RULES.winBonus * Math.abs(l[F.pir]) : 0);
  }

  function coachPoints(margin) {
    for (const [lo, pts] of RULES.coach) if (margin > lo) return pts;
    return -20;
  }

  function classify(p) {
    const minTot = p.totals.min;
    if (minTot < 40) return p.pos === 'C' ? 'Unutrašnji' : 'Svestrani';
    const per36 = k => (p.totals[k] / minTot) * 36;
    const fga = p.totals.f2a + p.totals.f3a;
    const ast36 = per36('ast');
    const reb36 = per36('reb');
    const f3r = fga ? p.totals.f3a / fga : 0;
    const ftr = fga ? p.totals.fta / fga : 0;
    const f2a36 = per36('f2a');
    if (ast36 >= 6) return 'Organizator';
    if (f3r >= 0.55 && fga / minTot * 36 >= 7) return 'Šuter';
    if (p.pos === 'C' || (reb36 >= 9 && f3r < 0.25)) return 'Unutrašnji';
    if (ftr >= 0.35 || f2a36 >= 8) return 'Prodorni';
    return 'Svestrani';
  }

  function buildModel(data) {
    const games = data.games;
    const gameByCode = new Map(games.map(g => [g.gc, g]));
    const dateOf = gc => gameByCode.get(gc)?.date || '';

    // --- Ekipe: rezultati i rejting ---
    const teams = {};
    for (const code of Object.keys(data.teams)) {
      teams[code] = { ...data.teams[code], gp: 0, w: 0, l: 0, pf: 0, pa: 0, results: [], played: [], upcoming: [] };
    }
    for (const g of games) {
      if (!teams[g.home] || !teams[g.away]) continue;
      if (g.played) {
        for (const [t, us, them, opp, home] of [[g.home, g.hs, g.as, g.away, true], [g.away, g.as, g.hs, g.home, false]]) {
          const T = teams[t];
          T.gp++; T.pf += us; T.pa += them;
          if (us > them) T.w++; else T.l++;
          T.results.push({ gc: g.gc, round: g.round, opp, home, us, them, win: us > them, date: g.date });
          T.played.push(g.gc);
        }
      } else {
        teams[g.home].upcoming.push({ gc: g.gc, round: g.round, opp: g.away, home: true, date: g.date });
        teams[g.away].upcoming.push({ gc: g.gc, round: g.round, opp: g.home, home: false, date: g.date });
      }
    }
    for (const T of Object.values(teams)) {
      T.diff = T.gp ? (T.pf - T.pa) / T.gp : 0;
      T.rating = T.diff * T.gp / (T.gp + 3);   // skupljeno ka nuli dok je malo utakmica
      T.last5 = T.results.slice(-5).map(r => (r.win ? 'W' : 'L'));
    }
    const standings = Object.values(teams).sort((a, b) => (b.w - a.w) || (b.diff - a.diff));
    standings.forEach((t, i) => { t.rank = i + 1; });

    // Kolo za koje se sada prave izmene: prvo kolo u kom nijedna utakmica nije počela
    const startedRounds = new Set(games.filter(g => g.played).map(g => g.round));
    const now = Date.now();
    for (const g of games) if (new Date(g.date).getTime() <= now) startedRounds.add(g.round);
    const rounds = [...new Set(games.map(g => g.round))].sort((a, b) => a - b);
    const targetRound = rounds.find(r => !startedRounds.has(r)) ?? null;
    const lastPlayedRound = Math.max(0, ...games.filter(g => g.played).map(g => g.round));

    const winOf = new Map();
    for (const T of Object.values(teams)) for (const r of T.results) winOf.set(`${r.gc}|${T.code}`, r.win);

    // --- Igrači ---
    const players = {};
    for (const p of Object.values(data.players)) {
      players[p.code] = {
        ...p, display: prettyName(p.name), search: normalize(prettyName(p.name) + ' ' + p.name),
        lines: [], totals: { min: 0, pir: 0, pts: 0, f2a: 0, f3a: 0, fta: 0, ast: 0, reb: 0 },
      };
    }
    for (const l of data.lines) {
      const p = players[l[F.code]];
      if (!p) continue;
      p.lines.push(l);
    }
    for (const p of Object.values(players)) {
      p.lines.sort((a, b) => dateOf(a[F.gc]).localeCompare(dateOf(b[F.gc])));
      const playedLines = p.lines.filter(l => l[F.min] > 0);
      p.gp = playedLines.length;
      for (const l of playedLines) {
        p.totals.min += l[F.min]; p.totals.pir += l[F.pir]; p.totals.pts += l[F.pts];
        p.totals.f2a += l[F.f2a]; p.totals.f3a += l[F.f3a]; p.totals.fta += l[F.fta];
        p.totals.ast += l[F.ast]; p.totals.reb += l[F.oreb] + l[F.dreb];
      }
      const pirs = playedLines.map(l => l[F.pir]);
      p.pirAvg = p.gp ? p.totals.pir / p.gp : 0;
      p.ptsAvg = p.gp ? p.totals.pts / p.gp : 0;
      p.minAvg = p.gp ? p.totals.min / p.gp : 0;
      p.last3 = avg(pirs.slice(-3));
      p.last5 = avg(pirs.slice(-5));
      p.fpAvg = p.gp ? avg(playedLines.map(l => fpOfLine(l, winOf.get(`${l[F.gc]}|${l[F.team]}`)))) : 0;
      p.form = p.gp >= 2 ? p.last3 - p.pirAvg : 0;
      p.base = p.gp >= 3 ? 0.6 * p.pirAvg + 0.4 * p.last3 : p.pirAvg;
      p.archetype = classify(p);

      // Dostupnost: koliko poslednjih utakmica svog tima je propustio
      const T = teams[p.team];
      p.missed = 0;
      if (T && T.played.length) {
        const playedSet = new Set(playedLines.filter(l => l[F.team] === p.team).map(l => l[F.gc]));
        for (let i = T.played.length - 1; i >= 0 && !playedSet.has(T.played[i]); i--) p.missed++;
      }
      p.avail = p.gp === 0 ? 0 : p.missed === 0 ? 1 : p.missed === 1 ? 0.55 : 0.15;
      p.estPrice = round1(clamp(4 + 0.75 * p.base, 4, 32));
    }

    // --- Odbrana: koliko ekipa dozvoljava po poziciji i tipu igrača ---
    // delta = PIR igrača protiv te ekipe minus njegov sezonski prosek (samo 10+ minuta)
    const defense = {};
    for (const code of Object.keys(teams)) {
      defense[code] = { pos: {}, arch: {}, ptsByPos: { G: 0, F: 0, C: 0 }, pirByPos: { G: 0, F: 0, C: 0 }, games: new Set() };
    }
    const league = { ptsByPos: { G: 0, F: 0, C: 0 }, pirByPos: { G: 0, F: 0, C: 0 }, teamGames: 0 };
    // Prosek igrača u nastupima od 10+ minuta, bez utakmice koja se ocenjuje (leave-one-out)
    for (const p of Object.values(players)) {
      const big = p.lines.filter(l => l[F.min] >= 10);
      p.n10 = big.length;
      p.sum10 = big.reduce((s, l) => s + l[F.pir], 0);
    }
    const leagueDelta = { pos: {}, arch: {} };
    const rawDeltas = [];
    for (const l of data.lines) {
      const p = players[l[F.code]];
      const D = defense[l[F.opp]];
      if (!p || !D || !p.pos) continue;
      D.games.add(l[F.gc]);
      D.ptsByPos[p.pos] += l[F.pts];
      D.pirByPos[p.pos] += l[F.pir];
      league.ptsByPos[p.pos] += l[F.pts];
      league.pirByPos[p.pos] += l[F.pir];
      if (l[F.min] < 10 || p.n10 < 3) continue;
      const delta = l[F.pir] - (p.sum10 - l[F.pir]) / (p.n10 - 1);
      rawDeltas.push([D, p, delta]);
      (leagueDelta.pos[p.pos] ??= []).push(delta);
      (leagueDelta.arch[p.archetype] ??= []).push(delta);
    }
    // Centriranje na prosek lige: 0 = ekipa brani tu poziciju/tip kao prosečna ekipa
    const posMean = {}, archMean = {};
    for (const [k, arr] of Object.entries(leagueDelta.pos)) posMean[k] = avg(arr);
    for (const [k, arr] of Object.entries(leagueDelta.arch)) archMean[k] = avg(arr);
    for (const [D, p, delta] of rawDeltas) {
      (D.pos[p.pos] ??= []).push(delta - posMean[p.pos]);
      (D.arch[p.archetype] ??= []).push(delta - archMean[p.archetype]);
    }
    for (const D of Object.values(defense)) league.teamGames += D.games.size;
    for (const pos of POSITIONS) {
      league.ptsByPos[pos] = league.teamGames ? league.ptsByPos[pos] / league.teamGames : 0;
      league.pirByPos[pos] = league.teamGames ? league.pirByPos[pos] / league.teamGames : 0;
    }
    for (const D of Object.values(defense)) {
      const n = D.games.size;
      const shrink = n / (n + 4);
      D.n = n;
      D.posDelta = {}; D.archDelta = {}; D.posDeltaRaw = {}; D.archDeltaRaw = {}; D.archN = {};
      for (const pos of POSITIONS) {
        D.ptsByPos[pos] = n ? D.ptsByPos[pos] / n : 0;
        D.pirByPos[pos] = n ? D.pirByPos[pos] / n : 0;
        D.posDeltaRaw[pos] = avg(D.pos[pos] || []);
        D.posDelta[pos] = D.posDeltaRaw[pos] * shrink;
      }
      for (const a of ARCHETYPES) {
        const arr = D.arch[a] || [];
        D.archN[a] = arr.length;
        D.archDeltaRaw[a] = avg(arr);
        D.archDelta[a] = avg(arr) * (arr.length / (arr.length + 8));
      }
      delete D.pos; delete D.arch; delete D.games;
    }

    const coaches = {};
    for (const [team, c] of Object.entries(data.coaches || {})) {
      coaches[team] = { ...c, display: prettyName(c.name), team };
    }

    return { data, F, teams, standings, players, defense, league, coaches, targetRound, lastPlayedRound, rounds, gameByCode };
  }

  // --- Projekcije ---
  function expectedMargin(m, team, opp, home) {
    const a = m.teams[team], b = m.teams[opp];
    if (!a || !b) return 0;
    return a.rating - b.rating + (home ? HOME_ADV : -HOME_ADV);
  }
  function winProb(m, team, opp, home) {
    return 1 - normCdf(0, expectedMargin(m, team, opp, home), MARGIN_SD);
  }

  function projectPlayerGame(m, p, game) {
    if (!p.gp) return { pir: 0, fp: 0, pWin: 0 };
    const D = m.defense[game.opp];
    const posAdj = D ? D.posDelta[p.pos] || 0 : 0;
    const archAdj = D ? D.archDelta[p.archetype] || 0 : 0;
    const oppAdj = D && D.archN[p.archetype] >= 6 ? 0.6 * posAdj + 0.4 * archAdj : posAdj;
    const pir = (p.base + oppAdj + (game.home ? HOME_PIR : -HOME_PIR)) * p.avail;
    const pWin = winProb(m, p.team, game.opp, game.home);
    const fp = pir + RULES.winBonus * Math.abs(pir) * pWin;
    return { pir, fp, pWin, oppAdj };
  }

  function projectCoachGame(m, team, game) {
    const mu = expectedMargin(m, team, game.opp, game.home);
    let e = 0, prevHi = Infinity;
    for (const [lo, pts] of RULES.coach) {
      const pr = normCdf(prevHi, mu, MARGIN_SD) - normCdf(lo, mu, MARGIN_SD);
      e += pr * pts; prevHi = lo;
    }
    return { fp: e, pWin: 1 - normCdf(0, mu, MARGIN_SD), margin: mu };
  }

  function horizonGames(m, team, horizon) {
    const T = m.teams[team];
    if (!T || m.targetRound == null) return [];
    return T.upcoming.filter(u => u.round >= m.targetRound && u.round < m.targetRound + horizon);
  }

  // Projekcija za horizont kola; obj = poeni + lambda * (poeni - cena) po kolu, ponderisano
  function projectEntity(m, ent, horizon, price, lambda) {
    const games = horizonGames(m, ent.team, horizon);
    let total = 0, weighted = 0, gain = 0;
    const perGame = games.map(g => {
      const pr = ent.isCoach ? projectCoachGame(m, ent.team, g) : projectPlayerGame(m, ent, g);
      const w = ROUND_WEIGHTS[g.round - m.targetRound] ?? 0.3;
      total += pr.fp; weighted += w * pr.fp;
      gain += w * (pr.fp - (ent.isCoach ? 0 : price));
      return { ...g, ...pr };
    });
    const next = perGame.find(g => g.round === m.targetRound);
    return {
      total, next: next ? next.fp : 0, perGame,
      obj: weighted + lambda * (ent.isCoach ? 0 : gain),
    };
  }

  // --- Optimizacija izmena ---
  // roster: [{key, kind:'G'|'F'|'C'|'coach', ent, price}] (ent=null za prazno mesto)
  // pool: {G:[{key, ent, price, team}], ...}
  function optimizeTrades(m, opts) {
    const { roster, pool, bank, maxTrades, maxPerTeam, evalEnt } = opts;
    const owned = new Set(roster.filter(r => r.ent).map(r => r.key));
    const counts = {};
    for (const r of roster) if (r.ent && r.kind !== 'coach') counts[r.ent.team] = (counts[r.ent.team] || 0) + 1;

    const swaps = [];
    roster.forEach((slot, si) => {
      const outVal = slot.ent ? evalEnt(slot.ent, slot.price).obj : -1e6;
      const cands = (pool[slot.kind] || []).filter(c => !owned.has(c.key));
      const scored = cands.map(c => ({ c, v: evalEnt(c.ent, c.price).obj }))
        .filter(x => x.v - outVal > 0.2);
      // najbolji po poenima + najbolji u svakom cenovnom razredu, da bi bilo i jeftinih opcija
      scored.sort((a, b) => b.v - a.v);
      const picked = new Set(scored.slice(0, 25));
      const tiers = [0, 6, 8, 10, 12, 15, 18, 22, Infinity];
      for (let t = 0; t < tiers.length - 1; t++) {
        scored.filter(x => x.c.price >= tiers[t] && x.c.price < tiers[t + 1]).slice(0, 5).forEach(x => picked.add(x));
      }
      for (const { c, v } of picked) {
        swaps.push({ si, slot, inn: c, d: v - outVal, cost: c.price - (slot.ent ? slot.price : 0) });
      }
    });

    const emptySi = roster.map((r, i) => (r.ent ? -1 : i)).filter(i => i >= 0);
    const minPrice = {};
    for (const [kind, list] of Object.entries(pool)) minPrice[kind] = Math.min(...list.map(c => c.price));
    let beam = [{ list: [], d: 0, cost: 0, used: new Set(), lastSi: -1, counts }];
    const validStates = [];
    const valid = s => s.cost <= bank + 1e-9 && emptySi.every(i => s.list.some(x => x.si === i));
    for (let depth = 1; depth <= Math.max(maxTrades, emptySi.length); depth++) {
      const next = [];
      for (const s of beam) {
        for (const sw of swaps) {
          if (sw.si <= s.lastSi || s.used.has(sw.inn.key)) continue;
          let counts2 = s.counts;
          if (sw.slot.kind !== 'coach') {
            counts2 = { ...s.counts };
            if (sw.slot.ent) counts2[sw.slot.ent.team]--;
            counts2[sw.inn.team] = (counts2[sw.inn.team] || 0) + 1;
            if (maxPerTeam > 0 && counts2[sw.inn.team] > maxPerTeam) continue;
          }
          const used = new Set(s.used); used.add(sw.inn.key);
          next.push({ list: [...s.list, sw], d: s.d + sw.d, cost: s.cost + sw.cost, used, lastSi: sw.si, counts: counts2 });
        }
      }
      if (!next.length) break;
      // Prazna mesta koja još nisu popunjena moraju moći da se popune bar najjeftinijim igračem
      const maxDepth = Math.max(maxTrades, emptySi.length);
      const feasible = s => {
        if (emptySi.some(i => i < s.lastSi && !s.list.some(x => x.si === i))) return false;
        const left = emptySi.filter(i => i > s.lastSi);
        if (left.length > maxDepth - depth) return false;
        return s.cost + left.reduce((acc, i) => acc + (minPrice[roster[i].kind] || 0), 0) <= bank + 1e-9;
      };
      const cand = next.filter(feasible);
      // Beam: više "cena kredita" da bi se zadržale i skupe i štedljive kombinacije
      const keep = new Set();
      for (const mu of [0, 0.5, 1.5, 3, 6, 12]) {
        cand.sort((a, b) => (b.d - mu * b.cost) - (a.d - mu * a.cost)).slice(0, 70).forEach(s => keep.add(s));
      }
      beam = [...keep];
      for (const s of beam) if (valid(s)) validStates.push(s);
    }
    // Alternativni planovi, međusobno različiti (isti izlazni i ulazni igrači = isti plan)
    const all = validStates.sort((a, b) => b.d - a.d);
    const seen = new Set();
    const plans = [];
    for (const s of all) {
      const sig = s.list.map(x => x.slot.key).sort().join('|') + '>' + s.list.map(x => x.inn.key).sort().join('|');
      if (seen.has(sig)) continue;
      seen.add(sig);
      plans.push(s);
    }
    const byCount = {};
    for (const s of plans) if (!byCount[s.list.length] || byCount[s.list.length].d < s.d) byCount[s.list.length] = s;
    return { plans: plans.slice(0, 5), byCount, swapsConsidered: swaps.length };
  }

  window.ELModel = {
    F, POSITIONS, POS_NAME, ARCHETYPES, ARCH_HINT, RULES, ROUND_WEIGHTS,
    buildModel, projectPlayerGame, projectCoachGame, projectEntity, horizonGames,
    optimizeTrades, winProb, expectedMargin, prettyName, normalize, round1, avg, coachPoints,
  };
})();
