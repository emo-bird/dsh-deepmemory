# 交接文档 · dsh-deepmemory

> 写给下一个在本机接手的 AI。目标：你读完这一份，就能继续干活，不用重新勘查。
> 面向用户的说明在 [README](../README.md)，偏实现叙述的在 [ARCHITECTURE](ARCHITECTURE.md)。
> 最后更新：2026-11-17（半成品补齐 + 推送 GitHub）。仓库 HEAD 见 `git log -1`。

---

## 1. 这是什么

`@emo-bird/dsh-deepmemory` —— 一个 DSH bundle，给 Harness 提供**跨会话的长期记忆**，
并在侧边栏加一个「深度记忆」面板当控制台，另外在每个会话窗口里加一个「深度记忆」页签、在新建会话那一行加一个记忆开关。

一句话架构：**一个 sqlite 文件 + 三档检索 + 五个常驻工具 + 一组 Connection 路由 + React 面板。**

- 数据库：`C:\Users\一门鸽鸽\.dsh\deepmemory\memory.db`
- 设置：同目录 `settings.json`
- 模型：`C:\Project\dsh-deepmemory\vendor\models\`
- 注册在**根平面**，所有 preset 的会话都能用（前提是那个 preset 的 tool-fence 白名单放行了这几个工具）

---

## 2. 文件结构与职责

```
lib/index.js      93 KB  插件主入口：注册工具、注入提示词、20 条路由、门控、注册写日记预设、素材带标题与项目、模型目录、首次激活时把人格种进设置文件
lib/client.js    163 KB  浏览器半：侧边栏图标 + 主面板（六个页签，模块面统一走 --dm-* 四个变量）+ 输入框角落的记忆开关菜单 + 会话窗口「深度记忆」页签
lib/store.js      35 KB  sqlite 封装：facts / episodes / diary / meta / vec + 三张 FTS + schema 迁移 + 向量缓存的读写与失效
lib/search.js     19 KB  三档检索（第三档复用 vec 里的向量缓存）+ 命中分档标记
lib/settings.js   12 KB  门控设置（预设 / 预设子代理 / 会话 / 子代理 四层）+ 日记人格与模型 + 日界参数
lib/dayclock.js    6 KB  日界推算：从时间戳找最后一段连续的夜、算出窗口、区分「午夜之后」的夜尾巴
lib/diary.js      21 KB  日记素材组装（含项目名/标题/首句/前一天）、日界窗口、夜尾巴、提示词、默认人设
lib/scheduler.js  12 KB  日记定时任务（借助宿主 schedule 服务）+ 立刻运行 + 一次性投递
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
test/                    九个 .test.mjs + smoke.cjs（真的迷你渲染器）
```

**核心数据模型**

| 表 | 内容 |
|---|---|
| `facts` | 长期事实（scope / subject / text / weight / 来源会话与 preset） |
| `episodes` | 对话片段（**只记 user 消息**，按 session_id 归属） |
| `diary` | **一天可以有多篇**。主键是 `id`，`day` 上建了索引，`origin` 记录是哪次投递写的（`origin: 'tail'` 是补夜尾巴的那一篇） |
| `meta` | 键值（`diarySessions` 存日记会话 id，换行分隔；`schemaVersion` 存 2） |
| `vec` | 向量缓存（`kind / id / model / dim / vector`）。第三档第一次见到某段文本时算一次写进来，下次直接读；改写原文或切换模型时对应的行会被删掉 |

`episodes` 的 `day` 列仍是落库那一刻的**日历日**（`store.js` 的 `dayOf`），因为那是历史事实、改了会打乱旧数据；「这一天算到几点」是**读日记素材的时候**由 `dayclock.js` 从 `created_at` 推出来的（`dayWindow` / `episodesBetween`），不落库。所以日界参数改了会立刻改变**日记素材**的归属，不需要迁移；面板的日历与 `/day` 仍按 `episodes.day`（见第 5 节那条未完成的说明）。

---

## 3. 当前状态

| 项 | 状态 |
|---|---|
| git | 见 `git log -1`；`docs/` 在 2026-11-11 由根目录 `HANDOVER.md` 迁入 |
| 安装 | **已安装并激活**，desktop profile 里是 `link:C:/Project/dsh-deepmemory` 的 junction，改代码刷新页面即生效 |
| 工具 | 根作用域：`memory_search` / `memory_recall` / `memory_save` / `diary_read` / `memory_forget`；`diary_write` + `diary_material` + `diary_discard` 只在日记目录的 agent 上注册。插件自己注册预设 `deepmemory-diary` |
| 20 条路由 | `/stats` `/facts` `/episodes` `/diary` `/day` `/calendar` `/activity` `/search` `/settings` `/forget` `/session-flags` `/rebuild` `/sessions` `/dependency` `/models` `/model-catalog` `/diary-task` `/backfill` `/missed` `/daycut` |
| 面板 | 六个页签：概览 / 搜索 / 记忆 / 事实 / 会话 / 设置。所有列表都是**新的在上**（片段、事实、日记页）；设置页按**预设**配默认权限（一个预设一张卡片，横排自动折行），另有一张「写日记的人格」卡片和一张「一天到哪里结束」卡片。模块面统一由 `.dm-page` 上那四个 `--dm-*` 变量决定（`--dm-surface` / `--dm-surface-stroke` / `--dm-inset` / `--dm-surface-sunken`），六个页签不再各取各的别名。顶栏只有标题 + 刷新：原来那个全局搜索框已移除（它和任何一页都不相干，按下去还会把人从当前页顶走），搜索框只留在「搜索」页 |
| 事实页 | 唯一能手写内容的页签：`POST /facts` 在不带 `id` 时调 `store.saveFact`（和 `memory_save` 同一套 `text + scope` 去重，重复则合并权重并返回 `updated: true`），正文 + 可选 `subject` + 权重 1–5；带 `id` 时走 `store.updateFact`（原地改文本/对象/权重并重建 FTS，未知 id → 404，文本撞车或空文本 → 400，接口已通、面板编辑器下一轮做）。下面的表走 `GET /facts?limit=500` 全量读，筛子在已加载的行上做（文字或对象，`highlight()` 复用），不消耗检索流水线。每行显示权重、对象、更新时间与**最近一次被命中**（`lastUsedAt`，0 显示「从未命中」）。概览的「事实」数字格子是进这张表的入口（只有这一格变成 `<button>`，其余四格仍是只读读数） |
| 日记模型下拉 | 「写日记的人格」里的模型是一个原生 `<select>`：选项来自 `GET /model-catalog`（宿主 `llm.listProviders()` + 逐个 `listModels()`，`default` 取 `agentDefaultModel`），按 provider 分 `<optgroup>`，第一项是「跟随全局默认（provider / model）」；值编码 `provider\tmodel`；宿主不再广告的旧值会保留成「（列表里没有）」一项，catalog 读不到时退回两个手填输入框 |
| 日记素材带项目 | 片段落库时记下会话 cwd（`episodes.workspace`）；取素材时再由 `sessionLabels()` 从 `sessionPersistence` + `sessionProjectionCache` 补上会话**标题**与首句，于是每段对话变成 `## 标题（项目 X · 预设 Y）` + `开头：…`。写日记的人格默认是「爱吃白饭的大肥鱼」 |
| 会话窗口 | 新增「深度记忆」页签（`conversation.view` 槽位，id `deepmemory`，order 35）。宿主只把标签渲染成纯文本，所以水母图标放在这个视图自己的标题行里 |
| 输入框角落 | 四个记忆开关（`conversation.input.right` 槽位，id `deepmemory-flags`，order 30）。**唯一画法**：`FlagsMenu` 组件，`react-dom` 门户到 body，配色照抄宿主 `Menu` 原语。会话页每行、设置页每个预设的两行用的都是它。原会话头胶囊与 `conversation.hero.options` 那枚都已移除 |
| 语义第三档 | **可用**。依赖已装（542.8 MB），模型已下（bge-small-zh + bge-base-zh），当前用 `Xenova/bge-base-zh-v1.5` |
| 日记定时任务 | 每天 23:55（`Asia/Shanghai`，用户自己改过），target `{kind:'new', cwd: <…>/diary, agentPreset:'deepmemory-diary'}`；提示词里**不含日期**；错过的那一次开机后补投一次。提示词是**两阶段**的：先看昨天那篇缺不缺夜尾巴（`tailCount > 0 && pageCount > 0`），缺就补完再写今天 |
| 日界 | 不是固定的 04:00，是**从时间戳推**的：取当天最后一段连续活动（相邻两条间隔不超过「空档阈值」）结束的钟点，向上取整、封顶到「最晚小时」。设置页「一天到哪里结束」卡可改这三个参数，并显示最近 7 天推算出来的日界区间与逐日明细（`GET /daycut`）。关掉开关就退回普通日历日 |
| 补写 / 重写 | **只由人在面板里发起**。记忆页点开某天 → 选「日记」：没日记给「补写」，有日记给「重写这一天」（重写是再加一篇，不覆盖）。两者都走 `POST /backfill`，`mode` 区分；`day` 写死在那一次的一次性投递里。点完那一天的按钮变「写手中…」并锁住（**锁按天记**：写 12 号时切到 11 号，11 号照常可点），`waitForNewPage()` 每 4 秒读一次 `/day`，看到页数变多就解锁并刷新；四分钟没交稿才解锁并说明没等到。错过提醒上的补写按钮同一套锁 |
| 错过的投递 | 不自动补。`GET /missed` 比较 `lastDelivery` 的 `scheduledAt` 与 `deliveredAt` 各自归属的目标日（按设置里的**最晚小时**折算，默认 04:00；这里不用逐夜推算的窗口，因为它要比较两个历史时刻、不能依赖那一夜熬得多晚），给出「定时任务错过了某天」；概览和记忆页顶部各一条提醒，按钮按那一天补写，那天有页面后提醒自己消失 |
| 写手不检测缺口 | 日记会话只写要求它的那一天：`diary_material` 只返回一天；`missingDays()` / `BACKFILL_DAYS` / 补写开关 / `diary_material` 的 `missing` 字段**全部删除**（用户的第 3 条要求） |
| 写日记的人格 | **存在设置文件里**（`settings.json` 的 `diary.persona`），不是写死在代码里：首次激活时用 `DEFAULT_DIARY_PERSONA` 种子写入，之后设置页输入框显示的就是运行时真正用的那段话；`snapshot.diaryDefault` 把出厂文本交给面板，「填入内置人格」按钮据此还原。内置那版是「爱吃白饭的大肥鱼」 |
| 测试 | 九个套件全绿：store 20 / search 19 / settings 16 / diary 20 / toolkit 9 / scheduler 18 / dayclock 16 / guidance 7 / session 5 = 130；`test/smoke.cjs` 是个真的迷你渲染器（桩 `react`/`react-dom`，逐 tab 深渲染并跑 effect），会断言每个页签的文字、检查 CSS 类与字面色，并打印未渲染到的交互态类名 |
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

