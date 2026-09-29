# AGENTS.md

> 最後核對：2026-09-29

給在「思想拼圖 v2」repo 工作的 AI agent。**動手前先把「硬性約束」那一節讀完。**

## 這是什麼

純前端靜態網頁應用（繁體中文 UI）：收集零散想法片段 → AI 分群 → AI 整合 → 匯出成果。**沒有後端、沒有帳號系統、沒有建置步驟**。公開 repo `share543/thought-puzzle-v2`，`main` push 後由 GitHub Actions 部署到 GitHub Pages。

| 檔案 | 角色 |
|---|---|
| `index.html` | 應用骨架（五個畫面；**含 CDN 依賴**） |
| `js/app.js`（893 行） | 主應用：狀態、畫面、拼圖流程 |
| `js/ai.js`（365 行） | AI 層：Gemini 分群/整合、Groq 轉錄、**模擬模式** |
| `js/store.js`（267 行） | 資料層：IndexedDB、備份、資料夾同步 |
| `css/style.css`（466 行） | 設計系統（深/淺主題、響應式） |
| `idea-puzzle-spec.md`（290 行） | **產品規格書 —— 功能範圍的真相來源** |

## 先讀什麼

| 你要做的事 | 讀這個 |
|---|---|
| 改任何功能行為 | **`idea-puzzle-spec.md`** ← 先確認它在不在規格內；規格標「非目標」的就不要做 |
| 用、跑、看使用流程 | `README.md` |
| 資料怎麼存、備份格式 | `js/store.js` |

## 硬性約束（不可違反）

1. **沒有後端、沒有登入。** 所有資料留在使用者自己的瀏覽器；不要引入伺服器、資料庫、帳號或雲端同步（規格書 §3.2 明列為非目標）。
2. **沒有建置步驟。** 不用 bundler、不用 npm 相依、不要產生 dist。改完直接開瀏覽器就能跑。
3. **金鑰永不進版控。** Gemini／Groq 金鑰由使用者在「設定」畫面自行貼上，存於 **IndexedDB**（DB `idea-puzzle` 的 `meta` store，key `settings`）。程式中任何地方都不得寫死金鑰。
4. **匯出備份必須剝除金鑰。** `store.js` 的 `exportBundle()` 用 `delete safeSettings.geminiKey` / `groqKey` 拿掉金鑰 —— 這是安全不變式，改動備份格式時不可移除。
   > ⚠️ 這裡指的是「匯出檔」；`settings` 本身仍存於 IndexedDB（`getMeta`/`setMeta`）。`README.md` 說金鑰存於 localStorage 是**錯的**（已 drift，尚未修）。
5. **模擬模式必須永遠可用。** 沒填金鑰時要走 `js/ai.js` 的模擬分群/模擬成果，讓使用者能體驗完整流程；任何改動都不能讓「未設定金鑰」這條路徑當掉或卡住。
6. **UI 與輸出以繁體中文為主。**
7. **CDN 依賴是刻意的，不要「順手離線化」。** `index.html` 明確載入 `marked@12.0.2`、`dompurify@3.1.6`、`pdfjs-dist@3.11.174`（jsdelivr）與 Google Fonts。版本有鎖。這是為了 GitHub Pages 上的零建置部署，與其他專案（如 `novel-animation` 要求零外部資源）的規則**相反**；要改動請先問。
   - 反過來也要注意：因為有 CDN 依賴，**本專案不是離線可用**。

## 本機執行

```bash
python3 -m http.server 8123     # 或 npx serve .
# 開 http://localhost:8123
```

**必須走本機伺服器**：用 `file://` 直接開檔會缺少部分瀏覽器 API（錄音、PDF、資料夾同步）。這點與 `novel-animation/storyboard.html` 的「雙擊即用」需求不同，不要混為一談。

## 部署

推 `main` 即觸發 `.github/workflows/pages.yml`（`actions/checkout` → Pages）。沒有其他建置產物要顧。

## 跨 repo 耦合（容易漏）

share543 網站上那張「思想拼圖 v2」卡片的標題／描述／縮圖，**不在本 repo 裡** —— 它們在另一個 repo `~/web-server` 的 `scripts/sync-github-repos.py` 的 `REPO_CONTENT` 表。改了本 repo 的定位或公開說明，記得同步那邊，否則網站卡片會跟本 repo 說法不一致。

## 修完之後

```bash
python3 -m http.server 8123        # 手動走一次：收件匣 → 分群 → 整合 → 匯出
git status --porcelain             # 只該出現你預期改的檔案
```

沒有測試框架。改動 `js/*.js` 後請在瀏覽器實際跑完上述一輪流程（含**未設金鑰的模擬模式**），並開 console 確認沒有錯誤。

## 變更痕跡放哪

**`git log`（權威）。** 功能範圍的變動同時更新 `idea-puzzle-spec.md`。**本檔不放 changelog** —— 每次都被載入的檔沉積成流水帳會擠掉真正該讀的規則。

## 維護本檔

每次動到「硬性約束」或流程，回來更新並改掉最上面的核對日期。**沒維護的 AGENTS.md 比沒有更糟**（會主動誤導）。
