/* ============================================================
   主應用程式 — 思想拼圖
   ============================================================ */
import * as Store from './store.js';
import { AI, OUTPUT_TYPES } from './ai.js';

/* ---------- DOM 工具 ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c) node.append(c);
  }
  return node;
}

function toast(msg, type = 'ok') {
  const wrap = $('#toast-wrap');
  const t = el('div', { class: `toast ${type}`, text: msg });
  wrap.append(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; }, 2200);
  setTimeout(() => t.remove(), 2700);
}

/* ---------- 狀態 ---------- */
const state = {
  fragments: [],
  outputs: [],
  settings: null,
  ai: null,
  view: 'inbox',
  tagFilter: null,
  puzzle: { selected: new Set(), type: 'auto', groups: [], conflicts: [], entries: [], result: null },
  recorder: null,
  recording: false,
  folderSyncTimer: null,
};

const TYPE_ICONS = { text: '✏️', voice: '🎙️', link: '🔗', image: '🖼️', file: '📄' };

/* ---------- 忙碌覆蓋 ---------- */
function busy(title, sub = '') {
  $('#busy').hidden = false;
  $('#busy-title').textContent = title;
  $('#busy-sub').textContent = sub;
}
function unbusy() { $('#busy').hidden = true; }

/* ---------- 彈窗 ---------- */
function openModal(title, bodyEl, footEl) {
  $('#modal-title').textContent = title;
  const panel = $('.modal-panel', $('#modal'));
  const body = $('#modal-body');
  body.innerHTML = '';
  body.append(bodyEl);
  const oldFoot = panel.querySelector('.modal-foot');
  if (oldFoot) oldFoot.remove();
  if (footEl) panel.append(footEl);
  $('#modal').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  $('#modal').hidden = true;
  document.body.style.overflow = '';
}

/* ---------- 視圖切換 ---------- */
function switchView(name) {
  state.view = name;
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'inbox') renderInbox();
  if (name === 'library') renderLibrary();
  if (name === 'puzzle') renderSelectList();
  if (name === 'outputs') renderOutputs();
  if (name === 'settings') fillSettings();
}

/* ---------- 資料載入 ---------- */
async function loadAll() {
  state.settings = await Store.getSettings();
  state.ai = new AI(state.settings);
  applyTheme(state.settings.theme);
  const [fragments, outputs] = await Promise.all([Store.getAllFragments(), Store.getAllOutputs()]);
  state.fragments = fragments.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  state.outputs = outputs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  renderAll();
  updateStoreStatus();
}

function renderAll() {
  renderInbox();
  renderLibrary();
  renderOutputs();
  renderStats();
  renderSelectList();
  $('#nav-count').textContent = state.fragments.length;
}

/* ---------- 片段卡片 ---------- */
function fragCard(f, { showActions = true } = {}) {
  const icon = TYPE_ICONS[f.type] || '✏️';
  const body = el('div', { class: 'frag-body' }, [
    el('div', { class: `frag-content${f.type === 'link' ? ' link' : ''}`, text: f.content || '（空白片段）' }),
    el('div', { class: 'frag-meta' }, [
      el('span', { class: 'frag-time', text: fmtTime(f.createdAt) }),
      ...(f.tags || []).map((t) => el('span', { class: 'tag-chip', text: t })),
      ...((f.duplicateOf && f.duplicateOf.length)
        ? [el('span', { class: 'dup-badge', text: `相似 ×${f.duplicateOf.length}`, onclick: () => showDupes(f) })]
        : []),
    ]),
  ]);
  const actions = el('div', { class: 'frag-actions' });
  if (showActions) {
    if (f.type === 'image') actions.append(el('button', { class: 'mini-btn', title: '檢視圖片', text: '👁', onclick: () => viewImage(f) }));
    actions.append(el('button', { class: 'mini-btn', title: '編輯', text: '✎', onclick: () => editFragment(f) }));
    actions.append(el('button', { class: 'mini-btn danger', title: '刪除', text: '🗑', onclick: () => deleteFragmentAsk(f) }));
  }
  return el('div', { class: `frag-card${(f.duplicateOf && f.duplicateOf.length) ? ' dup' : ''}` }, [
    el('div', { class: 'frag-icon', text: icon }),
    body,
    actions,
  ]);
}

function fmtTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const same = d.toDateString() === now.toDateString();
  return d.toLocaleString('zh-TW', same
    ? { hour: '2-digit', minute: '2-digit' }
    : { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/* ---------- 收件匣 ---------- */
function renderInbox() {
  const feed = $('#inbox-feed');
  feed.innerHTML = '';
  const recent = state.fragments.slice(0, 10);
  if (!recent.length) {
    feed.append(el('div', { class: 'empty' }, [
      el('span', { class: 'big', text: '🧩' }),
      el('p', { text: '還沒有片段。想到什麼就寫下來，一句話也可以！' }),
    ]));
    return;
  }
  recent.forEach((f) => feed.append(fragCard(f)));
  if (state.fragments.length > 10) {
    feed.append(el('button', { class: 'btn btn-ghost btn-block', text: `查看全部 ${state.fragments.length} 個片段 →`, onclick: () => switchView('library') }));
  }
}

/* ---------- 捕捉 ---------- */
async function captureText(text) {
  const t = text.trim();
  if (!t) return;
  const isLink = /^https?:\/\/\S+$/i.test(t);
  const f = {
    id: Store.uuid(), type: isLink ? 'link' : 'text', content: t,
    source: { kind: 'manual' }, tags: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), duplicateOf: [],
  };
  await Store.addFragment(f);
  state.fragments.unshift(f);
  toast('片段已加入 🧩');
  renderAll();
  $('#capture-text').value = '';
  await syncFolderIfConnected();
}

async function captureImage(file) {
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) return toast('圖片太大（限 8MB）', 'err');
  const blobId = Store.uuid();
  await Store.putBlob(blobId, file);
  const f = {
    id: Store.uuid(), type: 'image', content: '（圖片片段）',
    source: { kind: 'image', originalName: file.name }, tags: [],
    blobIds: [blobId],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), duplicateOf: [],
  };
  await Store.addFragment(f);
  state.fragments.unshift(f);
  toast('圖片已加入 🖼️');
  renderAll();
  await syncFolderIfConnected();
}

async function capturePdf(file) {
  if (!file) return;
  busy('正在解析 PDF…', file.name);
  try {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let text = '';
    const maxPages = Math.min(pdf.numPages, 30);
    for (let p = 1; p <= maxPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      text += tc.items.map((it) => it.str).join(' ') + '\n';
    }
    if (!text.trim()) throw new Error('找不到文字（可能是掃描圖片型 PDF）');
    const f = {
      id: Store.uuid(), type: 'file',
      content: `（PDF：${file.name}）\n\n${text.slice(0, 60000)}`,
      source: { kind: 'upload', originalName: file.name }, tags: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), duplicateOf: [],
    };
    await Store.addFragment(f);
    state.fragments.unshift(f);
    toast('PDF 內容已擷取 📄');
    renderAll();
    await syncFolderIfConnected();
  } catch (err) {
    toast(err.message || 'PDF 解析失敗', 'err');
  } finally {
    unbusy();
  }
}

/* ---------- 語音 ---------- */
async function toggleRecording() {
  if (state.recording) return stopRecording();
  if (!navigator.mediaDevices || !window.MediaRecorder) return toast('此瀏覽器不支援錄音', 'err');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    state.chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) state.chunks.push(e.data); };
    rec.onstop = () => finishRecording(new Blob(state.chunks, { type: 'audio/webm' }));
    rec.start();
    state.recorder = rec;
    state.recording = true;
    $('#btn-mic').classList.add('recording');
    $('#rec-hint').hidden = false;
  } catch (e) {
    toast('無法取得麥克風權限', 'err');
  }
}

function stopRecording() {
  if (state.recorder) state.recorder.stop();
  state.recorder = null;
  state.recording = false;
  $('#btn-mic').classList.remove('recording');
  $('#rec-hint').hidden = true;
}

async function finishRecording(blob) {
  busy('正在轉錄語音…');
  try {
    let transcript = '';
    try {
      transcript = await state.ai.transcribe(blob);
    } catch (err) {
      transcript = `（語音片段，未能自動轉錄：${err.message}）`;
    }
    const audioBlobId = Store.uuid();
    await Store.putBlob(audioBlobId, blob);
    const f = {
      id: Store.uuid(), type: 'voice', content: transcript,
      source: { kind: 'voice' }, tags: [], audioBlobId,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), duplicateOf: [],
    };
    await Store.addFragment(f);
    state.fragments.unshift(f);
    toast('語音片段已加入 🎙️');
    renderAll();
    await syncFolderIfConnected();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    unbusy();
  }
}

