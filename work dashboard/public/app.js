/* ═══════════════════════════════════════════════════════════════════════════
   업무 대시보드 - Client App
═══════════════════════════════════════════════════════════════════════════ */
'use strict';

// ─── State ───────────────────────────────────────────────────────────────────
let currentUser = null;
let workLogs    = [];
let postits     = [];
let isAdmin     = false;
let charts      = {};
let selectedPostitColor = '#fef08a';
let msgCount    = 0;
let socket;

// ─── Init ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
});

async function checkAuth() {
  try {
    const r = await fetch('/auth/user');
    const d = await r.json();
    if (d.authenticated) {
      currentUser = d.user;
      showDashboard();
      initAll();
    } else {
      document.getElementById('login-screen').classList.remove('hidden');
    }
  } catch(e) {
    // 서버 없이 실행 시 데모 모드로 자동 진입
    enterDemoMode();
  }
}

function enterDemoMode() {
  currentUser = {
    id: 'demo-user',
    name: '홍길동 (데모)',
    email: 'demo@example.com',
    avatar: 'https://ui-avatars.com/api/?name=홍길동&background=6366f1&color=fff&size=64'
  };
  showDashboard();

  // 샘플 업무 로그 주입
  const today = dateStr(new Date());
  const yesterday = dateStr(new Date(Date.now() - 86400000));
  workLogs = [
    {id:1, date:today, tasks:'주간 보고서 작성', hours:2, category:'문서', notes:''},
    {id:2, date:today, tasks:'팀 미팅', hours:1, category:'회의', notes:''},
    {id:3, date:today, tasks:'예산안 검토', hours:1.5, category:'일반', notes:''},
    {id:4, date:yesterday, tasks:'출장 보고서', hours:3, category:'문서', notes:''},
    {id:5, date:yesterday, tasks:'협력사 미팅', hours:2, category:'외근', notes:''},
  ];
  postits = [
    {id:1, content:'📅 월요일 팀 회의 자료 준비', color:'#fef08a'},
    {id:2, content:'🔔 결산 보고서 제출 마감일 확인', color:'#fca5a5'},
    {id:3, content:'✅ 인사팀 요청 문서 회신', color:'#86efac'},
  ];

  initDemoMode();
}

function initDemoMode() {
  startClock();
  applyStoredSettings();
  renderPostits();
  updateStats();
  initCharts();
  initWorkFormDemo();
  initSettings();
  initPostitModal();
  initMemo();
  setDateLabels();
  // 데모 채팅 메시지
  const demoMsgs = [
    {userId:'u1', userName:'김철수', avatar:'https://ui-avatars.com/api/?name=김철수&background=10b981&color=fff', content:'안녕하세요! 오늘 업무 시작합니다 👋', time:new Date(Date.now()-3600000)},
    {userId:'u2', userName:'이영희', avatar:'https://ui-avatars.com/api/?name=이영희&background=f59e0b&color=fff', content:'네, 오전 보고서 검토 부탁드립니다 📋', time:new Date(Date.now()-1800000)},
    {userId:'demo-user', userName:'홍길동 (데모)', avatar:currentUser.avatar, content:'알겠습니다! 오후까지 완료할게요 ✅', time:new Date(Date.now()-600000)},
  ];
  demoMsgs.forEach(appendMsg);
  scrollChat();
  // 데모 소켓 (비활성)
  document.getElementById('online-count').textContent = '3';
  document.getElementById('chat-send').onclick = sendMsgDemo;
  document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsgDemo(); }
  });
}

function sendMsgDemo() {
  const input = document.getElementById('chat-input');
  const content = input.value.trim();
  if (!content) return;
  appendMsg({
    userId: currentUser.id, userName: currentUser.name,
    avatar: currentUser.avatar, content, time: new Date()
  });
  scrollChat();
  input.value = '';
}

