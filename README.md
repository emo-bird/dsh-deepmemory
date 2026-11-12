# dsh-deepmemory

深度记忆插件：跨会话的长期记忆 + 侧边栏控制台。

一个本地 SQLite 文件存四类东西——**事实**（facts，长期有效的一句话）、**片段**（episodes，双方说过的话——用户说的话和助手回的话都记）、**日记**（diary，一天可以有多篇，一次投递一篇）、**向量**（vec，可选的嵌入索引）。会话日志才是真源，这个库是可以在任何时候重建的缓存。

- 包名：`@emo-bird/dsh-deepmemory`
- 插件 id：`deepmemory`
- 数据目录：`${DSH_HOME:-~/.dsh}/deepmemory/`（`memory.db` + `settings.json`）

## 它解决什么

普通会话的记忆只在上下文窗口里。这个插件把「换一个会话还用得上」的东西存下来，并且在下一轮对话里用一句极短的话告诉模型「你有记忆，去哪查」，内容本身要模型**主动调工具**取。

不每轮注入全文是刻意的：注入成本是常数，查询词由模型按当前对话决定，比固定注入更准。

## 三档检索

同一次搜索的三个阶段，不是三选一：

| 档 | 做法 | 成本 | 作用 |
|---|---|---|---|
| 1 | FTS5 `tokenize=trigram` + BM25 | ~1ms | 中文子串召回，保证不漏 |
| 2 | 中文 bigram 余弦重排 | ~5ms | 换了说法的也能往前提 |
| 3 | 嵌入向量余弦重排 | 取决于模型 | 语义相近但用词不同的 |

档 1+2 永远开，零依赖。档 3 默认关闭，面板里开启后需要模型；运行失败自动降级到档 2，不会让搜索整体失败。

**换嵌入模型**：`vec` 表只是派生索引，删掉重算即可；原文不受影响。

## 写入与注入的门控

四层，越具体越优先：

```
预设的新会话默认  >  预设的子代理默认  >  会话覆盖  >  子代理覆盖
```

最上面那层来自会话所属的预设（standard、minimal、deepmemory-diary……各自一套），往下依次收窄；没覆盖到的键就沿这条链往下问，问到最后一层仍没有就是内置默认值。

每层四个开关：**读记忆** / **写记忆** / **计入日记** / **删除记忆**。

- **读**：管 `memory_search` / `memory_recall` / `diary_read` 能不能用
- **写**：管你说的话、它回的话要不要存成片段
- **日**：管这个会话的内容要不要进当天的日记
- **删**：管能不能删记录（唯一默认关闭的一维）

「删除记忆」是唯一不可撤销的一维，**内置默认关闭**：打开之后，`memory_forget` 才允许清空某个会话的全部原始片段，事实（facts）不动，因为事实已经脱离会话独立存在。面板上不再有这个入口（见下面「会话」页），逐条删除不受它约束。

存储时只写「与父层不同」的键，所以「跟随上层」是默认状态，文件不会膨胀；把值改回与父层相同，那个键会留成 null 墓碑而不是删掉——删掉的键下次列表时会被重新钉住，「恢复继承」就永远失效。

预设那一层是**新会话的起点**：会话创建时读一次当时的值，钉成自己的，之后改预设不再影响任何已有会话——这一条是整个设计的关键，不然你调一个默认值就会把历史会话一起改掉。子代理是链上最后一层，没被单独改过时跟随父会话。

四个开关之外，日记会话还有一条**白名单**：`syncAgentGating` 认出「工作目录是 `~/.dsh/deepmemory/diary`」的会话时，调 `tools.restrict({ allow })` 把它能看到的全局工具压到九项——`diary_read`、四个 `memory_*`、`read` / `write` / `edit`。`restrict` 只接受**全局**注册的工具名（scope-local 名会让整个过滤器失败），所以名单会先和 `ctx.tools.definitions()` 的真实全局名字取交集；`diary_write` / `diary_material` 是挂在 agent 作用域上的，按宿主规则「scoped registrations remain visible」本来就在，不用进名单。这条限制和四个开关是**交集**关系：开关关掉「写」，`memory_save` 仍然会消失。

原来这一类会话能拿到 79 个工具（bash、浏览器、子代理、工作流、待办全在里面），一次日记投递只需要其中三个；现在剩下的都只是它真会用的。

## 工具

普通会话能看到五个：

- `memory_search` — 关键词检索事实/片段/日记
- `memory_recall` — 概览：重要事实 + 最近一篇日记
- `memory_save` — 存一条事实
- `diary_read` — 读日记（不给日期就读最新一篇），受该会话的**读**开关管
- `memory_forget` — 删除事实/片段/日记/整个会话的片段。**唯一不可逆的动作**，所以只在开了「删」的会话里生效，否则直接拒绝

`memory_forget` 的「清空某个会话」分支走同一套门控（每会话的 `forget` 开关，默认关），区别只是调用方是模型还是人；面板上那个红字链接已经撤掉，面板只留逐条删除。

另外两个**只存在于定时日记会话**里，普通会话根本不会收到它们的定义：

- `diary_material` — 取当天素材，已按每会话的**日**开关筛过
- `diary_write` — 写一篇日记

判定方式不是猜：日记任务跑在 `<数据目录>/diary` 下，插件只在 `agent/created` 时看到工作目录等于这个目录，才把这两个工具挂到该 agent 的作用域上。所以「工具列表里没有 diary_write」是结构性的，不靠模型自觉。