/* ---------- 片段庫 ---------- */
function renderLibrary() {
  const list = $('#lib-list');
  const tags = new Set();
  state.fragments.forEach((f) => (f.tags || []).forEach((t) => tags.add(t)));
  const chips = $('#lib-tags');
  chips.innerHTML = '';
  const allChip = el('button', { class: `chip${!state.tagFilter ? ' active' : ''}`, text: '全部', onclick: () => { state.tagFilter = null; renderLibrary(); } });
  chips.append(allChip);
  [...tags].sort().forEach((t) => {
    chips.append(el('button', { class: `chip${state.tagFilter === t ? ' active' : ''}`, text: t, onclick: () => { state.tagFilter = t; renderLibrary(); } }));
  });

  const q = ($('#lib-search').value || '').trim().toLowerCase();
  const filtered = state.fragments.filter((f) => {
    if (state.tagFilter && !(f.tags || []).includes(state.tagFilter)) return false;
    if (q && !String(f.content).toLowerCase().includes(q)) return false;
    return true;
  });
  list.innerHTML = '';
  if (!filtered.length) {
    list.append(el('div', { class: 'empty' }, [
      el('span', { class: 'big', text: state.fragments.length ? '🔍' : '📭' }),
      el('p', { text: state.fragments.length ? '沒有符合條件的片段' : '還沒有片段，先去收件匣捕捉一些吧！' }),
    ]));
    return;
  }
  filtered.forEach((f) => list.append(fragCard(f)));
}

function editFragment(f) {
  const ta = el('textarea', { class: 'edit-field' });
  ta.value = f.content;
  ta.style.cssText = 'width:100%;min-height:140px;padding:12px;border-radius:11px;background:var(--bg-soft);color:var(--text);border:1px solid var(--line);font-family:inherit;font-size:14.5px;resize:vertical;';
  const tagInput = el('input', { class: 'edit-field', placeholder: '用逗號分隔：工作, 靈感' });
  tagInput.value = (f.tags || []).join(', ');
  const body = el('div', {}, [
    el('label', { class: 'edit-field' }, [el('span', { text: '內容' }), ta]),
    el('label', { class: 'edit-field' }, [el('span', { text: '標籤' }), tagInput]),
  ]);
  const foot = el('div', { class: 'modal-foot' }, [
    ...(f.id ? [el('button', { class: 'btn btn-danger-ghost', text: '刪除', onclick: async () => { closeModal(); await deleteFragmentAsk(f); } })] : []),
    el('button', { class: 'btn btn-ghost', text: '取消', onclick: closeModal }),
    el('button', { class: 'btn btn-primary', text: '儲存', onclick: async () => {
      const isNew = !f.id;
      if (isNew) {
        f.id = Store.uuid();
        f.createdAt = new Date().toISOString();
        f.updatedAt = f.createdAt;
        f.duplicateOf = [];
        f.source = { kind: 'manual' };
      }
      f.content = ta.value.trim() || '（空白片段）';
      f.tags = tagInput.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
      if (isNew) { await Store.addFragment(f); state.fragments.unshift(f); }
      else await Store.updateFragment(f);
      closeModal();
      renderAll();
      toast('已儲存');
      await syncFolderIfConnected();
    } }),
  ]);
  openModal('編輯片段', body, foot);
}

async function deleteFragmentAsk(f) {
  const body = el('p', { text: `確定刪除這個片段？\n「${String(f.content).slice(0, 40)}…」` });
  const foot = el('div', { class: 'modal-foot' }, [
    el('button', { class: 'btn btn-ghost', text: '取消', onclick: closeModal }),
    el('button', { class: 'btn btn-danger-ghost', text: '刪除', onclick: async () => {
      await Store.deleteFragment(f.id);
      state.fragments = state.fragments.filter((x) => x.id !== f.id);
      state.puzzle.selected.delete(f.id);
      closeModal();
      renderAll();
      toast('已刪除');
      await syncFolderIfConnected();
    } }),
  ]);
  openModal('刪除片段', body, foot);
}

async function viewImage(f) {
  const blob = f.blobIds && f.blobIds.length ? await Store.getBlob(f.blobIds[0]) : null;
  const body = el('div', {}, []);
  if (blob) {
    const url = URL.createObjectURL(blob);
    const img = el('img', { src: url, style: 'max-width:100%;border-radius:12px;' });
    img.onload = () => setTimeout(() => URL.revokeObjectURL(url), 1000);
    body.append(img);
  } else body.append(el('p', { text: '找不到圖片檔案' }));
  openModal('圖片片段', body);
}

