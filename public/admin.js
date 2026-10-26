// Page admin : liste des comptes et leur activité (réservée aux noms de ADMIN_USERNAMES)
const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WEEK = 7 * 864e5;

const state = { me: null, users: [] };

async function api(method, url) {
  const res = await fetch(url, { method });
  const body = res.status === 204 ? null : await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error || 'Erreur serveur');
    err.status = res.status;
    throw err;
  }
  return body;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2500);
}

// "2026-10-26T13:57:51Z" -> "26 oct. 2026" ; "YYYY-MM-DD" (sans heure) -> même format
function fmtDate(value) {
  if (!value) return '—';
  const d = value.length === 10 ? new Date(value + 'T00:00:00Z') : new Date(value);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: value.length === 10 ? 'UTC' : undefined });
}
const recent = value => value && Date.now() - new Date(value).getTime() < WEEK;

function renderStats() {
  const u = state.users;
  $('#statUsers').textContent = u.length;
  $('#statNew').textContent = u.filter(x => recent(x.created_at)).length;
  $('#statActive').textContent = u.filter(x => recent(x.last_login)).length;
  $('#statDone').textContent = u.reduce((sum, x) => sum + x.done, 0);
}

function renderTable() {
  const q = $('#search').value.trim().toLowerCase();
  const list = state.users.filter(u => u.username.includes(q));
  let h = `<thead><tr>
    <th>Nom</th><th>Inscrit le</th><th>Dernière connexion</th>
    <th class="num">Mois</th><th class="num">✓</th><th class="num">✗</th><th class="num">Humeurs</th>
    <th>Dernière case</th><th></th></tr></thead><tbody>`;
  for (const u of list) {
    const isMe = u.id === state.me;
    h += `<tr>
      <td class="name">${esc(u.username)}${u.is_admin ? ' <span class="badge">admin</span>' : ''}${isMe ? ' <span class="muted small">(toi)</span>' : ''}</td>
      <td>${fmtDate(u.created_at)}</td>
      <td>${fmtDate(u.last_login)}${recent(u.last_login) ? ' <span class="dot" title="Connecté cette semaine"></span>' : ''}</td>
      <td class="num">${u.months}</td>
      <td class="num pen">${u.done}</td>
      <td class="num red">${u.miss}</td>
      <td class="num">${u.moods}</td>
      <td>${fmtDate(u.last_day)}</td>
      <td>${isMe ? '' : `<button class="icon-btn" data-del="${u.id}" data-name="${esc(u.username)}" title="Supprimer ce compte">✕</button>`}</td>
    </tr>`;
  }
  if (!list.length) h += `<tr><td colspan="9" class="muted">${q ? 'Aucun nom ne correspond.' : 'Aucun compte pour l\'instant.'}</td></tr>`;
  $('#usersTable').innerHTML = h + '</tbody>';
}

async function load() {
  try {
    const data = await api('GET', '/api/admin/users');
    state.me = data.me;
    state.users = data.users;
    $('#deniedView').hidden = true;
    $('#adminView').hidden = false;
    renderStats();
    renderTable();
  } catch (err) {
    $('#deniedView').hidden = false;
    $('#codeForm').hidden = err.status !== 403; // connecté mais pas admin : on demande le code
    $('#deniedText').textContent = err.status === 401
      ? 'Connecte-toi d\'abord sur le tableau, avec ton compte.'
      : err.status === 403 ? 'Entre le code admin pour accéder à cette page.' : err.message;
  }
}

$('#codeForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#codeSubmit').disabled = true;
  try {
    const res = await fetch('/api/auth/admin-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: e.target.code.value }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Erreur serveur');
    await load();
  } catch (err) {
    $('#codeError').textContent = err.message;
    e.target.code.select();
  } finally {
    $('#codeSubmit').disabled = false;
  }
});

$('#search').addEventListener('input', renderTable);

$('#usersTable').addEventListener('click', async e => {
  const btn = e.target.closest('[data-del]');
  if (!btn) return;
  if (!confirm(`Supprimer le compte « ${btn.dataset.name} » et toutes ses données ? C'est définitif.`)) return;
  try {
    await api('DELETE', '/api/admin/users/' + btn.dataset.del);
    state.users = state.users.filter(u => String(u.id) !== btn.dataset.del);
    renderStats();
    renderTable();
    toast('Compte supprimé');
  } catch (err) { toast(err.message); }
});

// thème jour / nuit (même réglage que le tableau)
function updateThemeBtn() { $('#themeBtn').textContent = document.documentElement.dataset.theme === 'dark' ? '☀' : '☾'; }
$('#themeBtn').addEventListener('click', () => {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('theme', t); } catch {}
  updateThemeBtn();
});
updateThemeBtn();

load();
