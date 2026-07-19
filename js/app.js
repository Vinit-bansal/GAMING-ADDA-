/* ==========================================================
   Respawn Console — Cafe Manager (cloud edition, Google Sheets backend)
   Two roles from two PINs: admin (owners) and staff (workers).
   Every create/edit/delete is tagged with the name typed in at login,
   and edits/deletes are written to an ActivityLog sheet too.
   ========================================================== */

const ENTITIES = [
  { id: 'ps5_1',    name: 'PS5 · Station 1', type: 'ps5',      icon: '🎮' },
  { id: 'ps5_2',    name: 'PS5 · Station 2', type: 'ps5',      icon: '🎮' },
  { id: 'ps5_3',    name: 'PS5 · Station 3', type: 'ps5',      icon: '🎮' },
  { id: 'pool',     name: '8-Ball Pool',     type: 'pool',     icon: '🎱' },
  { id: 'foosball', name: 'Foosball',        type: 'foosball', icon: '⚽' },
];

const POLL_MS = 4000;

let allSessions = [];
let allBeverages = [];
let allLogs = [];
let alertedSessionIds = new Set();
let staffName = localStorage.getItem('rc_name') || '';
let accessCode = localStorage.getItem('rc_code') || '';
let role = localStorage.getItem('rc_role') || ''; // 'admin' | 'staff'

/* ---------------- helpers ---------------- */
const $ = (sel) => document.querySelector(sel);
const $all = (sel) => document.querySelectorAll(sel);
const money = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
const todayStr = () => formatDateLocal(new Date());
const monthStr = () => todayStr().slice(0, 7);

function formatDateLocal(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}
function formatDuration(ms) {
  const neg = ms < 0;
  ms = Math.abs(ms);
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const str = (h > 0 ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  return (neg ? '+' : '') + str;
}
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}
function num(v) { return v === '' || v === null || v === undefined ? null : Number(v); }
function personLabel() { return `${staffName} (${role === 'admin' ? 'owner' : 'staff'})`; }
function isAdmin() { return role === 'admin'; }