function initWorkFormDemo() {
  document.getElementById('work-form').addEventListener('submit', async e => {
    e.preventDefault();
    const task  = document.getElementById('wf-task').value.trim();
    const hours = parseFloat(document.getElementById('wf-hours').value) || 0;
    const cat   = document.getElementById('wf-category').value;
    const notes = document.getElementById('wf-notes').value.trim();
    if (!task) return;
    const log = {id: Date.now(), date: dateStr(new Date()), tasks: task, hours, category: cat, notes};
    workLogs.push(log);
    updateStats();
    updateCharts();
    renderDailyLog();
    e.target.reset();
    toast('업무가 기록되었습니다! ✅ (데모 모드 - 새로고침 시 초기화)');
  });
}

function showDashboard() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  document.getElementById('user-avatar').src = currentUser.avatar;
  document.getElementById('user-name').textContent = currentUser.name;
}

async function initAll() {
  startClock();
  applyStoredSettings();
  try { initSocket(); } catch(e) {}
  await Promise.all([loadWorkLogs(), loadPostits()]);
  renderPostits();
  updateStats();
  initCharts();
  initWorkForm();
  initSettings();
  initPostitModal();
  initMemo();
  setDateLabels();
}

// ─── Clock ───────────────────────────────────────────────────────────────────
function startClock() {
  const el = document.getElementById('current-datetime');
  const tick = () => {
    const n = new Date();
    el.textContent = n.toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric',weekday:'short'})
      + ' ' + n.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
  };
  tick();
  setInterval(tick, 1000);
}

function setDateLabels() {
  const n = new Date();
  document.getElementById('today-label').textContent =
    n.toLocaleDateString('ko-KR',{month:'short',day:'numeric'});
  document.getElementById('week-label').textContent =
    `${n.getFullYear()}년 ${getWeekNumber(n)}주차`;
  document.getElementById('month-label').textContent =
    `${n.getFullYear()}년 ${n.getMonth()+1}월`;
  document.getElementById('quarter-label').textContent =
    `${n.getFullYear()}년 ${Math.ceil((n.getMonth()+1)/3)}분기`;
  document.getElementById('year-label').textContent =
    `${n.getFullYear()}년`;
}

// ─── Socket / Chat ───────────────────────────────────────────────────────────
function initSocket() {
  if (typeof io === 'undefined') {
    console.warn('socket.io 미연결 - 채팅은 서버 실행 시 활성화됩니다.');
    document.getElementById('online-count').textContent = '0';
    return;
  }
  socket = io();

  socket.emit('join', {
    userId: currentUser.id,
    name: currentUser.name,
    avatar: currentUser.avatar
  });

  socket.on('online-count', c => {
    document.getElementById('online-count').textContent = c;
  });

  socket.on('chat-history', msgs => {
    msgs.forEach(appendMsg);
    scrollChat();
  });

  socket.on('chat-message', msg => {
    appendMsg(msg);
    scrollChat();
    msgCount++;
    document.getElementById('msg-count').textContent = msgCount;
  });

  socket.on('system-message', text => {
    const el = document.createElement('div');
    el.className = 'sys-msg';
    el.textContent = text;
    document.getElementById('chat-messages').appendChild(el);
    scrollChat();
  });

  const input = document.getElementById('chat-input');
  document.getElementById('chat-send').onclick = sendMsg;
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
  });
}

function sendMsg() {
  const input = document.getElementById('chat-input');
  const content = input.value.trim();
  if (!content) return;
  socket.emit('chat-message', {
    userId: currentUser.id,
    userName: currentUser.name,
    avatar: currentUser.avatar,
    content
  });
  input.value = '';
}

function appendMsg(msg) {
  const isOwn = msg.userId === currentUser?.id;
  const time = new Date(msg.time).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
  const div = document.createElement('div');
  div.className = `chat-msg${isOwn ? ' own' : ''}`;
  div.innerHTML = `
    <img class="m-av" src="${msg.avatar}" alt="" onerror="this.style.display='none'">
    <div class="m-body">
      <div class="m-meta">
        <span class="m-name">${esc(msg.userName)}</span>
        <span class="m-time">${time}</span>
      </div>
      <div class="m-text">${esc(msg.content)}</div>
    </div>`;
  document.getElementById('chat-messages').appendChild(div);
}

function scrollChat() {
  const el = document.getElementById('chat-messages');
  el.scrollTop = el.scrollHeight;
}

