/* ============================================================
   AI 層 — Gemini 分群/整合、Groq 語音轉錄、模擬模式
   ============================================================ */

export const OUTPUT_TYPES = {
  action:   { label: '行動計畫',   icon: '📋', desc: '待辦清單' },
  proposal: { label: '提案/企劃書', icon: '💼', desc: '企劃書' },
  article:  { label: '文章/簡報',   icon: '✍️', desc: '內容創作' },
  report:   { label: '研究報告',   icon: '📚', desc: '知識彙整' },
  roadmap:  { label: '路線圖',     icon: '🗺️', desc: '發展藍圖' },
  auto:     { label: '依內容決定', icon: '✨', desc: '不固定' },
};

const TYPE_INSTRUCTIONS = {
  action: `輸出型態：行動計畫 / 待辦清單。
  要求：將片段轉化為具體可執行的行動步驟，每個步驟含「做什麼、怎麼做、優先順序」；複雜事項拆成多步驟並標註先後依賴；最後附上「下一步（本週可做）」小節。`,
  proposal: `輸出型態：提案 / 企劃書。
  要求：結構為「背景與動機 → 目標 → 方案內容 → 資源與成本 → 預期效益 → 風險」；用條列與小節清楚呈現。`,
  article: `輸出型態：文章 / 簡報內容。
  要求：先給標題建議（3 個），再給大綱，最後寫出正文；語氣自然有條理，適合閱讀或簡報。`,
  report: `輸出型態：研究報告 / 知識彙整。
  要求：分章節組織（主題總覽、細分主題、發現與洞察、延伸問題）；每個發現標註引用來源片段編號。`,
  roadmap: `輸出型態：路線圖 / 發展藍圖。
  要求：依時間分階段（短期/中期/長期），每階段列出目標、里程碑與所需條件；說明階段之間的推進關係。`,
  auto: `輸出型態：依內容決定。
  要求：先判斷這些片段最適合發展成哪一種成果（行動計畫、提案、文章、研究報告或路線圖），說明你的判斷理由，再依該型態完整輸出。`,
};

const STOPWORDS = new Set('的 了 我 你 他 她 它 是 在 有 和 也 就 都 而 及 與 一個 可以 想要 覺得 希望 需要 如果 因為 所以 但是 這個 那個 我們 你們 他們 自己 時候 事情 東西 一些 應該 能夠 之後 之前 現在 可能 非常 真的 還是 還有 不過 問題 想法 關於 沒有 不是 這樣 那樣 怎麼 什麼 為什麼 如何 把 被 讓 會 要 想 說 做 用 去 來 到 上 下 裡 中 大 小 新 好 比較 或者 已經 開始 覺得 之後 還是 一直 大家 覺得 然後 後來 其實 主要 重要 必要 大概 幾乎 完全 決定 繼續 直接 可以 應該 需要 想要 希望 必須 一定 很多 很少 一些 這些 那些 每個 所有 其他 什麼 怎麼 哪裡 為什麼 什麼時候'.split(' '));

export class AI {
  constructor(settings) {
    this.settings = settings;
  }

  setSettings(settings) { this.settings = settings; }

  get hasGemini() { return !!(this.settings && this.settings.geminiKey); }
  get hasGroq() { return !!(this.settings && this.settings.groqKey); }
  get modeLabel() {
    if (this.hasGemini) return `Gemini ${this.settings.geminiModel}`;
    return '模擬模式（未設定金鑰）';
  }

  /* ---------- Gemini 呼叫 ---------- */