/* ---------------- API layer (talks to Google Apps Script) ---------------- */
async function apiGetState() {
  const url = `${APPS_SCRIPT_URL}?action=state&pin=${encodeURIComponent(accessCode)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}
async function apiPost(action, extra) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, pin: accessCode, ...extra }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

/* ---------------- ENTRY (name + PIN — PIN decides role) ---------------- */
async function boot() {
  if (staffName && accessCode && role) {
    showApp();
  } else {
    if (staffName) $('#staffName').value = staffName;
    $('#loginScreen').classList.remove('hidden');
  }
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginError').textContent = '';
  const name = $('#staffName').value.trim();
  const pin = $('#staffPin').value.trim();
  staffName = name; accessCode = pin;
  try {
    const data = await apiGetState(); // validates the PIN, returns role
    role = data.role;
    localStorage.setItem('rc_name', staffName);
    localStorage.setItem('rc_code', accessCode);
    localStorage.setItem('rc_role', role);
    showApp();
  } catch (err) {
    $('#loginError').textContent = err.message === 'Wrong PIN' ? 'That access code is wrong.' : 'Could not reach the server — check the Apps Script URL in js/config.js.';
  }
});

$('#logoutBtn').addEventListener('click', () => {
  accessCode = ''; role = '';
  localStorage.removeItem('rc_code');
  localStorage.removeItem('rc_role');
  $('#staffPin').value = '';
  $('#loginScreen').classList.remove('hidden');
  $('#app').classList.add('hidden');
  stopPolling();
});

function applyRoleVisibility() {
  const admin = isAdmin();
  $all('[data-admin-only]').forEach((el) => el.classList.toggle('hidden', !admin));
  // if staff was somehow left on an admin-only tab, bounce back to Board
  const activePanel = document.querySelector('.tab-panel.active');
  if (!admin && activePanel && activePanel.id !== 'tab-board' && activePanel.id !== 'tab-schedule' && activePanel.id !== 'tab-beverages') {
    $all('.tab-btn').forEach((b) => b.classList.remove('active'));
    $all('.tab-panel').forEach((p) => p.classList.remove('active'));
    $('.tab-btn[data-tab="board"]').classList.add('active');
    $('#tab-board').classList.add('active');
  }
}

function showApp() {
  $('#loginScreen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#whoami').textContent = `${staffName} · ${role === 'admin' ? 'Owner' : 'Staff'}`;
  applyRoleVisibility();
  startPolling();
}

/* ---------------- POLLING ---------------- */
let pollTimer = null;
async function fetchState() {
  try {
    const data = await apiGetState();
    allSessions = data.sessions || [];
    allBeverages = data.beverages || [];
    allLogs = data.logs || [];
    $('#connStatus').classList.add('online');
    renderAll();
  } catch (err) {
    $('#connStatus').classList.remove('online');
  }
}
function startPolling() {
  fetchState();
  stopPolling();
  pollTimer = setInterval(fetchState, POLL_MS);
}
function stopPolling() { if (pollTimer) clearInterval(pollTimer); }

function renderAll() {
  renderBoard();
  renderSchedule();
  renderRevenue();
  renderBeverages();
  renderLog();
}

boot();

/* ---------------- TABS ---------------- */
$all('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.classList.contains('hidden')) return; // staff can't switch into an admin-only tab
    $all('.tab-btn').forEach((b) => b.classList.remove('active'));
    $all('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $('#tab-' + btn.dataset.tab).classList.add('active');
  });
});

/* ---------------- LIVE CLOCK + TICKER ---------------- */
setInterval(() => {
  $('#liveClock').textContent = new Date().toLocaleTimeString('en-IN');
  if (!$('#app').classList.contains('hidden')) {
    renderBoard();
    checkOvertimeAlerts();
  }
}, 1000);

/* ================= BOARD ================= */
function renderBoard() {
  const grid = $('#entityGrid');
  const now = new Date();
  grid.innerHTML = '';

  ENTITIES.forEach((ent) => {
    const active = allSessions.find((s) => s.entityId === ent.id && s.status === 'active');
    const upcoming = allSessions
      .filter((s) => s.entityId === ent.id && s.status === 'upcoming')
      .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

    let stateClass = 'free', pillClass = 'free', pillText = 'Available';
    let bodyHtml = `<div class="entity-empty">Free — ready for a walk-in</div>`;

    if (active) {
      const start = new Date(active.startTime);
      const durationMinutes = num(active.durationMinutes);
      let timerHtml, subHtml, overtime = false;
      if (durationMinutes) {
        const end = new Date(start.getTime() + durationMinutes * 60000);
        const remain = end - now;
        overtime = remain < 0;
        timerHtml = `<div class="timer-display ${overtime ? 'overtime' : 'active'}">${formatDuration(remain)}</div>`;
        subHtml = `<div class="timer-sub">${overtime ? 'OVER TIME · was due ' + formatTime(end) : 'ends ' + formatTime(end)}</div>`;
      } else {
        const elapsed = now - start;
        timerHtml = `<div class="timer-display active">${formatDuration(elapsed)}</div>`;
        subHtml = `<div class="timer-sub">open stopwatch · started ${formatTime(active.startTime)}</div>`;
      }
      stateClass = overtime ? 'overtime' : 'active';
      pillClass = overtime ? 'overtime' : 'active';
      pillText = overtime ? 'Time up' : 'Playing';
      bodyHtml = `
        <div class="entity-client">Player: <b>${escapeHtml(active.clientName)}</b> · ${num(active.players) || 1} ${num(active.players) === 1 ? 'person' : 'people'}</div>
        ${timerHtml}${subHtml}
        <div class="entity-actions">
          ${durationMinutes ? `<button class="btn btn-ghost btn-sm" data-extend="${active.id}">+15 min</button>` : ''}
          <button class="btn btn-ghost btn-sm" data-bev="${active.id}">+ Beverage</button>
        </div>
        <div class="entity-actions">
          <button class="btn btn-ghost btn-sm" data-edit="${active.id}">Edit</button>
          <button class="btn btn-danger btn-sm" data-end="${active.id}">Stop session</button>
        </div>
        ${isAdmin() ? `<div class="entity-actions"><button class="btn btn-danger-ghost btn-sm" data-delete="${active.id}">Delete entry</button></div>` : ''}`;
    } else if (upcoming.length) {
      const next = upcoming[0];
      stateClass = 'upcoming'; pillClass = 'upcoming'; pillText = 'Booked';
      bodyHtml = `
        <div class="entity-client">Next: <b>${escapeHtml(next.clientName)}</b> at ${formatTime(next.startTime)}</div>
        <div class="entity-actions">
          <button class="btn btn-primary btn-sm" data-start-upcoming="${next.id}">Client arrived</button>
          <button class="btn btn-ghost btn-sm" data-edit="${next.id}">Edit</button>
          <button class="btn btn-ghost btn-sm" data-cancel="${next.id}">Cancel</button>
        </div>
        ${isAdmin() ? `<div class="entity-actions"><button class="btn btn-danger-ghost btn-sm" data-delete="${next.id}">Delete entry</button></div>` : ''}`;
    }

    const upcomingListHtml = upcoming.length > (active ? 0 : 1)
      ? `<div class="entity-client" style="margin-top:2px;">+ ${upcoming.length - (active ? 0 : 1)} more booking(s) today — see Schedule</div>`
      : '';

    const card = document.createElement('div');
    card.className = `entity-card state-${stateClass}`;
    card.innerHTML = `
      <div class="entity-card-head">
        <span class="entity-name"><span class="entity-icon">${ent.icon}</span> ${ent.name}</span>
        <span class="status-pill ${pillClass}">${pillText}</span>
      </div>
      ${bodyHtml}
      ${upcomingListHtml}
      <div class="entity-actions">
        <button class="btn btn-ghost btn-sm" data-new="${ent.id}" data-mode="now" ${active ? 'disabled' : ''}>Start walk-in</button>
        <button class="btn btn-ghost btn-sm" data-new="${ent.id}" data-mode="later">Book a slot</button>
      </div>
    `;
    grid.appendChild(card);
  });

  $all('[data-new]').forEach((b) => b.addEventListener('click', () => openSessionModal(b.dataset.new, b.dataset.mode)));
  $all('[data-end]').forEach((b) => b.addEventListener('click', () => openEndModal(b.dataset.end)));
  $all('[data-extend]').forEach((b) => b.addEventListener('click', () => extendSession(b.dataset.extend)));
  $all('[data-start-upcoming]').forEach((b) => b.addEventListener('click', () => startUpcoming(b.dataset.startUpcoming)));
  $all('[data-cancel]').forEach((b) => b.addEventListener('click', () => cancelSession(b.dataset.cancel)));
  $all('[data-bev]').forEach((b) => b.addEventListener('click', () => openBevModal(b.dataset.bev)));
  $all('[data-edit]').forEach((b) => b.addEventListener('click', () => openEditModal(b.dataset.edit)));
  $all('[data-delete]').forEach((b) => b.addEventListener('click', () => deleteSessionEntry(b.dataset.delete)));
}

function checkOvertimeAlerts() {
  const now = new Date();
  const overtimeSessions = allSessions.filter((s) => {
    const durationMinutes = num(s.durationMinutes);
    if (s.status !== 'active' || !durationMinutes) return false;
    const end = new Date(new Date(s.startTime).getTime() + durationMinutes * 60000);
    return end < now;
  });

  if (overtimeSessions.length) {
    const names = overtimeSessions.map((s) => `${entityName(s.entityId)} (${s.clientName})`).join(', ');
    $('#alertStrip').textContent = `⏰ Time's up: ${names}`;
    $('#alertStrip').classList.remove('hidden');
    overtimeSessions.forEach((s) => {
      if (!alertedSessionIds.has(s.id)) {
        alertedSessionIds.add(s.id);
        playAlarm();
        notify(`${entityName(s.entityId)} — time's up`, `${s.clientName}'s session has ended.`);
      }
    });
  } else {
    $('#alertStrip').classList.add('hidden');
  }
}
function entityName(id) { return (ENTITIES.find((e) => e.id === id) || {}).name || id; }
function playAlarm() { const a = $('#alarmSound'); a.currentTime = 0; a.play().catch(() => {}); }
function notify(title, body) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') new Notification(title, { body });
  else if (Notification.permission !== 'denied') Notification.requestPermission();
}