/* ---------- 重複處理 ---------- */
async function showDupes(f) {
  const ids = [f.id, ...(f.duplicateOf || [])];
  const dupes = state.fragments.filter((x) => ids.includes(x.id)).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const body = el('div', {}, [
    el('p', { text: `AI 標示以下片段內容相似（${dupes.length} 個）。可合併或忽略此標示。`, class: 'sub' }),
    ...dupes.map((d, i) => el('div', { class: 'frag-card', style: 'margin-top:8px' }, [
      el('span', { text: `${i + 1}.`, style: 'font-weight:900;color:var(--accent-2);' }),
      el('div', { class: 'frag-content', text: String(d.content).slice(0, 120) }),
    ])),
  ]);
  const foot = el('div', { class: 'modal-foot' }, [
    el('button', { class: 'btn btn-ghost', text: '忽略標示', onclick: async () => {
      for (const d of dupes) { d.duplicateOf = []; await Store.updateFragment(d); }
      closeModal(); renderAll(); toast('已清除相似標示');
    } }),
    el('button', { class: 'btn btn-primary', text: '合併到第一個', onclick: async () => {
      const keep = dupes[0];
      const others = dupes.slice(1);
      keep.content = [keep.content, ...others.map((o) => `【合併自片段】${o.content}`)].join('\n\n');
      keep.tags = [...new Set([...(keep.tags || []), ...others.flatMap((o) => o.tags || [])])];
      keep.duplicateOf = [];
      await Store.updateFragment(keep);
      for (const o of others) await Store.deleteFragment(o.id);
      state.fragments = await Store.getAllFragments();
      state.fragments.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      closeModal(); renderAll(); toast('已合併片段');
      await syncFolderIfConnected();
    } }),
  ]);
  openModal('相似片段', body, foot);
}

/* ---------- 拼圖工作台 ---------- */
function renderSelectList() {
  const list = $('#pz-select-list');
  list.innerHTML = '';
  if (!state.fragments.length) {
    list.append(el('div', { class: 'empty', style: 'grid-column:1/-1' }, [
      el('span', { class: 'big', text: '🧩' }),
      el('p', { text: '還沒有片段可以拼。先去「收件匣」捕捉一些想法吧！' }),
    ]));
  } else {
    state.fragments.forEach((f) => {
      const checked = state.puzzle.selected.has(f.id);
      const card = el('div', { class: `sel-item${checked ? ' checked' : ''}` }, [
        el('input', { type: 'checkbox', checked: checked ? '' : null }),
        el('span', { class: 'sel-text', text: `${TYPE_ICONS[f.type] || ''} ${String(f.content).slice(0, 80)}` }),
      ]);
      card.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        const cb = card.querySelector('input');
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
      });
      card.querySelector('input').addEventListener('change', () => {
        if (card.querySelector('input').checked) { state.puzzle.selected.add(f.id); card.classList.add('checked'); }
        else { state.puzzle.selected.delete(f.id); card.classList.remove('checked'); }
        updateSelectCount();
      });
      list.append(card);
    });
  }
  updateSelectCount();
  // 型態選擇
  $$('.type-opt').forEach((b) => b.classList.toggle('selected', b.dataset.type === state.puzzle.type));
}

function updateSelectCount() {
  $('#pz-select-count').textContent = `已選 ${state.puzzle.selected.size} / ${state.fragments.length}`;
  $('#pz-check-all').checked = state.fragments.length > 0 && state.puzzle.selected.size === state.fragments.length;
}

async function prepareEntries(ids) {
  const frags = state.fragments.filter((f) => ids.has(f.id));
  const entries = [];
  for (const f of frags) {
    let imageDataUrl = null;
    if (f.type === 'image' && f.blobIds && f.blobIds.length) {
      const blob = await Store.getBlob(f.blobIds[0]);
      if (blob) imageDataUrl = await Store.blobToDataUrlForImage(blob);
    }
    entries.push({ f, imageDataUrl });
  }
  return entries;
}

