// Preuzima podatke sa javnog EuroLeague API-ja i pravi data/data.json za aplikaciju.
// Pokretanje: node scripts/fetch-data.mjs [E2026]
// Box score-ovi odigranih utakmica se keširaju u cache/games, pa se svaki put preuzimaju samo nove.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(ROOT, 'cache', 'games');
const OUT_FILE = path.join(ROOT, 'data', 'data.json');
const API = 'https://api-live.euroleague.net';

function currentSeasonCode() {
  const now = new Date();
  // sezona počinje u julu: od jula 2026 važi E2026
  const year = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return `E${year}`;
}

const SEASON = process.argv[2] || process.env.SEASON || currentSeasonCode();

async function getJson(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'el-fantasy-helper' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e.message}`);
      await new Promise(r => setTimeout(r, 1000 * i));
    }
  }
}

async function getText(url) {
  const headers = { 'User-Agent': 'el-fantasy-helper' };
  if (process.env.GITHUB_TOKEN && url.startsWith('https://api.github.com')) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

// Minimalni CSV parser (navodnici, zarezi unutar navodnika)
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

// Cene iz zvanične Fantasy igre. Javni repozitorijum (MIT) ih snima na svaka 2 sata;
// crosswalk povezuje Fantasy ID igrača sa zvaničnim EuroLeague kodom igrača.
const PRICE_REPO = 'gaizkafrutos/euroleague-fantasy-analytics';
async function loadPrices() {
  const list = JSON.parse(await getText(`https://api.github.com/repos/${PRICE_REPO}/contents/data/raw/prices`));
  const latest = list.map(f => f.name).filter(n => /^prices_\d{8}_\d{6}\.csv$/.test(n)).sort().pop();
  if (!latest) throw new Error('nema snimka cena');
  const raw = `https://raw.githubusercontent.com/${PRICE_REPO}/HEAD/data`;
  const [pricesCsv, crossCsv] = await Promise.all([getText(`${raw}/raw/prices/${latest}`), getText(`${raw}/processed/crosswalk.csv`)]);
  const cross = parseCsv(crossCsv);
  const codeById = new Map(cross.map(r => [r.fantaking_id, r.person_code]));
  // Fantasy oznake klubova (PAO, CZV...) -> zvanične (PAN, RED...), iz istog crosswalk-a
  const clubByFk = new Map(cross.filter(r => r.fantaking_team && r.club_code).map(r => [r.fantaking_team, r.club_code]));
  const num = s => (s === '' || s == null ? null : Number(s));
  const out = { source: PRICE_REPO, file: latest, capturedAt: '', players: {}, coaches: {} };
  for (const r of parseCsv(pricesCsv)) {
    const entry = { cr: num(r.quotation), chg: num(r.plus), fpt: num(r.fpt), name: r.name };
    out.capturedAt ||= r.captured_at;
    const isCoach = r['win_1-10'] !== '' || /coach/i.test(r.position);
    if (isCoach) {
      const club = clubByFk.get(r.team);
      if (club) out.coaches[club] = entry;
    } else if (codeById.get(r.fantaking_id)) {
      out.players[codeById.get(r.fantaking_id)] = entry;
    }
  }
  return out;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const POS = { Guard: 'G', Forward: 'F', Center: 'C' };

// Jedna linija igrača u utakmici, kompaktno (vidi LINE_FIELDS u app.js)
function compactSide(side, team, opp, home) {
  const lines = [];
  for (const p of side.players || []) {
    const s = p.stats || {};
    const person = p.player?.person || {};
    lines.push({
      code: person.code,
      name: person.name,
      pos: POS[p.player?.positionName] || '',
      height: person.height || 0,
      img: p.player?.images?.headshot || '',
      row: [
        person.code, team, opp, home ? 1 : 0,
        Math.round((s.timePlayed || 0) / 6) / 10, // minuti, jedna decimala
        s.valuation || 0, s.points || 0,
        s.fieldGoalsMade2 || 0, s.fieldGoalsAttempted2 || 0,
        s.fieldGoalsMade3 || 0, s.fieldGoalsAttempted3 || 0,
        s.freeThrowsMade || 0, s.freeThrowsAttempted || 0,
        s.offensiveRebounds || 0, s.defensiveRebounds || 0,
        s.assistances || 0, s.steals || 0, s.turnovers || 0,
        s.blocksFavour || 0, s.blocksAgainst || 0,
        s.foulsCommited || 0, s.foulsReceived || 0,
        s.startFive ? 1 : 0,
      ],
    });
  }
  return { coach: side.coach || null, lines };
}