## 日记

**每一天都可以累积，篇数不限；一次投递写一篇新的**：目标日即使已经有日记也要再写一篇——上午那次只看得见上午，晚上的那次必须补上下午发生的事。已有页面是别人写的，不改写、不覆盖、不合并。投递的来历（origin，就是投递会话的 id）相同时才按覆盖处理，所以同一次投递重复调用不会越写越多，而不同投递各留一篇。表用 `id` 做主键、`day` 上建索引——早期版本把 `day` 当主键，一天只能有一行，这就是「同日多份」改掉的地方。升级时旧库会被**自动备份**（`memory.db.bak-<时间戳>`），旧行原样搬进新表，`diary_fts` 一起重建，失败则整体回滚。

**跨会话整合**：把当天所有项目、所有会话、飞书与 Web 的片段汇总成一篇散文，不是按会话列条目。当天没有对话就不写。日记任务自己那个会话的独白不计入素材，否则它会把自己的开场白当成「今天唯一的对话」。三重排除：运行期集合、meta.diarySessions 持久表（重启后仍生效）、以及工作目录等于 diary 的会话头扫描——最后这条在插件启动时补跑一次，用来覆盖规则存在之前就写进库的旧行。

**哪些对话进日记由「日」开关决定**：关掉某个会话的「日」，它的片段照常存（写开关管的是存不存），但不会出现在当天的素材里。这个筛选发生在 `dayDigest(store, day, { include })`，由 index.js 传进来的 `diaryAllowed` 决定。

**素材里带着「这是哪个项目」**：早期版本只把每段对话标成 `## 一段对话`，于是日记读起来像「今天发生了很多事，但不知道是在做什么」——事情都在，项目没了。现在每条片段落库时都记下工作目录（`episodes.workspace`，取自会话头的 cwd），取素材时再补上两样宿主已经有、但库里查不到的东西：会话的**标题**和**首句**。`sessionLabels()` 从 `sessionPersistence.list()` 拿会话头、从 `sessionProjectionCache.cachedSnapshot` 拿 `title` / `titleInput.first.text`（零 I/O），一行对话于是变成：

```
## 重做深度记忆面板（项目 dsh-deepmemory · 预设 standard）
开头：把面板重做一下，按 docs/1.xml 那版布局
- 14:20 面板的页签从七个收到五个
```

项目名取 cwd 的最后一段（`projectOf`），预设 id 一起带上——同一天在两个项目之间来回切也读得出来。`composeInstruction` 因此多了一条要求：每段对话都带项目名和会话标题，写的时候要让人看出这一天在做什么。**这也顺便回答了「要不要打开会话标题刷新那个插件」**：宿主现在用的是「按首条提示生成一次标题」（`@deepseek-ai/dsh-session-title-first-prompt-llm`），所以长会话的标题停在一开始那句上；`@deepseek-ai/dsh-experimental-session-titles-bundle` 会随着新提示持续刷新标题，对日记确实更友好（每次刷新是一次小模型调用）。但它不是根因——项目名来自 cwd，跟标题插件无关；想开就在插件页装它，不开也能读。

由 DSH 定时任务在固定时间开一个新会话（工作目录 `<数据目录>/diary`），模型先调 `diary_material` 取素材、写完调 `diary_write` 落盘。插件本身不含任何模型调用。

- `lib/diary.js` 的 `composeInstruction(day)` 是那段指令，不传 `day` 时要求模型按投递时刻自己算日期；素材走工具，不塞进 prompt
- `targetDay()` 是那条日界规则：04:00 之前算「昨天」，04:00 之后算「今天」（`DAY_CUTOFF_HOUR`）
- `renderDigest` 按会话分组、按时间排序，每段对话带标题 / 项目 / 首句，单条截断 400 字，最多 400 条
- 日记日界用**本地时间**（`localDay`），`store.js` 里 episodes 的 `day` 字段也是本地日期——用 UTC 会把凌晨的消息记到前一天

**补写和重写只由人发起，写手不自己找活**：定时任务那一次只写它自己那一天，不扫「最近几天缺不缺」，也不去查哪个日子还没有日记。早期版本让模型自己补缺，结果是投递到一半先发现今天没素材、又发现昨天已经写过，然后就结束了——用户要的是「我叫你写哪一天，你写哪一天」。

- **补写**：「记忆」页选某一天、选「日记」，那天没有日记时白天会出现**补写**按钮，走 `POST /backfill { day }`：临时建一个只写这一天的一次性任务（`kind: 'after'`，2 秒后投递），把 `day` 写进那一次的提示词。
- **重写**：日期标题行右侧的**重写这一天**按钮，走 `POST /backfill { day, mode: 'rewrite' }`。它**不覆盖**原来那篇，而是给这一天再加一篇——同一件事换个时候再写一遍，旧的那篇留着可读。
- 两个按钮都不会去跑定时任务：那条提示没有日期，跑起来只会写「今天」，写不出你点的那个旧日子。
- **点完会锁住，直到写手交稿**：`POST /backfill` 只是排了一个一次性投递，写手在一个新会话里跑，过程没有任何推送回来——所以唯一的诚实信号是「那一天多了一篇」。按钮点下去就变成「写手中…」并禁用，旁边一行说明正在写哪一天；面板每 4 秒读一次 `/day`，看到页数变多就解锁、刷新这一天并告诉你有几篇。**锁是按天记的**：正在写 12 号时切到 11 号，11 号的按钮照常能用，只有 12 号自己还在等。四分钟还没交稿就解锁并如实说「写手还没交稿」，可以再点一次（按钮一直锁着的话，用户会以为卡死，然后去别处重复点）。
- **错过的那次不自动补**：宿主在停机后只会补投最新一次错过的发生（见下面的定时任务一节），所以那天的日记会缺。面板在概览顶端和记忆页顶端各显示一条提醒「定时任务错过了 YYYY-MM-DD」，旁边带一个只补那一天的**补写**按钮；那天有了日记，提醒自己就不见了，不需要点「已读」。

