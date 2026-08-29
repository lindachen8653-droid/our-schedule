import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://lzzicjintgeqzsetmzhk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_D3_CVQIDpo_wHkPA5q7z4g_rI3tZoRo';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const AUTH_REDIRECT = 'https://lindachen8653-droid.github.io/our-schedule/';

const APP_KEYS = {
  events: 'ourSchedule.events.v1',
  todos: 'ourSchedule.todos.v1',
  memo: 'ourSchedule.memo.v1',
  shopping: 'ourSchedule.shopping.v1',
  tripPhotos: 'ourSchedule.tripPhotos.v1',
  captions: 'ourSchedule.photoCaptions.v1',
  filters: 'ourSchedule.filters.v1'
};
const WATCHED = new Set(Object.values(APP_KEYS));
const ACTIVE_SPACE_KEY = 'ourSchedule.cloud.activeSpace.v1';
const REMOTE_MARKER_PREFIX = 'ourSchedule.cloud.remote.';
const originalSetItem = Storage.prototype.setItem;
const originalRemoveItem = Storage.prototype.removeItem;

let session = null;
let spaces = [];
let activeSpace = null;
let realtimeChannel = null;
let pushTimer = null;
let suppressPush = false;
let pendingRemote = null;
let toastTimer = null;

function parseJson(value, fallback) {
  try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; }
}
function setRaw(key, value) { originalSetItem.call(localStorage, key, value); }
function removeRaw(key) { originalRemoveItem.call(localStorage, key); }
function markerKey(spaceId) { return `${REMOTE_MARKER_PREFIX}${spaceId}`; }
function snapshot() {
  return {
    schemaVersion: 2,
    savedAt: new Date().toISOString(),
    events: parseJson(localStorage.getItem(APP_KEYS.events), []),
    todos: parseJson(localStorage.getItem(APP_KEYS.todos), []),
    memo: localStorage.getItem(APP_KEYS.memo) || '',
    shoppingList: localStorage.getItem(APP_KEYS.shopping) || '',
    tripPhotos: parseJson(localStorage.getItem(APP_KEYS.tripPhotos), {}),
    photoCaptions: parseJson(localStorage.getItem(APP_KEYS.captions), {}),
    calendarFilters: parseJson(localStorage.getItem(APP_KEYS.filters), null)
  };
}
function applySnapshot(data) {
  const s = data && typeof data === 'object' ? data : {};
  suppressPush = true;
  try {
    setRaw(APP_KEYS.events, JSON.stringify(Array.isArray(s.events) ? s.events : []));
    setRaw(APP_KEYS.todos, JSON.stringify(Array.isArray(s.todos) ? s.todos : []));
    setRaw(APP_KEYS.memo, typeof s.memo === 'string' ? s.memo : '');
    setRaw(APP_KEYS.shopping, typeof s.shoppingList === 'string' ? s.shoppingList : '');
    setRaw(APP_KEYS.tripPhotos, JSON.stringify(s.tripPhotos && typeof s.tripPhotos === 'object' ? s.tripPhotos : {}));
    setRaw(APP_KEYS.captions, JSON.stringify(s.photoCaptions && typeof s.photoCaptions === 'object' ? s.photoCaptions : {}));
    if (Array.isArray(s.calendarFilters)) setRaw(APP_KEYS.filters, JSON.stringify(s.calendarFilters));
  } finally {
    suppressPush = false;
  }
}
function refreshAppInPlace() {
  window.dispatchEvent(new CustomEvent('ourschedule:cloud-data'));
}
function clearLocalAppData() {
  suppressPush = true;
  try { WATCHED.forEach(k => removeRaw(k)); } finally { suppressPush = false; }
}

Storage.prototype.setItem = function(key, value) {
  originalSetItem.call(this, key, value);
  if (this === localStorage && WATCHED.has(key) && !suppressPush) schedulePush();
};
Storage.prototype.removeItem = function(key) {
  originalRemoveItem.call(this, key);
  if (this === localStorage && WATCHED.has(key) && !suppressPush) schedulePush();
};

const gate = document.createElement('div');
gate.id = 'cloudGate';
gate.className = 'cloud-gate';
gate.innerHTML = '<div id="cloudGateCard" class="cloud-card"><h2>☁️ Our Schedule</h2><p>正在連接雲端…</p></div>';
document.body.appendChild(gate);
const gateCard = gate.querySelector('#cloudGateCard');

const toast = document.createElement('div');
toast.className = 'cloud-toast';
document.body.appendChild(toast);