// ─── Work Logs ────────────────────────────────────────────────────────────────
async function loadWorkLogs() {
  const r = await fetch('/api/logs');
  workLogs = await r.json();
}

async function saveLog(data) {
  const r = await fetch('/api/logs', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(data)
  });
  const log = await r.json();
  workLogs.push(log);
  updateStats();
  updateCharts();
  renderDailyLog();
}

async function deleteLog(id) {
  await fetch(`/api/logs/${id}`, {method:'DELETE'});
  workLogs = workLogs.filter(l => l.id !== id);
  updateStats();
  updateCharts();
  renderDailyLog();
  toast('업무 기록을 삭제했습니다.', 'info');
}

function initWorkForm() {
  document.getElementById('work-form').addEventListener('submit', async e => {
    e.preventDefault();
    const task  = document.getElementById('wf-task').value.trim();
    const hours = parseFloat(document.getElementById('wf-hours').value) || 0;
    const cat   = document.getElementById('wf-category').value;
    const notes = document.getElementById('wf-notes').value.trim();
    if (!task) return;
    await saveLog({ tasks: task, hours, category: cat, notes });
    e.target.reset();
    toast('업무가 기록되었습니다! ✅');
  });
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function updateStats() {
  const today  = dateStr(new Date());
  const n      = new Date();

  const todayLogs = workLogs.filter(l => l.date === today);
  set('daily-hours',  sum(todayLogs).toFixed(1));
  set('daily-tasks',  todayLogs.length);

  const wLogs = workLogs.filter(l => l.date >= weekStart(n) && l.date <= today);
  set('weekly-hours', sum(wLogs).toFixed(1));
  set('weekly-tasks', wLogs.length);

  const mLogs = workLogs.filter(l => l.date >= monthStart(n) && l.date <= today);
  set('monthly-hours', sum(mLogs).toFixed(1));
  set('monthly-tasks', mLogs.length);

  const qLogs = workLogs.filter(l => l.date >= quarterStart(n) && l.date <= today);
  set('quarterly-hours', sum(qLogs).toFixed(1));
  set('quarterly-tasks', qLogs.length);

  const yLogs = workLogs.filter(l => l.date >= `${n.getFullYear()}-01-01` && l.date <= today);
  set('annual-hours', sum(yLogs).toFixed(1));
  set('annual-tasks', yLogs.length);

  renderDailyLog();
}

function renderDailyLog() {
  const today = dateStr(new Date());
  const todayLogs = workLogs.filter(l => l.date === today);
  const el = document.getElementById('daily-log-list');
  if (!el) return;
  if (todayLogs.length === 0) {
    el.innerHTML = '<div class="log-row" style="justify-content:center;color:var(--muted)">오늘 기록된 업무 없음</div>';
    return;
  }
  el.innerHTML = todayLogs.slice(-4).map(l => `
    <div class="log-row">
      <span class="lr-task" title="${esc(l.tasks)}">${esc(l.tasks)}</span>
      <span class="lr-h">${l.hours}h</span>
      <span class="lr-del" onclick="deleteLog(${l.id})" title="삭제">✕</span>
    </div>`).join('');
}

// ─── Charts ───────────────────────────────────────────────────────────────────
function initCharts() {
  Chart.defaults.color = '#8898b0';
  Chart.defaults.font.size = 10;

  const base = (type, color, fill=false) => ({
    type,
    data: { labels: [], datasets: [{ data: [], borderColor: color,
      backgroundColor: fill ? color+'26' : color,
      fill, tension: 0.4, pointRadius: 2, borderWidth: 2 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
      plugins: { legend: { display: false } },
      scales: { x: { display: false }, y: { display: false, beginAtZero: true } }
    }
  });

  charts.daily     = new Chart(document.getElementById('daily-chart'),     base('bar', '#3b82f6'));
  charts.weekly    = new Chart(document.getElementById('weekly-chart'),    base('line', '#10b981', true));
  charts.monthly   = new Chart(document.getElementById('monthly-chart'),   base('line', '#a855f7', true));
  charts.quarterly = new Chart(document.getElementById('quarterly-chart'), base('line', '#f59e0b', true));
  charts.annual    = new Chart(document.getElementById('annual-chart'),    base('bar', '#6366f1'));

  updateCharts();
}

function updateCharts() {
  const n = new Date();
  const today = dateStr(n);

  // Daily: by category
  const cats = ['일반','회의','문서','보고','외근','교육','기타'];
  const todayLogs = workLogs.filter(l => l.date === today);
  charts.daily.data.labels = cats;
  charts.daily.data.datasets[0].data = cats.map(c =>
    todayLogs.filter(l => l.category === c).reduce((s,l) => s+l.hours, 0));
  charts.daily.update();

  // Weekly: last 7 days
  const days7 = last7Days();
  charts.weekly.data.labels = days7.map(d => d.slice(8));
  charts.weekly.data.datasets[0].data = days7.map(d =>
    workLogs.filter(l => l.date === d).reduce((s,l) => s+l.hours, 0));
  charts.weekly.update();

  // Monthly: last 4 weeks
  const w4 = last4Weeks();
  charts.monthly.data.labels = w4.map((_,i) => `${i+1}주`);
  charts.monthly.data.datasets[0].data = w4.map(({s,e}) =>
    workLogs.filter(l => l.date >= s && l.date <= e).reduce((a,l) => a+l.hours, 0));
  charts.monthly.update();

  // Quarterly: last 3 months
  const m3 = last3Months(n);
  charts.quarterly.data.labels = m3.map(m => m.label);
  charts.quarterly.data.datasets[0].data = m3.map(({s,e}) =>
    workLogs.filter(l => l.date >= s && l.date <= e).reduce((a,l) => a+l.hours, 0));
  charts.quarterly.update();

  // Annual: all 12 months
  const yr = yearMonths(n.getFullYear());
  charts.annual.data.labels = yr.map(m => m.label);
  charts.annual.data.datasets[0].data = yr.map(({s,e}) =>
    workLogs.filter(l => l.date >= s && l.date <= e).reduce((a,l) => a+l.hours, 0));
  charts.annual.update();
}

// ─── Post-its ────────────────────────────────────────────────────────────────
async function loadPostits() {
  const r = await fetch('/api/postits');
  postits = await r.json();
}

function renderPostits() {
  const el = document.getElementById('postit-list');
  if (postits.length === 0) {
    el.innerHTML = '<div class="postit-empty">+ 추가 버튼으로 포스트잇을 작성하세요</div>';
    return;
  }
  el.innerHTML = postits.map(p => `
    <div class="postit" style="background:${p.color}" data-id="${p.id}">
      <button class="del" onclick="delPostit(${p.id})" title="삭제">✕</button>
      <div>${esc(p.content)}</div>
    </div>`).join('');
}

async function delPostit(id) {
  await fetch(`/api/postits/${id}`, {method:'DELETE'});
  postits = postits.filter(p => p.id !== id);
  renderPostits();
}

function initPostitModal() {
  document.getElementById('add-postit-btn').onclick = () => {
    document.getElementById('postit-modal').classList.remove('hidden');
    document.getElementById('postit-input').focus();
  };
  document.getElementById('close-postit').onclick = () => {
    document.getElementById('postit-modal').classList.add('hidden');
  };
  document.getElementById('postit-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('postit-modal'))
      document.getElementById('postit-modal').classList.add('hidden');
  });
  document.querySelectorAll('.swatch').forEach(s => {
    s.addEventListener('click', () => {
      document.querySelectorAll('.swatch').forEach(x => x.classList.remove('active'));
      s.classList.add('active');
      selectedPostitColor = s.dataset.color;
    });
  });
  document.getElementById('save-postit-btn').onclick = async () => {
    const content = document.getElementById('postit-input').value.trim();
    if (!content) return;
    const r = await fetch('/api/postits', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({content, color: selectedPostitColor})
    });
    const item = await r.json();
    postits.push(item);
    renderPostits();
    document.getElementById('postit-input').value = '';
    document.getElementById('postit-modal').classList.add('hidden');
    toast('포스트잇이 추가되었습니다! 📌');
  };
}

// ─── Memo ────────────────────────────────────────────────────────────────────
function initMemo() {
  const key = `memo-${new Date().toISOString().split('T')[0]}`;
  const el = document.getElementById('settlement-memo');
  el.value = localStorage.getItem(key) || '';
  document.getElementById('save-memo-btn').onclick = () => {
    localStorage.setItem(key, el.value);
    toast('메모가 저장되었습니다.');
  };
  el.addEventListener('input', () => {
    clearTimeout(el._t);
    el._t = setTimeout(() => localStorage.setItem(key, el.value), 800);
  });
}

// ─── Settings ────────────────────────────────────────────────────────────────
let settings = { theme: 'dark', adminMode: false, emailAuto: false };

function applyStoredSettings() {
  const saved = localStorage.getItem('wdb-settings');
  if (saved) Object.assign(settings, JSON.parse(saved));
  applyTheme();
}

function saveSettingsLocal() {
  localStorage.setItem('wdb-settings', JSON.stringify(settings));
}

function applyTheme() {
  document.body.classList.toggle('light', settings.theme === 'light');
}

function initSettings() {
  const modal = document.getElementById('settings-modal');

  document.getElementById('settings-btn').onclick = () => {
    modal.classList.remove('hidden');
    refreshSettingsUI();
  };
  document.getElementById('close-settings').onclick = () => modal.classList.add('hidden');
  modal.addEventListener('click', e => { if(e.target===modal) modal.classList.add('hidden'); });

  // Theme
  document.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      settings.theme = btn.dataset.theme;
      applyTheme();
      saveSettingsLocal();
    });
  });

  // Admin toggle
  document.getElementById('toggle-admin-btn').addEventListener('click', async () => {
    if (isAdmin) {
      isAdmin = false;
      settings.adminMode = false;
      saveSettingsLocal();
      applyAdminMode();
      toast('관리자 모드가 비활성화되었습니다.', 'info');
      refreshSettingsUI();
    } else {
      const pw = document.getElementById('admin-pw-input').value;
      if (!pw) { toast('비밀번호를 입력하세요.', 'err'); return; }
      try {
        const r = await fetch('/api/verify-admin', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({password: pw})
        });
        if (r.ok) {
          isAdmin = true;
          settings.adminMode = true;
          saveSettingsLocal();
          applyAdminMode();
          toast('관리자 모드가 활성화되었습니다. 🔑');
          document.getElementById('admin-pw-input').value = '';
          refreshSettingsUI();
          loadTeamData();
        } else {
          const d = await r.json();
          toast(d.error || '비밀번호 오류', 'err');
        }
      } catch { toast('서버 오류', 'err'); }
    }
  });

  // Email auto
  const emailToggle = document.getElementById('email-auto-toggle');
  emailToggle.addEventListener('change', async () => {
    settings.emailAuto = emailToggle.checked;
    saveSettingsLocal();
    try {
      await fetch('/api/users/preferences', {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({emailAuto: settings.emailAuto})
      });
    } catch {}
    toast(settings.emailAuto ? '자동 발송이 활성화되었습니다.' : '자동 발송이 비활성화되었습니다.', 'info');
  });

  // Send email now
  document.getElementById('send-email-btn').addEventListener('click', async () => {
    try {
      const r = await fetch('/api/send-daily-report', {method:'POST'});
      const d = await r.json();
      if (d.success) toast(`📧 ${d.message}`);
      else toast(d.error, 'err');
    } catch { toast('이메일 발송 실패', 'err'); }
  });
}

