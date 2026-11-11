# 交接文档 · dsh-deepmemory

> 写给下一个在本机接手的 AI。目标：你读完这一份，就能继续干活，不用重新勘查。
> 最后更新：2026-11-11。仓库 HEAD 见 `git log -1`。

---

## 1. 这是什么

`@emo-bird/dsh-deepmemory` —— 一个 DSH bundle，给 Harness 提供**跨会话的长期记忆**，
并在侧边栏加一个「深度记忆」面板当控制台。

一句话架构：**一个 sqlite 文件 + 三档检索 + 六个工具 + 一个 Connection 路由 + React 面板。**

- 数据库：`C:\Users\一门鸽鸽\.dsh\deepmemory\memory.db`
- 设置：同目录 `settings.json`
- 模型：`C:\Project\dsh-deepmemory\vendor\models\`
- 注册在**根平面**，所有 preset 的会话都能用（前提是那个 preset 的 tool-fence 白名单放行了这六个工具）

---

## 2. 文件结构与职责

```
lib/index.js      53 KB  插件主入口：注册工具、注入提示词、13 条路由、门控
lib/client.js     71 KB  浏览器半：侧边栏 + 主面板 + 会话头胶囊（七个页签）
lib/store.js      15 KB  sqlite 封装：facts / episodes / diary / meta / vec + 三张 FTS
lib/search.js     12 KB  三档检索
lib/settings.js    8 KB  门控设置（全局 / 会话 / 子代理 三层）
lib/diary.js       5 KB  日记素材组装与提示词
lib/scheduler.js   5 KB  日记定时任务（借助宿主 schedule 服务）
lib/embed.js      16 KB  ONNX 嵌入：下载、加载、模型管理
lib/install.js     9 KB  npm 依赖安装（进 vendor/）
lib/toolkit.js     5 KB  本地 defineTool 实现（**不能 import @deepseek-ai/dsh-tools**，见第 6 节）
cordis.patch.yml         bundle 挂载行
locale/{en,zh}.json      展示元数据 meta.title/description
icon.svg                 水母图标（与侧边栏图标同一份 path）
scripts/install-embed.mjs 无头安装嵌入依赖
reference/               asar 抽取件，被 .gitignore 排除，仅 README.md 入库
vendor/                  542.8 MB，被 .gitignore 排除
local/                   用户私有目录，被 .gitignore 排除
test/                    六个 .test.mjs + 一堆临时脚本
```

**核心数据模型**

| 表 | 内容 |
|---|---|
| `facts` | 长期事实（scope / subject / text / weight / 来源会话与 preset） |
| `episodes` | 对话片段（**只记 user 消息**，按 session_id 归属） |
| `diary` | 一天一篇 |
| `meta` | 键值（`diarySessions` 存日记会话 id，换行分隔） |
| `vec` | 向量（当前未用，第三档是即时算的） |

---

## 3. 当前状态

| 项 | 状态 |
|---|---|
| git | 干净，`c46e600 fix(diary): learn the existing diary sessions…` |
| 安装 | **已安装并激活**（`include:deepmemory` → `fiberPhase: active`） |
| 六个工具 | `memory_search` / `memory_recall` / `memory_save` / `diary_read` / `memory_forget` 注册在根作用域；`diary_write` + `diary_material` 只在日记目录的 agent 上注册 |
| 13 条路由 | `/stats` `/facts` `/episodes` `/diary` `/search` `/settings` `/forget` `/session-flags` `/rebuild` `/sessions` `/dependency` `/models` `/diary-task` |
| 面板 | 七个页签：概览 / 事实 / 片段 / 搜索 / 日记 / 会话 / 设置 |
| 语义第三档 | **可用**。依赖已装（542.8 MB），模型已下（bge-small-zh + bge-base-zh），当前用 `Xenova/bge-base-zh-v1.5` |
| 日记定时任务 | 每天 23:40，target `{kind:'new', cwd: <…>/diary}` |
| 测试 | 六个套件全绿：store 10 / search 13 / settings 10 / diary 9 / toolkit 9 / scheduler 13 |

**门控四维与三层**

- 四维：`recall`（读记忆 + `diary_read`）/ `write`（写记忆）/ `diary`（片段进不进日记素材）/ `forget`（删记忆，默认 **false**）
- 全局默认值 `{recall:true, write:true, diary:true, forget:false}`
- 三层：**全局 → 会话 → 子代理**。会话在创建时（`agent/created` / `sessionsOf`）把当时的全局值**钉住**，之后改全局不影响它。
- 存储只存**与父层的差异**；「恢复继承」写 `null` 墓碑（不是删键——删了下次 pin 又钉回去）。

---

## 4. 关键设计决策（别轻易推翻）

1. **三档检索是流水线不是三选一。** FTS5 trigram（永远跑，保证不漏）→ 中文 bigram 余弦重排（永远跑）→ ONNX 嵌入重排（可选，失败静默降级）。三档共用 `SearchProvider` 接口。
2. **原文即真源，向量只是派生索引。** 换模型 = 删 vec + 重算。启动时比对 `model_name` 与 `dim`，不一致自动重建。
3. **提示词注入只放极短索引块**（条数 + 最近日记日期），内容靠模型**主动调工具**查。上下文成本常数级。
4. **`diary_write` 不在普通会话里出现。** 靠「目录即身份」：只有 cwd 等于 `~/.dsh/deepmemory/diary` 的 agent 才注册这两个工具。
5. **子代理的片段记到父会话名下。** `record()` 里 `owner = parent === '' ? sessionId : parent`，这样日记与搜索只看到一条主线。
6. **日记会话的独白不算素材。** `record()` 三重排除（内存 Set + 目录判定 + `meta.diarySessions` 持久化集合），`primeDiarySessions()` 启动时扫已存会话头补齐。
7. **提示词「什么时候查、什么时候记」由插件自己写**（`GUIDANCE_SECTION = 'deepmemory:guidance'`），不塞进任何 preset 的 persona。这是用户明确裁定的分工。

---

## 5. 未完成 / 未测试

### 未完成（明确知道没做的）
- [ ] **事实不自动提炼**。`facts` 现在只有模型主动 `memory_save` 才写入；对话里没有「这件事值得记」的自动抽取。
- [ ] **facts 的作用域恒为 global**。表里有 `scope` 列但没写过别的值。
- [ ] **不能编辑事实与权重**（面板只能删）。
- [ ] **没有导出 / 备份**。
- [ ] **去重靠精确文本匹配**（同文本不同说法会各存一条）。
- [ ] **会话记忆隔离（方案 b）** —— 用户明说「先记着，现在不做」。设计已想好：设置层加 `isolation`（global / workspace / session），召回时按范围过滤、写入时把 scope 写成 `global` / `workspace:<hash>` / `session:<id>`；老数据不用迁移。

### 未测试（需要在浏览器里亲眼看）
- [ ] 刷新页面 → 设置页模型卡片式布局（新改的，还没人看过）
- [ ] 会话页两张表的开关**点完不弹回**（加了 drafts，未目视确认）
- [ ] 「恢复继承」标签立刻消失（加了 `onReload`，未目视确认）
- [ ] 改全局默认后，已有会话的勾选**不变**
- [ ] 搜索引擎第三档真正参与重排（只验证过 `createEmbedder` 返回 `dim 512`）
- [ ] 日记定时任务**真实写出过一篇**（2026-11-11 那次命中「今天不写日记」的空转 bug，已修但未复测）
- [ ] 面板在**亮色主题**下的观感

---

## 6. 环境坑（本机特有，血泪）

### 加载与激活
- **不能 `import '@deepseek-ai/dsh-tools'`**。`dsh-tools` 只存在于 app.asar 内，link 安装的包按 Node 规则向上解析找不到 → `ERR_MODULE_NOT_FOUND`。这就是 `lib/toolkit.js` 存在的原因（本地实现了 `defineTool`）。
- **`import` 别的 DSH 包也要小心**，同理。目前只 import 了 node 内置模块。
- 重载插件：`plugin_manager action=set_plugin target=include:deepmemory enabled=false` 再 `=true`。
  `target=deepmemory` 会报 `unknown-plugin`。
- 唯一恒定的 warning：`experimental-inspector … globalThis.fetch is an accessor`，无害。
- **重载后必须去日志确认新代码在跑**：
  `Select-String -Path C:\Users\一门鸽鸽\.dsh\logs\desktop-next.log -Pattern deepmemory`

### 路由
- **必须注册到 `connection.fetch.register`，不是 `webServer.register`**。`/api` 前缀被 `client-connection` 独占，浏览器只走带签名 cookie 的 Connection Fetch 通道。
- **注册以 path 为键，不看 method** → 同一路径的 GET 与 POST 必须合并成一条 `route(path, {GET, POST})`（会 `connection: exact Fetch route … already registered`）。
- `fetch` 拿的是 WHATWG `Request`，必须返回 `Response`。
- GET 会自动带上 HEAD；未命中 method 返回 405。

### 面板（client.js）
- 只 `require('react')`，**禁止 require 任何 Harness Client 包**。
- 样式：注入 `<style data-plugin-css="…">` 到 head；只用 `--dsw-alias-*` token；明暗靠 `body[data-ds-dark-theme]` 切换，**不要用 `prefers-color-scheme`**。
- 主题包里只有 114 个 `--dsw-alias-*`，`--dsw-alias-text-primary` / `-surface-secondary` 这类**不存在**。
- **渲染期抛错会让整个面板白屏**。凡从路由拿回的东西先 `Array.isArray()` 兜底。
- 面板改动只需刷新页面（client 半热更新）；host 半要重载插件。

### 下载与网络
- **这台机器对 huggingface.co 完全不通**，`hf-mirror.com` 只有小文件能过，`.onnx` 走另一个 CDN 必挂 `UNABLE_TO_VERIFY_LEAF_SIGNATURE`。pwsh / Invoke-WebRequest 也一样。
- 所以 `downloadModel()` **自己用 `node:https` 下**（`rejectUnauthorized: false` 只在这一处放宽）。
- npm 默认缓存在系统临时区，**workspace-write 沙箱写不进去**（`EPERM`）→ 必须 `--cache <vendor>/.npm-cache`。
- 依赖体积：完整装约 575 MB，`pruneOtherPlatforms()` 裁掉非本平台 native 库后 542.8 MB。

### 工具与运行时
- node 只有一个：`C:\Program Files\DSH NEXT\resources\runtime\x64\primary-runtime\dependencies\node\bin\node.exe`（v24.21.0，自带 `node:sqlite`，SQLite 3.53.4，FTS5 trigram 可用，`vec0` **不可用**）。
- `node --test test/` 会因 `spawn EPERM` 失败，**必须逐文件跑**（`npm test` 已串好）。
- **bash 工具实际跑的是 PowerShell**。
- 写文件必须 `[System.IO.File]::WriteAllText(...UTF8Encoding($false))` + 先 `Replace("\r\n","\n")`。
- `git add -A` 会吞用户的 `local/` → **提交前先看 `git status --short`**。
- 校验带 `!!js` 的 cordis patch 必须注册 `tag:yaml.org,2002:js` Type。

### `ctx.tools.restrict` 的两个语义（门控靠它）
- `restrict(filter)` 返回「撤销这次限制」的函数。
- `restrictableNames` 只含**继承层**（全局 + 祖先），所以根平面的记忆工具可以被 agent 作用域 deny。
- **根平面的工具不会因为 handler 卫兵而从 schema 消失** —— 想让模型「看不到」，必须 `agent.ctx.tools.restrict({ deny })`（在 `agent/created` 里做）。

---

## 7. 测试与验证方法

```powershell
cd C:\Project\dsh-deepmemory
& 'C:\Program Files\DSH NEXT\resources\runtime\x64\primary-runtime\dependencies\node\bin\node.exe' test\store.test.mjs
# 其余：search / settings / diary / toolkit / scheduler
# 或 npm test（逐文件串联）
```

- `test/smoke.cjs`：假 `window.__ModuleLoader__` + 假 React，验证 client bundle 能加载并注册三个 slot。
- `test/_render.cjs`：逐页签强制渲染（`DM_TAB=overview|facts|episodes|search|diary|sessions|settings`）。
- `test/_routes2.cjs`：假 ctx 跑路由，验证 `settingsSnapshot()` 形状。
- **所有 `test/_*` 都被 `.gitignore` 拦住，不提交。** 这些是临时调试脚本，可以随时删。

---

## 8. 下一步建议（按优先级）

1. **先让人在浏览器里过一遍第 5 节的「未测试」清单**。改了很多 UI，还没人看过。
2. 复测日记：等一个真的有对话的日子，看 23:40 之后 `diary` 表是否多一行。
3. 补「事实自动提炼」（最大功能缺口）。
4. 补导出 / 备份。
5. 会话记忆隔离（方案 b）——用户说先记着。

---

## 9. 相邻项目

- `C:\Project\dsh-feishu-bot-preset`（飞书机器人 preset，白名单 29 项含 5 个 memory 工具）
- `C:\Project\dsh-companion-preset`（小肥鱼，白名单 16 项含 5 个 memory 工具）

**注意**：这两个 preset 的 tool-fence 会挡掉根平面的工具。给 deepmemory 加新工具时，
**必须同时**去这两个仓库的白名单里放行，否则 bot 那边永远看不到它。