  async geminiRequest(prompt, { model, temperature = 0.4, json = false, imageParts = [] } = {}) {
    if (!this.hasGemini) throw new Error('未設定 Gemini API 金鑰');
    const parts = [];
    if (imageParts.length) {
      parts.push({ text: prompt });
      parts.push(...imageParts.map((img) => ({
        inlineData: { mimeType: img.mimeType, data: img.data },
      })));
    } else {
      parts.push({ text: prompt });
    }
    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature,
        ...(json ? { responseMimeType: 'application/json' } : {}),
      },
    };
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || this.settings.geminiModel}:generateContent?key=${encodeURIComponent(this.settings.geminiKey)}`;
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error('無法連線 Gemini API（請檢查網路）');
    }
    if (!res.ok) {
      let msg = `Gemini API 錯誤 (${res.status})`;
      try {
        const j = await res.json();
        if (j.error && j.error.message) msg = j.error.message;
      } catch (e) { /* ignore */ }
      if (res.status === 429) msg += ' — 免費額度已達上限，請稍後再試。';
      throw new Error(msg);
    }
    const j = await res.json();
    const text = (j.candidates && j.candidates[0] && j.candidates[0].content
      && j.candidates[0].content.parts || []).map((p) => p.text || '').join('');
    if (!text) throw new Error('Gemini 回傳為空');
    return text;
  }

  /* ---------- 分群（回傳 groups / duplicates / conflicts） ---------- */

  async cluster(entries) {
    if (!this.hasGemini) return this.mockCluster(entries);
    const listing = entries.map((e, i) => `[${i + 1}] ${this.describe(e)}`).join('\n');
    const prompt = `你是「思想拼圖」的分群助手。以下是使用者收集的想法片段（[n] 為片段編號）：

${listing}

請完成三件事：
1. 將片段分成若干主題群組（每個片段只能屬於一個群組，不可遺漏任何片段；難以歸類的放進「其他」）。
2. 偵測內容高度相似（重複）的片段組合。
3. 偵測內容互相矛盾或衝突的片段組合，並為每個衝突提供兩種可行的詮釋。

規則：
- 群組數自動決定：片段少於 8 個時 2~4 群；8 個以上時 3~8 群。
- 群組名稱簡短（2~6 字），summary 一句話說明該群主題。
- 回覆只輸出 JSON，不要任何其他文字。

JSON 格式：
{
  "groups": [{"name": "群組名", "summary": "一句話摘要", "fragmentIds": [1, 3, 5]}],
  "duplicates": [{"ids": [1, 2], "reason": "為何相似"}],
  "conflicts": [{"ids": [4, 7], "reason": "衝突點說明", "interpretations": ["詮釋一", "詮釋二"]}]
}
（fragmentIds / ids 請用上面 [n] 的數字；無則為空陣列）`;

    const raw = await this.geminiRequest(prompt, { temperature: 0.2, json: true, imageParts: this.imagePartsOf(entries) });
    const parsed = this.parseJSON(raw);
    return this.normalizeCluster(parsed, entries);
  }

  normalizeCluster(parsed, entries) {
    const idxToId = (n) => {
      const i = Number(n) - 1;
      return entries[i] ? entries[i].f.id : null;
    };
    const groups = (parsed.groups || []).map((g) => ({
      name: String(g.name || '未命名群組'),
      summary: String(g.summary || ''),
      fragmentIds: (g.fragmentIds || []).map(idxToId).filter(Boolean),
    }));
    // 確保沒有片段被漏掉
    const assigned = new Set(groups.flatMap((g) => g.fragmentIds));
    const leftover = entries.map((e) => e.f.id).filter((id) => !assigned.has(id));
    if (leftover.length) {
      const other = groups.find((g) => g.name === '其他');
      if (other) other.fragmentIds.push(...leftover);
      else groups.push({ name: '其他', summary: '未能歸類的片段', fragmentIds: leftover });
    }
    const duplicates = (parsed.duplicates || []).map((d) => ({
      ids: (d.ids || []).map(idxToId).filter(Boolean),
      reason: String(d.reason || '內容相似'),
    })).filter((d) => d.ids.length > 1);
    const conflicts = (parsed.conflicts || []).map((c) => ({
      ids: (c.ids || []).map(idxToId).filter(Boolean),
      reason: String(c.reason || ''),
      interpretations: Array.isArray(c.interpretations) ? c.interpretations.map(String) : [],
    })).filter((c) => c.ids.length > 1);
    return { groups, duplicates, conflicts };
  }

  /* ---------- 整合（回傳 markdown 成果） ---------- */

  async synthesize(entries, groups, type) {
    const t = OUTPUT_TYPES[type] || OUTPUT_TYPES.auto;
    if (!this.hasGemini) return this.mockSynthesize(entries, groups, type);
    const listing = entries.map((e, i) => `[${i + 1}] ${this.describe(e)}`).join('\n');
    const groupsText = groups.map((g, gi) => `群組 ${gi + 1}「${g.name}」：片段 ${g.fragmentIds.map((id) => `[${this.indexFor(entries, id)}]`).join('、')}（${g.summary}）`).join('\n');
    const instruction = TYPE_INSTRUCTIONS[type] || TYPE_INSTRUCTIONS.auto;
    const prompt = `你是「思想拼圖」的整合助手。使用者把零散想法片段收集起來，由你把它們拼成完整、有用、可執行的成果。

