// Habit Tracker - front-end (vanilla JS)
const DAY_LETTERS = ['D', 'L', 'M', 'M', 'J', 'V', 'S']; // dimanche -> samedi
const MONTH_SHORT = ['Jan', 'Fév', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
const CELL_W = 32;

// marques dessinées "au stylo"
const CHECK_SVG = '<svg viewBox="0 0 24 24" class="mark"><path d="M5 13.5c2 1.2 3.4 3 4.4 5 2.6-5.8 5.8-10 9.6-13"/></svg>';
const CROSS_SVG = '<svg viewBox="0 0 24 24" class="mark x"><path d="M6 6.5c4 3.5 8 7.5 12 11.5M17.5 6c-4 4-7.5 8-11 12"/></svg>';
const face = (mouth, cls) => `<svg viewBox="0 0 24 24" class="face ${cls}"><circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1" class="eye"/><circle cx="15" cy="10" r="1" class="eye"/><path d="${mouth}"/></svg>`;
const MOOD_FACE = {
  3: face('M8 14.2c2.2 2.4 5.8 2.4 8 0', 'happy'),
  2: face('M8.5 15.2h7', 'neutral'),
  1: face('M8 16.8c2.2-2.4 5.8-2.4 8 0', 'sad'),
};

const state = { months: [], period: null, stats: null, viewYear: null };
const $ = sel => document.querySelector(sel);

// ---------- Dates (chaînes "YYYY-MM-DD", calcul en UTC) ----------

const toDate = s => new Date(s + 'T00:00:00Z');
const iso = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => iso(new Date(toDate(s).getTime() + n * 864e5));
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return iso(d).slice(0, 7);
}
function daysOf(p) {
  const out = [];
  for (let d = p.start; d <= p.end; d = addDays(d, 1)) out.push(d);
  return out;
}
// semaines qui commencent le dimanche (comme sur le papier)
function weeksOf(days) {
  const weeks = [];
  for (const d of days) {
    if (!weeks.length || toDate(d).getUTCDay() === 0) weeks.push({ start: d, days: [] });
    weeks[weeks.length - 1].days.push(d);
  }
  return weeks;
}
const fmtLong = s => toDate(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- API ----------

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    // session expirée : retour à l'écran de connexion
    if (res.status === 401 && !url.startsWith('/api/auth/')) showAuth();
    throw new Error(err.error || 'Erreur serveur');
  }
  return res.status === 204 ? null : res.json();
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2500);
}

// ---------- Chargement d'un mois ----------

async function openMonth(ym) {
  state.period = await api('POST', '/api/months/' + ym);
  state.viewYear = Number(ym.slice(0, 4));
  try { localStorage.setItem('month', ym); } catch {}
  state.months = await api('GET', '/api/months');
  render();
  scrollToToday();
}

async function reloadMonth() {
  await openMonth(state.period.month);
}

// ---------- Statistiques ----------

function computeStats(p) {
  const days = daysOf(p);
  const today = todayISO();
  const elapsed = days.filter(d => d <= today);
  let done = 0, miss = 0;

  const habits = p.habits.map(h => {
    let hd = 0, hm = 0, best = 0, run = 0;
    for (const d of days) {
      const v = p.checks[h.id + '|' + d];
      if (v === 'done') { hd++; run++; best = Math.max(best, run); } else run = 0;
      if (v === 'miss') hm++;
    }
    // série actuelle : jours ✓ consécutifs jusqu'à aujourd'hui (aujourd'hui peut encore être vide)
    let cur = 0;
    let d = p.checks[h.id + '|' + today] === 'done' ? today : addDays(today, -1);
    while (d >= p.start && d <= p.end && p.checks[h.id + '|' + d] === 'done') { cur++; d = addDays(d, -1); }
    done += hd; miss += hm;
    return { ...h, done: hd, miss: hm, pct: elapsed.length ? hd / elapsed.length : 0, cur, best };
  });

  const weeks = weeksOf(days).map(w => {
    let wd = 0;
    for (const h of p.habits) for (const d of w.days) if (p.checks[h.id + '|' + d] === 'done') wd++;
    const total = p.habits.length * w.days.length;
    return { ...w, done: wd, pct: total ? wd / total : 0 };
  });

  const goal = p.goal || p.habits.length * days.length;
  return { days, weeks, today, elapsed, habits, done, miss, goal };
}