## 侧边栏面板

`sidebar.panellist` 的 id 与 `main` 的 key 都是 `deepmemory`——侧边栏只认 id 去解析主面板。

五个页签：**概览**、**搜索**、**记忆**、**会话**、设置。

面板右上角有一个搜索框，回车就跳到「搜索」页跑一次检索（和工具走同一条 `MemorySearch`
流水线，所以面板能搜到的和 agent 能搜到的是同一批），结果按事实 / 片段 / 日记打标签，
命中的词高亮，可以直接删。搜索是独立页签，所以搜完还能切回去看别的，不必先清空输入框。

检索是模糊的：三个字以上的查询走 FTS5 trigram，短查询补一遍按词的 `LIKE`，
连成一串的查询（「水母颜色」）在没有整体命中时会退化成字符 bigram 重试——
所以两三个字的词、只出现在长句里某个片段的词，都还能捞出来，而不是只有完全一致才命中。

**「概览」**是 `docs/1.xml` 里那一版布局：顶上一行指标，下面是**近一年的贡献墙**（照 GitHub 主页那种排法：一列一周、一格一天，颜色深浅按当天的片段 + 事实数分四档，档位边界取当天数据的 25/50/75 分位，所以安静的日子也看得出层次；有素材却没写日记的那天，格子带一圈警示色描边，点任意一格跳到记忆页的那一天）。格子上的说明悬停即出、自己画：一行是日期，下面三行分别是片段 / 事实 / 日记的条数，缺口那天多一行警示语——不用浏览器原生 `title`，那个要等将近一秒才弹，而且只有一行。再往下两栏——左边最近 4 篇日记，右边最近 3 条事实、最近 5 条片段，三栏用的是**同一种行**（类别标签 + 时间 + 两行截断正文 + 命中词高亮），点一行直接跳记忆页的那一天；不再有「展开全文」和「去看这一天」两个按钮，正文靠两行截断对齐，两栏底边落在同一条线上。底部的「重建检索索引」会回来一行结果（事实 / 片段 / 日记各重建了多少条），不再是一闪而过。

**「搜索」**页把检索参数摆出来了：搜索框、时间范围（全部 / 近 7 / 30 / 90 天）、类别（事实 / 片段 / 日记，至少留一个）。结果**按类别分组依次展示**，命中的词高亮，点条目跳到记忆页的那一天，右边可以直接删。

**「记忆」**页是日历 + 目录树 + 右栏内容：

- 左栏日历，一天一格。格子的底色深浅表示当天的活跃度（相对当前这一页里最忙的那天分四档），**当天有素材却没有日记的日子右下角有一个小圆点**——那是缺口标记，一眼就能看出哪天漏了。
- 日历下面是一棵**目录树**（照着工作区侧边栏的样子做的：折叠箭头 + 图标 + 名字 + 计数）：**日记 / 片段 / 事实**——片段排在事实前面，先把有东西的那一项摆在眼前。片段和事实没有子项，点了右栏直接铺当天全部；**日记有子项**，子项是当天的每一篇（同日可以有多篇，并列成「第 N 篇 · 14:32」，最新的一篇排在最上），点其中一篇右栏只显示那一篇。
- 右栏显示「选中那天 + 选中类别」的内容。选了「日记」而那天没有日记时，右栏是空态「这一天没有日记」加一个**补写**按钮。
- **所有列表都是新的在上**：片段、事实、日记页一律按时间倒序，刚说过的话就在眼前。日历的空格与缺口标记不受影响，仍然是按日期排。日记素材（`dayDigest`）为了读起来像一天，内部会翻回正序再交给模型。

「会话」页和其余几页同一套版式：两块 `.dm-panel`，一块「会话」、一块「子代理默认值」，都不再是表格。

- 一行一个会话：标题、`sessionId`、preset、首句（两行截断）。**点这一行就打开这个会话的记忆**——和概览里点一条片段是同一个动作，所以原来那个「看片段」超链接没有了。
- 四个开关折成右边一枚小按钮 `n/4`，悬停能看到四项各自的开/关。**点它就是改这四项**：弹出一层菜单，四个开关各一行（读 / 写 / 日 / 删），点一下即生效，另有一行「恢复继承」（写的是 null 墓碑，不是删键）。这枚菜单和对话输入框角落那枚、设置页每个预设下面那两枚是**同一个组件**，所以三处的字重、行高、配色、悬停底色完全一致——它照抄的是宿主 `Menu` 原语的规则（`--dsw-menu-surface-fill`、`--dsw-elevation-prominent`、`--dsw-alias-interactive-bg-hover`）。
- 点行本身（不是那枚按钮）打开这个会话的记忆——和概览里点一条片段是同一个动作，所以原来那个「看片段」超链接没有了。**「清空本会话记忆」已经移除**：清空整段历史是破坏性动作，不该混在列表里的行内链接上；要删某条就走记忆页或搜索页的删除，逐条可控。

