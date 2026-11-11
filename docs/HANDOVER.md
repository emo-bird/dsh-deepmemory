# 交接文档 · dsh-deepmemory

> 写给下一个在本机接手的 AI。目标：你读完这一份，就能继续干活，不用重新勘查。
> 最后更新：2026-11-11。仓库 HEAD 见 `git log -1`。

---

## 1. 这是什么

`@emo-bird/dsh-deepmemory` —— 一个 DSH bundle，给 Harness 提供**跨会话的长期记忆**，
并在侧边栏加一个「深度记忆」面板当控制台，另外在每个会话窗口里加一个「深度记忆」页签、在新建会话那一行加一个记忆开关。

一句话架构：**一个 sqlite 文件 + 三档检索 + 五个常驻工具 + 一个 Connection 路由 + React 面板。**

- 数据库：`C:\Users\一门鸽鸽\.dsh\deepmemory\memory.db`
- 设置：同目录 `settings.json`
- 模型：`C:\Project\dsh-deepmemory\vendor\models\`
- 注册在**根平面**，所有 preset 的会话都能用（前提是那个 preset 的 tool-fence 白名单放行了这几个工具）

---

## 2. 文件结构与职责

```
lib/index.js      64 KB  插件主入口：注册工具、注入提示词、17 条路由、门控
lib/client.js    112 KB  浏览器半：侧边栏图标 + 主面板（五个页签）+ 会话头胶囊 + 会话窗口「深度记忆」页签 + 新建会话行记忆开关
lib/store.js      25 KB  sqlite 封装：facts / episodes / diary / meta / vec + 三张 FTS + schema 迁移
lib/search.js     15 KB  三档检索
lib/settings.js    9 KB  门控设置（全局 / 会话 / 子代理 三层）+ 补写开关
lib/diary.js       8 KB  日记素材组装、日界与提示词
lib/scheduler.js   7 KB  日记定时任务（借助宿主 schedule 服务）+ 立刻运行 + 一次性投递
lib/embed.js      16 KB  ONNX 嵌入：下载、加载、模型管理
lib/install.js     9 KB  npm 依赖安装（进 vendor/）
lib/toolkit.js     5 KB  本地 defineTool 实现（**不能 import @deepseek-ai/dsh-tools**，见第 6 节）
cordis.patch.yml         bundle 挂载行
locale/{en,zh}.json      展示元数据 meta.title/description
icon.svg                 水母图标（与侧边栏图标同一份 path）
scripts/install-embed.mjs 无头安装嵌入依赖
docs/1.xml               面板布局原始规格（用户给的，改动前先对一遍）
reference/               asar 抽取件，被 .gitignore 排除，仅 README.md 入库
vendor/                  542.8 MB，被 .gitignore 排除
local/                   用户私有目录，被 .gitignore 排除
test/                    六个 .test.mjs + smoke.cjs
```

**核心数据模型**

| 表 | 内容 |
|---|---|
| `facts` | 长期事实（scope / subject / text / weight / 来源会话与 preset） |
| `episodes` | 对话片段（**只记 user 消息**，按 session_id 归属） |
| `diary` | **一天可以有多篇**。主键是 `id`，`day` 上建了索引，`origin` 记录是哪次投递写的 |
| `meta` | 键值（`diarySessions` 存日记会话 id，换行分隔；`schemaVersion` 存 2） |
| `vec` | 向量（当前未用，第三档是即时算的） |

---

## 3. 当前状态

| 项 | 状态 |
|---|---|
| git | 见 `git log -1`；`docs/` 在 2026-11-11 由根目录 `HANDOVER.md` 迁入 |
| 安装 | **已安装并激活**，desktop profile 里是 `link:C:/Project/dsh-deepmemory` 的 junction，改代码刷新页面即生效 |
| 工具 | 根作用域：`memory_search` / `memory_recall` / `memory_save` / `diary_read` / `memory_forget`；`diary_write` + `diary_material` 只在日记目录的 agent 上注册 |
| 17 条路由 | `/stats` `/facts` `/episodes` `/diary` `/day` `/calendar` `/activity` `/search` `/settings` `/forget` `/session-flags` `/rebuild` `/sessions` `/dependency` `/models` `/diary-task` `/backfill` |
| 面板 | 五个页签：概览 / 搜索 / 记忆 / 会话 / 设置 |
| 会话窗口 | 新增「深度记忆」页签（`conversation.view` 槽位，id `deepmemory`，order 35）。宿主只把标签渲染成纯文本，所以水母图标放在这个视图自己的标题行里 |
| 新建会话页 | 记忆开关（`conversation.hero.options` 槽位，id `deepmemory-hero-flags`，order 20）。与会话头那排小圆点同一份数据、同一个 `/session-flags` 路由 |
| 语义第三档 | **可用**。依赖已装（542.8 MB），模型已下（bge-small-zh + bge-base-zh），当前用 `Xenova/bge-base-zh-v1.5` |
| 日记定时任务 | 每天 23:40（`Asia/Shanghai`），target `{kind:'new', cwd: <…>/diary}`；提示词里**不含日期** |
| 补写 | 写日记时顺带扫最近 7 天（可关）；面板记忆页每天也能单独「补写」 |
| 测试 | 六个套件全绿：store 10 / search 13 / settings 10 / diary 17 / toolkit 9 / scheduler 16 |

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
8. **定时任务的提示词里不能出现日期。** 提示词是一次写入、天天复用的；写死日期就会天天写同一天、然后被「已有就跳过」吞掉——这是 2026-11-11 修掉的「日期冻死」bug。日期由接手的 agent 按投递时刻自己算（日界 04:00），`taskPrompt()` 里留了 `PROMPT_MARK = '这段提示是每天固定投递的'`，`ensureTask()` 靠它识别并修复老版本留下的带日期任务。老任务没人会再去设置页点一次，所以 `apply()` 里在拿到 `schedule` 服务后立刻调 `repairTask()` 改一次提示词（只改 prompt，不动 time / target——那是用户自己设的）。
9. **日记表主键是 `id` 不是 `day`。** 同一天可以有多次投递、多篇日记。同一次投递重复写靠 `(day, origin)` 去重（`origin` 默认是会话 id）；`origin` 为空的手写一律新增。旧库打开时自动迁移：先 `wal_checkpoint(TRUNCATE)` 再整文件备份成 `memory.db.bak-<时间戳>`，然后重建表并重灌 FTS。
10. **记忆页是唯一的日记入口。** 用户明确不要独立的「日记」页签：日历上点一天 → 点「日记 / 事实 / 片段」→ 右侧出内容。没有日记的那天日历上有缺口标记，右侧给「补写」按钮。补写走 `/backfill`，它**总是**新建一次性投递，把 `day` 写死在那一次的提示词里——定时任务本身是无日期的、补写窗口只有 7 天，跑它写不出用户点的那个旧日子。
11. **概览的活跃度是一面贡献墙，不是柱图。** 用户点名要 GitHub 主页那种贡献墙。实现是自己写的十来个 CSS 类（11px 一格、一周一列、周一起头），没有引入任何开源项目——只是照那个排法自己画。档位边界取当天数据的 25/50/75 分位，所以安静的日子也看得出层次；格子上的 `missing` 与日历缺口是同一个判断。`/activity` 一次要一年，所以走 `store.activityBetween()` 的三次分组查询，不是 365 × 3 次日查询。
12. **概览两栏靠「填满 + 裁切」对齐，不靠「展开全文」。** 用户明确否掉了展开按钮：最近一日日记那张卡 `flex:1`、正文 `overflow:hidden`，于是两栏底边永远在一条线上；整张卡就是链接（`role="link"` + 回车/空格），也不另加「去看这一天」按钮。
13. **会话语义只加槽位，不改宿主。** 页签标签是纯文本，所以图标进不去标签，就放进视图标题行；新建会话的开关用官方 `conversation.hero.options` 槽位，而不是去改宿主那一行。

---

## 5. 未完成 / 未测试

### 未完成（明确知道没做的）
- [ ] **事实不自动提炼**。`facts` 现在只有模型主动 `memory_save` 才写入；对话里没有「这件事值得记」的自动抽取。
- [ ] **facts 的作用域恒为 global**。表里有 `scope` 列但没写过别的值。
- [ ] **不能编辑事实与权重**（面板只能删）。
- [ ] **没有导出 / 备份**（除了迁移时那一次自动备份）。
- [ ] **去重靠精确文本匹配**（同文本不同说法会各存一条）。
- [ ] **会话记忆隔离（方案 b）** —— 用户明说「先记着，现在不做」。设计已想好：设置层加 `isolation`（global / workspace / session），召回时按范围过滤、写入时把 scope 写成 `global` / `workspace:<hash>` / `session:<id>`；老数据不用迁移。
- [ ] **深度记忆页签里不能补写**（那里只读，因为可写的是按天归属的日记，跟单个会话对不上）。

### 未测试（需要在浏览器里亲眼看）
- [ ] 重写后的五个页签在**亮色主题**下的观感
- [ ] 记忆页日历的活跃度分档是否够明显、缺口标记是否看得清
- [ ] 概览页的最近一日预览：点整张卡片是否真的跳到记忆页那一天，两栏底边是否对齐在一条线上
- [ ] 贡献墙在亮色/暗色下分档是否看得清、格子里的缺口描边是否认得出、点格子是否落到那一天
- [ ] 会话窗口里「深度记忆」页签在真实布局里是否可用（组件能注册、能渲染，但没人在页面上点过）
- [ ] 新建会话那一行的小胶囊位置对不对：会不会挤掉模式/模型选择器，弹层会不会被输入框盖住
- [ ] 定时任务真实投递一次、且日期是它自己算出来的
- [ ] 「补写」按钮走 `/backfill` 后是否真能在 `diary` 表里落一行

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
- 直接用 `Invoke-WebRequest` 打 `http://127.0.0.1:45127/api/...` 会拿到 **401**——那些路由只认浏览器里带签名的连接通道，不能命令行验证。