/* ================= SESSION MODAL (start / book) ================= */
const sessionModal = $('#sessionModal');
function openSessionModal(entityId, mode) {
  const ent = ENTITIES.find((e) => e.id === entityId);
  $('#sessionEntityId').value = entityId;
  $('#sessionModalTitle').textContent = `${ent.name}`;
  $('#sessionForm').reset();
  $('#sessionPlayers').value = 1;
  setSessionMode(mode || 'now');
  const nowD = new Date();
  $('#bookingDate').value = todayStr();
  nowD.setMinutes(nowD.getMinutes() + 15);
  $('#bookingTime').value = String(nowD.getHours()).padStart(2, '0') + ':' + String(nowD.getMinutes()).padStart(2, '0');
  sessionModal.classList.remove('hidden');
}
function setSessionMode(mode) {
  $all('.modal-tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  $('#laterFields').classList.toggle('hidden', mode !== 'later');
  $('#sessionSubmitBtn').textContent = mode === 'later' ? 'Book slot' : 'Start now';
  sessionModal.dataset.mode = mode;
}
$all('.modal-tab-btn').forEach((b) => b.addEventListener('click', () => setSessionMode(b.dataset.mode)));

$('#sessionForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const entityId = $('#sessionEntityId').value;
  const ent = ENTITIES.find((x) => x.id === entityId);
  const mode = sessionModal.dataset.mode || 'now';
  const durationVal = $('#durationSelect').value;
  const durationMinutes = durationVal === 'open' ? '' : Number(durationVal);
  const amountVal = $('#sessionAmount').value;

  let startTime;
  if (mode === 'later') {
    const date = $('#bookingDate').value, time = $('#bookingTime').value;
    startTime = new Date(`${date}T${time}:00`).toISOString();
  } else {
    startTime = new Date().toISOString();
  }

  const payload = {
    entityId, entityName: ent.name, entityType: ent.type,
    clientName: $('#clientName').value.trim(),
    clientPhone: $('#clientPhone').value.trim(),
    players: Number($('#sessionPlayers').value) || 1,
    startTime, durationMinutes,
    amount: amountVal === '' ? '' : Number(amountVal),
    status: mode === 'later' ? 'upcoming' : 'active',
    createdBy: personLabel(),
  };

  await apiPost('createSession', { payload });
  closeModal('sessionModal');
  fetchState();
});