async function runCluster() {
  const ids = state.puzzle.selected;
  if (!ids.size) return toast('請先選擇要拼圖的片段', 'err');
  if (!state.ai.hasGemini) toast('模擬模式：未設定金鑰，將使用示範分群。', 'err');
  busy('AI 正在分群…', `共 ${ids.size} 個片段`);
  try {
    state.puzzle.entries = await prepareEntries(ids);
    const res = await state.ai.cluster(state.puzzle.entries);
    state.puzzle.groups = res.groups;
    state.puzzle.conflicts = res.conflicts;
    // 標示重複
    const dupMap = new Map();
    res.duplicates.forEach((d) => d.ids.forEach((id) => dupMap.set(id, d.ids)));
    for (const f of state.fragments) {
      const next = dupMap.has(f.id) ? dupMap.get(f.id).filter((x) => x !== f.id) : [];
      if (JSON.stringify(next) !== JSON.stringify(f.duplicateOf || [])) {
        f.duplicateOf = next;
        await Store.updateFragment(f);
      }
    }
    renderGroups();
    renderLibrary();
    $('#pz-step-select').hidden = true;
    $('#pz-step-groups').hidden = false;
    $('#pz-step-result').hidden = true;
    $('#pz-group-summary').textContent = `${res.groups.length} 群 ｜ ${state.ai.modeLabel}`;
    if (res.conflicts.length) toast(`偵測到 ${res.conflicts.length} 組衝突片段`, 'err');
    if (res.duplicates.length) toast(`偵測到 ${res.duplicates.length} 組相似片段`);
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    unbusy();
  }
}

function renderGroups() {
  const board = $('#pz-groups');
  board.innerHTML = '';
  const groups = state.puzzle.groups;
  if (!groups.length) {
    board.append(el('div', { class: 'empty', style: 'grid-column:1/-1' }, [el('p', { text: '沒有可顯示的群組' })]));
    return;
  }
  const indexMap = new Map(state.puzzle.entries.map((e, i) => [e.f.id, i + 1]));
  const allIds = state.puzzle.entries.map((e) => e.f.id);
  const assigned = new Set(groups.flatMap((g) => g.fragmentIds));
  const unassigned = allIds.filter((id) => !assigned.has(id));

  groups.forEach((g) => {
    const card = el('div', { class: 'group-card' }, [
      el('div', { class: 'group-head' }, [
        el('h4', { text: g.name }),
        el('span', { class: 'g-count', text: `${g.fragmentIds.length} 片` }),
      ]),
      el('div', { class: 'group-summary', text: g.summary || '' }),
      el('div', { class: 'group-frags' }, g.fragmentIds.map((id) => fragRow(id))),
    ]);
    board.append(card);
  });
  if (unassigned.length) {
    board.append(el('div', { class: 'group-card' }, [
      el('div', { class: 'group-head' }, [el('h4', { text: '未分組', style: 'color:var(--muted)' }), el('span', { class: 'g-count', text: `${unassigned.length} 片` })]),
      el('div', { class: 'group-summary', text: '這些片段尚未歸類' }),
      el('div', { class: 'group-frags' }, unassigned.map((id) => fragRow(id))),
    ]));
  }

  function fragRow(id) {
    const e = state.puzzle.entries.find((x) => x.f.id === id);
    if (!e) return el('div', {});
    const n = indexMap.get(id) || '?';
    const select = el('select', {}, [
      ...groups.map((g) => el('option', { value: g.name, text: g.name, selected: g.fragmentIds.includes(id) ? '' : null })),
      el('option', { value: '__none__', text: '未分組', selected: !groups.some((g) => g.fragmentIds.includes(id)) ? '' : null }),
    ]);
    select.addEventListener('change', () => moveFragment(id, select.value));
    return el('div', { class: 'g-frag' }, [
      el('span', { class: 'g-num', text: `[${n}]` }),
      el('span', { class: 'g-text', text: String(e.f.content || '').replace(/\n/g, ' ').slice(0, 50) }),
      select,
    ]);
  }
}

function moveFragment(id, target) {
  for (const g of state.puzzle.groups) {
    g.fragmentIds = g.fragmentIds.filter((x) => x !== id);
  }
  if (target !== '__none__') {
    const g = state.puzzle.groups.find((x) => x.name === target);
    if (g) g.fragmentIds.push(id);
  }
  renderGroups();
}