const brand = document.querySelector('.brand');
const cloudBar = document.createElement('div');
cloudBar.className = 'cloud-bar';
cloudBar.hidden = true;
cloudBar.innerHTML = `
  <div class="cloud-bar-main">
    <span id="cloudDot" class="cloud-dot"></span>
    <div style="min-width:0">
      <div id="cloudSpaceName" class="cloud-space-name">雲端空間</div>
      <div id="cloudStatus" class="cloud-status">連線中</div>
    </div>
  </div>
  <div class="cloud-bar-actions">
    <button id="cloudApplyRemote" class="cloud-mini-btn" type="button" hidden>套用更新</button>
    <button id="cloudManage" class="cloud-mini-btn" type="button">共用空間</button>
    <button id="cloudLogout" class="cloud-mini-btn" type="button">登出</button>
  </div>`;
if (brand) brand.insertAdjacentElement('afterend', cloudBar);

const cloudDot = cloudBar.querySelector('#cloudDot');
const cloudSpaceName = cloudBar.querySelector('#cloudSpaceName');
const cloudStatus = cloudBar.querySelector('#cloudStatus');
const cloudApplyRemote = cloudBar.querySelector('#cloudApplyRemote');

function showToast(text) {
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}
function setStatus(type, text) {
  cloudDot.className = `cloud-dot ${type || ''}`;
  cloudStatus.textContent = text;
}
function unlockApp() {
  gate.hidden = true;
  cloudBar.hidden = false;
  document.body.classList.remove('cloud-pending');
}
function lockApp() {
  gate.hidden = false;
  cloudBar.hidden = true;
}
function friendlyError(error) {
  const msg = error?.message || String(error || '發生錯誤');
  if (/invalid login credentials/i.test(msg)) return 'Email 或密碼不正確。';
  if (/email not confirmed/i.test(msg)) return '請先到信箱完成 Email 驗證。';
  if (/user already registered/i.test(msg)) return '此 Email 已註冊，請直接登入。';
  if (/password/i.test(msg) && /characters/i.test(msg)) return '密碼長度不足，請至少輸入 6 個字元。';
  if (/invalid invite code/i.test(msg)) return '共用碼不存在，請確認後再試。';
  if (/email rate limit|security purposes|rate limit/i.test(msg)) return '驗證信請求太頻繁，請稍候再試；若已驗證過請直接登入。';
  if (/network|fetch/i.test(msg)) return '目前無法連上雲端，請確認網路後再試。';
  return msg;
}

function authHtml(mode = 'login') {
  const login = mode === 'login';
  gateCard.innerHTML = `
    <h2>☁️ Our Schedule</h2>
    <p>登入後，雙方手機會使用同一個共用空間。行程、備忘錄、購物清單與旅遊資料都會同步。</p>
    <form id="cloudAuthForm">
      <label for="cloudEmail">Email</label>
      <input id="cloudEmail" type="email" autocomplete="email" inputmode="email" required placeholder="name@example.com">
      <label for="cloudPassword">密碼</label>
      <input id="cloudPassword" type="password" autocomplete="${login ? 'current-password' : 'new-password'}" minlength="6" required placeholder="至少 6 個字元">
      <div class="cloud-actions">
        <button class="cloud-btn" type="submit">${login ? '登入' : '建立帳號'}</button>
        <button id="cloudSwitchAuth" class="cloud-btn secondary" type="button">${login ? '第一次使用？註冊' : '已有帳號？登入'}</button>
      </div>
      <div id="cloudAuthMessage" class="cloud-message" role="status"></div>
    </form>`;
  const form = gateCard.querySelector('#cloudAuthForm');
  const message = gateCard.querySelector('#cloudAuthMessage');
  gateCard.querySelector('#cloudSwitchAuth').addEventListener('click', () => authHtml(login ? 'signup' : 'login'));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const email = gateCard.querySelector('#cloudEmail').value.trim();
    const password = gateCard.querySelector('#cloudPassword').value;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    message.className = 'cloud-message';
    message.textContent = login ? '登入中…' : '建立帳號中…';
    try {
      if (login) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: AUTH_REDIRECT } });
        if (error) throw error;
        if (!data.session) {
          message.className = 'cloud-message ok';
          message.textContent = '註冊完成。請到信箱點擊驗證連結；若你已經驗證過，請直接切換到「已有帳號？登入」。';
          submit.disabled = false;
          return;
        }
      }
    } catch (error) {
      message.textContent = friendlyError(error);
      submit.disabled = false;
    }
  });
}