async function startUpcoming(id) {
  await apiPost('updateSession', { id, payload: { status: 'active', startTime: new Date().toISOString(), updatedBy: personLabel() } });
  fetchState();
}
async function cancelSession(id) {
  if (!confirm('Cancel this booking?')) return;
  await apiPost('updateSession', { id, payload: { status: 'cancelled', updatedBy: personLabel() } });
  fetchState();
}
async function extendSession(id) {
  const s = allSessions.find((x) => x.id === id);
  if (!s) return;
  const newDuration = (num(s.durationMinutes) || 0) + 15;
  await apiPost('updateSession', { id, payload: { durationMinutes: newDuration, updatedBy: personLabel() } });
  fetchState();
}
async function deleteSessionEntry(id) {
  if (!confirm('Permanently delete this booking? This cannot be undone, though it will stay in the Activity Log.')) return;
  try {
    await apiPost('deleteSession', { id, payload: { performedBy: personLabel() } });
    fetchState();
  } catch (err) {
    alert(err.message);
  }
}

/* ================= STOP / END SESSION MODAL ================= */
const endModal = $('#endModal');
function openEndModal(id) {
  const s = allSessions.find((x) => x.id === id);
  if (!s) return;
  const now = new Date();
  const start = new Date(s.startTime);
  const elapsedMin = (now - start) / 60000;
  const existingAmount = num(s.amount);

  $('#endSessionId').value = id;
  $('#endSummary').textContent = `${s.entityName} · ${s.clientName} · ${num(s.players) || 1} ${num(s.players) === 1 ? 'person' : 'people'} · started ${formatTime(s.startTime)} · ${Math.round(elapsedMin)} min played so far`;
  $('#endAmount').value = existingAmount !== null ? existingAmount : '';
  $('#endAddBeverage').checked = false;
  $('#endBeverageFields').classList.add('hidden');
  $('#endBevDesc').value = ''; $('#endBevAmount').value = '';
  endModal.classList.remove('hidden');
}
$('#endAddBeverage').addEventListener('change', (e) => {
  $('#endBeverageFields').classList.toggle('hidden', !e.target.checked);
});
$('#endForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#endSessionId').value;
  const amount = Number($('#endAmount').value);
  const session = allSessions.find((x) => x.id === id);

  await apiPost('updateSession', { id, payload: { status: 'completed', endTime: new Date().toISOString(), amount, updatedBy: personLabel() } });

  // gather beverages already tied to this session (added mid-play via +Beverage)
  const receiptBeverages = allBeverages
    .filter((b) => b.linkedSessionId === id)
    .map((b) => ({ description: b.description, amount: Number(b.amount) || 0 }));

  if ($('#endAddBeverage').checked) {
    const desc = $('#endBevDesc').value.trim();
    const bAmt = Number($('#endBevAmount').value) || 0;
    if (desc && bAmt) {
      await apiPost('createBeverage', { payload: { description: desc, amount: bAmt, date: todayStr(), linkedSessionId: id, createdBy: personLabel() } });
      receiptBeverages.push({ description: desc, amount: bAmt });
    }
  }

  closeModal('endModal');
  showReceipt(session, amount, receiptBeverages);
  fetchState();
});