function refreshSettingsUI() {
  const n = new Date();
  // theme
  document.querySelectorAll('.seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === settings.theme);
  });
  // admin status
  const adminBtn = document.getElementById('toggle-admin-btn');
  const adminText = document.getElementById('admin-status-text');
  if (isAdmin) {
    adminBtn.textContent = '비활성화';
    adminBtn.classList.add('active');
    adminText.textContent = '현재 상태: 활성화 ✅';
    adminText.style.color = 'var(--green)';
  } else {
    adminBtn.textContent = '활성화';
    adminBtn.classList.remove('active');
    adminText.textContent = '현재 상태: 비활성화';
    adminText.style.color = '';
  }
  // email auto
  document.getElementById('email-auto-toggle').checked = settings.emailAuto;
  // user info
  document.getElementById('settings-user-info').innerHTML = `
    <img class="avatar" src="${currentUser.avatar}" alt="">
    <div><div class="uib-name">${esc(currentUser.name)}</div>
    <div class="uib-email">${esc(currentUser.email)}</div></div>`;
}

// ─── Admin ───────────────────────────────────────────────────────────────────
function applyAdminMode() {
  const badge = document.getElementById('admin-badge');
  badge.classList.toggle('hidden', !isAdmin);
  if (!isAdmin) {
    document.getElementById('team-content').innerHTML =
      '<p class="muted-msg">관리자 모드 활성화 시<br>팀원 업무 현황을 확인할 수 있습니다.</p>';
  }
}