1. **三档检索是流水线不是三选一。** FTS5 trigram（永远跑，保证不漏）→ 中文 bigram 余弦重排（永远跑）→ ONNX 嵌入重排（可选，失败静默降级）。三档共用 `SearchProvider` 接口。**命中理由由后端外传**：`search()` 给每条 hit 加 `marks: [{text, tier}]`，`tier` 是 `exact`（原词在那句里）或 `fuzzy`（只有字形 bigram 重合）；前端 `highlight(text, query, marks)` 照单标成两种颜色，因为只有后端知道这条是走哪一档进来的。别把这段逻辑搬回前端——前端拿「水母颜色」去逐字匹配一个只含「水母」和「颜色」的句子，只能一个都不中，于是模糊命中看起来像没标。
2. **原文即真源，向量只是派生索引。** 换模型 = 删 vec + 重算。向量按 `(kind, id, model)` 存，读的时候带上当前模型名，别的模型写下的行自然读不到（切换模型时还会 `clearVectors()` 主动清一次，免得旧空间的行白占体积）。改写原文时那一条的向量被删掉，下次用到重算——向量描述的是**那一句**，句子变了它就不再成立。
3. **提示词注入只放极短索引块**（条数 + 最近日记日期），内容靠模型**主动调工具**查。上下文成本常数级。
4. **`diary_write` 不在普通会话里出现。** 靠「目录即身份」：只有 cwd 等于 `~/.dsh/deepmemory/diary` 的 agent 才注册这三个工具（`diary_material` / `diary_write` / `diary_discard`）。
5. **子代理的片段记到父会话名下。** `record()` 里 `owner = parent === '' ? sessionId : parent`，这样日记与搜索只看到一条主线。
6. **日记会话的独白不算素材。** `record()` 三重排除（内存 Set + 目录判定 + `meta.diarySessions` 持久化集合），`primeDiarySessions()` 启动时扫已存会话头补齐。
7. **提示词「什么时候查、什么时候记」由插件自己写**（`GUIDANCE_SECTION = 'deepmemory:guidance'`），不塞进任何 preset 的 persona。这是用户明确裁定的分工。
8. **定时任务的提示词里不能出现日期。** 提示词是一次写入、天天复用的；写死日期就会天天写同一天、然后被「已有就跳过」吞掉——这是 2026-11-11 修掉的「日期冻死」bug。日期由接手的 agent 按投递时刻自己算（日界由 `dayclock.js` 推），`taskPrompt()` 里留了 `PROMPT_MARK = '夜尾巴'`，`ensureTask()` 靠它识别并修复老版本留下的任务；这条标记跟着指令含义走，指令改了意思标记就要改，好让旧任务在下次激活时被重写。老任务没人会再去设置页点一次，所以 `apply()` 里在拿到 `schedule` 服务后立刻调 `repairTask()` 改一次提示词（只改 prompt，不动 time / target——那是用户自己设的）。**每次改 `taskPrompt()` 都要同步看一眼 `PROMPT_MARK`**，否则已经装好的任务永远停在旧提示词上。
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
20. **错过的投递只提醒，不自动补。** `GET /missed` 拿定时任务的 `lastDelivery`，把 `scheduledAt` 与 `deliveredAt` 各自按设置里的**最晚小时**（默认 4 点）折算成目标日：`got <= expected` 说明没跨日（凌晨那一投算准时），超过 30 天的不管，那天已经有页面的也不管（**自己消失**，没有已读状态）。这里刻意用固定的 `latestHour` 而不是逐夜推算的 `cutHourOf`——它比的是两个历史时刻，不能依赖那一夜到底熬到几点，否则同一个事件会因为今天的参数不同而给出不同结论。面板在概览和记忆页顶部各渲染一条 `.dm-notice`，按钮按那一天发起补写。会话语义下的「对话记忆」页签不显示这条提醒——那里不写日记。
21. **四个开关只有一个画法，而且必须门户出去。** `FlagsMenu` 一个组件服务三处：输入框右下角（`conversation.input.right`，order 30，当前会话）、会话页每行（那一行的会话）、设置页每个预设的两行（该预设的新会话 / 子代理默认值）。菜单用 `react-dom` 的 `createPortal` 挂到 `document.body`，因为输入框那一列会 `overflow: hidden`，宿主的弹层也是这么做的（`Menu` 原语里 `.portal{position:fixed;z-index:1100}`）。样式照抄 `dsh-client-ui-primitives/lib/Menu.module.css` 与 `MenuSurface.module.css` 的规则：`--dsw-menu-surface-fill` 底、`--dsw-menu-backdrop-filter` 模糊、`--dsw-elevation-prominent` 投影、`--dsw-radius-lg` 圆角、行 `min-height:30px` / `padding:5px 8px` / 悬停 `--dsw-alias-interactive-bg-hover`、图标 `--dsw-alias-menu-icon`。这些 token 不在 `Theme.listTokens` 的短名单里，要去样式表里找（`reference/_theme_client.js` 有全集）。`@deepseek-ai/dsh-client-ui-context-menu` 是右键菜单，不是点击弹出的下拉，别拿它做这个。
22. **会话头那排单字胶囊与新建会话行那枚都撤了。** 用户的原话是「胶囊删掉，改成和新会话一样出现在对话框角落的菜单」：同一件事原来有三种长相（单字胶囊、hero 小胶囊、设置页四个 Toggle），现在是三种位置、一个组件。`conversation.hero.options` 那条注册整个移除——会话还不存在时四个开关没有可写的地方，这一段交给「按预设的默认权限」。
23. **日记会话的工具是白名单，不是黑名单。** `DIARY_TOOLS` 九项 + `restrict({ allow })`。两个坑：`restrict` 只认**全局**工具名，scope-local 名会让整个过滤器失败，所以名单先和 `ctx.tools.definitions()` 的真实全局名取交集；`diary_write` / `diary_material` / `diary_discard` 挂在 agent 作用域上，按宿主规则「scoped registrations remain visible」本来就在，**不要**写进名单（写进去只会让整个 restrict 失败）。这条限制与四个开关是交集关系。
24. **错过了就是错过了，开机补投一次是宿主的既定语义。** 用户设的 23:55 那天机器关着，第二天 12:42 开机时补投了一次——`schedule` 的文档原文是「After downtime, only the latest missed delivery occurrence is delivered」，所以关多久都只补最近那一次，不会补一串。这不是插件的 bug；面板的 `/missed` 提醒就是为这件事准备的。
25. **日记要知道「在做哪个项目」，而项目来自 cwd，不是来自标题。** 用户的抱怨是「事情都记着，但什么项目却不知道」。根因是 `episodes.workspace` 一直是空字符串（`record()` 没传），而 `renderDigest` 把每段对话一律印成 `## 一段对话`。修法分两步：落库时写 `workspace: sessionCwd(session)`；取素材时用 `dayDigest` 新增的 `describe` 回调把宿主里的会话标题与首句补进来（`sessionLabels()`，走 `sessionProjectionCache`，零 I/O）。因此**不要**指望「打开标题刷新插件」来修这件事——它只是让标题更准；项目名与标题插件无关。
26. **默认人设写成跑得动的一段话，不是形容词。** 「爱吃白饭的大肥鱼」沿用 `dsh-companion-preset`（小肥鱼）的语气规则：简体中文、像人说话、不列条目/小标题/整段加粗、可以自嘲和少量颜文字、不总结不复述、不编造。区别是它写的是「他」的一天而不是聊天回话。这段文本存在 `DEFAULT_DIARY_PERSONA`，但它只是**种子**（见第 28 条）。
27. **模型是下拉框，数据来自宿主的 `llm` 服务，不是手填。** 新增 `GET /model-catalog`：`listProviders()`（空则退回 `listConfigurableProviders()`）→ 逐个 `await listModels(id)` → `{providers:[{id,name,models:[…]}], default}`，`default` 取 `agentDefaultModel.currentSelection()`。客户端把它渲染成一个原生 `<select>` + 每 provider 一个 `<optgroup>`，值编码成 `provider\tmodel`（`modelPick` / `splitModelPick` / `modelOptions` 三个函数是唯一知道这个编码的地方），空串表示「跟随全局默认」。照 `dsh-pet` 的做法走**自建 host 路由**而不是 `connection` 远程调用，但**不用**它那套带搜索的自绘弹层——原生 `select` 键盘可达、没有定位算错的可能。两个细节：保存过但宿主不再广告的一对要留一项「（列表里没有）」，否则 `<select>` 会静默跳到第一项、下一次保存就把模型改了；catalog 读不到时退回两个手填输入框并说明原因，别让人卡在一个空下拉框前。
28. **人格是数据，不是常量。** 用户的第 3 条要求是「人格要在面板里，不要写死了」。做法：`apply()` 在 `new MemorySettings(...)` 之后立刻检查 `diaryConfig().persona`，为空就把 `DEFAULT_DIARY_PERSONA` 写进去——**只种一次**，之后 `settings.json` 是唯一事实来源，`remountDiaryPreset` 读的是文件里那段话。`settingsSnapshot()` 额外下发 `diaryDefault`，面板用它实现「填入内置人格」（填进输入框、再点保存才生效，不偷偷改文件）。两个细节：面板的 `useState` 只读一次初值，而 `/settings` 通常晚于挂载到达，所以 `Settings` 里有一条「本地为空且 snapshot 有值时回填」的 effect，并且**只在本地为空时**回填，避免后台刷新吃掉用户正在敲的字；`remountDiaryPreset` 里那句 `config.persona.trim() === '' ? DEFAULT_DIARY_PERSONA : …` 保留成兜底，只覆盖「种子之前写下的旧文件」或「有人手动清空」。
29. **五种盒子只有一处颜色定义。** 用户的第 2 条要求是「5 个页面的模块背景色不相同，请用相同接口配置颜色，要支持深浅模式」。根因是每个页签各挑各的别名：卡片/统计格 `settings-card-fill`、记忆页面板与模型行 `bg-layer-1`、预设卡 `bg-layer-2`。现在 `.dm-page` 上声明四个变量 `--dm-surface`（顶层模块面）/ `--dm-surface-stroke`（描边）/ `--dm-inset`（嵌在模块里的盒子）/ `--dm-surface-sunken`，所有盒子只读这四个名字，改一处整张面板跟着变，亮暗由别名本身负责。语义色不进来：`.dm-notice` 仍用 `state-warn-*`（它是提醒不是面），`.dm-menu` 仍照抄宿主 `Menu` 的变量。新增模块时**先想清楚它是顶层还是嵌套**，别再去直接引别名。
30. **排了任务不等于写完了，所以按钮要锁到「多出一篇」为止。** `POST /backfill` 只排一个一次性投递，写手在新会话里跑，没有任何进度流回来；用户的原话是「没有明显反馈用户可能重复点击，或者锁住按钮直到对话结束」。做法：点完立刻把**那一天**写进 `pending`（对象按天存，不是单个布尔），那一天的按钮变「写手中…」并禁用，旁边写明正在写哪一天；`waitForNewPage(day, before)` 每 4 秒读一次 `/day`，页数比点之前多就收工，四分钟没动静就解锁并如实说没等到（一直锁着会让人以为卡死，然后跑别处重复点）。锁必须按天：用户的原话是「我重写 12 号进行中，切换到 11 号不要又锁住了」——一个全局 `pending` 会让别的日子跟着一起废掉。**没有做「跳到那个会话」**：会话 id 要等投递真正发生才知道，`POST /backfill` 只回 `taskId`，面板没有办法按 id 打开一个未来才创建的会话。错过提醒上的那一枚按钮走同一套锁，区别是成功后才把这一行移除——先移除再写，看起来就像成功了。
31. **「一天」不是零点到零点，是推出来的。** 用户的抱怨是「熬夜到两三点，但 12 点后的数据被算进第二天，很割裂」；他举的例子是 14 号那篇里「三点出头……中间隔了大半天，十三点二十二分」——那多半是干完活去睡了，不是熬穿了。修法分两层：**读**的时候由 `lib/dayclock.js` 从 `created_at` 推窗口（`dayWindow`），**写**的时候由 `composeInstruction` 要求写手把空档当成「他去了哪儿」写出来。落库的 `episodes.day` 不动：那是历史事实，而窗口是解释。三个参数（开关 / 空档阈值 / 最晚小时）存在 `settings.json` 的 `dayclock` 里，`/settings {scope:'dayclock'}` 可改，`GET /daycut` 返回最近 N 天的推算结果给面板看。**不要**把这个逻辑塞进 `store.dayOf`——那会让旧数据与查询口径永久分叉。
32. **夜尾巴是补篇，不是推迟投递。** 用户拍板的是「保持 23:40 投递，第二天投递时给前一天补一篇夜尾巴，AI 校对后没问题就删旧篇」（否掉了「推迟到 03:30」与「只改口径不补篇」）。所以 `taskPrompt()` 是两阶段：第一步查前一天的 `tailCount > 0 && pageCount > 0`，用 `diary_read` 读那篇、并进后半夜重写、`origin: "tail"` 落一篇新的；第二步才写今天。旧篇**不由写手在写之前删**，而是新篇写过、自己读过确认更全之后，用 `diary_discard` 删。校对不通过就留着两篇让人定——多一篇比丢一篇好。
33. **`diary_discard` 的两道闸门是故意的。** `store.discardDiaryPages(day, keep)` 在 `keep` 为空、或 `keep` 在那一天查不到对应页时**什么都不删**：前者等于清空整天，后者说明重写其实没落地、删了就是丢掉唯一一篇。另外 `origin === ''` 的手写页永远不删——没人会失手写出手写页，那也就不该被失手删掉。这三个判断写在 store 里而不是工具里，因为它要能被单独测（`test/store.test.mjs` 三条）。
34. **关掉的开关要在提示词里也生效，不只是把工具摘掉。** 用户 2026-11-15 的抱怨是「我明明设置了读取记忆关，为什么 `memory_search` 还是能被调用？不应该是根本不知道有这个工具吗」。查下来是三处漏：`guidanceText()` 无条件列了五个工具的用法（工具表摘掉了，提示词还在教它去查，而且 `memory_search` 的 handler 自带卫兵，真调了也只会返回「没查」，模型于是自以为查过）；`/session-flags` POST 只落盘不 `resyncGating()`，会话内拨开关要等下一次 `agent/created` 才改工具表；`resyncGating()` 只遍历 `gatedByAgent` 里登记过的 agent，插件挂载前就在的会话永远轮不到。三条一起修：`guidanceText(flags)` 按开关拼装（全关返回空串，空段落被上游丢弃，不会只剩一个 `# 记忆` 空标题）；per-step 的 `deepmemory:index` 里「用 `memory_search` 查」那句也门控；`/session-flags` 保存后调 `resyncGating()`；`resyncGating()` 先用 `ctx.get('agents')` 的 `list()` 补登记 live agent，再逐个 resync 并逐个 try/catch（一个 agent 正在拆不能拖垮其余的）。**规则**：以后任何新工具只要进了 `GATED_TOOLS`，它在提示词里的每一处提及都要门控——提示词与工具表说的是同一件事。
35. **会话 id 从 `exec.agent.session.id` 取，`exec.session` 不存在。** 用户在飞书群里让模型删一条事实，`memory_forget` 每次回 `{"ok":false,"error":"没有会话上下文"}`，模型于是对用户说「我的记忆工具只能写入，不能删除」——那句话是错的，功能从上线起就没跑通过。根因是工具执行上下文的形状：`dsh-tools` 的 pipeline 构造的是 `{ callId, name, arguments, agent?, toolSet?, signal }`，**没有 `session` 字段**（`README.md` 原话「`agent` is absent for standalone service calls」），于是 `String(exec?.session?.id ?? '')` 恒为 `''`。同一个错影响四类东西：`memory_forget` 拒绝一切调用；`memory_search` / `memory_recall` / `memory_save` / `diary_read` 里的 `flagsFor(...)` 全部退化成全局默认值（这是第 34 条那个「关了还查得到」的**第二层**原因，只在群会话/IM 会话里显现）；`presetOfSession.get('')` 恒 undefined，于是 `facts.source_session` / `facts.source_preset` 写空、`diary_write` 的 `origin` 退化成 `''`（`diary_discard` 的「手写页永不删」闸门于是误保护定时任务写的页）。修法：新增导出的 `sessionIdOf(exec)`，取值 `exec?.agent?.session?.id ?? exec?.agent?.id`，null/undefined 归一成 `''`，八处调用点全换过来（`grep 'exec?.session'` 应当零命中）。`agent.id` 只作回退：agent registry 的 `enter()` 会拒绝 `agent.id !== session.id` 的注册，所以两者必然一致。**规则**：任何需要「当前会话」的地方一律走 `sessionIdOf(exec)`，别再手写 `exec?.session`。

