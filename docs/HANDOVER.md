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
lib/index.js      69 KB  插件主入口：注册工具、注入提示词、17 条路由、门控、注册写日记预设
lib/client.js    132 KB  浏览器半：侧边栏图标 + 主面板（五个页签）+ 输入框角落的记忆开关菜单 + 会话窗口「深度记忆」页签
lib/store.js      26 KB  sqlite 封装：facts / episodes / diary / meta / vec + 三张 FTS + schema 迁移
lib/search.js     14 KB  三档检索
lib/settings.js   12 KB  门控设置（预设 / 预设子代理 / 会话 / 子代理 四层）+ 日记人格与模型
lib/diary.js       9 KB  日记素材组装、日界与提示词
lib/scheduler.js   8 KB  日记定时任务（借助宿主 schedule 服务）+ 立刻运行 + 一次性投递
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
| 工具 | 根作用域：`memory_search` / `memory_recall` / `memory_save` / `diary_read` / `memory_forget`；`diary_write` + `diary_material` 只在日记目录的 agent 上注册。插件自己注册预设 `deepmemory-diary` |
| 18 条路由 | `/stats` `/facts` `/episodes` `/diary` `/day` `/calendar` `/activity` `/search` `/settings` `/forget` `/session-flags` `/rebuild` `/sessions` `/dependency` `/models` `/diary-task` `/backfill` `/missed` |
| 面板 | 五个页签：概览 / 搜索 / 记忆 / 会话 / 设置。所有列表都是**新的在上**（片段、事实、日记页）；设置页按**预设**配默认权限，另有一张「写日记的人格」卡片 |
| 会话窗口 | 新增「深度记忆」页签（`conversation.view` 槽位，id `deepmemory`，order 35）。宿主只把标签渲染成纯文本，所以水母图标放在这个视图自己的标题行里 |
| 输入框角落 | 四个记忆开关（`conversation.input.right` 槽位，id `deepmemory-flags`，order 30）。**唯一画法**：`FlagsMenu` 组件，`react-dom` 门户到 body，配色照抄宿主 `Menu` 原语。会话页每行、设置页每个预设的两行用的都是它。原会话头胶囊与 `conversation.hero.options` 那枚都已移除 |
| 语义第三档 | **可用**。依赖已装（542.8 MB），模型已下（bge-small-zh + bge-base-zh），当前用 `Xenova/bge-base-zh-v1.5` |
| 日记定时任务 | 每天 23:55（`Asia/Shanghai`，用户自己改过），target `{kind:'new', cwd: <…>/diary, agentPreset:'deepmemory-diary'}`；提示词里**不含日期**；错过的那一次开机后补投一次 |
| 补写 / 重写 | **只由人在面板里发起**。记忆页点开某天 → 选「日记」：没日记给「补写」，有日记给「重写这一天」（重写是再加一篇，不覆盖）。两者都走 `POST /backfill`，`mode` 区分；`day` 写死在那一次的一次性投递里 |
| 错过的投递 | 不自动补。`GET /missed` 比较 `lastDelivery` 的 `scheduledAt` 与 `deliveredAt` 各自归属的目标日（按 04:00 日界），给出「定时任务错过了某天」；概览和记忆页顶部各一条提醒，按钮按那一天补写，那天有页面后提醒自己消失 |
| 写手不检测缺口 | 日记会话只写要求它的那一天：`diary_material` 只返回一天；`missingDays()` / `BACKFILL_DAYS` / 补写开关 / `diary_material` 的 `missing` 字段**全部删除**（用户的第 3 条要求） |
| 测试 | 六个套件全绿：store 10 / search 13 / settings 16 / diary 15 / toolkit 9 / scheduler 18 = 81；`test/smoke.cjs` 另渲染四个槽位（31 个节点） |
| 日记会话工具 | `restrict({ allow })` 白名单九项（`diary_read` + 四个 `memory_*` + `read`/`write`/`edit`），从 79 个压到九个；名单先与 `ctx.tools.definitions()` 的真实全局名取交集 |

**门控四维与四层**

- 四维：`recall`（读记忆 + `diary_read`）/ `write`（写记忆）/ `diary`（片段进不进日记素材）/ `forget`（删记忆，默认 **false**）
- 内置默认值 `GLOBAL_DEFAULTS = {recall:true, write:true, diary:true, forget:false}`，它是这条链的最底，不是一栏可改的配置
- 四层：**预设的新会话默认 → 预设的子代理默认 → 会话覆盖 → 子代理覆盖**。会话在创建时（`agent/created` / `sessionsOf`）把当时预设那一层的值**钉住**，之后改预设不影响已有会话。
- 「全局默认」那一栏已经移除（用户明确要求）：进程级开关和预设级默认同时存在时，谁也说不清某一行到底跟着谁。
- 存储只存**与父层的差异**（`presets[id].flags` / `presets[id].subagent` / `sessions` / `subagents`）；「恢复继承」写 `null` 墓碑（不是删键——删了下次 pin 又钉回去）。预设那张表某一行全等于内置默认时会整个消失。
- `Settings` 的调用方一律要带预设 id：`flagsFor(sessionId, fallback)` 在 `lib/index.js:353` 用 `presetOfSession` 查出来再问 settings，所以后端不需要前端传预设。

