// UI aplikacije. Računanje je u model.js (window.ELModel).
(function () {
  'use strict';
  const M = window.ELModel;
  const { F, POSITIONS, POS_NAME, ARCHETYPES, ARCH_HINT, RULES } = M;
  const r1 = x => (Math.round(x * 10) / 10).toFixed(1);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = sel => document.querySelector(sel);

  // ---------- Stanje (čuva se lokalno na uređaju) ----------
  const store = {
    get(key, def) { try { const v = localStorage.getItem('elf.' + key); return v ? JSON.parse(v) : def; } catch { return def; } },
    set(key, val) { try { localStorage.setItem('elf.' + key, JSON.stringify(val)); } catch { /* privatni režim */ } },
  };
  const emptyTeam = () => ({ slots: { G: [null, null, null, null], F: [null, null, null, null], C: [null, null] }, coach: null, bank: 0 });
  let team = store.get('team', emptyTeam());
  let prices = store.get('prices', {});
  let settings = Object.assign({ horizon: 3, lambda: 0.3, maxPerTeam: RULES.maxPerClub, trades: 4, theme: 'auto' }, store.get('settings', {}));
  const ui = { view: 'tim', pos: 'ALL', teamFilter: '', q: '', sort: 'proj', defMetric: 'delta', plans: null };

  let model = null;
  const saveTeam = () => store.set('team', team);
  const savePrices = () => store.set('prices', prices);
  const saveSettings = () => store.set('settings', settings);

  function applyTheme() {
    if (settings.theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', settings.theme);
  }

  // ---------- Pomoćne ----------
  // Cena: zvanična iz igre (osvežava se automatski) > ručno upisana > procena aplikacije
  const officialOf = e => (e.isCoach ? model.data.prices?.coaches[e.team] : model.data.prices?.players[e.code]) || null;
  const priceSource = e => (officialOf(e)?.cr != null ? 'official' : prices[e.isCoach ? coachKey(e.team) : e.code] != null ? 'manual' : 'est');
  const priceOf = p => officialOf(p)?.cr ?? prices[p.code] ?? p.estPrice;
  const priceIsReal = p => priceSource(p) !== 'est';
  const priceChg = e => officialOf(e)?.chg ?? null;
  const coachKey = t => 'coach:' + t;
  const coachEnt = t => (t ? { isCoach: true, team: t, code: coachKey(t), display: model.coaches[t]?.display || 'Trener', pos: 'HC' } : null);
  const coachEstPrice = t => M.round1(Math.max(4, Math.min(14, 8 + 0.25 * (model.teams[t]?.rating || 0))));
  const coachPrice = t => model.data.prices?.coaches[t]?.cr ?? prices[coachKey(t)] ?? coachEstPrice(t);
  const entPrice = e => (e.isCoach ? coachPrice(e.team) : priceOf(e));
  function chgHtml(e) {
    const c = priceChg(e);
    if (c == null) return '';
    return `<span class="${c > 0 ? 'up' : c < 0 ? 'down' : 'muted'}">${c > 0 ? '+' : ''}${r1(c)}</span>`;
  }
  const proj = e => M.projectEntity(model, e, settings.horizon, entPrice(e), settings.lambda);
  const teamShort = c => model.teams[c]?.short || c;
  const crest = c => model.teams[c]?.crest ? `<img class="crest" src="${esc(model.teams[c].crest)}" alt="" loading="lazy">` : '';

  function heatStyle(v, maxAbs) {
    if (!maxAbs || !isFinite(v)) return '';
    const a = Math.min(1, Math.abs(v) / maxAbs) * 0.55;
    return `background: rgba(var(${v >= 0 ? '--div-pos' : '--div-neg'}), ${a.toFixed(2)})`;
  }
  function formArrow(f) {
    if (f > 1.5) return `<span class="up" title="u usponu">▲ ${r1(f)}</span>`;
    if (f < -1.5) return `<span class="down" title="u padu">▼ ${r1(Math.abs(f))}</span>`;
    return `<span class="muted">● ${r1(f)}</span>`;
  }
  function injTag(p) {
    if (!p.gp) return '<span class="tag inj">bez minuta</span>';
    if (p.missed >= 1) return `<span class="tag inj" title="Nije igrao poslednjih ${p.missed} utakmica svog tima">⚠ ${p.missed} izost.</span>`;
    return '';
  }
  // Čipovi protivnika u horizontu, obojeni koliko taj protivnik dozvoljava poziciji igrača
  function oppChips(e) {
    const games = M.horizonGames(model, e.team, settings.horizon);
    return '<span class="opp">' + games.map(g => {
      let v;
      if (e.isCoach) v = M.expectedMargin(model, e.team, g.opp, g.home) / 2;
      else v = model.defense[g.opp]?.posDelta[e.pos] || 0;
      return `<span style="${heatStyle(v, e.isCoach ? 6 : 3)}" title="Kolo ${g.round}: ${g.home ? 'kod kuće' : 'u gostima'} protiv ${esc(teamShort(g.opp))}">${g.home ? '' : '@'}${esc(g.opp)}</span>`;
    }).join('') + '</span>';
  }
  function playerCell(p, sub) {
    const img = p.img ? `<img src="${esc(p.img)}" alt="" loading="lazy">` : crest(p.team);
    return `<div class="pname">${img}<div style="min-width:0"><div class="n">${esc(p.display)}</div><div class="s">${esc(sub ?? teamShort(p.team))}</div></div></div>`;
  }
  const allPlayers = () => Object.values(model.players).filter(p => p.pos && model.teams[p.team] && p.active !== false);

  // ---------- Učitavanje ----------
  // Otvoreno direktno iz foldera (file://): fetch nije dozvoljen, pa se podaci učitavaju kao skripta
  function loadDataScript() {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'data/data.js?t=' + Date.now();
      s.onload = () => { const d = window.EL_DATA; s.remove(); d ? resolve(d) : reject(new Error('data/data.js je prazan')); };
      s.onerror = () => { s.remove(); reject(new Error('nema fajla data/data.js')); };
      document.head.appendChild(s);
    });
  }

  async function loadData() {
    let data;
    if (location.protocol === 'file:') {
      data = await loadDataScript();
    } else {
      const res = await fetch('data/data.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      data = await res.json();
    }
    model = M.buildModel(data);
    const fmt = d => new Date(d).toLocaleString('sr-RS', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const pr = data.prices?.capturedAt ? ` · cene ${fmt(data.prices.capturedAt)}` : ' · <span class="warn">cene: procena</span>';
    $('#meta').innerHTML = `${esc(data.season)} · kolo za izmene: <b>${model.targetRound ?? '-'}</b><br>statistika ${fmt(data.updated)}${pr}`;
  }

  // ---------- Navigacija ----------
  function show(view) {
    ui.view = view;
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    document.querySelectorAll('section.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + view));
    render();
    window.scrollTo(0, 0);
  }
  function render() {
    if (!model) return;
    ({ tim: renderTim, igraci: renderIgraci, odbrana: renderOdbrana, ekipe: renderEkipe, podesavanja: renderPodesavanja })[ui.view]();
  }

  // ---------- Moj tim ----------
  function rosterEntries() {
    const out = [];
    for (const pos of POSITIONS) team.slots[pos].forEach((code, i) => out.push({ kind: pos, idx: i, ent: code ? model.players[code] || null : null }));
    out.push({ kind: 'coach', idx: 0, ent: coachEnt(team.coach) });
    return out;
  }

  function renderTim() {
    const el = $('#view-tim');
    const entries = rosterEntries();
    const filled = entries.filter(e => e.ent);
    const value = filled.reduce((s, e) => s + entPrice(e.ent), 0);
    const nextR = model.targetRound;
    const unlimited = nextR != null && RULES.unlimitedAfterRounds.includes(nextR - 1);

    const slotHtml = e => {
      if (!e.ent) {
        return `<div class="slot empty" data-pick="${e.kind}" data-idx="${e.idx}">+ ${e.kind === 'coach' ? 'Trener' : POS_NAME[e.kind]}</div>`;
      }
      const p = e.ent;
      const pr = proj(p);
      const isC = p.isCoach;
      const priceKey = isC ? coachKey(p.team) : p.code;
      const src = priceSource(p);
      const priceField = src === 'official'
        ? `<div class="num" style="text-align:right;min-width:52px" title="Zvanična cena iz igre"><b>${r1(entPrice(p))}</b><div style="font-size:11px">${chgHtml(p)}</div></div>`
        : `<input type="number" step="0.1" min="0" value="${r1(entPrice(p))}" data-price="${esc(priceKey)}" title="${src === 'manual' ? 'Tvoja cena' : 'Procena — upiši pravu cenu iz igre'}" style="${src === 'manual' ? '' : 'color:var(--muted)'}">`;
      return `<div class="slot">
        ${isC ? crest(p.team) : (p.img ? `<img class="crest" src="${esc(p.img)}" alt="">` : crest(p.team))}
        <div class="info" ${isC ? '' : `data-player="${p.code}"`} style="cursor:${isC ? 'default' : 'pointer'}">
          <div class="n">${esc(p.display)} ${isC ? '' : injTag(p)}</div>
          <div class="s">${esc(teamShort(p.team))} · sledeće ${r1(pr.next)} · ${settings.horizon} kola ${r1(pr.total)}</div>
        </div>
        ${priceField}
        <button class="x" data-remove="${e.kind}" data-idx="${e.idx}" title="Ukloni">×</button>
      </div>`;
    };

    const group = (kind, title) => `<h3>${title}</h3><div class="slots">${entries.filter(e => e.kind === kind).map(slotHtml).join('')}</div>`;

    el.innerHTML = `
      <div class="card">
        <h2>Moj tim</h2>
        <p class="hint">Dodaj svojih 10 igrača i trenera i upiši koliko kredita ti je ostalo. Cene se preuzimaju iz zvanične igre i osvežavaju same; sivo polje = igrač bez zvanične cene, tu upiši cenu ručno. Sve se čuva na ovom uređaju.</p>
        <div class="row">
          <label>Preostali krediti<input type="number" step="0.1" id="bank" value="${team.bank}"></label>
          <div class="summary grow" style="justify-content:flex-end">
            <span>Vrednost tima <b>${r1(value)}</b></span>
            <span>Ukupno <b>${r1(value + Number(team.bank || 0))}</b></span>
          </div>
        </div>
        ${group('G', 'Bekovi (4)')}${group('F', 'Krila (4)')}${group('C', 'Centri (2)')}${group('coach', 'Trener')}
        <div class="row" style="margin-top:12px"><button class="btn small ghost" id="clear-team">Isprazni tim</button></div>
      </div>

      <div class="card">
        <h2>Preporuke izmena${nextR != null ? ` za kolo ${nextR}` : ''}</h2>
        <p class="hint">Traži kombinaciju do ${settings.trades} izmena (igrači i/ili trener) koja donosi najviše projektovanih poena u narednih ${settings.horizon} kola, u okviru tvojih kredita. Bliža kola imaju veću težinu.</p>
        ${unlimited ? `<div class="notice">Posle kola ${nextR - 1} važe <b>neograničene izmene</b> — povećaj broj izmena ispod.</div>` : ''}
        <div class="row">
          <label>Broj izmena<input type="number" id="s-trades" min="1" max="11" value="${settings.trades}"></label>
          <label>Kola unapred<input type="number" id="s-horizon" min="1" max="6" value="${settings.horizon}"></label>
          <label>Max iz istog kluba<input type="number" id="s-maxteam" min="0" max="10" value="${settings.maxPerTeam}" title="0 = bez ograničenja"></label>
          <label class="grow" style="min-width:200px">Fokus: poeni ↔ rast kredita (${Math.round(settings.lambda * 100)}%)
            <input type="range" id="s-lambda" min="0" max="1" step="0.05" value="${settings.lambda}">
          </label>
        </div>
        <div class="row" style="margin-top:10px"><button class="btn primary" id="run-opt">Preporuči izmene</button></div>
        <div id="plans">${ui.plans ? renderPlans(ui.plans) : ''}</div>
      </div>

      ${filled.length ? renderTeamAnalysis(entries) : ''}
    `;

    el.querySelector('#bank').addEventListener('change', ev => { team.bank = Number(ev.target.value) || 0; saveTeam(); ui.plans = null; renderTim(); });
    el.querySelectorAll('[data-price]').forEach(inp => inp.addEventListener('change', ev => {
      const v = parseFloat(ev.target.value);
      if (isFinite(v)) prices[ev.target.dataset.price] = v; else delete prices[ev.target.dataset.price];
      savePrices(); ui.plans = null; renderTim();
    }));
    el.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => {
      const kind = b.dataset.remove;
      if (kind === 'coach') team.coach = null; else team.slots[kind][+b.dataset.idx] = null;
      saveTeam(); ui.plans = null; renderTim();
    }));
    el.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => openPicker(b.dataset.pick, +b.dataset.idx)));
    el.querySelectorAll('[data-player]').forEach(b => b.addEventListener('click', () => openPlayer(b.dataset.player)));
    el.querySelector('#clear-team').addEventListener('click', () => {
      if (!confirm('Isprazniti ceo tim?')) return;
      team = emptyTeam(); saveTeam(); ui.plans = null; renderTim();
    });
    const setNum = (id, key, lo, hi) => el.querySelector(id).addEventListener('change', ev => {
      settings[key] = Math.max(lo, Math.min(hi, Number(ev.target.value) || lo)); saveSettings(); ui.plans = null; renderTim();
    });
    setNum('#s-trades', 'trades', 1, 11);
    setNum('#s-horizon', 'horizon', 1, 6);
    setNum('#s-maxteam', 'maxPerTeam', 0, 10);
    el.querySelector('#s-lambda').addEventListener('change', ev => { settings.lambda = Number(ev.target.value); saveSettings(); ui.plans = null; renderTim(); });
    el.querySelector('#run-opt').addEventListener('click', () => {
      const btn = el.querySelector('#run-opt');
      btn.disabled = true; btn.textContent = 'Računam…';
      setTimeout(() => { ui.plans = runOptimizer(); renderTim(); document.getElementById('plans')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 30);
    });
    el.querySelectorAll('[data-apply]').forEach(b => b.addEventListener('click', () => applyPlan(+b.dataset.apply)));
  }

  function runOptimizer() {
    const entries = rosterEntries();
    const roster = entries.map(e => ({ key: e.ent ? (e.ent.isCoach ? e.ent.code : e.ent.code) : `empty:${e.kind}:${e.idx}`, kind: e.kind, idx: e.idx, ent: e.ent, price: e.ent ? entPrice(e.ent) : 0 }));
    const pool = { G: [], F: [], C: [], coach: [] };
    for (const p of allPlayers()) if (p.gp > 0) pool[p.pos].push({ key: p.code, ent: p, price: priceOf(p), team: p.team });
    for (const t of Object.keys(model.teams)) {
      const e = coachEnt(t);
      pool.coach.push({ key: e.code, ent: e, price: coachPrice(t), team: t });
    }
    const cache = new Map();
    const evalEnt = (ent, price) => {
      const k = ent.code + '|' + price;
      if (!cache.has(k)) cache.set(k, M.projectEntity(model, ent, settings.horizon, price, settings.lambda));
      return cache.get(k);
    };
    const t0 = performance.now();
    const res = M.optimizeTrades(model, { roster, pool, bank: Number(team.bank) || 0, maxTrades: settings.trades, maxPerTeam: settings.maxPerTeam, evalEnt });
    res.ms = Math.round(performance.now() - t0);
    res.evalEnt = evalEnt;
    return res;
  }

  function planStats(plan, evalEnt) {
    let dTotal = 0, dNext = 0;
    for (const sw of plan.list) {
      const pin = evalEnt(sw.inn.ent, sw.inn.price);
      const pout = sw.slot.ent ? evalEnt(sw.slot.ent, sw.slot.price) : { total: 0, next: 0 };
      dTotal += pin.total - pout.total; dNext += pin.next - pout.next;
    }
    return { dTotal, dNext, bankAfter: (Number(team.bank) || 0) - plan.cost };
  }

  function renderPlans(res) {
    if (!res.plans.length) {
      return `<div class="notice">Nema izmene koja poboljšava tim u okviru ${r1(Number(team.bank) || 0)} kredita${settings.maxPerTeam ? ` i limita od ${settings.maxPerTeam} igrača po klubu` : ''}. Probaj više kredita, veći horizont ili proveri cene.</div>`;
    }
    const swapRow = sw => {
      const o = sw.slot.ent, i = sw.inn.ent;
      const pin = res.evalEnt(i, sw.inn.price);
      const pout = o ? res.evalEnt(o, sw.slot.price) : null;
      const side = (e, price, pr) => e ? `<div class="side">
          <div class="n">${e.isCoach ? '' : `<span class="pos">${e.pos}</span> `}${esc(e.display)}</div>
          <div class="s">${esc(teamShort(e.team))} · ${r1(price)} kr · proj. ${r1(pr.total)} ${oppChips(e)}</div></div>`
        : '<div class="side"><div class="n muted">(prazno mesto)</div></div>';
      return `<div class="swap">${side(o, sw.slot.price, pout)}<div class="arrow">→</div>${side(i, sw.inn.price, pin)}</div>`;
    };
    const block = (plan, idx, title) => {
      const st = planStats(plan, res.evalEnt);
      return `<div class="plan ${idx === 0 ? 'best' : ''}">
        <div class="row"><b class="grow">${title}</b><button class="btn small" data-apply="${idx}">Primeni u tim</button></div>
        <div class="summary">
          <span>Izmena <b>${plan.list.length}</b></span>
          <span>Kolo ${model.targetRound} <b class="${st.dNext >= 0 ? 'up' : 'down'}">${st.dNext >= 0 ? '+' : ''}${r1(st.dNext)}</b></span>
          <span>${settings.horizon} kola <b class="${st.dTotal >= 0 ? 'up' : 'down'}">${st.dTotal >= 0 ? '+' : ''}${r1(st.dTotal)}</b></span>
          <span>Ostaje kredita <b>${r1(st.bankAfter)}</b></span>
        </div>
        ${plan.list.map(swapRow).join('')}
      </div>`;
    };
    const counts = Object.keys(res.byCount).map(Number).sort((a, b) => a - b);
    const byCountHtml = counts.length > 1 ? `<h3>Ako želiš manje izmena</h3><div class="table-wrap"><table><thead><tr><th class="l">Izmena</th><th>Δ ${settings.horizon} kola</th><th class="l">Šta menja</th></tr></thead><tbody>${counts.map(c => {
      const p = res.byCount[c]; const st = planStats(p, res.evalEnt);
      return `<tr><td class="l">${c}</td><td class="num">+${r1(st.dTotal)}</td><td class="l">${p.list.map(sw => `${esc(sw.slot.ent?.display || '—')} → ${esc(sw.inn.ent.display)}`).join(', ')}</td></tr>`;
    }).join('')}</tbody></table></div>` : '';
    ui.planList = res.plans;
    return block(res.plans[0], 0, 'Najbolja kombinacija') +
      res.plans.slice(1, 3).map((p, i) => block(p, i + 1, `Alternativa ${i + 1}`)).join('') +
      byCountHtml +
      `<p class="hint">Projekcija = forma i prosek PIR-a, korigovani za to koliko protivnik dozvoljava toj poziciji i tipu igrača, domaći teren i šansu za pobedu (+10%). Trener: očekivani bodovi po pravilima za razliku na utakmici.</p>`;
  }

  function applyPlan(idx) {
    const plan = ui.planList?.[idx];
    if (!plan) return;
    for (const sw of plan.list) {
      if (sw.slot.kind === 'coach') team.coach = sw.inn.ent.team;
      else team.slots[sw.slot.kind][sw.slot.idx] = sw.inn.ent.code;
    }
    team.bank = M.round1((Number(team.bank) || 0) - plan.cost);
    saveTeam(); ui.plans = null; renderTim();
  }

  function renderTeamAnalysis(entries) {
    const rows = entries.filter(e => e.ent).map(e => ({ e: e.ent, pr: proj(e.ent) }));
    const players = rows.filter(r => !r.e.isCoach).sort((a, b) => b.pr.next - a.pr.next);
    // Predlog prve petorke: najviše projektovanih poena uz 1–3 beka, 1–3 krila, 1–2 centra
    const five = [];
    const cnt = { G: 0, F: 0, C: 0 };
    const max = { G: 3, F: 3, C: 2 };
    for (const need of POSITIONS) {
      const r = players.find(x => x.e.pos === need && !five.includes(x));
      if (r) { five.push(r); cnt[need]++; }
    }
    for (const r of players) {
      if (five.length >= 5) break;
      if (five.includes(r) || cnt[r.e.pos] >= max[r.e.pos]) continue;
      five.push(r); cnt[r.e.pos]++;
    }
    const captain = players[0];
    return `<div class="card">
      <h2>Analiza tima — kolo ${model.targetRound ?? '-'}</h2>
      ${captain ? `<p class="hint">Predlog kapitena: <b>${esc(captain.e.display)}</b> (${r1(captain.pr.next)}). Prva petorka: ${five.map(r => esc(r.e.display)).join(', ')}.</p>` : ''}
      <div class="table-wrap"><table>
        <thead><tr><th class="l">Igrač</th><th>Cena</th><th>PIR</th><th>Forma</th><th>Sled.</th><th>${settings.horizon} kola</th><th class="l hide-sm">Protivnici</th></tr></thead>
        <tbody>${rows.sort((a, b) => b.pr.total - a.pr.total).map(({ e, pr }) => `
          <tr class="${e.isCoach ? '' : 'click'}" ${e.isCoach ? '' : `data-player="${e.code}"`}>
            <td class="l">${e.isCoach ? `<div class="pname">${crest(e.team)}<div><div class="n">${esc(e.display)}</div><div class="s">Trener · ${esc(teamShort(e.team))}</div></div></div>` : playerCell(e, `${POS_NAME[e.pos]} · ${teamShort(e.team)}`)}</td>
            <td class="num">${r1(entPrice(e))}</td>
            <td class="num">${e.isCoach ? '' : r1(e.pirAvg)}</td>
            <td class="num">${e.isCoach ? '' : formArrow(e.form)} ${e.isCoach ? '' : injTag(e)}</td>
            <td class="num">${r1(pr.next)}</td>
            <td class="num"><b>${r1(pr.total)}</b></td>
            <td class="l hide-sm">${oppChips(e)}</td>
          </tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  }

  // Bira igrača/trenera za prazno mesto
  function openPicker(kind, idx) {
    const owned = new Set(Object.values(team.slots).flat().filter(Boolean));
    let q = '';
    const list = () => {
      let items;
      if (kind === 'coach') {
        items = Object.keys(model.teams).map(coachEnt);
      } else {
        items = allPlayers().filter(p => p.pos === kind && !owned.has(p.code));
      }
      const nq = M.normalize(q);
      if (nq) items = items.filter(e => M.normalize(e.display + ' ' + teamShort(e.team) + ' ' + e.team).includes(nq));
      return items.map(e => ({ e, pr: proj(e) })).sort((a, b) => b.pr.total - a.pr.total).slice(0, 80);
    };
    const draw = () => {
      $('#picker-list').innerHTML = list().map(({ e, pr }) => `
        <tr class="click" data-choose="${esc(e.isCoach ? e.team : e.code)}">
          <td class="l">${e.isCoach ? `<div class="pname">${crest(e.team)}<div><div class="n">${esc(e.display)}</div><div class="s">${esc(teamShort(e.team))}</div></div></div>` : playerCell(e)}</td>
          <td class="num">${r1(entPrice(e))}</td>
          <td class="num">${e.isCoach ? '' : r1(e.pirAvg)}</td>
          <td class="num"><b>${r1(pr.total)}</b></td>
        </tr>`).join('');
      $('#picker-list').querySelectorAll('[data-choose]').forEach(tr => tr.addEventListener('click', () => {
        if (kind === 'coach') team.coach = tr.dataset.choose; else team.slots[kind][idx] = tr.dataset.choose;
        saveTeam(); ui.plans = null; closeModal(); renderTim();
      }));
    };
    openModal(`
      <div class="head"><h2>Izaberi: ${kind === 'coach' ? 'trenera' : POS_NAME[kind].toLowerCase()}</h2><button class="btn small" data-close>Zatvori</button></div>
      <input type="search" id="picker-q" placeholder="Pretraga po imenu ili klubu" style="width:100%">
      <div class="table-wrap"><table><thead><tr><th class="l">Ime</th><th>Cena</th><th>PIR</th><th>${settings.horizon} kola</th></tr></thead><tbody id="picker-list"></tbody></table></div>
    `);
    draw();
    const inp = $('#picker-q');
    inp.addEventListener('input', () => { q = inp.value; draw(); });
    if (window.matchMedia('(min-width: 760px)').matches) inp.focus();
  }

  // ---------- Forma igrača ----------
  function renderIgraci() {
    const el = $('#view-igraci');
    const teamOpts = Object.values(model.teams).sort((a, b) => a.short.localeCompare(b.short))
      .map(t => `<option value="${t.code}" ${ui.teamFilter === t.code ? 'selected' : ''}>${esc(t.short)}</option>`).join('');
    el.innerHTML = `
      <div class="card">
        <h2>Igrači i forma</h2>
        <p class="hint">Forma = prosek PIR-a u poslednje 3 utakmice minus sezonski prosek. Projekcija uzima u obzir naredna ${settings.horizon} kola i protivnike (plavo = protivnik dozvoljava više toj poziciji, crveno = manje).</p>
        <div class="row">
          <div class="seg" id="pos-seg">${['ALL', ...POSITIONS].map(p => `<button data-pos="${p}" class="${ui.pos === p ? 'on' : ''}">${p === 'ALL' ? 'Svi' : POS_NAME[p]}</button>`).join('')}</div>
          <select id="team-f"><option value="">Svi klubovi</option>${teamOpts}</select>
          <select id="sort-f">
            ${[['proj', `Projekcija ${settings.horizon} kola`], ['form', 'Forma'], ['pir', 'Prosek PIR'], ['value', 'Poeni po kreditu'], ['price', 'Cena'], ['chg', 'Rast cene u poslednjem kolu']].map(([k, t]) => `<option value="${k}" ${ui.sort === k ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
          <input type="search" id="q-f" placeholder="Pretraga" value="${esc(ui.q)}" class="grow">
        </div>
      </div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th class="l">Igrač</th><th>Poz</th><th>Cena</th><th title="Promena cene posle poslednjeg kola">±kr</th><th>Ut</th><th class="hide-sm">Min</th><th>PIR</th><th>Posl.3</th><th>Forma</th><th>${settings.horizon} kola</th><th class="hide-sm">Pts/kr</th><th class="l hide-sm">Protivnici</th></tr></thead>
        <tbody id="pl-body"></tbody>
      </table></div></div>`;

    const draw = () => {
      const nq = M.normalize(ui.q);
      let rows = allPlayers().filter(p => p.gp > 0 && (ui.pos === 'ALL' || p.pos === ui.pos) && (!ui.teamFilter || p.team === ui.teamFilter) && (!nq || p.search.includes(nq)))
        .map(p => { const pr = proj(p); return { p, pr, value: pr.total / Math.max(1, priceOf(p)) }; });
      const key = { proj: r => r.pr.total, form: r => r.p.form, pir: r => r.p.pirAvg, value: r => r.value, price: r => priceOf(r.p), chg: r => priceChg(r.p) ?? -99 }[ui.sort];
      rows.sort((a, b) => key(b) - key(a));
      rows = rows.slice(0, 150);
      $('#pl-body').innerHTML = rows.map(({ p, pr, value }) => `
        <tr class="click" data-player="${p.code}">
          <td class="l">${playerCell(p)}</td>
          <td><span class="pos">${p.pos}</span></td>
          <td class="num" style="${priceIsReal(p) ? '' : 'color:var(--muted)'}">${r1(priceOf(p))}</td>
          <td class="num">${chgHtml(p)}</td>
          <td class="num">${p.gp}</td>
          <td class="num hide-sm">${r1(p.minAvg)}</td>
          <td class="num">${r1(p.pirAvg)}</td>
          <td class="num">${r1(p.last3)}</td>
          <td class="num">${formArrow(p.form)}${injTag(p)}</td>
          <td class="num"><b>${r1(pr.total)}</b></td>
          <td class="num hide-sm">${value.toFixed(2)}</td>
          <td class="l hide-sm">${oppChips(p)}</td>
        </tr>`).join('') || '<tr><td colspan="12" class="empty-state">Nema igrača za izabrane filtere.</td></tr>';
      $('#pl-body').querySelectorAll('[data-player]').forEach(tr => tr.addEventListener('click', () => openPlayer(tr.dataset.player)));
    };
    draw();
    el.querySelectorAll('#pos-seg button').forEach(b => b.addEventListener('click', () => {
      ui.pos = b.dataset.pos; el.querySelectorAll('#pos-seg button').forEach(x => x.classList.toggle('on', x === b)); draw();
    }));
    el.querySelector('#team-f').addEventListener('change', ev => { ui.teamFilter = ev.target.value; draw(); });
    el.querySelector('#sort-f').addEventListener('change', ev => { ui.sort = ev.target.value; draw(); });
    el.querySelector('#q-f').addEventListener('input', ev => { ui.q = ev.target.value; draw(); });
  }

  function openPlayer(code) {
    const p = model.players[code];
    if (!p) return;
    const pr = proj(p);
    const T = model.teams[p.team];
    const inTeam = team.slots[p.pos]?.includes(code);
    const freeIdx = team.slots[p.pos]?.indexOf(null) ?? -1;
    const log = p.lines.slice().reverse().slice(0, 12).map(l => {
      const g = model.gameByCode.get(l[F.gc]);
      const res = T?.results.find(r => r.gc === l[F.gc]);
      return `<tr><td class="l">${g?.round ?? ''}</td><td class="l">${l[F.home] ? '' : '@'}${esc(teamShort(l[F.opp]))}</td>
        <td class="l ${res?.win ? 'up' : 'down'}">${res ? (res.win ? 'W' : 'L') + ' ' + res.us + ':' + res.them : ''}</td>
        <td class="num">${r1(l[F.min])}</td><td class="num">${l[F.pts]}</td><td class="num">${l[F.oreb] + l[F.dreb]}</td><td class="num">${l[F.ast]}</td><td class="num"><b>${l[F.pir]}</b></td></tr>`;
    }).join('');
    openModal(`
      <div class="head">${p.img ? `<img src="${esc(p.img)}" alt="">` : crest(p.team)}
        <div class="grow"><h2>${esc(p.display)}</h2><div class="hint" style="margin:0">${POS_NAME[p.pos] || ''} · ${esc(T?.name || p.team)} · tip: <b title="${esc(ARCH_HINT[p.archetype])}">${p.archetype}</b></div></div>
        <button class="btn small" data-close>Zatvori</button></div>
      <div class="stats-grid">
        <div class="stat"><div class="v">${p.gp}</div><div class="k">utakmica</div></div>
        <div class="stat"><div class="v">${r1(p.minAvg)}</div><div class="k">minuta</div></div>
        <div class="stat"><div class="v">${r1(p.ptsAvg)}</div><div class="k">poena</div></div>
        <div class="stat"><div class="v">${r1(p.pirAvg)}</div><div class="k">PIR prosek</div></div>
        <div class="stat"><div class="v">${r1(p.last3)}</div><div class="k">PIR posl. 3</div></div>
        <div class="stat"><div class="v">${r1(pr.total)}</div><div class="k">proj. ${settings.horizon} kola</div></div>
      </div>
      ${p.missed ? `<div class="notice">Nije igrao poslednjih ${p.missed} utakmica svog kluba — moguća povreda, projekcija je umanjena.</div>` : ''}
      <div class="row" style="margin:8px 0">
        ${priceSource(p) === 'official'
          ? `<div class="stat"><div class="v">${r1(priceOf(p))} kr ${chgHtml(p)}</div><div class="k">zvanična cena · prosek u igri ${r1(officialOf(p).fpt ?? 0)} FP</div></div><span class="grow"></span>`
          : `<label>Cena u igri (kr)<input type="number" step="0.1" id="pp-price" value="${prices[code] ?? ''}" placeholder="${r1(p.estPrice)}"></label>
        <span class="hint grow" style="margin:0">Nema zvanične cene za ovog igrača. Procena aplikacije: ${r1(p.estPrice)} kr — upiši pravu cenu.</span>`}
        ${inTeam ? '<span class="tag">u tvom timu</span>' : freeIdx >= 0 ? '<button class="btn primary small" id="pp-add">Dodaj u tim</button>' : ''}
      </div>
      <h3>Naredne utakmice</h3>
      <div class="table-wrap"><table><thead><tr><th class="l">Kolo</th><th class="l">Protivnik</th><th>Šansa za pobedu</th><th>Korekcija protivnika</th><th>Proj. poeni</th></tr></thead><tbody>
        ${pr.perGame.map(g => `<tr><td class="l">${g.round}</td><td class="l">${g.home ? 'vs' : '@'} ${esc(teamShort(g.opp))}</td><td class="num">${Math.round(g.pWin * 100)}%</td>
          <td class="num"><span style="${heatStyle(g.oppAdj, 3)};padding:1px 6px;border-radius:4px">${g.oppAdj >= 0 ? '+' : ''}${r1(g.oppAdj)}</span></td><td class="num"><b>${r1(g.fp)}</b></td></tr>`).join('') || '<tr><td colspan="5" class="empty-state">Nema zakazanih utakmica u horizontu.</td></tr>'}
      </tbody></table></div>
      <h3>Poslednje utakmice</h3>
      <div class="table-wrap"><table><thead><tr><th class="l">Kolo</th><th class="l">Protivnik</th><th class="l">Rez.</th><th>Min</th><th>Pts</th><th>Sk</th><th>As</th><th>PIR</th></tr></thead><tbody>${log}</tbody></table></div>
    `);
    $('#pp-price')?.addEventListener('change', ev => {
      const v = parseFloat(ev.target.value);
      if (isFinite(v)) prices[code] = v; else delete prices[code];
      savePrices(); ui.plans = null; render();
    });
    $('#pp-add')?.addEventListener('click', () => { team.slots[p.pos][freeIdx] = code; saveTeam(); ui.plans = null; closeModal(); show('tim'); });
  }

  // ---------- Odbrane ----------
  function renderOdbrana() {
    const el = $('#view-odbrana');
    const teams = Object.values(model.teams);
    const metric = ui.defMetric;
    const D = c => model.defense[c];
    let cols, val, maxAbs, fmt, sortKey;
    if (metric === 'delta') {
      cols = [...POSITIONS.map(p => ({ k: 'pos:' + p, t: POS_NAME[p] })), ...ARCHETYPES.map(a => ({ k: 'arch:' + a, t: a, hint: ARCH_HINT[a] }))];
      val = (c, k) => { const [type, key] = k.split(':'); return type === 'pos' ? D(c).posDeltaRaw[key] : D(c).archDeltaRaw[key]; };
      maxAbs = 4; fmt = v => (v >= 0 ? '+' : '') + r1(v);
    } else {
      cols = POSITIONS.map(p => ({ k: p, t: POS_NAME[p] }));
      val = (c, k) => (metric === 'pts' ? D(c).ptsByPos[k] - model.league.ptsByPos[k] : D(c).pirByPos[k] - model.league.pirByPos[k]);
      maxAbs = metric === 'pts' ? 8 : 10; fmt = v => (v >= 0 ? '+' : '') + r1(v);
    }
    sortKey = ui.defSort || cols[0].k;
    if (!cols.some(c => c.k === sortKey)) sortKey = cols[0].k;
    teams.sort((a, b) => val(b.code, sortKey) - val(a.code, sortKey));
    const leagueRow = metric === 'delta' ? '' : `<tr><td class="l"><b>Prosek lige</b></td>${cols.map(c => `<td class="cell num">${r1(metric === 'pts' ? model.league.ptsByPos[c.k] : model.league.pirByPos[c.k])}</td>`).join('')}</tr>`;

    el.innerHTML = `
      <div class="card">
        <h2>Kako ekipe brane</h2>
        <p class="hint">${metric === 'delta'
          ? 'Koliko PIR-a protivnički igrači ostvaruju protiv ove ekipe u odnosu na svoj sezonski prosek (igrači sa 10+ minuta). Po poziciji i po tipu igrača.'
          : `${metric === 'pts' ? 'Poeni' : 'PIR'} koje ekipa po utakmici prima od svake pozicije, u odnosu na prosek lige.`} Klikni na kolonu za sortiranje.</p>
        <div class="row">
          <div class="seg" id="def-seg">
            <button data-m="delta" class="${metric === 'delta' ? 'on' : ''}">Iznad proseka igrača</button>
            <button data-m="pts" class="${metric === 'pts' ? 'on' : ''}">Primljeni poeni</button>
            <button data-m="pir" class="${metric === 'pir' ? 'on' : ''}">Primljeni PIR</button>
          </div>
        </div>
        <div class="legend"><span>jaka odbrana (teško)</span><span class="bar"></span><span>slaba odbrana (lako)</span></div>
        <div class="table-wrap"><table class="heat">
          <thead><tr><th class="l">Ekipa</th>${cols.map(c => `<th class="sortable ${c.k === sortKey ? 'sorted' : ''}" data-sort="${esc(c.k)}" title="${esc(c.hint || '')}">${esc(c.t)}${c.k === sortKey ? ' ▼' : ''}</th>`).join('')}</tr></thead>
          <tbody>${leagueRow}${teams.map(t => `<tr class="click" data-team="${t.code}"><td class="l"><div class="pname">${crest(t.code)}<div class="n">${esc(t.short)}</div></div></td>
            ${cols.map(c => { const v = val(t.code, c.k); return `<td class="cell" style="${heatStyle(v, maxAbs)}" title="${esc(t.short)} · ${esc(c.t)}: ${fmt(v)}">${fmt(v)}</td>`; }).join('')}</tr>`).join('')}
          </tbody>
        </table></div>
        ${metric === 'delta' ? `<p class="hint">Tipovi igrača: ${ARCHETYPES.map(a => `<b>${a}</b> — ${ARCH_HINT[a]}`).join('; ')}. Na početku sezone uzorak je mali, pa vrednosti treba uzeti s rezervom.</p>` : ''}
      </div>
      ${renderEasySchedules()}`;

    el.querySelectorAll('#def-seg button').forEach(b => b.addEventListener('click', () => { ui.defMetric = b.dataset.m; renderOdbrana(); }));
    el.querySelectorAll('[data-sort]').forEach(th => th.addEventListener('click', () => { ui.defSort = th.dataset.sort; renderOdbrana(); }));
    el.querySelectorAll('[data-team]').forEach(tr => tr.addEventListener('click', () => openTeam(tr.dataset.team)));
  }

  // Koji klubovi imaju najlakši raspored za svaku poziciju u narednim kolima
  function renderEasySchedules() {
    const rows = Object.keys(model.teams).map(c => {
      const games = M.horizonGames(model, c, settings.horizon);
      const s = {};
      for (const pos of POSITIONS) s[pos] = games.reduce((acc, g) => acc + (model.defense[g.opp]?.posDelta[pos] || 0) + (g.home ? 0.6 : -0.6), 0);
      return { c, s, games };
    });
    const top = pos => rows.slice().sort((a, b) => b.s[pos] - a.s[pos]).slice(0, 5);
    return `<div class="card">
      <h2>Najlakši raspored u narednih ${settings.horizon} kola</h2>
      <p class="hint">Zbir koliko protivnici dozvoljavaju datoj poziciji (+ domaći teren). Igrači iz ovih klubova su dobri kandidati za kupovinu.</p>
      <div class="slots">${POSITIONS.map(pos => `<div><h3>${POS_NAME[pos]}</h3><table><tbody>${top(pos).map(r => `
        <tr class="click" data-team="${r.c}"><td class="l"><div class="pname">${crest(r.c)}<div class="n">${esc(teamShort(r.c))}</div></div></td><td class="num">${r.s[pos] >= 0 ? '+' : ''}${r1(r.s[pos])}</td></tr>`).join('')}</tbody></table></div>`).join('')}</div>
    </div>`;
  }

  // ---------- Ekipe ----------
  function renderEkipe() {
    const el = $('#view-ekipe');
    const H = Math.max(settings.horizon, 5);
    const roundsAhead = model.targetRound != null ? Array.from({ length: H }, (_, i) => model.targetRound + i).filter(r => model.rounds.includes(r)) : [];
    el.innerHTML = `
      <div class="card">
        <h2>Tabela</h2>
        <div class="table-wrap"><table>
          <thead><tr><th class="l">#</th><th class="l">Ekipa</th><th>W</th><th>L</th><th>+/-</th><th class="l hide-sm">Posl. 5</th>${roundsAhead.map(r => `<th>K${r}</th>`).join('')}</tr></thead>
          <tbody>${model.standings.map(t => `<tr class="click" data-team="${t.code}">
            <td class="l">${t.rank}</td>
            <td class="l"><div class="pname">${crest(t.code)}<div class="n">${esc(t.short)}</div></div></td>
            <td class="num">${t.w}</td><td class="num">${t.l}</td>
            <td class="num ${t.diff >= 0 ? 'up' : 'down'}">${t.diff >= 0 ? '+' : ''}${r1(t.diff)}</td>
            <td class="l hide-sm">${t.last5.map(x => `<span class="${x === 'W' ? 'up' : 'down'}">${x}</span>`).join(' ')}</td>
            ${roundsAhead.map(r => {
              const g = t.upcoming.find(u => u.round === r);
              if (!g) return '<td></td>';
              const m = M.expectedMargin(model, t.code, g.opp, g.home);
              return `<td class="cell" style="text-align:center;${heatStyle(m, 15)}" title="Kolo ${r}: ${g.home ? 'vs' : '@'} ${esc(teamShort(g.opp))}, šansa ${Math.round(M.winProb(model, t.code, g.opp, g.home) * 100)}%">${g.home ? '' : '@'}${g.opp}</td>`;
            }).join('')}
          </tr>`).join('')}</tbody>
        </table></div>
        <p class="hint">Boja narednih utakmica: plavo = očekivana pobeda (dobro za trenera i +10% bonus igračima), crveno = težak meč. @ = gostovanje.</p>
      </div>`;
    el.querySelectorAll('[data-team]').forEach(tr => tr.addEventListener('click', () => openTeam(tr.dataset.team)));
  }

  function openTeam(code) {
    const T = model.teams[code];
    const roster = allPlayers().filter(p => p.team === code && p.gp > 0).map(p => ({ p, pr: proj(p) })).sort((a, b) => b.p.pirAvg - a.p.pirAvg);
    const coach = coachEnt(code);
    const cpr = proj(coach);
    const D = model.defense[code];
    openModal(`
      <div class="head">${crest(code)}<div class="grow"><h2>${esc(T.name)}</h2><div class="hint" style="margin:0">${T.w}-${T.l} · ${T.rank}. mesto · trener ${esc(coach.display)}</div></div><button class="btn small" data-close>Zatvori</button></div>
      <div class="stats-grid">
        ${POSITIONS.map(pos => `<div class="stat" style="${heatStyle(D.posDeltaRaw[pos], 4)}"><div class="v">${D.posDeltaRaw[pos] >= 0 ? '+' : ''}${r1(D.posDeltaRaw[pos])}</div><div class="k">dozvoljava ${POS_NAME[pos].toLowerCase()}ima</div></div>`).join('')}
        <div class="stat"><div class="v">${r1(cpr.total)}</div><div class="k">trener, proj. ${settings.horizon} kola</div></div>
      </div>
      <h3>Igrači</h3>
      <div class="table-wrap"><table><thead><tr><th class="l">Igrač</th><th>Poz</th><th>Cena</th><th>PIR</th><th>Forma</th><th>${settings.horizon} kola</th></tr></thead><tbody>
        ${roster.map(({ p, pr }) => `<tr class="click" data-player="${p.code}"><td class="l">${playerCell(p, p.archetype)}</td><td><span class="pos">${p.pos}</span></td><td class="num">${r1(priceOf(p))}</td><td class="num">${r1(p.pirAvg)}</td><td class="num">${formArrow(p.form)}${injTag(p)}</td><td class="num"><b>${r1(pr.total)}</b></td></tr>`).join('')}
      </tbody></table></div>
      <h3>Raspored</h3>
      <div class="table-wrap"><table><tbody>
        ${T.results.slice(-5).map(r => `<tr><td class="l">K${r.round}</td><td class="l">${r.home ? 'vs' : '@'} ${esc(teamShort(r.opp))}</td><td class="num ${r.win ? 'up' : 'down'}">${r.win ? 'W' : 'L'} ${r.us}:${r.them}</td></tr>`).join('')}
        ${T.upcoming.slice(0, 5).map(u => `<tr><td class="l">K${u.round}</td><td class="l">${u.home ? 'vs' : '@'} ${esc(teamShort(u.opp))}</td><td class="num">${new Date(u.date).toLocaleDateString('sr-RS', { day: '2-digit', month: '2-digit' })} · ${Math.round(M.winProb(model, code, u.opp, u.home) * 100)}%</td></tr>`).join('')}
      </tbody></table></div>
    `);
    document.querySelectorAll('#modal [data-player]').forEach(tr => tr.addEventListener('click', () => openPlayer(tr.dataset.player)));
  }

  // ---------- Podešavanja ----------
  function renderPodesavanja() {
    const el = $('#view-podesavanja');
    const realCount = Object.keys(prices).length;
    el.innerHTML = `
      <div class="card">
        <h2>Podaci</h2>
        <p class="hint">Statistika se preuzima sa zvaničnog EuroLeague API-ja. Sezona ${esc(model.data.season)}, odigrano kolo ${model.lastPlayedRound}, izmene se prave za kolo ${model.targetRound ?? '-'}. Ažurirano ${new Date(model.data.updated).toLocaleString('sr-RS')}.</p>
        <button class="btn" id="reload">Osveži podatke</button>
      </div>
      <div class="card">
        <h2>Cene igrača (krediti)</h2>
        <p class="hint">${model.data.prices
          ? `Zvanične cene iz EuroLeague Fantasy igre: <b>${Object.keys(model.data.prices.players).length}</b> igrača i <b>${Object.keys(model.data.prices.coaches).length}</b> trenera, snimak od ${new Date(model.data.prices.capturedAt).toLocaleString('sr-RS')}. Izvor: javni skup podataka <a href="https://github.com/${esc(model.data.prices.source)}" target="_blank" rel="noopener">${esc(model.data.prices.source)}</a>, osvežava se na svaka 2 sata.`
          : 'Zvanične cene trenutno nisu preuzete, pa aplikacija koristi procenu.'}
          Ručne cene važe samo za igrače bez zvanične cene. Upisano ručno: <b>${realCount}</b>. Možeš nalepiti više cena odjednom, jedan red po igraču: <code>Prezime;cena</code> ili <code>Ime Prezime;cena</code> (trener: <code>trener KLUB;cena</code>, npr. <code>trener PAR;9.5</code>).</p>
        <textarea id="bulk" placeholder="Vezenkov;27.5&#10;Nadir Hifi;22&#10;trener OLY;10"></textarea>
        <div class="row" style="margin-top:8px"><button class="btn primary" id="bulk-go">Uvezi cene</button><button class="btn ghost" id="bulk-clear">Obriši sve ručne cene</button><span class="hint grow" id="bulk-res" style="margin:0"></span></div>
      </div>
      <div class="card">
        <h2>Prenos tima na drugi uređaj</h2>
        <p class="hint">Tim i cene se čuvaju posebno na svakom uređaju. Kopiraj kod ovde i nalepi ga na telefonu (ili obrnuto).</p>
        <textarea id="xfer" placeholder="Nalepi kod ovde…"></textarea>
        <div class="row" style="margin-top:8px"><button class="btn" id="xfer-copy">Kopiraj moj kod</button><button class="btn primary" id="xfer-load">Učitaj kod</button><span class="hint grow" id="xfer-res" style="margin:0"></span></div>
      </div>
      <div class="card">
        <h2>Izgled</h2>
        <div class="seg" id="theme-seg">${[['auto', 'Automatski'], ['light', 'Svetla'], ['dark', 'Tamna']].map(([k, t]) => `<button data-t="${k}" class="${settings.theme === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      </div>
      <div class="card">
        <h2>Pravila koja aplikacija koristi</h2>
        <p class="hint">Igrač: PIR (poeni + skokovi + asistencije + ukradene + blokade + iznuđene greške − izgubljene − primljene blokade − lične greške − promašaji), +10% (od apsolutne vrednosti) ako mu tim pobedi. Klupa nosi 50%.<br>
        Trener: pobeda do 10 razlike +10, 11–20 +20, preko 20 +25; poraz do 10 −5, 11–20 −10, preko 20 −20.<br>
        Tim: 4 beka, 4 krila, 2 centra i trener, najviše ${RULES.maxPerClub} igrača iz istog kluba. Do ${RULES.tradesPerRound} izmene po kolu; neograničene izmene posle kola ${RULES.unlimitedAfterRounds.join(', ')}.<br>
        Cene se menjaju posle svakog dana: igrač koji ostvari više nego što mu cena „očekuje” poskupljuje, a jeftiniji igrači brže rastu. Zato klizač „poeni ↔ rast kredita” daje prednost igračima čija je projekcija visoka u odnosu na cenu.</p>
      </div>`;

    el.querySelector('#reload').addEventListener('click', async () => {
      try { await loadData(); ui.plans = null; render(); } catch (e) { alert('Osvežavanje nije uspelo: ' + e.message); }
    });
    el.querySelector('#bulk-go').addEventListener('click', () => {
      const res = importPrices(el.querySelector('#bulk').value);
      el.querySelector('#bulk-res').textContent = `Uvezeno ${res.ok}` + (res.miss.length ? `, nije pronađeno: ${res.miss.slice(0, 8).join(', ')}${res.miss.length > 8 ? '…' : ''}` : '');
    });
    el.querySelector('#bulk-clear').addEventListener('click', () => {
      if (!confirm('Obrisati sve ručno upisane cene?')) return;
      prices = {}; savePrices(); ui.plans = null; renderPodesavanja();
    });
    el.querySelector('#xfer-copy').addEventListener('click', async () => {
      const code = btoa(unescape(encodeURIComponent(JSON.stringify({ team, prices }))));
      el.querySelector('#xfer').value = code;
      try { await navigator.clipboard.writeText(code); el.querySelector('#xfer-res').textContent = 'Kopirano.'; } catch { el.querySelector('#xfer-res').textContent = 'Označi i kopiraj tekst iznad.'; }
    });
    el.querySelector('#xfer-load').addEventListener('click', () => {
      try {
        const obj = JSON.parse(decodeURIComponent(escape(atob(el.querySelector('#xfer').value.trim()))));
        if (!obj.team?.slots) throw new Error('neispravan kod');
        team = obj.team; prices = obj.prices || {}; saveTeam(); savePrices(); ui.plans = null;
        el.querySelector('#xfer-res').textContent = 'Tim učitan.';
      } catch (e) { el.querySelector('#xfer-res').textContent = 'Kod nije ispravan.'; }
    });
    el.querySelectorAll('#theme-seg button').forEach(b => b.addEventListener('click', () => { settings.theme = b.dataset.t; saveSettings(); applyTheme(); renderPodesavanja(); }));
  }

  function importPrices(text) {
    const res = { ok: 0, miss: [] };
    const list = allPlayers();
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(/^(.*?)[;,\t]\s*([\d.,]+)\s*$/) || line.match(/^(.*\S)\s+([\d.,]+)$/);
      if (!m) { res.miss.push(line); continue; }
      const name = M.normalize(m[1].trim());
      const val = parseFloat(m[2].replace(',', '.'));
      const coach = name.match(/^(trener|coach|hc)\s+([a-z]{3})$/);
      if (coach && model.teams[coach[2].toUpperCase()]) { prices[coachKey(coach[2].toUpperCase())] = val; res.ok++; continue; }
      const words = name.split(/\s+/);
      let hits = list.filter(p => M.normalize(p.display) === name);
      if (!hits.length) hits = list.filter(p => words.every(w => M.normalize(p.display).split(/\s+/).includes(w)));
      if (!hits.length) hits = list.filter(p => M.normalize(p.display).includes(name));
      if (hits.length !== 1) { res.miss.push(m[1].trim() + (hits.length > 1 ? ' (više igrača)' : '')); continue; }
      prices[hits[0].code] = val; res.ok++;
    }
    savePrices(); ui.plans = null;
    return res;
  }

  // ---------- Modal ----------
  function openModal(html) {
    $('#modal').innerHTML = html;
    $('#modal-bg').classList.add('open');
    $('#modal').scrollTop = 0;
    $('#modal').querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModal));
  }
  function closeModal() { $('#modal-bg').classList.remove('open'); }
  $('#modal-bg').addEventListener('click', ev => { if (ev.target.id === 'modal-bg') closeModal(); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeModal(); });

  // ---------- Start ----------
  document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));
  applyTheme();
  loadData().then(() => {
    $('#loading').remove();
    render();
  }).catch(e => {
    $('#loading').innerHTML = `Podaci nisu učitani (${esc(e.message)}). Pokreni <code>start.cmd</code> — preuzima podatke i otvara aplikaciju na http://localhost:8787.`;
  });
})();