// ---------- Rendu ----------

function render() {
  const p = state.period;
  if (!p) return;
  const s = computeStats(p);
  state.stats = s;

  $('#periodTitle').textContent = p.title;
  $('#periodRange').textContent = `${fmtLong(p.start)} → ${fmtLong(p.end)} · ${s.days.length} jours`;
  const dayIdx = s.days.indexOf(s.today);
  $('#todayInfo').textContent = dayIdx >= 0
    ? `Aujourd'hui : jour ${dayIdx + 1} / ${s.days.length}`
    : (s.today < p.start ? 'Ce mois n\'a pas encore commencé' : 'Mois terminé');

  $('#goalVal').textContent = s.goal;
  $('#doneVal').textContent = s.done;
  $('#leftVal').textContent = Math.max(0, s.goal - s.done);
  $('#missVal').textContent = s.miss;

  $('#weekChart').innerHTML = weekChartSVG(s.weeks);
  $('#donut').innerHTML = donutSVG(s.goal ? s.done / s.goal : 0);
  renderTable(p, s);
  renderRanking(s);
  renderMonthTabs();
  if (document.activeElement !== $('#notes')) $('#notes').value = p.notes || '';
}

// les 12 onglets de l'année affichée, avec une petite barre de progression
function renderMonthTabs() {
  const y = state.viewYear;
  const current = todayISO().slice(0, 7);
  const active = state.period?.month;
  $('#yearLabel').textContent = y;
  $('#monthTabs').innerHTML = MONTH_SHORT.map((name, i) => {
    const ym = `${y}-${String(i + 1).padStart(2, '0')}`;
    let pct = 0;
    if (ym === active) pct = state.stats.goal ? state.stats.done / state.stats.goal : 0;
    else {
      const m = state.months.find(x => x.month === ym);
      if (m && m.goal) pct = m.done / m.goal;
    }
    const cls = ['tab', ym === active ? 'active' : '', ym === current ? 'current' : ''].join(' ');
    return `<button class="${cls}" data-month="${ym}" title="${Math.round(pct * 100)}% complété">
      <span class="lbl">${name}</span>
      <span class="mini"><i style="width:${Math.min(pct, 1) * 100}%"></i></span>
    </button>`;
  }).join('');
  // sur téléphone, centrer l'onglet du mois ouvert
  const tabs = $('#monthTabs');
  const act = tabs.querySelector('.tab.active');
  if (act) tabs.scrollLeft = act.offsetLeft - tabs.clientWidth / 2 + act.offsetWidth / 2;
}

function weekChartSVG(weeks) {
  const W = 620, H = 190, L = 36, B = 24, T = 14;
  const ch = H - B - T;
  const bw = (W - L) / Math.max(weeks.length, 1);
  let out = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Pourcentage par semaine">
    <defs><pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="7" stroke="var(--pen)" stroke-width="2.2"/></pattern></defs>`;
  for (const v of [0, 25, 50, 75, 100]) {
    const y = T + ch - ch * v / 100;
    out += `<line x1="${L}" x2="${W}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-dasharray="${v ? 4 : 0}"/>`;
    out += `<text x="${L - 6}" y="${y + 4}" text-anchor="end">${v}%</text>`;
  }
  weeks.forEach((w, i) => {
    const h = ch * w.pct;
    const x = L + i * bw + bw * 0.18;
    const width = bw * 0.64;
    if (h > 0) out += `<rect x="${x}" y="${T + ch - h}" width="${width}" height="${h}" fill="url(#hatch)" stroke="var(--pen)" stroke-width="1.6"><title>Semaine ${i + 1} : ${Math.round(w.pct * 100)}%</title></rect>`;
    if (w.pct > 0) out += `<text x="${x + width / 2}" y="${T + ch - h - 5}" text-anchor="middle" class="val">${Math.round(w.pct * 100)}%</text>`;
    out += `<text x="${x + width / 2}" y="${H - 5}" text-anchor="middle" class="hand">Sem. ${i + 1}</text>`;
  });
  return out + '</svg>';
}