/* ================= RECEIPT (shown right after stopping a session) ================= */
function showReceipt(session, gameAmount, beverages) {
  const bevTotal = beverages.reduce((sum, b) => sum + (b.amount || 0), 0);
  const grandTotal = (gameAmount || 0) + bevTotal;

  let html = `<div class="receipt-line dim"><span>${session ? escapeHtml(session.entityName) : ''}</span><span>${session ? escapeHtml(session.clientName) : ''}</span></div>`;
  html += `<div class="receipt-line"><span>Game amount</span><span class="mono">${money(gameAmount)}</span></div>`;
  beverages.forEach((b) => {
    html += `<div class="receipt-line dim"><span>${escapeHtml(b.description)}</span><span class="mono">${money(b.amount)}</span></div>`;
  });
  if (beverages.length) {
    html += `<div class="receipt-line"><span>Beverages subtotal</span><span class="mono">${money(bevTotal)}</span></div>`;
  }
  html += `<div class="receipt-total"><span>Total to collect</span><span>${money(grandTotal)}</span></div>`;

  $('#receiptBody').innerHTML = html;
  $('#receiptModal').classList.remove('hidden');
}

/* ================= EDIT SESSION MODAL ================= */
function openEditModal(id) {
  const s = allSessions.find((x) => x.id === id);
  if (!s) return;
  $('#editSessionId').value = id;
  $('#editClientName').value = s.clientName || '';
  $('#editClientPhone').value = s.clientPhone || '';
  $('#editPlayers').value = num(s.players) || 1;
  $('#editDuration').value = num(s.durationMinutes) !== null ? num(s.durationMinutes) : '';
  $('#editAmount').value = num(s.amount) !== null ? num(s.amount) : '';
  $('#editModal').classList.remove('hidden');
}
$('#editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#editSessionId').value;
  const durationVal = $('#editDuration').value;
  const amountVal = $('#editAmount').value;
  const payload = {
    clientName: $('#editClientName').value.trim(),
    clientPhone: $('#editClientPhone').value.trim(),
    players: Number($('#editPlayers').value) || 1,
    durationMinutes: durationVal === '' ? '' : Number(durationVal),
    amount: amountVal === '' ? '' : Number(amountVal),
    updatedBy: personLabel(),
  };
  await apiPost('updateSession', { id, payload });
  closeModal('editModal');
  fetchState();
});

/* ================= SCHEDULE TAB ================= */
$('#scheduleDate').value = todayStr();
$('#scheduleDate').addEventListener('change', renderSchedule);
$('#scheduleTodayBtn').addEventListener('click', () => { $('#scheduleDate').value = todayStr(); renderSchedule(); });