### 面板（client.js）
- 只 `require('react')`，**禁止 require 任何 Harness Client 包**。
- 样式：注入 `<style data-plugin-css="…">` 到 head；只用 `--dsw-alias-*` token；明暗靠 `body[data-ds-dark-theme]` 切换，**不要用 `prefers-color-scheme`**。
- 主题包里只有 114 个 `--dsw-alias-*`，`--dsw-alias-text-primary` / `-surface-secondary` 这类**不存在**。
- **渲染期抛错会让整个面板白屏**。凡从路由拿回的东西先 `Array.isArray()` 兜底。
- 面板改动只需刷新页面（client 半热更新）；host 半要重载插件。
- 会话窗口里的页签走 `ctx.slots.register({name:'conversation.view', id:'deepmemory', order, label})`，复用**已有的**标准 props（`props.sessionId`），不需要自己开路由。`label` 用函数形式，切语言时会重读。

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

- `test/smoke.cjs`：假 `window.__ModuleLoader__` + 假 React，验证 client bundle 能加载并注册**四个** slot（侧边栏图标 / 主面板 / 会话头胶囊 / 会话窗口页签）。
- 迁移要在**真的库的副本**上先试：复制 `memory.db` + `-wal` 到临时目录，`new MemoryStore(db)` 看 `backup` / `pages` / `stats` / `rebuildFts`。
- 面板的浏览器验证：工具里没有浏览器自动化时，只能确认「bundle 能加载 + 四个槽位注册成功 + 每个视图能渲染不抛错」，观感必须人眼看。

---

## 8. 下一步建议（按优先级）

1. **先让人在浏览器里过一遍第 5 节的「未测试」清单**。UI 整个重写了，还没人看过。
2. 复测日记：等一个真的有对话的日子，确认定时任务写出的是**当天**、不是被冻住的旧日期。
3. 补「事实自动提炼」（最大功能缺口）。
4. 补导出 / 备份。
5. 会话记忆隔离（方案 b）——用户说先记着。

---

## 9. 相邻项目

- `C:\Project\dsh-feishu-bot-preset`（飞书机器人 preset，白名单 29 项含 5 个 memory 工具）
- `C:\Project\dsh-companion-preset`（小肥鱼，白名单 16 项含 5 个 memory 工具）

**注意**：这两个 preset 的 tool-fence 会挡掉根平面的工具。给 deepmemory 加新工具时，
**必须同时**去这两个仓库的白名单里放行，否则 bot 那边永远看不到它。