function donutSVG(pct) {
  const r = 50, c = 2 * Math.PI * r, v = Math.min(pct, 1);
  return `<svg viewBox="0 0 140 140" role="img" aria-label="Progression globale">
    <circle cx="70" cy="70" r="${r}" fill="none" stroke="var(--line)" stroke-width="14"/>
    <circle cx="70" cy="70" r="${r}" fill="none" stroke="var(--pen)" stroke-width="14" stroke-linecap="round"
      stroke-dasharray="${c * v} ${c}" transform="rotate(-90 70 70)"/>
    <text x="70" y="80" text-anchor="middle" class="donut-val">${Math.round(pct * 100)}%</text>
  </svg>`;
}

function dayClasses(d, s, weekStarts) {
  const wd = toDate(d).getUTCDay();
  return [
    'day',
    weekStarts.has(d) ? 'week-start' : '',
    wd === 5 || wd === 6 ? 'weekend' : '',
    d === s.today ? 'is-today' : '',
  ].join(' ');
}

function renderTable(p, s) {
  const ws = new Set(s.weeks.map(w => w.start));
  let h = '<thead><tr>';
  h += '<th class="habit-name head" rowspan="3">Mes habitudes <span class="ar" lang="ar">عاداتي</span></th>';
  s.weeks.forEach((w, i) => { h += `<th class="week-label week-start" colspan="${w.days.length}">Semaine ${i + 1}</th>`; });
  h += '<th class="stat first" rowspan="3" title="Nombre de ✓">✓</th><th class="stat" rowspan="3" title="% des jours passés">%</th><th class="stat" rowspan="3" title="Série actuelle / meilleure série">Série</th></tr><tr>';
  for (const d of s.days) h += `<th class="${dayClasses(d, s, ws)}">${DAY_LETTERS[toDate(d).getUTCDay()]}</th>`;
  h += '</tr><tr>';
  for (const d of s.days) h += `<th class="${dayClasses(d, s, ws)} day-num" title="${fmtLong(d)}">${+d.slice(8)}</th>`;
  h += '</tr></thead><tbody>';

  for (const hb of s.habits) {
    h += `<tr><th class="habit-name"><div class="wrap">
      <span class="label" data-rename="${hb.id}" title="Cliquer pour renommer">${esc(hb.name)}</span>
      <span class="actions">
        <button class="icon-btn" data-move="-1" data-id="${hb.id}" title="Monter">↑</button>
        <button class="icon-btn" data-move="1" data-id="${hb.id}" title="Descendre">↓</button>
        <button class="icon-btn" data-del="${hb.id}" title="Supprimer">✕</button>
      </span></div></th>`;
    for (const d of s.days) {
      const v = p.checks[hb.id + '|' + d];
      h += `<td class="${dayClasses(d, s, ws)}"><button class="cell ${v || ''}" data-h="${hb.id}" data-d="${d}" aria-label="${esc(hb.name)} ${d}">${v === 'done' ? CHECK_SVG : v === 'miss' ? CROSS_SVG : ''}</button></td>`;
    }
    h += `<td class="stat first">${hb.done}</td>
      <td class="stat">${Math.round(hb.pct * 100)}%<div class="bar"><i style="width:${hb.pct * 100}%"></i></div></td>
      <td class="stat" title="Meilleure série : ${hb.best}">${hb.cur}${hb.cur >= 3 ? ' 🔥' : ''}<div class="tiny">max ${hb.best}</div></td></tr>`;
  }
  if (!s.habits.length) {
    h += `<tr><td colspan="${s.days.length + 4}" style="padding:16px" class="muted">Aucune habitude. Ajoute-en une ci-dessous.</td></tr>`;
  }
  h += '</tbody><tfoot>';

  // % réussite par jour
  h += '<tr class="extra-row"><th class="habit-name">Réussite du jour</th>';
  for (const d of s.days) {
    const n = p.habits.filter(hb => p.checks[hb.id + '|' + d] === 'done').length;
    const pct = p.habits.length ? Math.round(n / p.habits.length * 100) : 0;
    h += `<td class="${dayClasses(d, s, ws)} tiny">${n ? pct + '%' : ''}</td>`;
  }
  h += '<td colspan="3" class="stat first"></td></tr>';

  // poids par semaine
  h += '<tr class="extra-row"><th class="habit-name">Poids (kg)</th>';
  for (const w of s.weeks) {
    const v = p.weight[w.start] ?? '';
    h += `<td class="week-start" colspan="${w.days.length}"><input class="weight-input" type="number" step="0.1" min="1" data-weight="${w.start}" value="${v}" placeholder="—"></td>`;
  }
  h += '<td colspan="3" class="stat first"></td></tr>';

  // humeur par jour
  h += '<tr class="extra-row"><th class="habit-name">Humeur</th>';
  for (const d of s.days) {
    h += `<td class="${dayClasses(d, s, ws)}"><button class="cell mood-btn" data-mood="${d}" aria-label="Humeur ${d}">${MOOD_FACE[p.mood[d]] || ''}</button></td>`;
  }
  h += '<td colspan="3" class="stat first"></td></tr>';

  // courbe d'humeur
  h += `<tr class="extra-row"><th class="habit-name"><div class="mood-legend">
      <span>${MOOD_FACE[3]} Content</span><span>${MOOD_FACE[2]} Neutre</span><span>${MOOD_FACE[1]} Triste</span></div></th>
      <td class="mood-chart-cell" colspan="${s.days.length}">${moodChartSVG(p, s.days)}</td>
      <td colspan="3" class="stat first"></td></tr>`;
  h += '</tfoot>';

  $('#grid').innerHTML = h;
}