async function runSynthesize() {
  const groups = state.puzzle.groups.filter((g) => g.fragmentIds.length);
  // 把未分組的片段併入「其他」群，避免被靜默丟棄
  const assigned = new Set(groups.flatMap((g) => g.fragmentIds));
  const unassigned = state.puzzle.entries.map((e) => e.f.id).filter((id) => !assigned.has(id));
  if (unassigned.length) {
    const other = groups.find((g) => g.name === '其他');
    if (other) other.fragmentIds.push(...unassigned);
    else groups.push({ name: '其他', summary: '未分組片段', fragmentIds: unassigned });
  }
  if (!groups.length) return toast('沒有可整合的片段', 'err');
  const t = OUTPUT_TYPES[state.puzzle.type] || OUTPUT_TYPES.auto;
  busy('AI 正在整合…', `${t.icon} ${t.label} ｜ ${state.ai.modeLabel}`);
  try {
    const content = await state.ai.synthesize(state.puzzle.entries, groups, state.puzzle.type);
    const output = {
      id: Store.uuid(),
      title: firstHeading(content) || `${t.label}成果`,
      type: state.puzzle.type,
      typeLabel: t.label,
      content,
      fragmentIds: state.puzzle.entries.map((e) => e.f.id),
      createdAt: new Date().toISOString(),
      mode: state.ai.modeLabel,
    };
    await Store.addOutput(output);
    state.outputs.unshift(output);
    state.puzzle.result = output;
    renderResult(output);
    $('#pz-step-select').hidden = true;
    $('#pz-step-groups').hidden = true;
    $('#pz-step-result').hidden = false;
    toast('整合完成 ✨');
    renderOutputs();
    await syncFolderIfConnected();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    unbusy();
  }
}

function firstHeading(md) {
  const m = String(md).match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : '';
}