function spacesHtml() {
  const rows = spaces.map(s => `
    <div class="cloud-space-item">
      <div><b>${escapeHtml(s.name || 'Our Schedule')}</b><small>${escapeHtml(s.role || '')} · 共用碼 ${escapeHtml(s.invite_code || '')}</small></div>
      <button class="cloud-btn secondary cloud-open-space" type="button" data-space="${escapeHtml(s.space_id)}">開啟</button>
    </div>`).join('');
  gateCard.innerHTML = `
    <h2>👩🏻‍❤️‍👨🏻 共用空間</h2>
    <p>${session?.user?.email ? escapeHtml(session.user.email) : ''}<br>建立一個新空間，或輸入對方提供的共用碼加入同一份行事曆。</p>
    ${rows ? `<div class="cloud-space-list">${rows}</div><div class="cloud-divider"></div>` : ''}
    <form id="cloudCreateSpace">
      <label for="cloudSpaceNameInput">建立新空間</label>
      <input id="cloudSpaceNameInput" maxlength="60" value="Our Schedule" required>
      <div class="cloud-actions"><button class="cloud-btn pink" type="submit">建立並上傳此裝置資料</button></div>
    </form>
    <div class="cloud-divider"></div>
    <form id="cloudJoinSpace">
      <label for="cloudInviteCode">加入既有空間</label>
      <input id="cloudInviteCode" maxlength="20" autocapitalize="characters" placeholder="輸入共用碼" required>
      <div class="cloud-actions"><button class="cloud-btn blue" type="submit">加入共用空間</button></div>
    </form>
    <div id="cloudSpaceMessage" class="cloud-message" role="status"></div>
    ${activeSpace ? '<div class="cloud-actions"><button id="cloudCloseManager" class="cloud-btn secondary" type="button">取消</button></div>' : ''}`;

  gateCard.querySelectorAll('.cloud-open-space').forEach(btn => btn.addEventListener('click', () => selectSpace(btn.dataset.space, true)));
  const msg = gateCard.querySelector('#cloudSpaceMessage');
  gateCard.querySelector('#cloudCreateSpace').addEventListener('submit', async e => {
    e.preventDefault();
    const name = gateCard.querySelector('#cloudSpaceNameInput').value.trim() || 'Our Schedule';
    msg.textContent = '建立共用空間中…';
    try {
      const { data, error } = await supabase.rpc('create_shared_space', { p_name: name, p_initial_data: snapshot() });
      if (error) throw error;
      await loadSpaces();
      const created = Array.isArray(data) ? data[0] : data;
      await selectSpace(created?.space_id, false);
      showToast('共用空間已建立，現有資料已上傳。');
    } catch (error) { msg.textContent = friendlyError(error); }
  });
  gateCard.querySelector('#cloudJoinSpace').addEventListener('submit', async e => {
    e.preventDefault();
    const code = gateCard.querySelector('#cloudInviteCode').value.trim().toUpperCase();
    msg.textContent = '加入共用空間中…';
    try {
      const { data, error } = await supabase.rpc('join_shared_space', { p_invite_code: code });
      if (error) throw error;
      await loadSpaces();
      const joined = Array.isArray(data) ? data[0] : data;
      await selectSpace(joined?.space_id, true);
    } catch (error) { msg.textContent = friendlyError(error); }
  });
  gateCard.querySelector('#cloudCloseManager')?.addEventListener('click', () => unlockApp());
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}
async function loadSpaces() {
  const { data, error } = await supabase.rpc('list_my_shared_spaces');
  if (error) throw error;
  spaces = Array.isArray(data) ? data : [];
  return spaces;
}
async function selectSpace(spaceId, forceRemote) {
  const chosen = spaces.find(s => s.space_id === spaceId) || spaces[0];
  if (!chosen) { activeSpace = null; spacesHtml(); return; }
  activeSpace = chosen;
  setRaw(ACTIVE_SPACE_KEY, chosen.space_id);
  cloudSpaceName.textContent = chosen.name || 'Our Schedule';
  setStatus('syncing', '讀取雲端資料…');
  await subscribeRealtime(chosen.space_id);
  await hydrateFromCloud(forceRemote);
  unlockApp();
}
async function hydrateFromCloud(forceRemote = false) {
  if (!activeSpace) return;
  const { data, error } = await supabase.rpc('get_shared_space_state', { p_space_id: activeSpace.space_id });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return;
  const marker = localStorage.getItem(markerKey(activeSpace.space_id));
  if (forceRemote || marker !== row.updated_at) {
    applySnapshot(row.data || {});
    setRaw(markerKey(activeSpace.space_id), row.updated_at || '');
    setStatus('synced', '已同步');
    refreshAppInPlace();
    return;
  }
  setStatus('synced', '已同步');
}
function schedulePush() {
  if (!session || !activeSpace || suppressPush) return;
  clearTimeout(pushTimer);
  setStatus('syncing', '儲存中…');
  pushTimer = setTimeout(pushSnapshot, 650);
}
async function pushSnapshot() {
  if (!session || !activeSpace || suppressPush) return;
  if (!navigator.onLine) { setStatus('error', '離線，恢復網路後同步'); return; }
  try {
    const { data, error } = await supabase.rpc('update_shared_space_state', {
      p_space_id: activeSpace.space_id,
      p_data: snapshot()
    });
    if (error) throw error;
    if (data) setRaw(markerKey(activeSpace.space_id), String(data));
    setStatus('synced', '已同步');
  } catch (error) {
    setStatus('error', '同步失敗');
    showToast(friendlyError(error));
  }
}
async function subscribeRealtime(spaceId) {
  if (realtimeChannel) {
    await supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  realtimeChannel = supabase.channel(`our-schedule-${spaceId}`)
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'shared_space_state', filter: `space_id=eq.${spaceId}`
    }, payload => {
      const remote = payload.new || {};
      if (!session || remote.updated_by === session.user.id) return;
      const modalOpen = document.querySelector('#eventModal.open');
      if (modalOpen) {
        pendingRemote = remote;
        cloudApplyRemote.hidden = false;
        setStatus('syncing', '另一台裝置有更新');
        showToast('另一台裝置有更新，完成編輯後可套用。');
        return;
      }
      applyRemoteInPlace(remote);
    })
    .subscribe(status => {
      if (status === 'SUBSCRIBED') setStatus('synced', '已同步 · 即時共用');
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setStatus('error', '即時連線異常');
    });
}
function applyRemoteInPlace(remote) {
  if (!activeSpace) return;
  applySnapshot(remote.data || {});
  if (remote.updated_at) setRaw(markerKey(activeSpace.space_id), remote.updated_at);
  refreshAppInPlace();
}