36. **日记正文里不写钟点，写了也用阿拉伯数字。** 用户指出日记读起来不像人写的：「三点出头……中间隔了大半天，十三点二十二分……」——真实日记里没人这么记。两处修：`composeInstruction` 加了「时间要怎么提」一条（正文**尽量不出现精确时间**，「`HH:mm` 是给你定位顺序用的，不是让你抄进正文」，先后顺序用「先…过了一会儿…后来」交代）；`DEFAULT_DIARY_PERSONA` 里也加了同样的规则，因为人设是用户可以在设置页改、并且会被长期保存的一份文本，只改提示词会跟它打架。硬规则只有一条形状上的：非要点时刻时写 `02:00`，**不写「两点」「十三点二十二分」这种汉字数字**——汉字数字既啰嗦又假，阿拉伯数字至少看起来像个时间戳。顺带把提示词里原来的反例「两点说完、下一个时间戳是十三点」也换成 `02:00` / `13:00`，否则提示词自己就在教它写汉字数字（`test/diary.test.mjs` 有两条断言把这条钉住）。

37. **半成品补齐：向量落库、权重真的参与截断、`last_used_at` 有出口。** 2026-11-17 按用户的「把半成品中的 5 点补上」一次修了五处「建了但没接通」的东西，五处的共同特征都是**数据层已经存在、消费端没接**：
   - `vec` 表建了但 `INSERT INTO vec` 全库零命中，第三档每次都把候选文本重新过一遍模型。现在 `rerankSemantic` 先按 `(kind, id, model)` 批量 `loadVectors`，只嵌入没缓存的那几条再 `saveVectors` 写回；查询本身仍每次现算（它是唯一每轮都不同的文本）。
   - 缓存的失效规则必须跟着原文走：`reindexFact`（事实改写）与 `saveDiary` 的 UPDATE 分支都 `dropVectors`，因为向量描述的是**旧句子**；`/settings` 的 `scope:'semantic'` 在 `model` 或 `modelPath` 变化时 `clearVectors()`，因为不同模型是不同向量空间（维度通常也不同），混着用等于拿两套坐标算距离。
   - `facts.last_used_at` 只被 `touchFacts` 写、从来没人读。`listFacts` / `topFacts` 的 SELECT 现在都带上它并映射成 `lastUsedAt`，事实页每行显示「命中 2026-11-17 10:20」或「从未命中」。
   - `memory_save` 的参数说明写着「Higher survives recall truncation」，但 `memory_recall` 走的是 `listFacts`（`ORDER BY updated_at DESC`），权重根本不参与。新增 `store.topFacts(limit)`（`ORDER BY weight DESC, updated_at DESC`）专供 recall，`listFacts` 仍然是面板的视图（新的在上）。**两套视图分开**是关键：面板要的是「最近改过什么」，recall 要的是「最要紧的是什么」。
   - `episodes.importance` 算了存了但排序不用。`rerankBigrams` 加了 `Math.min(0.06, (importance - 1) * 0.02)` 的微加成，和事实的 `Math.min(0.2, (weight - 1) * 0.05)` 同构——都只是加成，字面/语义相似度仍主导，否则一条重要但不相干的记录会挤掉正确答案。
   顺带把「编辑事实」的数据底座先铺好了：`store.updateFact({id, text?, subject?, weight?})` 与 `POST /facts` 的 `body.id` 分支（404 / 400 各一条），面板的行内编辑器还是下一轮的事。