**首句**优先取 `episodes` 里该会话最早的一条 user 记录（`ROW_NUMBER()` 取，不用 `MIN(created_at)` 自连接——同一毫秒的两条会因此挑错）；没有记录的旧会话回退到 `sessionProjectionCache` 的 `titleInput.first.text`，那是宿主用来生成标题的原始提问，所以老会话也有首句。会话清单来自 `sessionPersistence.list()`，标题走 `sessionProjectionCache.cachedSnapshot`（零 I/O），子代理会话被排除。

「设置」页：**按预设的默认权限**、写日记的人格与模型、每日日记任务、语义检索依赖与推荐嵌入模型。

**权限不再有「全局默认」那一栏**。每个预设（`standard`、`minimal`、以及插件自己注册的 `deepmemory-diary`……）各有一组「新会话」和「子代理」的读写日删默认值：会话创建时读一次就归自己所有，之后改预设只影响将来的会话；子代理先跟父会话，父会话没有覆盖时才看预设里那一行。落在 `settings.json` 里的永远只是「和上一层不同的那些键」，所以「继承」是文件的自然状态，一调回默认那一行就整个消失。一个预设一块，横排成卡片（`repeat(auto-fit, minmax(176px, 1fr))`），窄了就自动折行——早先是竖着一条条铺，装上几个预设就把设置页顶下去了。

**写日记的人格**也只影响日记：那段话写进 `deepmemory-diary` 这个预设的 persona，配上一个模型选择（默认「跟随全局默认模型」，选了具体模型才切）。改完立刻重挂预设，下一次投递就按新的人格写。

这段话**存在设置文件里，不是写死在代码里**。第一次激活时插件把内置文本写进 `settings.json` 的 `diary.persona`，之后设置页那个输入框显示的就是日记真正在用的那段话——没有「留空才用内置」这种隐含规则要记。想回到出厂那版，点输入框下面的「填入内置人格」，再点保存；宿主通过 `snapshot.diaryDefault` 把内置文本交给面板，所以那个按钮永远拿得到最新的出厂版本。

内置的那位是 **爱吃白饭的大肥鱼**：一条住在电脑里的鱼，白天藏在显示器后面看人敲键盘，晚上替他把这一天记下来；第一人称「我」，写的是「他」；平实、慢、具体，不列条目、不整段加粗、不用「今天真是充实的一天」收尾，可以自嘲可以有一点颜文字但别每句都撒；抓具体的事（改了什么、卡在哪里、几点才想起来吃饭），不写「处理了一些事情」；可以带情绪和判断，但不编造素材里没有的事，记不清就写记不清。语气是从 `dsh-companion-preset`（小肥鱼）那套规则里收过来的，只是把「聊天」换成了「记事」。

**模型是从下拉框里选的，不是手打的**。那个下拉框的数据来自宿主自己的 `llm` 服务：面板读 `GET /api/deepmemory/model-catalog`，插件在宿主里调 `listProviders()`（没有可用路由时退回 `listConfigurableProviders()`），再对每个 provider `await listModels(id)`，拼成 `{providers:[{id,name,models:[{id,name}]}], default:{provider,model}|null}` 返回；`default` 是 `agentDefaultModel.currentSelection()` 报的全局默认，也就是下拉框第一项「跟随全局默认（provider / model）」显示的东西。选项按 provider 分 `<optgroup>`，一个 provider 一个组。这样做是为了不让人去背 provider id 和模型 id——手填一个拼错的 id 不会报错，只会在投递时静默回退。已经保存、但宿主现在不再广告的一对仍然会留成一项「（列表里没有）provider / model」，否则 `<select>` 会悄悄跳到第一项，下一次保存就把模型改了。宿主一个模型路由都没有、或者这条路由读不到（比如插件跑在没有 `llm` 服务的环境里）时，面板退回两个手填输入框，并说明原因。

删除的入口都在「记忆」页右栏：每条事实、每条片段、每一篇日记右边都有「删除」。搜索页的结果也能直接删。这些都不需要开会话的「删」开关，只有模型侧「清空某个会话的全部片段」受它约束——那是唯一影响一片历史的动作。日记与片段删除前会弹一次确认。

## 配色与主题

面板和输入框角落的小开关都只引用 `--dsw-alias-*` token，不写死任何颜色，所以亮色和暗色都跟着走，不需要媒体查询。

**五种盒子只有一处颜色定义**：五个页签里的模块原来是各取各的别名——卡片和统计格用 `settings-card-fill`、记忆页的面板和模型行用 `bg-layer-1`、预设卡片用 `bg-layer-2`——于是同一个面板里出现三种灰。现在 `.dm-page` 上声明一层薄薄的接口，所有盒子只读这四个名字：

| 变量 | 值 | 谁用 |
| --- | --- | --- |
| `--dm-surface` | `settings-card-fill`（缺省回退 `bg-layer-1`） | 顶层模块：`.dm-card` / `.dm-stat` / `.dm-panel` |
| `--dm-surface-stroke` | `settings-card-stroke`（回退 `border-l1`） | 上面前三种的描边，以及下面嵌套盒的描边 |
| `--dm-inset` | `bg-layer-2` | 嵌在模块里的盒子：`.dm-preset-card` / `.dm-model` / `.dm-input` |
| `--dm-surface-sunken` | `bg-layer-2` | 需要「凹下去」的行，比如表格条带 |