cloudApplyRemote.addEventListener('click', () => {
  if (!pendingRemote) return;
  const remote = pendingRemote;
  pendingRemote = null;
  cloudApplyRemote.hidden = true;
  applyRemoteInPlace(remote);
});
cloudBar.querySelector('#cloudManage').addEventListener('click', () => { lockApp(); spacesHtml(); });
cloudBar.querySelector('#cloudLogout').addEventListener('click', async () => {
  if (!confirm('確定登出？已同步的資料仍會保留在雲端。')) return;
  await supabase.auth.signOut();
});
window.addEventListener('online', () => { if (activeSpace) { setStatus('syncing', '恢復連線，正在同步…'); schedulePush(); } });
window.addEventListener('offline', () => setStatus('error', '離線'));

async function bootSignedIn(currentSession) {
  session = currentSession;
  try {
    await loadSpaces();
    if (!spaces.length) {
      activeSpace = null;
      lockApp();
      spacesHtml();
      return;
    }
    const remembered = localStorage.getItem(ACTIVE_SPACE_KEY);
    const chosen = spaces.find(s => s.space_id === remembered) || spaces[0];
    await selectSpace(chosen.space_id, false);
  } catch (error) {
    lockApp();
    gateCard.innerHTML = `<h2>☁️ 雲端連線失敗</h2><p>${escapeHtml(friendlyError(error))}</p><div class="cloud-actions"><button id="cloudRetry" class="cloud-btn" type="button">重新連線</button></div>`;
    gateCard.querySelector('#cloudRetry').addEventListener('click', () => bootSignedIn(currentSession));
  }
}
async function bootSignedOut() {
  session = null;
  activeSpace = null;
  spaces = [];
  pendingRemote = null;
  cloudApplyRemote.hidden = true;
  if (realtimeChannel) { await supabase.removeChannel(realtimeChannel); realtimeChannel = null; }
  removeRaw(ACTIVE_SPACE_KEY);
  lockApp();
  authHtml('login');
}

const { data: initialAuth } = await supabase.auth.getSession();
if (initialAuth.session) await bootSignedIn(initialAuth.session); else await bootSignedOut();

supabase.auth.onAuthStateChange((event, nextSession) => {
  if (event === 'SIGNED_IN' && nextSession && nextSession.user.id !== session?.user?.id) {
    setTimeout(() => bootSignedIn(nextSession), 0);
  }
  if (event === 'SIGNED_OUT') {
    clearLocalAppData();
    setTimeout(() => bootSignedOut(), 0);
  }
});