---

## 4. 关键设计决策（别轻易推翻）

1. **三档检索是流水线不是三选一。** FTS5 trigram（永远跑，保证不漏）→ 中文 bigram 余弦重排（永远跑）→ ONNX 嵌入重排（可选，失败静默降级）。三档共用 `SearchProvider` 接口。
2. **原文即真源，向量只是派生索引。** 换模型 = 删 vec + 重算。启动时比对 `model_name` 与 `dim`，不一致自动重建。
3. **提示词注入只放极短索引块**（条数 + 最近日记日期），内容靠模型**主动调工具**查。上下文成本常数级。
4. **`diary_write` 不在普通会话里出现。** 靠「目录即身份」：只有 cwd 等于 `~/.dsh/deepmemory/diary` 的 agent 才注册这两个工具。
5. **子代理的片段记到父会话名下。** `record()` 里 `owner = parent === '' ? sessionId : parent`，这样日记与搜索只看到一条主线。
6. **日记会话的独白不算素材。** `record()` 三重排除（内存 Set + 目录判定 + `meta.diarySessions` 持久化集合），`primeDiarySessions()` 启动时扫已存会话头补齐。
7. **提示词「什么时候查、什么时候记」由插件自己写**（`GUIDANCE_SECTION = 'deepmemory:guidance'`），不塞进任何 preset 的 persona。这是用户明确裁定的分工。
8. **定时任务的提示词里不能出现日期。** 提示词是一次写入、天天复用的；写死日期就会天天写同一天、然后被「已有就跳过」吞掉——这是 2026-11-11 修掉的「日期冻死」bug。日期由接手的 agent 按投递时刻自己算（日界 04:00），`taskPrompt()` 里留了 `PROMPT_MARK = '目标日即使已经有日记，也要再写一篇新的'`，`ensureTask()` 靠它识别并修复老版本留下的带日期任务；这条标记跟着指令含义走，指令改了意思标记就要改，好让旧任务在下次激活时被重写。老任务没人会再去设置页点一次，所以 `apply()` 里在拿到 `schedule` 服务后立刻调 `repairTask()` 改一次提示词（只改 prompt，不动 time / target——那是用户自己设的）。
9. **日记表主键是 `id` 不是 `day`。** 同一天可以有多次投递、多篇日记。同一次投递重复写靠 `(day, origin)` 去重（`origin` 默认是会话 id）；`origin` 为空的手写一律新增。旧库打开时自动迁移：先 `wal_checkpoint(TRUNCATE)` 再整文件备份成 `memory.db.bak-<时间戳>`，然后重建表并重灌 FTS。
10. **记忆页是唯一的日记入口。** 用户明确不要独立的「日记」页签：日历上点一天 → 点「日记 / 事实 / 片段」→ 右侧出内容。没有日记的那天日历上有缺口标记，右侧给「补写」按钮（已有日记时给「重写这一天」）。两者都走 `/backfill`，它**总是**新建一次性投递，把 `day` 写死在那一次的提示词里——定时任务本身是无日期的，跑它只写得出「今天」，写不出用户点的那个旧日子。
11. **概览的活跃度是一面贡献墙，不是柱图。** 用户点名要 GitHub 主页那种贡献墙。实现是自己写的十来个 CSS 类（11px 一格、一周一列、周一起头），没有引入任何开源项目——只是照那个排法自己画。档位边界取当天数据的 25/50/75 分位，所以安静的日子也看得出层次；格子上的 `missing` 与日历缺口是同一个判断。`/activity` 一次要一年，所以走 `store.activityBetween()` 的三次分组查询，不是 365 × 3 次日查询。
12. **概览三栏共用一种行，不再各写一套。** 早先左边日记预览是一段裁切的正文 + 整卡点击，右边事实/片段是带 meta、截断、高亮的行——同一份数据两套语法。现在统一成 `MemoryRow`（类别 + 时间 + 两行截断 + 命中词高亮），日记也从「最近一日」改成「最近 4 篇」。用户明确否掉了「展开全文」和「去看这一天」两个按钮：对齐靠 `clamp-2` 两行截断，跳转靠点这一行。贡献墙的悬停说明同理换成自绘的 `.dm-wall-tip`（定位在格子上方），因为浏览器原生 `title` 要等将近一秒、且只有一行，而一格代表一整天。
13. **会话语义只加槽位，不改宿主。** 页签标签是纯文本，所以图标进不去标签，就放进视图标题行；新建会话的开关用官方 `conversation.hero.options` 槽位，而不是去改宿主那一行。
14. **「会话」页跟其余几页同一套版式，且不再有整段清空。** 原来是两张表 + 四列复选框 + 行内三个链接（看片段 / 恢复继承 / 清空本会话记忆）。现在是一行一个会话、点行即打开这个会话的记忆（和点一条片段同一个动作，所以「看片段」消失了），四个开关收在右侧一枚 `n/4` 按钮里，**点它就是改这四项**（四行开关 + 恢复继承）。**「清空本会话记忆」整条移除**：清空一段历史是破坏性动作，不该挂在列表行上；面板只保留逐条删除，模型侧 `memory_forget` 的 session 分支仍受 `forget` 开关门控。