改一处，整张面板在亮暗两套配色里一起变。语义色不在这套接口里：`.dm-notice` 仍然用 `state-warn-*`（它是提醒，不是一个面），`.dm-menu` 仍然照抄宿主 `Menu` 原语那几个变量（`--dsw-menu-surface-fill` 等）。

**为什么不用 `prefers-color-scheme`**：主题包把亮色变量声明在 `body` 上，暗色声明在 `body[data-ds-dark-theme]` 上，主题是用户在设置里选的，跟系统无关。用媒体查询反而会和用户的选择打架。

三组容易混淆的 token：

| token | 含义 | 不能怎么用 |
| --- | --- | --- |
| `brand-primary` | **单色**（亮色近黑 `#0f1115`，暗色近白）。是对比填充色 | 不能当蓝色 accent 用 |
| `button-primary-fill` + `label-primary-foreground` | 必须成对：前者填底，后者写字，配色翻转后对比度不变 | 不能只用一个 |
| `link` | 真正的蓝色，两套背景都清晰 | —— |

其余用到的：`label-primary` / `label-secondary` / `label-tertiary` 三级文字，`border-l1`（发丝线）/ `border-l2`（常规边框），`bg-base`（页面）/ `bg-layer-1`（输入框）/ `bg-layer-2`（次级面），`settings-card-fill` + `settings-card-stroke`（卡片面 + 描边，宿主就是用这一对画设置卡片的），`interactive-bg-hover`（悬停），`state-error-primary`（错误）。圆角用 `--dsw-radius-xs/sm/md`。

**样式是注入的 `<style>`，不是内联 `style`**。原因很实际：`hover`、`:focus`、过渡、滚动条样式都无法内联表达。注入时带 `data-plugin-css` 标记，插件重载（HMR）时不会堆叠重复样式表。类名统一 `dm-` 前缀。

侧边栏图标用 `fill: currentColor`，颜色交给宿主按钮决定——同一份 SVG 在亮/暗侧边栏、选中/未选中四种状态都正确。

**包图标和侧边栏图标是同一个图形。**

| 文件 | 用途 | 画法 |
| --- | --- | --- |
| `icon.svg`（包根目录） | bundle 元数据图标，插件列表/能力面板用 | 512 网格，粉色 `#F472B6` 实心，一道高光用 `fill-rule="evenodd"` 打穿 |
| `lib/client.js` 里的 `SidebarIcon` | 侧边栏按钮 | 同一份 path 数据，换成 `currentColor`，尺寸取 slot 的 `size` prop |

图形是一只水母：圆顶帽、四根带钩的触手，帽子上一道镂空高光。**整只水母是一条 path**——帽子、触手、高光都在同一串路径里，高光是挖空的子路径而不是叠一个白色图形，所以放在任何底色上都成立，也仍然只有一个颜色。

侧边栏那份只换颜色（`#F472B6` → `currentColor`），几何完全不动，两处露脸认得出是同一个东西。

## 输入框角落的记忆开关

四个开关只有一个画法，也只有一个组件（`FlagsMenu`），三个地方都用它：

| 位置 | 槽位 | 改的是哪一层 |
| --- | --- | --- |
| 对话输入框右下角 | `conversation.input.right`（`order: 30`） | 当前会话（`scope: 'session'`） |
| 「会话」页每行右侧 | 面板内部 | 那一行对应的会话 |
| 「设置」页每个预设下面两行 | 面板内部 | 那个预设的「新会话」/「子代理」默认值 |

每处都只是「一枚小按钮 + 一层菜单」：

- 按钮是 24px 高的 `记` + `开着的数量/4`，和旁边模型、模式选择器同一行、同一个高度。
- 菜单是**门户到 `document.body`** 的（`react-dom` 的 `createPortal`）：输入框那一列会裁剪溢出，宿主的弹层也是这么做的。位置按触发按钮的 `getBoundingClientRect()` 算，上方放不下就翻到下方，左右都夹在视口内，滚动和缩放时跟着走。
- 菜单**照抄宿主 `Menu` 原语的规则**：`--dsw-menu-surface-fill` 底、`--dsw-menu-backdrop-filter` 模糊、`--dsw-elevation-prominent` 投影、`--dsw-radius-lg` 圆角、行高 20px / 内边距 5px 8px / 悬停 `--dsw-alias-interactive-bg-hover`。所以它和 DSH 自己的菜单是同一个观感，亮暗两套都成立（这里没有一处写死颜色）。
- 四行菜单各带单字前缀（读 / 写 / 日 / 删），右边写「开 / 关」，开着的那行字和前缀转成 `state-success-primary`。最后一行是「恢复继承」：会话层写 null 墓碑，预设层则把上层的值原样写回去，于是差值归零、那一项从文件里消失。
- 它和面板是**同一份数据、同一个路由**（`/session-flags`、`/settings`），改一边另一边立刻跟着变：两个组件都把加载函数注册进同一个 `flagWatchers` 集合，谁点完都广播一次。

## 新建会话页

新建会话那一行**不再有记忆开关**（原 `conversation.hero.options` 的 `deepmemory-hero-flags` 已移除）。会话还不存在时，四个开关没有可写的地方；现在这一段由「设置」页的**按预设默认值**负责：选哪个预设，新会话就带着那一行的默认值出生，诞生之后再改预设不影响它。