function renderResult(output) {
  const indexMap = new Map(state.puzzle.entries.map((e, i) => [e.f.id, i + 1]));
  let md = output.content;
  md = md.replace(/\[(\d+)\]/g, (m, n) => {
    const e = state.puzzle.entries[Number(n) - 1];
    if (!e) return m;
    return `<span class="cite" data-fid="${e.f.id}">[${n}]</span>`;
  });
  let html;
  try { html = DOMPurify.sanitize(window.marked.parse(md, { breaks: true, gfm: true })); }
  catch (e) { html = DOMPurify.sanitize(`<pre>${md}</pre>`); }
  const body = $('#pz-result-body');
  body.innerHTML = html;
  $('#pz-result-meta').textContent = `${output.typeLabel} ｜ ${output.mode} ｜ ${fmtTime(output.createdAt)} ｜ ${state.puzzle.entries.length} 個片段`;
  // 引用點擊（用 onclick 覆寫，避免多次整合時監聽器累積）
  body.onclick = async (e) => {
    const cite = e.target.closest('.cite');
    if (cite) {
      const fid = cite.dataset.fid;
      const f = state.fragments.find((x) => x.id === fid);
      if (f) openModal(`片段 [${indexMap.get(fid)}]`, fragCard(f));
    }
  };
  body.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetPuzzle() {
  state.puzzle.selected = new Set();
  state.puzzle.groups = [];
  state.puzzle.conflicts = [];
  state.puzzle.entries = [];
  state.puzzle.result = null;
  $('#pz-step-result').hidden = true;
  $('#pz-step-groups').hidden = true;
  $('#pz-step-select').hidden = false;
  renderSelectList();
}

/* ---------- 成果 ---------- */
function renderOutputs() {
  const list = $('#out-list');
  list.innerHTML = '';
  if (!state.outputs.length) {
    list.append(el('div', { class: 'empty' }, [
      el('span', { class: 'big', text: '🗂️' }),
      el('p', { text: '還沒有成果。去「拼圖工作台」把片段拼成完整成果吧！' }),
    ]));
    return;
  }
  state.outputs.forEach((o) => {
    const card = el('div', { class: 'out-card' }, [
      el('span', { class: 'out-icon', text: (OUTPUT_TYPES[o.type] || {}).icon || '📄' }),
      el('div', { class: 'out-info' }, [
        el('div', { class: 'out-title', text: o.title }),
        el('div', { class: 'out-meta', text: `${o.typeLabel || o.type} ｜ ${o.fragmentIds ? o.fragmentIds.length : 0} 個片段 ｜ ${fmtTime(o.createdAt)}` }),
      ]),
      el('div', { class: 'out-actions' }, [
        el('button', { class: 'mini-btn', title: '檢視', text: '👁', onclick: (ev) => { ev.stopPropagation(); viewOutput(o); } }),
        el('button', { class: 'mini-btn', title: '刪除', text: '🗑', onclick: async (ev) => {
          ev.stopPropagation();
          await Store.deleteOutput(o.id);
          state.outputs = state.outputs.filter((x) => x.id !== o.id);
          renderOutputs();
          toast('已刪除成果');
        } }),
      ]),
    ]);
    card.addEventListener('click', () => viewOutput(o));
    list.append(card);
  });
}

function viewOutput(o) {
  let md = o.content;
  const idxMap = new Map((o.fragmentIds || []).map((id, i) => [id, i + 1]));
  md = md.replace(/\[(\d+)\]/g, (m, n) => {
    const id = (o.fragmentIds || [])[Number(n) - 1];
    if (!id) return m;
    return `<span class="cite" data-fid="${id}">[${n}]</span>`;
  });
  let html;
  try { html = DOMPurify.sanitize(window.marked.parse(md, { breaks: true, gfm: true })); }
  catch (e) { html = DOMPurify.sanitize(`<pre>${md}</pre>`); }
  const body = el('div', { class: 'prose' });
  body.innerHTML = html;
  body.addEventListener('click', async (e) => {
    const cite = e.target.closest('.cite');
    if (cite) {
      const f = state.fragments.find((x) => x.id === cite.dataset.fid);
      if (f) openModal(`片段 [${idxMap.get(f.id)}]`, fragCard(f));
    }
  });
  const foot = el('div', { class: 'modal-foot' }, [
    el('button', { class: 'btn btn-outline', text: '匯出 Markdown', onclick: () => downloadFile(`${o.title}.md`, o.content, 'text/markdown') }),
    el('button', { class: 'btn btn-outline', text: '匯出文字', onclick: () => downloadFile(`${o.title}.txt`, stripMd(o.content), 'text/plain') }),
    el('button', { class: 'btn btn-outline', text: '匯出 PDF', onclick: () => { printModal(); } }),
    el('button', { class: 'btn btn-ghost', text: '關閉', onclick: closeModal }),
  ]);
  openModal(o.title, body, foot);
}

function stripMd(md) {
  return String(md).replace(/^#{1,6}\s+/gm, '').replace(/\[(\d+)\]/g, '[$1]').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^>\s?/gm, '');
}

function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

function printModal() {
  // 列印 CSS 只顯示 #modal 內容
  setTimeout(() => window.print(), 150);
}

/* ---------- 設定 ---------- */
function fillSettings() {
  $('#set-gemini-key').value = state.settings.geminiKey || '';
  $('#set-gemini-model').value = state.settings.geminiModel || 'gemini-2.5-flash';
  $('#set-groq-key').value = state.settings.groqKey || '';
  $('#set-groq-model').value = state.settings.groqModel || 'whisper-large-v3-turbo';
  const status = $('#ai-status');
  status.textContent = state.ai.hasGemini
    ? `✅ AI 已就緒：${state.ai.modeLabel}`
    : '⚠️ 尚未設定金鑰 — 目前為「模擬模式」，仍可體驗完整流程；填入免費 Gemini 金鑰即可獲得真實 AI 整合。';
  status.classList.toggle('warn', !state.ai.hasGemini);
}

async function saveSettings() {
  state.settings.geminiKey = $('#set-gemini-key').value.trim();
  state.settings.geminiModel = $('#set-gemini-model').value;
  state.settings.groqKey = $('#set-groq-key').value.trim();
  state.settings.groqModel = $('#set-groq-model').value;
  await Store.saveSettings(state.settings);
  state.ai.setSettings(state.settings);
  fillSettings();
  toast('設定已儲存');
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme || 'dark';
}

async function setTheme(theme) {
  state.settings.theme = theme;
  await Store.saveSettings(state.settings);
  applyTheme(theme);
  toast(`已切換為${theme === 'dark' ? '深色' : '淺色'}主題`);
}

async function updateStoreStatus() {
  const meta = await Store.getFolderMeta();
  const st = $('#store-status');
  st.classList.toggle('folder', !!meta);
  $('#store-status-text').textContent = meta ? `已連線資料夾：${meta.name}` : '本機儲存（IndexedDB）';
  const fs = $('#folder-status');
  if (fs) fs.textContent = meta
    ? `已連線資料夾「${meta.name}」，片段與成果會同步為 Markdown 檔案（${meta.at ? fmtTime(meta.at) : ''}）。`
    : '尚未連線資料夾。連線後，片段會以 Markdown 檔案形式儲存到你指定的資料夾。';
}

async function connectFolderClick() {
  busy('連線資料夾…');
  try {
    const handle = await Store.connectFolder();
    const res = await Store.syncFolder(handle);
    toast(`已同步 ${res.fragments} 個片段、${res.outputs} 個成果到資料夾`);
    updateStoreStatus();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    unbusy();
  }
}

async function syncFolderIfConnected() {
  const handle = Store.getFolderHandle();
  if (!handle) return;
  clearTimeout(state.folderSyncTimer);
  state.folderSyncTimer = setTimeout(async () => {
    try { await Store.syncFolder(handle); } catch (e) { /* 忽略同步錯誤 */ }
  }, 800);
}

async function exportBackup() {
  const bundle = await Store.exportBundle();
  downloadFile(`idea-puzzle-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(bundle, null, 2), 'application/json');
  toast('備份已匯出');
}

async function importBackup(file) {
  if (!file) return;
  try {
    const json = JSON.parse(await file.text());
    const res = await Store.importBundle(json);
    await loadAll();
    toast(`已匯入 ${res.fragments} 個片段、${res.outputs} 個成果`);
  } catch (err) {
    toast(err.message || '匯入失敗', 'err');
  }
}

function wipeAsk() {
  const foot = el('div', { class: 'modal-foot' }, [
    el('button', { class: 'btn btn-ghost', text: '取消', onclick: closeModal }),
    el('button', { class: 'btn btn-danger-ghost', text: '確認清除', onclick: async () => {
      await Store.wipeAll();
      state.fragments = [];
      state.outputs = [];
      closeModal();
      renderAll();
      toast('所有資料已清除');
    } }),
  ]);
  openModal('清除所有資料', el('p', { text: '這將刪除所有片段、圖片、語音與成果，且無法復原。確定嗎？' }), foot);
}

/* ---------- 事件綁定 ---------- */
function bindEvents() {
  // 導覽
  $$('[data-view]').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));

  // 捕捉
  $('#capture-send').addEventListener('click', () => captureText($('#capture-text').value));
  $('#capture-text').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') captureText($('#capture-text').value);
  });
  $('#btn-mic').addEventListener('click', toggleRecording);
  $('#btn-image').addEventListener('click', () => $('#file-image').click());
  $('#file-image').addEventListener('change', (e) => { captureImage(e.target.files[0]); e.target.value = ''; });
  $('#btn-pdf').addEventListener('click', () => $('#file-pdf').click());
  $('#file-pdf').addEventListener('change', (e) => { capturePdf(e.target.files[0]); e.target.value = ''; });

  // 片段庫
  $('#btn-new-fragment').addEventListener('click', () => {
    editFragment({ id: null, content: '', tags: [], type: 'text', source: { kind: 'manual' } });
  });
  $('#lib-search').addEventListener('input', renderLibrary);

  // 拼圖
  $('#pz-check-all').addEventListener('change', (e) => {
    state.puzzle.selected = e.target.checked ? new Set(state.fragments.map((f) => f.id)) : new Set();
    renderSelectList();
  });
  $$('.type-opt').forEach((b) => b.addEventListener('click', () => {
    state.puzzle.type = b.dataset.type;
    $$('.type-opt').forEach((x) => x.classList.toggle('selected', x === b));
  }));
  $('#pz-btn-cluster').addEventListener('click', runCluster);
  $('#pz-btn-resync').addEventListener('click', runCluster);
  $('#pz-btn-integrate').addEventListener('click', runSynthesize);
  $('#pz-btn-again').addEventListener('click', resetPuzzle);
  $('#pz-btn-export-md').addEventListener('click', () => {
    if (state.puzzle.result) downloadFile(`${state.puzzle.result.title}.md`, state.puzzle.result.content, 'text/markdown');
  });
  $('#pz-btn-export-txt').addEventListener('click', () => {
    if (state.puzzle.result) downloadFile(`${state.puzzle.result.title}.txt`, stripMd(state.puzzle.result.content), 'text/plain');
  });
  $('#pz-btn-export-pdf').addEventListener('click', () => {
    if (state.puzzle.result) viewOutput(state.puzzle.result);
  });

  // 設定
  $('#btn-save-settings').addEventListener('click', saveSettings);
  $('#btn-theme-dark').addEventListener('click', () => setTheme('dark'));
  $('#btn-theme-light').addEventListener('click', () => setTheme('light'));
  $('#btn-connect-folder').addEventListener('click', connectFolderClick);
  $('#btn-export').addEventListener('click', exportBackup);
  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', (e) => { importBackup(e.target.files[0]); e.target.value = ''; });
  $('#btn-wipe').addEventListener('click', wipeAsk);

  // 彈窗關閉
  $$('[data-close-modal]').forEach((b) => b.addEventListener('click', closeModal));
}

/* ---------- 啟動 ---------- */
document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  loadAll().then(() => switchView('inbox'));
});