15. **写日记有自己的预设，人设与模型在面板里改。** `deepmemory-diary` 由插件在激活时 `agentPresets.register(...)` 注册（不是一个额外的 bundle，因为人设是运行时可改的，而 bundle patch 是静态的），`order: 90`，plugins 只留三样：`@deepseek-ai/dsh-persona`（`prefix` 取自设置页，留空用内置人设）、`@deepseek-ai/dsh-time-context`（时钟——日记靠它算日期）、`@deepseek-ai/dsh-tool-fs`（文件读写）。`complete` 必须保持 `false`，否则 prefix 会成为唯一系统提示，时钟一起没了。**记忆与日记工具不在预设里声明**：它们是本插件在 Host 层注册的，对所有 agent 可见；预设只决定额外挂什么。这才是「日记会话只背几个工具」的实现方式——普通会话仍是 74 个。模型独立：`agent/created` 时如果设置页填了 provider + model，就对落在该预设下的会话调 `agent.model.select(...)`，留空跟随 DSH 全局默认模型。
16. **改人设立刻生效，但只对下一次投递生效。** `POST /settings { scope:'diary' }` = 落盘 + `remountDiaryPreset()`（先 dispose 再 register，不会越改越多）。DSH 的规则是「已有会话保留启动时的预设版本」，所以在跑的日记会话不会中途换人格，下一次投递才是新的。设置页要说明这一点，不然用户会以为没生效。
17. **所有列表新的在上。** 片段、事实、日记页的查询一律 `ORDER BY created_at DESC, rowid DESC`（`lib/store.js` 里的 `episodesOfDay` / `pagesOfDay` / `listDiary` / `listFactsBetween`）。唯一例外是 `dayDigest()`：它要吃「这一天」的叙事，所以内部 `.reverse()` 回正序再 `.slice(-MAX_EPISODES)` 保留最近的 400 条。改排序时别把 digest 一起改回去。
18. **目标日无条件写；写手不检测缺口。** 每一次投递只写它那一天，哪怕那天已有日记也照写**新的一篇**（用户否掉了「改写同一篇」：宁可多一篇，也不要覆盖别人写过的）。反过来，日记会话**不再扫最近 7 天、不再判断哪天缺日记**：`missingDays()` / `BACKFILL_DAYS` / 设置页的补写开关 / `diary_material` 的 `missing` 字段全部删除，`composeInstruction()` 里明写「不要自己去查哪些天缺日记——补写由人在面板里点」。这条是用户 2026-11-12 的第 3 条要求，别再加回来。
19. **补写和重写都只由人发起。** 记忆页点开某天 → 选「日记」：那天没有日记时标题行给「补写」，有日记时给「重写这一天」（重写是再加一篇，不覆盖）。两者都走 `POST /backfill`，用 `mode: 'fill' | 'rewrite'` 区分，`day` 写死在那一次的一次性投递提示词里——定时任务的提示词是无日期的，跑它只能写出「今天」。
20. **错过的投递只提醒，不自动补。** `GET /missed` 拿定时任务的 `lastDelivery`，把 `scheduledAt` 与 `deliveredAt` 各自按 04:00 日界折算成目标日：`got <= expected` 说明没跨日（凌晨那一投算准时），超过 30 天的不管，那天已经有页面的也不管（**自己消失**，没有已读状态）。面板在概览和记忆页顶部各渲染一条 `.dm-notice`，按钮按那一天发起补写。会话语义下的「对话记忆」页签不显示这条提醒——那里不写日记。
21. **四个开关只有一个画法，而且必须门户出去。** `FlagsMenu` 一个组件服务三处：输入框右下角（`conversation.input.right`，order 30，当前会话）、会话页每行（那一行的会话）、设置页每个预设的两行（该预设的新会话 / 子代理默认值）。菜单用 `react-dom` 的 `createPortal` 挂到 `document.body`，因为输入框那一列会 `overflow: hidden`，宿主的弹层也是这么做的（`Menu` 原语里 `.portal{position:fixed;z-index:1100}`）。样式照抄 `dsh-client-ui-primitives/lib/Menu.module.css` 与 `MenuSurface.module.css` 的规则：`--dsw-menu-surface-fill` 底、`--dsw-menu-backdrop-filter` 模糊、`--dsw-elevation-prominent` 投影、`--dsw-radius-lg` 圆角、行 `min-height:30px` / `padding:5px 8px` / 悬停 `--dsw-alias-interactive-bg-hover`、图标 `--dsw-alias-menu-icon`。这些 token 不在 `Theme.listTokens` 的短名单里，要去样式表里找（`reference/_theme_client.js` 有全集）。`@deepseek-ai/dsh-client-ui-context-menu` 是右键菜单，不是点击弹出的下拉，别拿它做这个。
22. **会话头那排单字胶囊与新建会话行那枚都撤了。** 用户的原话是「胶囊删掉，改成和新会话一样出现在对话框角落的菜单」：同一件事原来有三种长相（单字胶囊、hero 小胶囊、设置页四个 Toggle），现在是三种位置、一个组件。`conversation.hero.options` 那条注册整个移除——会话还不存在时四个开关没有可写的地方，这一段交给「按预设的默认权限」。
23. **日记会话的工具是白名单，不是黑名单。** `DIARY_TOOLS` 八项 + `restrict({ allow })`。两个坑：`restrict` 只认**全局**工具名，scope-local 名会让整个过滤器失败，所以名单先和 `ctx.tools.definitions()` 的真实全局名取交集；`diary_write`/`diary_material` 挂在 agent 作用域上，按宿主规则「scoped registrations remain visible」本来就在，**不要**写进名单。这条限制与四个开关是交集关系。
24. **错过了就是错过了，开机补投一次是宿主的既定语义。** 用户设的 23:55 那天机器关着，第二天 12:42 开机时补投了一次——`schedule` 的文档原文是「After downtime, only the latest missed occurrence is delivered」，所以关多久都只补最近那一次，不会补一串。这不是插件的 bug；面板的 `/missed` 提醒就是为这件事准备的。

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
- [ ] 概览页三栏是否真的底边对齐（日记是「最近 4 篇」的行列表，不再是整卡裁切）、点一行是否跳到记忆页那一天
- [ ] 概览的日记/事实/片段三种行看起来是不是同一种东西、命中词高亮有没有出现
- [ ] 贡献墙在亮色/暗色下分档是否看得清、格子里的缺口描边是否认得出、点格子是否落到那一天
- [ ] 贡献墙的自绘悬停：跟着鼠标走得快不快、会不会被面板边界裁掉
- [ ] 「会话」页改成列表后：点一行是否打开那个会话的记忆、`n/4` 按钮点开后四项是否都能改、「恢复继承」是否只在有覆盖时出现
- [ ] 会话窗口里「深度记忆」页签在真实布局里是否可用（组件能注册、能渲染，但没人在页面上点过）
- [ ] 输入框右下角那枚 `记 n/4` 与模型、模式选择器并排时会不会挤、菜单朝上翻的时候有没有被输入框或窗口边缘裁掉（门户到 body，理论上不会，但要在真实布局里看）
- [ ] 菜单和 DSH 自己的菜单摆在一起时配色/圆角/投影是否一致（亮暗两套都要看）
- [ ] 设置页每个预设的两行菜单：改完之后那一行是否立刻显示新值、「恢复内置默认」/「跟随上面一行」是否只在有差值时可点
- [ ] 定时任务真实投递一次、且日期是它自己算出来的
- [ ] 「补写」按钮走 `/backfill` 后是否真能在 `diary` 表里落一行；「重写这一天」是否**加**了一篇而不是改旧的那篇
- [ ] 概览与记忆页顶部的「定时任务错过了某天」提醒是否出现、按钮是否只补那一天、那天有页面后是否自己消失
- [ ] 真的错过一次定时任务之后，`/missed` 给出的日期是否就是错过的那个目标日（凌晨投递不应误报）
- [ ] 设置页「每个预设的默认权限」在真实数据下列出的是哪些预设、改一行之后新开会话是否真的按它来
- [ ] 设置页「写日记的人格」保存后，下一次投递的会话头里 `agentPreset` 是否是 `deepmemory-diary`、人格段是否真的换了
- [ ] `deepmemory-diary` 出现在新建会话的预设选择器里是否合适（没有 bash 之类，只有文件读写）
- [ ] 下一次日记投递时，那个会话的工具清单是否真的从 79 降到九个（看会话里的工具调用列表，或日志里有没有 `deepmemory: could not narrow the diary tools` 这条 warn）

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