## 日记定时任务

面板「设置」页可以开启，落到 DSH 的 `schedule` 服务（`kind: 'daily'`），默认 `23:40` / `Asia/Shanghai`，`target` 是 `{ kind: 'new', create: { cwd, agentPreset } }`——每次投递开一个新会话，不会写进聊天里。

- 任务的唯一身份是标题 `深度记忆 · 写日记`；`ensureTask` 按标题查目录，已存在且时间相同就直接返回，时间不同则 `edit` 改期，不会造出第二个任务
- `target` 的 `agentPreset` 是 `deepmemory-diary`（见上一节），没传就由插件补上，所以日记会话天然是「人设 + 时钟 + 文件读写」那一套
- 提示词里**不写日期**：每次投递都是同一段话，日期由模型按投递时刻自己算（04:00 之前算昨天，之后算今天）。早期版本把当天日期烤进 prompt，一次写死之后就永远是那一天，日记也就再也写不出来了；`ensureTask` 现在会检查 prompt 里有没有 `PROMPT_MARK`，没有就就地修好。这条标记跟着指令的含义走——指令改了意思，标记就要改，好让旧任务在下次激活时被重写
- 当天没素材时不写：prompt 里明确要求回「今天没有素材，不写日记」且不调 `diary_write`
- 插件自身不发任何模型调用，也不轮询——一切由 DSH 的定时系统驱动

## 写日记专用预设

日记会话不再落在 `standard` 上。插件在激活时自己注册一个预设 `deepmemory-diary`（`agentPresets.register(...)`，名字「深度记忆 · 写日记」，`order: 90`），定时任务与补写的 `target.create.agentPreset` 都指向它。

- **人格是它自己的**：预设里挂 `@deepseek-ai/dsh-persona`，`prefix` 来自设置页那段话。那段话在第一次激活时被写进 `settings.json`（`diary.persona`），之后就是唯一事实来源——代码里那份 `DEFAULT_DIARY_PERSONA` 只作为种子和「填入内置人格」按钮的来源，不再是运行时取值。你的普通会话是什么人格完全不受影响，反过来也一样——人设是预设里的一个字段，不是进程级开关。`complete` 保持 `false`：那样只会替换部署身份，通用工具说明和**运行时时钟**仍然渲染，而日记要靠时钟算日期。
- **工具只留需要的**：预设里只有 persona、`@deepseek-ai/dsh-time-context`（时钟）和 `@deepseek-ai/dsh-tool-fs`（文件读写）。记忆与日记工具（`diary_read` / `diary_material` / `diary_write` / `memory_*`）来自本插件在 Host 层注册的工具，**不需要也不应该在预设里声明**——预设只决定这个 agent 额外挂什么，宿主级工具对所有 agent 都可见。另外插件还会给这类会话加一条 `restrict({ allow })` 白名单（见上面「门控」那节），把全局工具压到九项，于是它不再背着一整套 79 个工具的 schema，只留它真正会用的那几个。
- **模型可以单独指定**：设置页的模型下拉框选一个 `provider / model`（数据来自宿主 `llm` 服务的 `listProviders()` + `listModels()`），插件在 `agent/created` 时对落在该预设下的会话调 `agent.model.select(...)`；选「跟随全局默认模型」就不动。
- **改人格立刻生效**：`POST /settings { scope: 'diary' }` 先落盘，再 `remountDiaryPreset()`——先 dispose 旧注册再 `register`，所以不会越改越多。注意 DSH 的规则是「已有的会话保留它启动时的预设版本」，所以改完的生效范围是**下一次投递**，正在跑的日记会话不会中途换人格。
- 这个预设出现在新建会话的预设选择器里（它就是一个正常注册的预设），所以你也可以直接开一个会话用它——里面没有 bash 之类的工具，就是一个只会读写文件、带着记忆的对话。

## 面板接口

面板不走 typert Remote（纯 JS 手写包没有 generator 描述符），走 Connection 服务的精确 Fetch 路由：

```
GET  /api/deepmemory/stats
GET  /api/deepmemory/activity?days=371
GET  /api/deepmemory/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD[&sessionId=…]
GET  /api/deepmemory/day?day=YYYY-MM-DD[&sessionId=…]
GET  /api/deepmemory/facts?limit=200
GET  /api/deepmemory/episodes?limit=100&day=YYYY-MM-DD
GET  /api/deepmemory/diary?limit=30[&day=YYYY-MM-DD][&offset=…]
GET  /api/deepmemory/search?q=…&kinds=fact,episode,diary&from=…&to=…&sessionId=…
GET  /api/deepmemory/settings
GET  /api/deepmemory/sessions
GET  /api/deepmemory/session-flags?sessionId=…
GET  /api/deepmemory/dependency
GET  /api/deepmemory/models
GET  /api/deepmemory/model-catalog
GET  /api/deepmemory/diary-task
POST /api/deepmemory/settings       { scope: preset|preset-subagent|session|subagent|semantic|diary|clear-session, id, flags, diary }
POST /api/deepmemory/session-flags  { sessionId, scope?: 'subagent', flags | clear: true }
POST /api/deepmemory/forget         { kind: fact|episode|diary|session, id | day | sessionId }
POST /api/deepmemory/facts          { text, subject, weight }
POST /api/deepmemory/rebuild
POST /api/deepmemory/dependency     { action: 'install' }
POST /api/deepmemory/models         { action: install|remove|reveal, model }
POST /api/deepmemory/diary-task     { action: 'enable', time?, zone?, cwd?, agentPreset? } | { action: 'disable' } | { action: 'run' }
POST /api/deepmemory/backfill       { day, mode?, agentPreset? }
GET  /api/deepmemory/missed
```