function renderSchedule() {
  const date = $('#scheduleDate').value || todayStr();
  const list = allSessions
    .filter((s) => s.status !== 'cancelled' && formatDateLocal(new Date(s.startTime)) === date)
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

  const box = $('#scheduleList');
  if (!list.length) { box.innerHTML = `<div class="schedule-empty">No bookings for this day yet.</div>`; return; }

  box.innerHTML = list.map((s) => `
    <div class="schedule-row">
      <span class="schedule-time mono">${formatTime(s.startTime)}${num(s.durationMinutes) ? ' · ' + num(s.durationMinutes) + 'm' : ' · open'}</span>
      <span class="schedule-entity">${s.entityName}</span>
      <span class="schedule-client">${escapeHtml(s.clientName)} · ${num(s.players) || 1}p${s.clientPhone ? ' · ' + escapeHtml(s.clientPhone) : ''}</span>
      <span class="schedule-status status-pill ${s.status === 'active' ? 'active' : s.status === 'upcoming' ? 'upcoming' : 'free'}">${s.status}</span>
      ${s.status === 'completed' ? `<span class="rr-amount mono">${money(s.amount)}</span>` : ''}
      <button class="btn btn-ghost btn-sm" data-schedule-edit="${s.id}">Edit</button>
      ${isAdmin() ? `<button class="btn btn-danger-ghost btn-sm" data-schedule-delete="${s.id}">Delete</button>` : ''}
    </div>
  `).join('');

  $all('[data-schedule-edit]').forEach((b) => b.addEventListener('click', () => openEditModal(b.dataset.scheduleEdit)));
  $all('[data-schedule-delete]').forEach((b) => b.addEventListener('click', () => deleteSessionEntry(b.dataset.scheduleDelete)));
}

/* ================= REVENUE TAB (owners only) ================= */
$('#revenueDate').value = todayStr();
$('#revenueMonth').value = monthStr();
$('#revenueDate').addEventListener('change', renderRevenue);
$('#revenueMonth').addEventListener('change', renderRevenue);

function sessionDateKey(s) { return formatDateLocal(new Date(s.endTime || s.startTime)); }

function renderRevenue() {
  const day = $('#revenueDate').value || todayStr();
  const month = $('#revenueMonth').value || monthStr();

  const completed = allSessions.filter((s) => s.status === 'completed');

  const dayEntity = completed.filter((s) => sessionDateKey(s) === day).reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  const dayBev = allBeverages.filter((b) => b.date === day).reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
  const monthEntity = completed.filter((s) => sessionDateKey(s).slice(0, 7) === month).reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  const monthBev = allBeverages.filter((b) => (b.date || '').slice(0, 7) === month).reduce((sum, b) => sum + (Number(b.amount) || 0), 0);

  $('#dayEntity').textContent = money(dayEntity);
  $('#dayBev').textContent = money(dayBev);
  $('#dayTotal').textContent = money(dayEntity + dayBev);
  $('#monthEntity').textContent = money(monthEntity);
  $('#monthBev').textContent = money(monthBev);
  $('#monthTotal').textContent = money(monthEntity + monthBev);

  const dayList = completed.filter((s) => sessionDateKey(s) === day).sort((a, b) => new Date(b.endTime) - new Date(a.endTime));
  const box = $('#revenueSessionsList');
  box.innerHTML = dayList.length ? dayList.map((s) => `
    <div class="revenue-row">
      <span>${s.entityName} — ${escapeHtml(s.clientName)}</span>
      <span class="mono" style="color:var(--text-faint)">${formatTime(s.startTime)} → ${formatTime(s.endTime)}</span>
      <span class="rr-amount">${money(s.amount)}</span>
    </div>
  `).join('') : `<div class="schedule-empty">No completed sessions for this day yet.</div>`;
}