---

## 5. 未完成 / 未测试

### 未完成（明确知道没做的）
- [ ] **事实不自动提炼**。`facts` 现在只有模型主动 `memory_save` 才写入；对话里没有「这件事值得记」的自动抽取。
- [ ] **facts 的作用域恒为 global**。表里有 `scope` 列但没写过别的值。
- [ ] **不能编辑已有事实与权重**（删了重写是现在的办法）。数据底座已经通了（`store.updateFact` + `POST /facts` 的 `body.id` 分支），缺的是面板那一半：事实页每行还没有「改成编辑态」的按钮。
- [ ] **没有导出 / 备份**（除了迁移时那一次自动备份）。
- [ ] **去重靠精确文本匹配**（同文本不同说法会各存一条）。
- [ ] **会话记忆隔离（方案 b）** —— 用户明说「先记着，现在不做」。设计已想好：设置层加 `isolation`（global / workspace / session），召回时按范围过滤、写入时把 scope 写成 `global` / `workspace:<hash>` / `session:<id>`；老数据不用迁移。
- [ ] **深度记忆页签里不能补写**（那里只读，因为可写的是按天归属的日记，跟单个会话对不上）。
- [ ] **面板的「某个日」还是按日历日切的，不是按日界窗口。** `/day` 与 `/calendar` 走的是 `store.episodesOfDay` / `episodeCounts`，也就是 `episodes.day` 列（落库时的日历日）；只有**写日记**那条链路用了 `dayWindow`。这是故意的取舍：日界是为了让日记读起来连贯，不是为了重写面板的时间轴，而且 `episodes.day` 是历史事实、拿窗口去覆盖会让「日界参数一改，历史全变」这种事发生在界面上。真要统一，做法是让 `/day` 也走 `episodesBetween(dayWindow(...))`，但得先想清楚事实（`facts`）那边怎么对齐——`facts.created_at` 同样只有日历日分桶。