`/calendar` 与 `/day` 都收一个可选的 `sessionId`，收到就整个页面窄到那一个会话：日记不出现（一篇日记属于「哪一天」，不属于「哪一句话」），事实与片段按 `source_session` / `session_id` 过滤，缺口标记也不再算——补写是全局的事，不在会话页里提供。会话窗口里的「深度记忆」页签就是同一个 `/day` + `/calendar`，只是固定带上 `sessionId`。

`/settings` 的 `scope` 说明：`preset` / `preset-subagent` 写某个预设的默认值（`id` 是预设 id），`session` / `subagent` 写某个会话自己那一层（`id` 是会话 id，预设由插件按会话查出来，不用前端传），`diary` 写写日记的人格与模型（`{ persona, provider, model }`，落盘后立刻重挂预设），`semantic` / `clear-session` 各自一个开关。**`global` 和 `backfill` 都不存在了**：进程级的「全局默认」被预设层取代，「写日记时顺带补一周」那个开关随自动补写一起删掉了——补写现在只有人在面板里点。

`/activity?days=371` 供概览那面贡献墙用（`days` 夹在 1..400）；它不做「一天一次」的三连查，而是走 `MemoryBoard` 之外的 `store.activityBetween(fromDay, toDay)`，一次拿三个分组计数。每个格子还带一个 `missing`：当天有片段或事实、却没有日记。

`/backfill` 是「记忆」页那两个按钮：`{ day }` 是补写（那天没有日记），`{ day, mode: 'rewrite' }` 是重写（那天已有日记，再写一篇新的，旧的留着）。两者都新建一次性投递、都不跑定时任务，`202` 加 `mode: 'once'`、`rewrite` 和 `taskId`；`400` 是 `day` 不成 `YYYY-MM-DD`，`409` 是宿主拒绝投递，`503` 是没有 `schedule` 服务。

`/missed` 是那条错过的提醒：读定时任务最后一次投递的 `scheduledAt` 与 `deliveredAt`，两边各自按 04:00 日界折算成「目标日」，不相等就说明前一个目标日那一次被跳过了；那天的日记已经存在、或者这次错过已经超过 30 天，就什么都不返回。返回一条就够面板显示一行字加一个补写按钮，不需要任何「已读」状态。

`GET /dependency` 的响应里带一个 `progress`：`{ phase: 'idle'|'installing'|'done'|'error', bytes, totalBytes, startedAt, finishedAt, error }`。npm 不报字节，所以 Host 在装的时候每秒量一次 `vendor/` 的大小当作进度，`totalBytes` 是估算的 600 MB（实测一次完整安装约 575 MB——onnxruntime-node 把每个平台的 native 运行时都装了）。面板每 900 ms 拉一次这个接口，把「安装中…」变成「12.4 MB / 320.0 MB（4%）」。这是一个进度提示，不是倒计时；装完显示的是实测落盘大小。

**必须注册到 `connection.fetch.register`，不是 `webServer.register`。** `/api` 这个 prefix 由 `client-connection` 独占，只有它会在把请求交给 handler 之前做浏览器信任校验并把 Peer 传进来；直接在 webserver 上挂一条 prefix 会在那道栅栏之前应答。重复注册同一 path 会抛错，所以同一路径的 `GET` 与 `POST` 分成两条路由；`GET` 要和 `HEAD` 一起声明，否则 HEAD 会掉到 404。

浏览器端 `fetch` 同源、带 authority-bound cookie，所以不需要额外鉴权。

## 提示词

「什么时候查、什么时候记」由插件自己写（`lib/index.js` 的 `guidanceText()`），注册在 `systemPrompt.section` 上，不塞进任何 preset 的 persona——换 preset 不该换掉记忆的用法。

那段「该查就去查」的督促单独占一个 section（`deepmemory:recall-nudge`），并且**只在「读」开着的会话里存在**：它的 `text` 是个函数，拿得到本次装配的 `agent`，读开关关着就返回空串；空 section 在渲染前会被丢掉，所以关掉时那段话根本不进提示词，不是进了不生效。装配发生在每一轮开始时，改开关下一轮就换。

另外注册一个 `systemPrompt.context`（order 900），每步只说一句：

> 长期记忆：N 条事实、M 条过往片段、K 篇日记。最近一篇日记是 YYYY-MM-DD。需要细节时用 memory_search 查。

### 第三档依赖不进 profile

`@huggingface/transformers` 会拉 `onnxruntime-node`（unpacked 约 575 MB，含各平台 native 库）。装进 profile 会让每次 DSH 启动都慢，而且装失败会把 profile 弄成半坏状态。所以：

- 装进本 bundle 自己的 `vendor/`（已在 `.gitignore` 里），npm 缓存也放 `vendor/.npm-cache`——默认缓存在系统临时目录，受限环境下会写不进去，装到一半失败比慢更糟
- 面板「设置 → 语义检索」有安装按钮，`POST /api/deepmemory/dependency {action:'install'}` 走 `npm install`，进程内串行化（两次点击不会起两个 npm）
- 无头环境用 `node scripts/install-embed.mjs`
- 依赖缺失时 `createEmbedder()` 返回 `undefined`，**不抛错**，第三档保持关闭；开关仍然可以拨，只是不生效