function moodChartSVG(p, days) {
  const W = days.length * CELL_W, H = 90;
  const y = v => ({ 3: 15, 2: 45, 1: 75 }[v]);
  const pts = days.map((d, i) => p.mood[d] ? [i * CELL_W + CELL_W / 2, y(p.mood[d])] : null).filter(Boolean);
  let out = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  for (const v of [3, 2, 1]) out += `<line x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-dasharray="4" vector-effect="non-scaling-stroke"/>`;
  if (pts.length > 1) out += `<polyline points="${pts.map(q => q.join(',')).join(' ')}" fill="none" stroke="var(--pen)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  for (const [x, yy] of pts) out += `<circle cx="${x}" cy="${yy}" r="3.2" fill="var(--pen)"/>`;
  return out + '</svg>';
}

function renderRanking(s) {
  const sorted = [...s.habits].sort((a, b) => b.pct - a.pct);
  $('#ranking').innerHTML = sorted.length
    ? sorted.map((h, i) => `<div class="rank-row">
        <span class="pos">${i + 1}</span>
        <span class="name">${esc(h.name)}</span>
        <div class="bar"><i style="width:${h.pct * 100}%"></i></div>
        <strong>${Math.round(h.pct * 100)}%</strong></div>`).join('')
    : '<p class="muted">Rien à classer pour l\'instant.</p>';
}

function scrollToToday() {
  const th = document.querySelector('thead th.is-today');
  const box = $('#tableScroll');
  box.scrollLeft = th ? Math.max(0, th.offsetLeft - 230 - CELL_W * 6) : 0;
}

// ---------- Navigation entre les mois ----------

$('#monthTabs').addEventListener('click', e => {
  const tab = e.target.closest('[data-month]');
  if (tab) openMonth(tab.dataset.month).catch(err => toast(err.message));
});
$('#prevMonth').addEventListener('click', () => openMonth(shiftMonth(state.period.month, -1)).catch(err => toast(err.message)));
$('#nextMonth').addEventListener('click', () => openMonth(shiftMonth(state.period.month, 1)).catch(err => toast(err.message)));
// changer d'année n'ouvre pas de mois : on choisit ensuite l'onglet
$('#prevYear').addEventListener('click', () => { state.viewYear--; renderMonthTabs(); });
$('#nextYear').addEventListener('click', () => { state.viewYear++; renderMonthTabs(); });

// ---------- Actions sur le tableau ----------

const NEXT_CELL = { undefined: 'done', done: 'miss', miss: null };
const NEXT_MOOD = { undefined: 3, 3: 2, 2: 1, 1: null };

$('#grid').addEventListener('click', async e => {
  const p = state.period;
  const btn = e.target.closest('button, .label');
  if (!btn) return;
  try {
    if (btn.dataset.h) {
      const key = btn.dataset.h + '|' + btn.dataset.d;
      const value = NEXT_CELL[p.checks[key]];
      if (value) p.checks[key] = value; else delete p.checks[key];
      render(); // mise à jour immédiate, l'appel serveur suit
      await api('PUT', `/api/periods/${p.id}/checks`, { habitId: btn.dataset.h, date: btn.dataset.d, value });
    } else if (btn.dataset.mood) {
      const d = btn.dataset.mood;
      const value = NEXT_MOOD[p.mood[d]];
      if (value) p.mood[d] = value; else delete p.mood[d];
      render();
      await api('PUT', `/api/periods/${p.id}/mood`, { date: d, value });
    } else if (btn.dataset.move) {
      p.habits = await api('POST', `/api/periods/${p.id}/habits/${btn.dataset.id}/move`, { dir: +btn.dataset.move });
      render();
    } else if (btn.dataset.del) {
      const hb = p.habits.find(h => h.id === btn.dataset.del);
      if (!confirm(`Supprimer « ${hb.name} » et toutes ses cases de ce mois ?`)) return;
      await api('DELETE', `/api/periods/${p.id}/habits/${hb.id}`);
      await reloadMonth();
      toast('Habitude supprimée');
    } else if (btn.dataset.rename) {
      startRename(btn);
    }
  } catch (err) {
    toast(err.message);
    reloadMonth();
  }
});

function startRename(label) {
  const p = state.period;
  const hb = p.habits.find(h => h.id === label.dataset.rename);
  const input = document.createElement('input');
  input.value = hb.name;
  input.maxLength = 60;
  label.replaceWith(input);
  input.focus();
  input.select();
  let finished = false;
  const finish = async ok => {
    if (finished) return;
    finished = true;
    const name = input.value.trim();
    if (ok && name && name !== hb.name) {
      try {
        await api('PUT', `/api/periods/${p.id}/habits/${hb.id}`, { name });
        hb.name = name;
      } catch (err) { toast(err.message); }
    }
    render();
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

$('#grid').addEventListener('change', async e => {
  const input = e.target.closest('[data-weight]');
  if (!input) return;
  const p = state.period;
  try {
    const r = await api('PUT', `/api/periods/${p.id}/weight`, { date: input.dataset.weight, value: input.value || null });
    if (r.value === null) delete p.weight[r.date]; else p.weight[r.date] = r.value;
    toast(r.value === null ? 'Poids effacé' : `Poids enregistré : ${r.value} kg`);
  } catch (err) { toast(err.message); }
});

$('#addHabitForm').addEventListener('submit', async e => {
  e.preventDefault();
  const input = $('#newHabit');
  try {
    const habit = await api('POST', `/api/periods/${state.period.id}/habits`, { name: input.value });
    state.period.habits.push(habit);
    input.value = '';
    render();
    toast('Habitude ajoutée');
  } catch (err) { toast(err.message); }
});

// notes : sauvegarde automatique après une pause de frappe
$('#notes').addEventListener('input', () => {
  $('#notesStatus').textContent = 'Écriture…';
  clearTimeout(state.notesTimer);
  const id = state.period.id;
  state.notesTimer = setTimeout(async () => {
    try {
      await api('PUT', `/api/periods/${id}`, { notes: $('#notes').value });
      if (state.period.id === id) state.period.notes = $('#notes').value;
      $('#notesStatus').textContent = 'Enregistré ✓';
    } catch (err) { $('#notesStatus').textContent = err.message; }
  }, 600);
});

$('#todayBtn').addEventListener('click', () => {
  const current = todayISO().slice(0, 7);
  if (state.period.month !== current) openMonth(current);
  else scrollToToday();
});

// ---------- Dialogue : modifier / réinitialiser le mois ----------

const dialog = $('#periodDialog');
const form = $('#periodForm');

$('#editPeriodBtn').addEventListener('click', () => {
  const p = state.period;
  if (!p) return;
  $('#dialogError').textContent = '';
  form.title.value = p.title;
  form.goal.value = p.goal || '';
  dialog.showModal();
  form.title.focus();
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await api('PUT', '/api/periods/' + state.period.id, {
      title: form.title.value,
      goal: form.goal.value ? Number(form.goal.value) : null,
    });
    dialog.close();
    await reloadMonth();
    toast('Mois modifié');
  } catch (err) { $('#dialogError').textContent = err.message; }
});

$('#deletePeriodBtn').addEventListener('click', async () => {
  if (!confirm(`Effacer toutes les cases, l'humeur, le poids et les notes de « ${state.period.title} » ?`)) return;
  await api('DELETE', '/api/periods/' + state.period.id);
  dialog.close();
  await reloadMonth(); // le mois est recréé vide, avec les habitudes du mois voisin
  toast('Mois réinitialisé');
});