async function loadTeamData() {
  if (!isAdmin) return;
  try {
    const [usersR, logsR] = await Promise.all([fetch('/api/users'), fetch('/api/logs/all')]);
    const users = await usersR.json();
    const allLogs = await logsR.json();
    const today = dateStr(new Date());

    const el = document.getElementById('team-content');
    if (users.length === 0) {
      el.innerHTML = '<p class="muted-msg">접속한 팀원이 없습니다.</p>';
      return;
    }
    el.innerHTML = `<div class="team-list">${users.map(u => {
      const uLogs = (allLogs[u.id]?.logs || []).filter(l => l.date === today);
      const hrs = uLogs.reduce((s,l) => s+l.hours, 0).toFixed(1);
      return `<div class="team-row">
        <img class="team-av" src="${u.avatar}" alt="" onerror="this.style.display='none'">
        <div class="team-info">
          <div class="team-name">${esc(u.name)}</div>
          <div class="team-stat">${u.email} · 오늘 ${hrs}h / ${uLogs.length}건</div>
        </div>
        <span class="badge" style="background:${u.role==='admin'?'var(--orange)':'var(--accent)'};color:${u.role==='admin'?'#1f2937':'#fff'}">${u.role==='admin'?'관리자':'팀원'}</span>
      </div>`;
    }).join('')}</div>`;
  } catch {}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const dateStr = d => d.toISOString().split('T')[0];
const sum = logs => logs.reduce((s,l) => s + l.hours, 0);
const set = (id, v) => { const e = document.getElementById(id); if(e) e.textContent = v; };
const esc = t => {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(String(t)));
  return d.innerHTML;
};