**模型是另一回事。** 依赖装好只代表代码能跑；模型要单独下载，默认从 `huggingface.co` 拉 `Xenova/bge-small-zh-v1.5`（`BAAI/*` 的原始仓库只有 PyTorch 权重，没有 `onnx/`，直接指过去会 404）。国内常连不上，此时：

- 在面板同页把「下载镜像」填 `https://hf-mirror.com`（写进 `semantic.remoteHost`，也可用环境变量 `DSH_DEEPMEMORY_HF_HOST`）
- 或者自己把 ONNX 目录放进 `vendor/models`，再把「本地模型目录」指到它（写进 `semantic.modelPath`）

两条都失败时第三档就保持关闭，日志里会说明原因。注意本机实测：镜像能取 `config.json`/`tokenizer.json`，但 `.onnx` 走的是另一个 CDN，Node 的 TLS 校验在这台机器上过不去（`UNABLE_TO_VERIFY_LEAF_SIGNATURE`），所以模型要手工放。

## 推荐嵌入模型

面板「设置」页的「推荐嵌入模型」列了四个 `Xenova/*` 的 ONNX 转换（`BAAI/*` 只有 PyTorch
权重，指过去必然 404）：`bge-small-zh-v1.5`（24 MB，中文首选）、`bge-base-zh-v1.5`、
`multilingual-e5-small`、`all-MiniLM-L6-v2`（英文最省）。

- **安装**：真去下载到 `vendor/models`，装完立刻切成那个模型（写 `semantic.model`），
  这样点完就生效，不用再手动填模型名。
- **卸载**：删掉 `vendor/models` 下属于它的缓存目录，模型文件不进 profile，删了不影响别的。
- **打开模型目录**：在文件管理器里打开 `vendor/models`，手动放模型就放这儿。

本机实测的坑：镜像能取 `config.json` / `tokenizer.json`，但 `.onnx` 走的是另一个 CDN，
Node 的 TLS 校验过不去（`UNABLE_TO_VERIFY_LEAF_SIGNATURE`），`Invoke-WebRequest` 也一样。
所以这台机器上「安装」多半会失败——失败信息会显示在卡片下方，而不会静默。可行的路是把
ONNX 目录手工放进 `vendor/models`，再在「本地模型目录」里指过去。

## 开发

```bash
node test/store.test.mjs
node test/search.test.mjs
node test/settings.test.mjs
node test/diary.test.mjs
node test/toolkit.test.mjs
node test/scheduler.test.mjs
```

逐个文件跑：`node --test test/` 在本机沙箱里会因为 `spawn EPERM` 挂掉。

### 不能 import `@deepseek-ai/*`

bundle 是用 pnpm 的 `link:` 装进 profile 的，运行时从本仓库目录向上解析依赖。而 `@deepseek-ai/*` 这些包**只存在于 `app.asar` 内**，profile 的 `node_modules\@deepseek-ai\` 下只有 `cosmokit` 和 `schemastery`。所以：

```js
import { defineTool } from '@deepseek-ai/dsh-tools'  // ✗ ERR_MODULE_NOT_FOUND，整个 bundle 起不来
```

注意这是 **import 的问题，不是 link 安装的问题** —— link 安装本身完全正常，只要不 import DSH 内部包就行。真正的判据是「有没有 import」，`tool-fence.js` 和伴侣 preset 里一条 `import` 都没有，所以它们走 link 一点事没有。

需要 `defineTool` 这类工具函数时，在本仓库内自己实现一份（见 `lib/toolkit.js`），或者干脆只跟 `ctx` 服务打交道 —— 根平面注册的包也全都只走 `ctx`。

### 面板接口要走 `connection.fetch.register`

`/api` 这个前缀被 `client-connection` 独占，`ctx.webServer.register({ kind: 'prefix', path: '/api/deepmemory' })` 拿不到浏览器请求（浏览器的 fetch 只带 authority-bound 签名 cookie，走的是 Connection 的 Fetch 通道）。正确写法：

```js
ctx.inject(['connection'], (connCtx) => {
  connCtx.effect(() => connCtx.connection.fetch.register({
    path: '/api/deepmemory/stats',
    methods: ['GET', 'HEAD'],
    requestBody: 'buffered',
    fetch: async (request) => new Response('…'),
  }))
})
```

要点：`fetch` 收到的是 WHATWG `Request`、必须返回 `Response`；同一 `path` 只能注册一次（所以 GET 与 POST 要拆两条）；声明 GET 时把 `HEAD` 一起写上，否则 HEAD 掉 404。

环境事实（写代码时别踩）：

- 本机 node 只有 `C:\Program Files\DSH NEXT\resources\runtime\x64\primary-runtime\dependencies\node\bin\node.exe`（v24.21.0，SQLite 3.53.4，`node:sqlite` 内置）
- FTS5 `trigram` 对**少于 3 个字符**的查询必然为空，短查询要退回 `LIKE`
- FTS 表必须是普通 `fts5(text, tokenize='trigram')`，写成 `content=''` 的 contentless 表不能 `DELETE`
- `{{...}}` 在 prompt section 里会被当模板变量，未注册的变量会让整轮请求失败

## 安装

```text
plugin_manager action=install_bundle target=<本目录绝对路径>
```

替换已安装的包需要重启 DSH 才会加载新 JS。