$('#cancelDialog').addEventListener('click', () => dialog.close());

// importer un ancien fichier data/db.json dans son compte
$('#importFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  $('#importResult').textContent = 'Import en cours…';
  try {
    const data = JSON.parse(await file.text());
    const results = await api('POST', '/api/import', { periods: data.periods });
    const done = results.filter(r => r.status === 'importé');
    $('#importResult').textContent = done.length
      ? 'Importé : ' + done.map(r => `${r.month} (${r.checks} cases)`).join(', ')
      : 'Rien à importer : mois vides ou déjà remplis.';
    if (done.length) {
      state.months = await api('GET', '/api/months');
      await reloadMonth();
      toast('Données importées');
    }
  } catch (err) {
    $('#importResult').textContent = err instanceof SyntaxError ? 'Ce fichier n\'est pas un JSON valide' : err.message;
  }
  e.target.value = '';
});

// ---------- Thème jour / nuit ----------

function isDark() {
  return document.documentElement.dataset.theme === 'dark';
}
function updateThemeBtn() { $('#themeBtn').textContent = isDark() ? '☀' : '☾'; }
$('#themeBtn').addEventListener('click', () => {
  const t = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('theme', t); } catch {}
  updateThemeBtn();
});
updateThemeBtn();

// ---------- Connexion / inscription ----------