/* ================= BEVERAGES TAB ================= */
// Same modal is used for a standalone sale (Beverages tab button) and for
// ordering mid-session from a station card — the only difference is
// whether a session id gets tagged onto it.
function openBevModal(linkedSessionId) {
  $('#bevForm').reset();
  $('#bevLinkedSessionId').value = linkedSessionId || '';
  $('#bevModalTitle').textContent = linkedSessionId ? 'Add a beverage to this table' : 'Log a beverage sale';
  $('#bevModal').classList.remove('hidden');
}
$('#addBeverageBtn').addEventListener('click', () => openBevModal(''));
$('#bevForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await apiPost('createBeverage', {
    payload: {
      description: $('#bevDesc').value.trim(),
      amount: Number($('#bevAmount').value),
      date: todayStr(),
      linkedSessionId: $('#bevLinkedSessionId').value || '',
      createdBy: personLabel(),
    },
  });
  closeModal('bevModal');
  fetchState();
});

function renderBeverages() {
  const list = [...allBeverages].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 150);
  const box = $('#beverageList');
  box.innerHTML = list.length ? list.map((b) => `
    <div class="bev-row">
      <div>
        <div class="bev-desc">${escapeHtml(b.description)}</div>
        <div class="bev-meta">${b.date}${b.linkedSessionId ? ' · added mid-session' : ' · standalone sale'} · by ${escapeHtml(b.createdBy || '')}</div>
      </div>
      <span class="bev-amount">${money(b.amount)}</span>
      <button class="btn btn-ghost btn-sm" data-bev-edit="${b.id}">Edit</button>
      ${isAdmin() ? `<button class="btn btn-danger-ghost btn-sm" data-bev-delete="${b.id}">Delete</button>` : ''}
    </div>
  `).join('') : `<div class="schedule-empty">No beverage sales logged yet.</div>`;

  $all('[data-bev-edit]').forEach((btn) => btn.addEventListener('click', () => openEditBevModal(btn.dataset.bevEdit)));
  $all('[data-bev-delete]').forEach((btn) => btn.addEventListener('click', () => deleteBeverageEntry(btn.dataset.bevDelete)));
}

function openEditBevModal(id) {
  const b = allBeverages.find((x) => x.id === id);
  if (!b) return;
  $('#editBevId').value = id;
  $('#editBevDesc').value = b.description || '';
  $('#editBevAmount').value = num(b.amount) || 0;
  $('#editBevModal').classList.remove('hidden');
}
$('#editBevForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#editBevId').value;
  await apiPost('updateBeverage', {
    id,
    payload: {
      description: $('#editBevDesc').value.trim(),
      amount: Number($('#editBevAmount').value),
      updatedBy: personLabel(),
    },
  });
  closeModal('editBevModal');
  fetchState();
});

async function deleteBeverageEntry(id) {
  if (!confirm('Permanently delete this beverage entry? This cannot be undone, though it will stay in the Activity Log.')) return;
  try {
    await apiPost('deleteBeverage', { id, payload: { performedBy: personLabel() } });
    fetchState();
  } catch (err) {
    alert(err.message);
  }
}

/* ================= ACTIVITY LOG TAB (owners only) ================= */
function renderLog() {
  const box = $('#logList');
  if (!allLogs.length) { box.innerHTML = `<div class="schedule-empty">No edits or deletions yet.</div>`; return; }
  box.innerHTML = allLogs.map((l) => `
    <div class="log-row">
      <div class="log-top">
        <span>${new Date(l.timestamp).toLocaleString('en-IN')}</span>
        <span class="log-action ${l.action.indexOf('delete') === 0 ? 'delete' : 'edit'}">${l.action.replace('_', ' ')}</span>
      </div>
      <div>${escapeHtml(l.summary)}</div>
      <div style="color:var(--text-faint); font-size:11.5px;">by ${escapeHtml(l.performedBy)}</div>
    </div>
  `).join('');
}

/* ================= MODAL CLOSE WIRING ================= */
$all('[data-close]').forEach((btn) => btn.addEventListener('click', () => closeModal(btn.dataset.close)));
$all('.modal-backdrop').forEach((bg) => bg.addEventListener('click', (e) => { if (e.target === bg) bg.classList.add('hidden'); }));
function closeModal(id) { $('#' + id).classList.add('hidden'); }

/* ask notification permission once, quietly */
if ('Notification' in window && Notification.permission === 'default') {
  document.addEventListener('click', () => Notification.requestPermission(), { once: true });
}