function weekStart(d) {
  const c = new Date(d);
  const day = c.getDay() || 7;
  c.setDate(c.getDate() - day + 1);
  return dateStr(c);
}
function monthStart(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
}
function quarterStart(d) {
  const qm = Math.floor(d.getMonth()/3)*3;
  return `${d.getFullYear()}-${String(qm+1).padStart(2,'0')}-01`;
}
function getWeekNumber(d) {
  const start = new Date(d.getFullYear(),0,1);
  return Math.ceil(((d-start)/86400000 + start.getDay()+1)/7);
}
function last7Days() {
  return Array.from({length:7}, (_,i) => {
    const d = new Date(); d.setDate(d.getDate()-6+i); return dateStr(d);
  });
}
function last4Weeks() {
  return Array.from({length:4}, (_,i) => {
    const e = new Date(); e.setDate(e.getDate()-i*7);
    const s = new Date(e); s.setDate(s.getDate()-6);
    return {s:dateStr(s), e:dateStr(e)};
  }).reverse();
}
function last3Months(n) {
  return Array.from({length:3}, (_,i) => {
    const d = new Date(n.getFullYear(), n.getMonth()-2+i, 1);
    const e = new Date(d.getFullYear(), d.getMonth()+1, 0);
    return {s:dateStr(d), e:dateStr(e), label:`${d.getMonth()+1}월`};
  });
}
function yearMonths(yr) {
  return Array.from({length:12}, (_,m) => {
    const s = `${yr}-${String(m+1).padStart(2,'0')}-01`;
    const e = dateStr(new Date(yr,m+1,0));
    return {s, e, label:`${m+1}월`};
  });
}

// ─── Toast ───────────────────────────────────────────────────────────────────
function toast(msg, type='ok') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.offsetHeight; el.classList.add('show'); });
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 3000);
}