let authMode = 'login';

function showAuth() {
  document.body.classList.add('logged-out');
  $('#authView').hidden = false;
  state.period = null;
  dialog.close();
}

function showApp(user) {
  document.body.classList.remove('logged-out');
  $('#authView').hidden = true;
  $('#userName').textContent = user.username;
  $('#adminLink').hidden = !user.isAdmin;
  let startMonth = todayISO().slice(0, 7);
  try { startMonth = localStorage.getItem('month') || startMonth; } catch {}
  openMonth(startMonth).catch(err => toast(err.message));
}

function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  $('#authSubmit').textContent = mode === 'login' ? 'Se connecter' : 'Créer mon compte';
  $('#authForm').password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('#authHint').hidden = mode === 'login';
  $('#authError').textContent = '';
}

document.querySelectorAll('.auth-tab').forEach(t => t.addEventListener('click', () => setAuthMode(t.dataset.mode)));

$('#authForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  $('#authError').textContent = '';
  $('#authSubmit').disabled = true;
  try {
    const user = await api('POST', `/api/auth/${authMode}`, { username: f.username.value, password: f.password.value });
    f.password.value = '';
    showApp(user);
  } catch (err) {
    $('#authError').textContent = err.message;
  } finally {
    $('#authSubmit').disabled = false;
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  try { await api('POST', '/api/auth/logout'); } catch {}
  showAuth();
});

// ---------- Démarrage ----------

api('GET', '/api/auth/me')
  .then(me => showApp(me))
  .catch(err => {
    showAuth();
    // problème de configuration du serveur (base, secret) : l'afficher tout de suite
    if (err.message !== 'Non connecté') $('#authError').textContent = err.message;
  });