async function loadGameStats(game) {
  const file = path.join(CACHE_DIR, `${SEASON}_${game.gameCode}.json`);
  if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));
  const raw = await getJson(`${API}/v3/competitions/E/seasons/${SEASON}/games/${game.gameCode}/stats`);
  const home = game.local.club.code;
  const away = game.road.club.code;
  const compact = {
    gameCode: game.gameCode,
    local: compactSide(raw.local || {}, home, away, true),
    road: compactSide(raw.road || {}, away, home, false),
  };
  // keširamo samo potpune box score-ove
  if (compact.local.lines.length && compact.road.lines.length) {
    await writeFile(file, JSON.stringify(compact));
  }
  return compact;
}

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  await mkdir(path.dirname(OUT_FILE), { recursive: true });

  console.log(`Sezona ${SEASON}: preuzimam raspored...`);
  const gamesRaw = (await getJson(`${API}/v2/competitions/E/seasons/${SEASON}/games`)).data;

  const teams = {};
  const games = [];
  for (const g of gamesRaw) {
    for (const side of [g.local, g.road]) {
      const c = side.club;
      teams[c.code] ??= { code: c.code, name: c.name, short: c.abbreviatedName || c.editorialName || c.name, crest: c.images?.crest || '' };
    }
    games.push({
      gc: g.gameCode,
      round: g.round,
      phase: g.phaseType?.code || '',
      date: g.utcDate || g.date,
      home: g.local.club.code,
      away: g.road.club.code,
      hs: g.played ? g.local.score : null,
      as: g.played ? g.road.score : null,
      played: !!g.played,
    });
  }
  games.sort((a, b) => a.date.localeCompare(b.date));

  const played = gamesRaw.filter(g => g.played);
  console.log(`Odigrano ${played.length} od ${gamesRaw.length} utakmica, preuzimam box score-ove...`);
  const stats = await mapLimit(played, 6, loadGameStats);

  const players = {};
  const coaches = {};
  const lines = [];
  const coachSeen = {};
  for (let i = 0; i < played.length; i++) {
    const g = played[i];
    const st = stats[i];
    for (const [sideKey, team] of [['local', g.local.club.code], ['road', g.road.club.code]]) {
      const side = st[sideKey];
      if (side.coach?.code && (!coachSeen[team] || coachSeen[team] < g.utcDate)) {
        coachSeen[team] = g.utcDate;
        coaches[team] = { code: side.coach.code, name: side.coach.name, team };
      }
      for (const l of side.lines) {
        if (!l.code) continue;
        const p = (players[l.code] ??= { code: l.code, name: l.name, team, pos: l.pos, height: l.height, img: l.img, lastDate: '' });
        if (g.utcDate > p.lastDate) { p.lastDate = g.utcDate; p.team = team; }
        if (!p.pos && l.pos) p.pos = l.pos;
        lines.push([g.gameCode, ...l.row]);
      }
    }
  }

  // Aktuelni rosteri: pozicija i klub (zbog transfera u toku sezone)
  console.log('Preuzimam rostere...');
  try {
    const people = (await getJson(`${API}/v2/competitions/E/seasons/${SEASON}/people?personType=J`)).data || [];
    for (const r of people) {
      const code = r.person?.code;
      if (!code || !r.club?.code) continue;
      const p = (players[code] ??= { code, name: r.person.name, team: r.club.code, pos: '', height: r.person.height || 0, img: '', lastDate: '' });
      if (r.active !== false) p.team = r.club.code;
      p.pos = POS[r.positionName] || p.pos;
      p.img ||= r.images?.headshot || r.images?.action || '';
      p.active = r.active !== false;
    }
  } catch (e) {
    console.warn('Rosteri nisu preuzeti:', e.message);
  }
  for (const p of Object.values(players)) delete p.lastDate;

  console.log('Preuzimam Fantasy cene...');
  let prices = null;
  try {
    prices = await loadPrices();
    console.log(`Cene: ${Object.keys(prices.players).length} igrača, ${Object.keys(prices.coaches).length} trenera (${prices.file})`);
  } catch (e) {
    console.warn('Cene nisu preuzete, aplikacija koristi procenu:', e.message);
  }

  const next = games.find(g => !g.played);
  const data = {
    updated: new Date().toISOString(),
    season: SEASON,
    nextRound: next ? next.round : null,
    teams,
    coaches,
    players,
    games,
    lines,
    prices,
  };
  const json = JSON.stringify(data);
  await writeFile(OUT_FILE, json);
  // Isti podaci kao skripta: browser ne dozvoljava fetch kad se index.html otvori direktno iz foldera (file://)
  await writeFile(OUT_FILE.replace(/\.json$/, '.js'), `window.EL_DATA = ${json};\n`);
  console.log(`Gotovo: ${Object.keys(players).length} igrača, ${lines.length} linija -> ${path.relative(ROOT, OUT_FILE)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