片段清單（[n] 為引用編號，成果中引用時請用 [n] 標註，讓使用者知道每個段落來自哪些片段）：
${listing}

AI 分群結果（供你組織內容參考）：
${groupsText}

${instruction}

硬性要求：
- 內容必須涵蓋所有片段的想法，不可遺漏；但要做整合與深化，不是逐條翻譯。
- 整合而非堆疊：補足片段之間的邏輯關聯、指出洞見、提出未說明的假設。
- 全文使用繁體中文；小標題用 ##；條列用 - 或 1.
- 引用：每個重要段落結尾用 [n] 標註來源片段編號（如「…[2][5]」）。
- 衝突片段（若有）：在相關位置以引用區塊（> ）呈現「⚠️ 衝突點：…」，並列出「詮釋一」與「詮釋二」兩種可能，不要擅自刪除任何一方。
- 結尾附上「## 下一步行動」小節（2~5 條具體行動）。
- 直接輸出 Markdown 正文，不要額外說明。`;
    return this.geminiRequest(prompt, { temperature: 0.6, imageParts: this.imagePartsOf(entries) });
  }

  indexFor(entries, id) {
    const i = entries.findIndex((e) => e.f.id === id);
    return i >= 0 ? i + 1 : 0;
  }

  /* ---------- 語音轉文字 ---------- */

  async transcribe(blob) {
    if (this.hasGroq) {
      return this.groqTranscribe(blob);
    }
    if (this.hasGemini) {
      return this.geminiTranscribe(blob);
    }
    throw new Error('未設定 AI 金鑰，無法轉錄語音（音檔已保留）');
  }

  async groqTranscribe(blob) {
    const fd = new FormData();
    fd.append('file', blob, 'voice.webm');
    fd.append('model', this.settings.groqModel || 'whisper-large-v3-turbo');
    fd.append('language', 'zh');
    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.settings.groqKey}` },
      body: fd,
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error('Groq 轉錄失敗：' + ((j.error && j.error.message) || res.status));
    }
    const j = await res.json();
    return (j.text || '').trim();
  }

  async geminiTranscribe(blob) {
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    const prompt = '請將這段語音轉成繁體中文文字，直接輸出文字內容，不要任何說明。';
    const parts = [{ text: prompt }, { inlineData: { mimeType: m[1], data: m[2] } }];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.settings.geminiModel}:generateContent?key=${encodeURIComponent(this.settings.geminiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0 } }),
    });
    if (!res.ok) throw new Error('Gemini 轉錄失敗：' + res.status);
    const j = await res.json();
    return (j.candidates && j.candidates[0].content.parts || []).map((p) => p.text || '').join('').trim();
  }

  /* ---------- 工具 ---------- */

  describe(e) {
    const f = e.f;
    const c = String(f.content || '').slice(0, 500);
    if (f.type === 'image') return `（圖片片段）${c}`.trim();
    if (f.type === 'voice') return `（語音片段）${c}`.trim();
    if (f.type === 'link') return `（連結）${c}`.trim();
    return c;
  }

  imagePartsOf(entries) {
    return entries
      .filter((e) => e.f.type === 'image' && e.imageDataUrl)
      .map((e) => {
        const m = e.imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
        return { mimeType: m ? m[1] : 'image/png', data: m ? m[2] : '' };
      });
  }

  parseJSON(raw) {
    const s = String(raw).trim();
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('AI 回傳格式錯誤，無法解析分群結果');
    try { return JSON.parse(s.slice(start, end + 1)); } catch (e) { throw new Error('AI 回傳 JSON 解析失敗'); }
  }

  /* ---------- 模擬模式（無金鑰時的示範用） ---------- */

  static _normText(s) {
    return String(s || '').replace(/[\s\p{P}]/gu, '').toLowerCase();
  }

  static _bigrams(s) {
    const out = new Set();
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
    return out;
  }

  /** 包含係數：交集 / 較短的 bigram 集合（適合重複偵測） */
  static _bigramContainment(a, b) {
    const A = AI._bigrams(a);
    const B = AI._bigrams(b);
    if (!A.size || !B.size) return 0;
    let inter = 0;
    const [small, big] = A.size <= B.size ? [A, B] : [B, A];
    for (const x of small) if (big.has(x)) inter++;
    return inter / small.size;
  }

  mockCluster(entries) {
    // 以「常見雙字詞」作為群組種子，貪婪涵蓋最多未分組片段
    const tokenIds = new Map(); // 雙字 token -> 片段 id 集合
    for (const e of entries) {
      const s = AI._normText(e.f.content);
      const ids = tokenIds.get('__all__') || new Set();
      ids.add(e.f.id);
      tokenIds.set('__all__', ids);
      for (let i = 0; i < s.length - 1; i++) {
        const t = s.slice(i, i + 2);
        if (STOPWORDS.has(t)) continue;
        if (!tokenIds.has(t)) tokenIds.set(t, new Set());
        tokenIds.get(t).add(e.f.id);
      }
    }
    const groups = [];
    const used = new Set();
    const all = tokenIds.get('__all__');
    for (let g = 0; g < 4 && used.size < (all ? all.size : 0); g++) {
      let best = null;
      for (const [t, ids] of tokenIds) {
        if (t === '__all__') continue;
        const avail = [...ids].filter((id) => !used.has(id));
        if (avail.length < 2) continue; // 至少要涵蓋 2 個片段才成群
        if (!best || avail.length > best.avail.length) best = { t, avail };
      }
      if (!best) break;
      best.avail.forEach((id) => used.add(id));
      groups.push({ name: best.t, summary: `與「${best.t}」相關的片段`, fragmentIds: best.avail });
    }
    const leftovers = entries.map((e) => e.f.id).filter((id) => !used.has(id));
    if (leftovers.length) groups.push({ name: '其他', summary: '未能自動歸類的片段（模擬模式分群較簡略）', fragmentIds: leftovers });

    // 重複：bigram Jaccard 相似度 >= 0.5
    const duplicates = [];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = AI._normText(entries[i].f.content);
        const b = AI._normText(entries[j].f.content);
        if (a.length > 8 && AI._bigramContainment(a, b) >= 0.5) {
          duplicates.push({ ids: [entries[i].f.id, entries[j].f.id], reason: '內容高度相似' });
        }
      }
    }
    return { groups, duplicates, conflicts: [] };
  }

  mockSynthesize(entries, groups, type) {
    const t = OUTPUT_TYPES[type] || OUTPUT_TYPES.auto;
    const lines = [];
    lines.push(`# ${t.label}（模擬成果）`);
    lines.push('');
    lines.push('> ⚠️ 目前為**模擬模式**：尚未設定 AI API 金鑰，以下為依片段自動編排的示範成果。請到「設定」填入免費的 Gemini API 金鑰，即可獲得真正的 AI 整合。');
    lines.push('');
    lines.push('## 片段總覽');
    for (const g of groups) {
      lines.push(`### ${g.name}`);
      lines.push('');
      lines.push(g.summary || '');
      for (const id of g.fragmentIds) {
        const i = entries.findIndex((e) => e.f.id === id);
        if (i === -1) continue;
        const e = entries[i];
        lines.push(`- [${i + 1}] ${String(e.f.content || '').replace(/\n/g, ' ').slice(0, 120)}`);
      }
      lines.push('');
    }
    lines.push('## 下一步行動');
    lines.push('');
    lines.push('- 設定 AI 金鑰後重新拼圖，取得真正的整合成果');
    lines.push('- 檢視上方各群組，確認你的片段是否被正確歸類');
    lines.push('- 調整群組後再次整合，觀察成果變化');
    lines.push('');
    return lines.join('\n');
  }
}