### 未测试（需要在浏览器里亲眼看）
- [ ] **设置页「一天到哪里结束」卡**：开关/两个数字框改动后点保存是否真的落盘、7 天预览表是否随参数变化、「重算」是否重新拉 `/daycut`
- [ ] **夜尾巴真的跑一次**：熬夜到过午夜的日子，第二天投递时第一步是否真去读了前一天、写完是否真的调了 `diary_discard`、旧篇是不是真的没了、没过的校对是否真的没删
- [ ] **日界真的按时间戳变**：一个有凌晨活动的前一天，面板上那天的区间是否比平时的宽；改动「空档阈值」之后区间是否跟着变（同一个库、同一批时间戳）
- [ ] 日界关闭后，面板预览是否全部回到 `00:00 – 00:00`（普通日历日）
- [ ] 写日记提示词里「空档要写出来」那几条是否真的让日记变具体了（14 号那种「三点出头……隔了大半天」是否还会出现）
- [ ] 重写后的六个页签在**亮色主题**下的观感
- [ ] **向量缓存真的省事了**：开第三档搜两次，`stats.vectors` 第一次之后应该大于 0 并在第二次不再涨（新的候选才会涨）；概览页第五格「向量」是否显示这个数
- [ ] **事实页的「命中 / 从未命中」**是否随一次 `memory_search` 变化（用一条被命中过的事实看）
- [ ] 切换嵌入模型后 `stats.vectors` 是否归零、下一次搜索是否重新填满（清空缓存的唯一触发点）
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
- [ ] 预设卡片横排之后：宽窗口下一屏能放下几个、窄窗口折行是否正常、卡片之间高度是否因为预设名长短而不齐
- [ ] 模型下拉框里列出的是不是这台机器上真的能用的那些路由、选一个之后下一次投递是否真的换了模型、选回「跟随全局默认」是否真的回到全局那个
- [ ] 下拉框展开时被 `<optgroup>` 分组的样子（原生 `select`，各平台观感不同，但没有自绘的成本）
- [ ] 下一次日记的素材里是否真的出现 `## 标题（项目 X · 预设 Y）` 和 `开头：…`（`episodes.workspace` 从本次改动之后的行才开始有值，旧行仍是空）
- [ ] 「爱吃白饭的大肥鱼」写出来的东西是不是用户想要的味道（语气、具体度、有没有编造）
- [ ] 设置页「写日记的人格」保存后，下一次投递的会话头里 `agentPreset` 是否是 `deepmemory-diary`、人格段是否真的换了
- [ ] `deepmemory-diary` 出现在新建会话的预设选择器里是否合适（没有 bash 之类，只有文件读写）
- [ ] 下一次日记投递时，那个会话的工具清单是否真的从 79 降到九个（看会话里的工具调用列表，或日志里有没有 `deepmemory: could not narrow the diary tools` 这条 warn）
- [ ] 六个页签的模块面换成 `--dm-*` 之后，亮暗两套配色下**六个页签里同一种盒子颜色是否真的一致**（尤其是记忆页的 `.dm-panel` 与概览的 `.dm-card` 并排看）
- [ ] 预设卡片嵌在 `.dm-card` 里用的是 `--dm-inset`：暗色下能不能和父卡片分开（如果糊在一起，就把 `--dm-inset` 换成 `--dm-surface-sunken`）
- [ ] 「填入内置人格」按钮：点完输入框是否变成出厂文本、不点保存时刷新页面是否回到原来那段
- [ ] 在**群聊/IM 会话**里让模型删一条事实：`memory_forget` 是否真的删掉了（第 35 条修的是 `exec.session` 取值，只有真跑一次才知道这个上下文在 IM 里也带 `agent.session`）
- [ ] 删完之后面板里的那一条是否立刻消失、`facts.source_session` 里是否记着正确的会话 id（新增的记录才有值）
- [ ] 四个删除按钮（事实 / 片段 / 通用行 / 搜索页 / 日记页）弹的是不是同一句「真的要从本鲸脑海里删掉…吗ε＝ε＝ε＝(#>д<)ﾉ」

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
& 'C:\Program Files\DSH NEXT\resources\runtime\x64\primary-runtime\dependencies\node\bin\node.exe' --test test\store.test.mjs
# 其余：search / settings / diary / toolkit / scheduler / dayclock
# 注意：必须逐文件跑。`node --test test/` 在本机沙箱下会 spawn EPERM，
# 而且 workspace-write 下根本起不了子进程 —— 要带 danger-full-access。
```

- `test/smoke.cjs`：假 `window.__ModuleLoader__` + 假 React，验证 client bundle 能加载并注册**四个** slot（侧边栏图标 / 主面板 / 输入框角落开关 / 会话窗口页签）。`SMOKE_TAB=settings` 只渲染设置页，`SMOKE_NEEDLES="a;;b"` 断言文字出现。
- 迁移要在**真的库的副本**上先试：复制 `memory.db` + `-wal` 到临时目录，`new MemoryStore(db)` 看 `backup` / `pages` / `stats` / `rebuildFts`。
- 面板的浏览器验证：工具里没有浏览器自动化时，只能确认「bundle 能加载 + 四个槽位注册成功 + 每个视图能渲染不抛错」，观感必须人眼看。
- 日界这类「跟时钟有关」的逻辑，测试必须自己造时间戳（`store.saveEpisode({ at })` + `startOfDayMs(day) + hour*HOUR_MS`），不能拿 `Date.now()` 去测——那样跑在不同的钟点上会给出不同的答案。

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
