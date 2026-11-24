# 画布核心二次拆分方案

## 当前基线

- 核心文件：`static/canvas/js/smart-canvas.js`
- 起始规模：约 32,494 行，约 1.56 MB；截至第 4.3 阶段为 31,209 行（约 1.44 MB），
  前置四个模块 `modules/canvas-utils.js`（780 行 / 52 函数）、
  `modules/canvas-state.js`（387 行 / 19 函数）、
  `modules/canvas-layout.js`（当前布局函数）、
  `modules/canvas-renderer.js`（连线、视口和虚拟化计算）与
  `modules/canvas-interaction.js`（磁性吸附计算）
- 页面加载方式：传统 `<script>`，不是 ES Module
- 页面存在大量 HTML `onclick`，并通过 `window` 暴露公共函数
- 基线检查：`node --check` 通过，`scripts/smoke_check.py` 为 `failed=0`

## 拆分原则

1. 只修改 `D:\小小办公`，原项目不动。
2. 保留 `smart-canvas.js` 作为兼容入口，第一阶段不改成 `type="module"`。
3. 每次只移动一类职责，并保留旧的 `window` 函数名。
4. 不改变节点数据字段、保存格式、URL 和 HTML 内联调用方式。
5. 每阶段都运行语法检查、冒烟检查，并由用户验收画布后再进入下一阶段。

## 六个阶段

### 第 1 阶段：基线和公共边界

整理全局状态、公共函数、HTML 入口和外部依赖清单；建立拆分前的哈希和检查记录。

本阶段只做分析和记录，不改变运行代码。

### 第 2 阶段：纯工具和媒体工具

新建 `static/canvas/js/modules/canvas-utils.js`，放入不直接修改画布状态的函数，例如：

- URL、文件名、HTML 转义
- 媒体预览地址和媒体尺寸缓存
- 图片/视频尺寸、比例和格式计算
- 复制文本、错误信息和下载工具

通过 `window.SmartCanvasUtils` 暴露，主文件继续保留原函数名作为兼容包装。

### 第 3 阶段：画布状态和数据读写

新建 `static/canvas/js/modules/canvas-state.js`，集中管理：

- `nodes`、`canvas`、`viewport`
- 选择状态、拖动状态、撤销/重做状态
- 节点规范化、旧数据迁移、序列化
- `loadCanvas`、`saveCanvas`、`scheduleSave`

这一阶段严格保持现有数据契约和版本迁移逻辑。

> 执行时收窄：状态变量本身与带 I/O 的 load/save 属于强耦合区，实测搬动风险远大于收益，
> 因此本阶段只落「数据契约层」（纯转换），状态仍单一归属主文件。
> 详见文末《第 3 阶段执行记录》。第 4 阶段之前不引入第二份状态。

### 第 4 阶段：布局和渲染

新建 `static/canvas/js/modules/canvas-renderer.js`，集中管理：

- `nodeRect` 和节点尺寸计算
- 节点 DOM、连线 SVG、小地图
- 视口变换、虚拟化和高低清媒体切换
- `render`、`renderConnections`、`renderMinimap`

创建和刷新必须继续使用同一套尺寸计算函数。

### 第 5 阶段：交互

新建 `static/canvas/js/modules/canvas-interaction.js`，集中管理：

- 平移、缩放、拖动、框选、多选
- 连线拖拽、删除、自动吸附
- 键盘、鼠标、触摸和拖放事件
- 小地图拖动和视口恢复

交互模块只调用状态和渲染模块的公共 API，不直接复制节点布局逻辑。

### 第 6 阶段：功能模块边界

按功能建立独立模块，优先顺序为：

- `canvas-media-editor.js`：裁剪、宫格切分、拼接、视频裁剪
- `canvas-assets.js`：素材库、上传、素材面板
- `canvas-generation.js`：图片/视频/LLM 生成和任务轮询
- `canvas-workflow.js`：工作流导入、导出、归档
- `canvas-collaboration.js`：与现有 `lan-sync-adapter.js` 的桥接

插件注册先只定义接口，不提前新增插件功能。等功能模块稳定后，再建立 `canvas-plugin-registry.js`。

## 每阶段验收

- `node --check`：新旧画布脚本全部通过。
- `python scripts/smoke_check.py`：`failed=0`。
- 画布页面静态资源返回 `200`。
- 用户检查：启动、打开画布、创建节点、拖动、缩放、导入工作流、保存重开、素材显示。
- 第 3 阶段额外检查：新数据、旧数据升级、刷新、重开四条路径。

## 回滚方式

每阶段开始前备份上一阶段目录和 `smart-canvas.js`。如果页面黑屏、按钮失效、素材消失或数据字段变化，只恢复当前阶段新增文件和对应 HTML 引用，不回退用户数据目录。

## 当前决定

第 1 至第 6 阶段已完成。`modules/` 下现有公共工具、数据契约、布局、渲染、交互，
以及 workflow、assets、generation、media-editor、collaboration 五个功能边界模块。
`smart-canvas.js` 保留兼容入口和 DOM 事件处理。
**小地图没有搬**：`renderMinimap` / `renderMinimapDirect` 持有主文件五个可变 `let`
（`smartMinimapRaf`、`smartMinimapState`、`smartMinimapNodeRects`、`smartMinimapNodeElements`、
`smartMinimapGeometryDirty`，共 35 处引用、多个写入点在节点拖动/缩放处理里）并直接建 DOM，
JS 无法按引用注入 `let`，搬它要么复制第二份状态、要么把五个状态装箱并改写所有写入点。
其余未拆：`render`、`applyViewport`、事件监听、分组语义
（`smartGroupImageRefs` / `smartGroupCompactMembers` / `smartGroupMembers` /
`arrangeSmartGroupMembers` / 入组 / 吸收）、`promptNodeMinHeight` / `promptNodeExpandedHeight`。
下一步需先经用户验收画布（尤其连线绘制：普通/input/history 三类线、组内线隐藏、
多成员合并成一条到分组的线、级联动画与减动效、点选高亮、连线删除与插入吸附；
以及小地图缩放/拖动未受影响），再决定是否继续。
4.3b 已完成：小地图的几何范围与矩形投影两段纯数学已提入 `canvas-renderer.js`；
小地图状态、DOM 更新、刷新调度和事件仍保留在主文件。
暂不拆后端、数据目录、局域网服务，也不改成 ES Module。

## 第 4.3 阶段执行记录：连线绘制拆分（2026-09-19）

新建 `static/canvas/js/modules/canvas-renderer.js`（148 行，IIFE，只暴露
`window.SmartCanvasRenderer`），搬入三个函数，函数体逐字节照搬：

| 函数 | 原行数 | 主文件调用点 |
| --- | --- | --- |
| `renderConnections` | 75（10946-11020） | `refreshConnectionLayer`、`render` 内 `insertAdjacentHTML` |
| `updateConnectionSelection` | 20（11037-11056） | 选中 UI 同步、连线开关 |
| `connectionMidpoint` | 10（18528-18537） | 连线插入吸附 |

`smart-canvas.js` 31,302 → 31,209 行（-93：搬走 105 行函数体、换回 3 行包装，
新增 `rendererDeps()` 助手 12 行）。加载顺序变为
utils → state → layout → **renderer** → main，五个脚本 `?v=` 与
`CANVAS_FRAME_VERSION` 同为 `2026.09.19.canvas_split_p4_3`。

**注入的 11 个依赖**（`rendererDeps()` 调用期组装，全部按引用，模块不持有任何状态）：
`nodes`、`canvas`、`world`、`escapeAttr`、`nodeRect`、`selectedNodeIds`、
`smartGroupScopeId`、`cascadeConnectionKeys`、`smartCascadeEdgeState`、
`smartCascadeRunPath`、`loopInsertPreview`。其中 `world` 是唯一 DOM 句柄：
`updateConnectionSelection` 只在这块注入进来的元素上做 `querySelectorAll` / `classList`，
模块本身不含 `document` / `getElementById` / 事件注册。

**SVG 结构与选中/隐藏语义零改动**：class 组合、`data-conn-index` / `data-from` /
`data-to` / `data-targets`、stroke 颜色与线宽、hit 的 `stroke-width="16"`、
end 的 `r="2.6"`、`conn-reduce-motion`（>24 个未完成级联）、组内线隐藏与
「多成员合并成一条到分组的线」全部逐字保留。

**未搬动并按要求留在主文件**：`render`、`nodeRect`、`applyViewport`、
`refreshConnectionLayer`、`scheduleConnectionLayerRefresh`、
`scheduleInteractionLayerRefresh`、`bindConnectionEvents`、`renderMinimap`、
`renderMinimapDirect`、`minimapEventToWorld`、`saveCanvas`（gate D 逐条断言这 15 个函数
仍在主文件且没进模块）。小地图不搬的具体代价见「当前决定」。

验收：`node --check` 五个画布脚本 + `project-manager.js` 全过；`smoke_check.py`
`failed=0`；`canvas_asset_check.py` 全部 200、sha256 一致、五脚本顺序与令牌一致。
五道 gate 全绿——C 与 4.3 备份逐字节相同；A 裸 vm 陷阱 0 个隐式全局；
B 456 组场景零差异（真实画布 90 组 + 合成 80 + 合并/边界 47 + 中点 72，
其中真实大画布 `54686be8….json` 有 156 节点 / 703 条连线（44 flow + 659 input））；D 3 导出↔3 包装、11 个注入名两侧都可解析、
禁止的自由标识符为空、75 条 `window.*` 不变；E 无解析期调用。

**敏感度电池 `scripts/canvas_split_phase4_3_negative_test.py`：51 项绘制变异 +
11 项注入变异，共 62 次全量校验。** 50 项绘制变异被 gate B 抓到（线宽 1.2/1.4、
hit 的 16、端点 `r` 2.6、透明度 .82/.66、四种颜色、10 个 class 令牌、四个 data 属性、
转义、合并键、组内隐藏、成员判定、选择器、四段中点公式、reduceMotion 阈值 24）；
1 项机械证明为惰性并每次复核：只把 `from` 侧的 `kind === 'history'` 豁免去掉不会有任何影响，
因为 `to` 侧仍对 history 返回 `''`，而隐藏判定要求 `fromScope` 为真且 `=== toScope`；
证明函数会检查那三行源码，一改就报错要求重新归类（对称的 `to` 侧变异确实被抓到 157 例，
正好证明惰性来自守卫成对而不是缺输入）。11 项「从解构里删掉一个依赖名」gate A 全部点名报出。

**为了让 gate 不再是假绿而修的地方（都在测试侧，运行代码未受影响）：**

1. gate B 的 sandbox 少了 `settings`，两侧同样抛 `ReferenceError` → 456 组「零差异」其实
   是空 SVG 在比。已在 harness 增加 `clean`（两侧都没抛）与 `pat`（结果里真有 `<path ` /
   `conn-selected`）覆盖下限，任何一组低于阈值直接判 GATE B FAIL；本次实测
   render 217/217 clean、183 组真画出连线，selection 167 clean、74 组真打上选中 class。
2. gate A 的注入桩缺 `smartCascadeEdgeState`，`Array.map(undefined)` 抛 TypeError 让函数体
   在触达后面的依赖前就中断（与第 4.2a 阶段那次假绿同一类）。补齐桩之后，gate D 现在还会
   静态断言「模块解构的每个名字必须同时被 `rendererDeps()` 和陷阱桩供上」，缺一个就 FATAL。
3. 假 DOM 的 `querySelectorAll` 原来不按标签过滤，导致「把 `path.conn-line` 改成
   `circle.conn-line`」看起来无害；按浏览器语义修好后该项变异抓到 124 例差异。
4. gate E 的花括号分类器把 `let x = {a:1};` 这类单行对象当块起始，误划出一个跨 27 行的
   「解析期块」，把函数体内的 `updateConnectionSelection()`（3321 行）误判为解析期调用；
   改成要求真正跨行的起始花括号后，解析期块 38 → 11。
5. harness 与依赖桩泛化：新增 `payload.moduleGlobal`（SmartCanvasLayout /
   SmartCanvasRenderer 共用同一套 A/B），`clean`/`pat` 只在有下限要求时打印，
   因此第 4.1 / 4.2a / 4.2b 阶段的 check 输出格式不变；`smartLayoutDeps` 相关名单与
   陷阱桩集中在 `scripts/canvas_layout_test_deps.py` 单点维护。

**顺带查出的两处冗余判定（未改，改它等于改绘制行为）：**
`updateConnectionSelection` 里 `selected.size > 0 &&` 是多余的（空集合下所有 `has()` 本就
为 false）；`renderConnections` 里 `from` 侧的 history 豁免在 `to` 侧也有同样豁免时永不生效。
两处都已由变异测试确认为惰性，若将来有人只删一侧，电池会立刻报警。

**回归顺带修正：** 无。第 2、3/3.5、4.1、4.2a、4.2b 阶段在本阶段结束时全部重跑通过
（13,700 / 5,334 / 1,991 / 11,441 / 1,592 组，零差异），各阶段 gate C 按规则 `--skip-c`，
其职责由本阶段 gate C 承接。`smoke_check.py` 与 `canvas_asset_check.py` 的清单分别新增
`canvas-renderer.js`（前者还有一条从页面自抓脚本、要求第一方脚本必须被 node --check 覆盖的
断言，vendor 明确排除），后者按 `len(ORDER)` 动态校验五个脚本共用同一令牌，并已用
「把 renderer 的令牌改坏」验证过能报错。

回退点：`D:/压缩包/canvas_split_phase4_3_backup_2026-09-19/`
（`smart-canvas.js` md5 `c77f7f22…`、`canvas-layout.js` `24183d79…`、`smart-canvas.html`、
`smoke_check.py`、`canvas_asset_check.py`、`project-manager.js`、
`canvas_layout_test_deps.py`、4.1 harness、4.1/4.2a check、4.2a 搬迁与电池脚本、
4.2b 三件套，另存 `data-canvases-md5.txt`）。

用户数据：本轮校验只读 `data/canvases/`，开工与收尾的 `md5sum data/canvases/*.json | md5sum`
同为 `22bab985645a…`（应用未运行）。本阶段没有启动浏览器或 `server.py`。

## 第 4.2b 阶段执行记录：smartGroupThumbLayout 单函数拆分（2026-09-19）

把分组缩略图排布 `smartGroupThumbLayout` 搬进已有的 `modules/canvas-layout.js`
（276 → 350 行，11 → 12 个导出），`smart-canvas.js` 由 31,365 行降到 31,302 行（-63：
搬走 65 行函数体、换回 1 行包装、`smartLayoutDeps()` 增加 1 行依赖名）。
没有新建模块，没有改加载顺序，没有改 HTML `onclick`。

**依赖完整注入，无需搬 smartGroupImageRefs。** 该函数的全部外部引用只有 9 个：
- 节点图 / 分组解析（按引用注入，留在主文件）：`smartGroupImageRefs`（内部用 `nodes` +
  `nodeRect` 排序成员）、`smartGroupCompactMembers`（内部 `smartGroupMembers` 读 `nodes`）
- 纯计算（按引用注入）：`mediaNodeDefaultScale`
- 已在模块内（继续把 deps 传下去）：`singleImageLayout`、`groupImageGridLayout`
- 常量（留在主文件按引用注入）：`SMART_GROUP_MIN_WIDTH`、`SMART_GROUP_MIN_HEIGHT`、
  `SMART_GROUP_MAX_VISIBLE_ROWS`、`MEDIA_GROUP_THUMB_BASE`

清单里的 `SMART_GROUP_DEFAULT_WIDTH` / `SMART_GROUP_DEFAULT_HEIGHT` **实测不在本函数内**，
它们属于 `arrangeSmartGroupMembers`，因此没有解构进来（避免死参数）；两个名字本来已由
`smartLayoutDeps()` 提供，无需改动。`smartLayoutDeps()` 本轮只新增 3 个名字。

**主文件调用方零改动。** `arrangeSmartGroupMembers`（3733）与分组节点 HTML 构造（12982）
都是单参数调用，包装签名 `smartGroupThumbLayout(node)` 保持不变。
`imageLayout` 一行未改：它继续调用 `deps.smartGroupThumbLayout`，而 `smartLayoutDeps()`
现在把这个名字指向主文件包装 → 包装再进模块，行为与 4.2a 完全一致，也没有递归
（模块内的 `smartGroupThumbLayout` 从不读 `deps.smartGroupThumbLayout`）。

**顺带修掉一个 4.2a 遗留的依赖泄漏（本轮唯一一处非搬运改动）。**
加强后的 gate A 陷阱发现：模块里的 `imageLayout` 有 3 处使用 `MEDIA_GROUP_MAX_VISIBLE_ROWS`
却从未在 deps 解构里声明，它是**穿透到 smart-canvas.js 的全局词法 const** 才跑起来的
（经典 script 共享同一份全局词法环境）。今天不报错，但一旦那个常量搬出主文件，
`imageLayout` 会立刻抛 `ReferenceError`，宫格切分节点的尺寸会整片失效。
本轮把该名字补进 `imageLayout` 的解构行——`smartLayoutDeps()` 早就注入了同一个值，
所以没有任何数字变化，等价性由第 4.2a 阶段自己的 gate B（11,441 组 imageLayout 输入）证明。

**为什么之前的 gate A 没发现它。** 陷阱把模块单独装进裸 vm，但旧版 deps 表达式写的是
`globalThis.mediaNodeDefaultScale` 这类引用，而裸上下文里根本没有这些全局：
调用立刻抛 `TypeError`（不是 `ReferenceError`），于是 body 在**触达后面的常量之前**就中断了，
"0 个全局" 是提前退出造成的假绿。已把陷阱的 deps 桩改成自包含实现，
并抽到 `scripts/canvas_layout_test_deps.py` 作为 4.1/4.2a/4.2b 共用真源
（`smartLayoutDeps()` 只有一个对象字面量，各阶段 check 各自维护一份名单必然漂移）。

验收：`node --check` 四个画布脚本 + `project-manager.js` 全过；`smoke_check.py` `failed=0`；
`canvas_asset_check.py` 全部 200 且与磁盘 sha256 一致。五道 gate 在正式文件上全绿——
C 与 4.2b 备份逐字节相同；A 模块隐式全局 0 个（加强后的陷阱）；
B 新旧等价 1,592 组输入 × 3 组桩种子 = 4,776 次比较零差异；D 12 导出↔12 包装、
「必须留在主文件」的 15 个函数逐个核实仍在原处且未进模块、模块顶层零全局/零词法状态、
无 DOM / nodes / canvas / viewport 引用、`smartLayoutDeps()` 28 个注入名全部可解析、
75 条 `window.*` 不变、加载顺序与四脚本+帧版本同令牌；E 38 个解析期代码块无解析期调用。

**测试数据来源要说明清楚：** `data/canvases/` 里**没有任何分组节点**（8 个画布 172 个节点，
类型只有 smart-image / smart-upload / smart-video），所以真实数据贡献的是
166 张真实图片对象（含 `natural_w/h`、`kind`、真实 url），由脚本组装成分组与其成员；
分组形态（空分组、单图、多图、含 compactMembers、显式/缺失/临界宽高、gridSplitGroup、
isFrameGroup）全是合成覆盖。

**敏感度电池 `scripts/canvas_split_phase4_2b_negative_test.py`：23 项数字/结构变异 +
4 项注入变异。** 19 项数字变异全部被 gate B 抓到；4 项 `Math.max` 下限
（`innerW`/`innerH` 的 24、`groupImageGridLayout` 宽高的 72/56）经机械证明是死下限——
它们只在 `hasExplicit` 分支里，而 `hasExplicit` 要求 `explicitW >= 150`、
`explicitH >= 130`，故 `explicitW - 32 >= 118 > 73`、`explicitH - 32 - 28 >= 70 > 57`。
这些数字每次运行都从正式文件里重新读取并复核不等式，常量一改就报错要求重新归类。
4 项注入变异（从解构里删掉一个依赖名）gate A 每次都点名报出，证明陷阱确实能发现漏注入。

电池同样查出三个真实覆盖缺口并已补：`Array.isArray(node?.items)` 守卫与
`refs.filter(ref => ref.item?.url)` 原来不可观测（桩函数从不产出无 url 的 ref、
也从不出现「items 非数组但有成员」的组合），`singleImageLayout(item, {}, scale)` 传
`{}` 还是传 `node` 也测不出来（缺无自然尺寸的图 + 小尺寸显式宽高这一类输入）。
另外 `groupImageGridLayout` 的 `100000` 上限原来从不生效，补了 1e6 量级的分组尺寸。

**回归顺带修正：** 4.2a 的 check 加了 `--skip-c`（它的一次性无损重建已被 4.2b 取代）、
gate D 放宽为「本阶段搬走的必须仍在」、并改用共用陷阱桩；
4.1 与 4.2a 的 sandbox 补上 `smartGroupImageRefs` / `smartGroupCompactMembers` 两个全局桩
（`smartLayoutDeps()` 自 4.2b 起会引用它们，不补就 `ReferenceError`）。
累计回归全绿：第 2 阶段 13,700 组、第 3/3.5 阶段 gate B、第 4.1 阶段 1,991 组、
第 4.2a 阶段 11,441 组（加强后的 gate A 也通过，正是 imageLayout 泄漏已闭合的证据）。

`smoke_check.py` 新增一条覆盖断言：从页面自身抓 `<script src>`，要求每个第一方脚本都在
`JS_FILES` 里（`static/vendor/` 明确排除，因为 `node --check` 按 CommonJS 解析会拒绝
ESM/压缩 UMD 包）。该断言立刻抓出 `static/vendor/js/lucide.js` 未被覆盖，按上述归类处理；
并用「从 JS_FILES 里删掉 canvas-layout.js」做过负向自检，能报错。

HTML 与令牌：四个画布脚本与 `CANVAS_FRAME_VERSION` 统一递增为
`?v=2026.09.19.canvas_split_p4_2b`；`canvas_asset_check.py` 无需改动，
其 ORDER 与新增的令牌一致性断言（本轮实测通过）自动覆盖。

回退点：`D:/压缩包/canvas_split_phase4_2b_backup_2026-09-19/`
（`smart-canvas.js` md5 `87c8d45e…`、`canvas-layout.js` `b3cd66f7…`、`smart-canvas.html`、
`smoke_check.py`、`canvas_asset_check.py`、`project-manager.js`，以及 4.1/4.2a 的
check、4.2a 的搬迁与电池脚本，另存 `data-canvases-md5.txt` 作为用户数据基线）。

用户数据：本轮所有校验只读 `data/canvases/`；开工基线 `22bab985645a…`，收尾复核同为
`22bab985645a…`，逐文件 md5 未变（上一阶段那个被应用自己保存过的
`59e412c1….json` 本轮没有再变）。

## 第 4.2a 阶段执行记录：imageLayout 单函数拆分（2026-09-19）

把布局分派枢纽 `imageLayout` 搬进**已有**的 `modules/canvas-layout.js`
（202 → 276 行，10 → 11 个导出），`smart-canvas.js` 由 31,425 行降到 31,365 行（-60：
搬走 64 行函数体、换回 1 行包装，注入助手 `smartLayoutDeps()` 增加 3 行依赖名）。
没有新建模块，没有改加载顺序，没有改 HTML `onclick`。

**只搬这一个函数的理由。** `imageLayout` 是 `nodeRect` 与 `render` 都经过的分派点，
主文件 6 处调用写法保持原样（包装继续保留默认参数 `scale=1, node=null`），
所以这一步不需要碰任何调用方，是第 4 阶段里风险最低的一块。

**依赖注入清单。** 模块签名
`function imageLayout(images, scale, node, deps = needDeps('imageLayout'))`，
函数体逐字节照搬，只在开头多一行 deps 解构。`smartLayoutDeps()` 新增 13 个名字：

- 仍属纯计算、将来可继续下沉：`mediaNodeDefaultScale`、`smartMinimaxLayoutSize`、
  `smartLoopWidth`、`isSmartUploadNode`、`isSmartVideoNode`、`EMPTY_UPLOAD_NODE_WIDTH`、
  `EMPTY_UPLOAD_NODE_HEIGHT`、`MEDIA_GROUP_THUMB_BASE`
- 依赖节点图/分组成员解析，**不能**进纯布局模块，只能按引用注入：
  `smartGroupThumbLayout`、`promptNodeLayoutSize`、`isSmartGroupCompactMember`、`smartLoopHeight`

**模块内自调用必须补 deps。** 它调用 4.1 已搬进本模块的四个函数
（`smartGroupLayoutSize`、`emptyGenBoardSizeFromAspect`、`singleImageLayout`、
`groupImageGridLayout`），要把 deps 继续传下去；`groupImageGridLayout` 还显式补回
`MEDIA_GROUP_MAX_VISIBLE_ROWS`——那是原先主文件包装提供的默认参数，不补就会命中
`needDeps` 或走错分支。

**未搬动：** `nodeRect`、`render`、`renderConnections`、`renderMinimap`、`applyViewport`、
`promptNodeMinHeight`、`promptNodeExpandedHeight` 全部原地不动，与 4.1 记录一致。

> 后续（第 4.3 阶段）：`renderConnections` 已搬进
> `modules/canvas-renderer.js`；`nodeRect`、`render`、`renderMinimap`、
> `applyViewport`、`promptNodeMinHeight` / `promptNodeExpandedHeight` 仍未搬。

## 第 4.4 阶段前置检查：主渲染与节点 HTML（2026-09-19）

检查了 `render()`、`buildSmartNodeHtml()` 及其直接调用链。`render()` 直接管理
DOM 增删、节点虚拟化、媒体播放状态、连接层和小地图，必须留在主文件。
`buildSmartNodeHtml()` 虽然返回 HTML 对象且本身不直接写 DOM，但会调用
`nodeBodyHtml()`；后者继续依赖提示词、分组、媒体任务和主文件状态闭包。
若只搬外层函数，模块仍会隐式依赖主文件；若连同调用链一起搬，则会复制状态或
扩大为大范围重构。因此本轮不搬这两个函数，避免形成名义分层、实际耦合的模块。
后续渲染拆分只处理能够完整注入依赖、且不持有 DOM 或可变状态的纯边界函数。

在同一阶段中，`nodeRect()` 已按此原则加入 `modules/canvas-layout.js`。它只依赖
`imageLayout`、`smartNodeLayoutImages` 和 `nodeScale`，主文件保留同名包装，所有调用方
不变。旧实现与新模块对 500 组节点输入逐项比较一致；语法、冒烟和静态资源检查均通过。

随后将 `canvasWorldBounds()` 与 `isNodeInRenderWindow()` 加入
`modules/canvas-renderer.js`。两者只负责视口边界和节点可见性判断，主文件调用签名保持不变，
依赖通过 `rendererDeps()` 注入。与第 4.3 阶段备份逐项比较 800 组输入一致；未搬动
`render()`、小地图和任何 DOM/可变状态。

最后把渲染虚拟化的纯筛选 `isSmartNodeRenderActive()` 与 `visibleCanvasNodes()`
加入同一模块。它们只根据选择、拖动、活动会话和视口边界筛选节点数组，不管理节点 DOM。
与旧版在 300 组不同节点数量、选择数量、拖动组和活动状态组合下的结果完全一致。

**第 4.4 阶段修复（2026-09-19）：** 首次实际调用发现 `visibleCanvasNodes()` 错误地
从注入对象读取模块自身的 `canvasWorldBounds` / `isNodeInRenderWindow`，导致渲染阶段
抛出函数未定义错误，节点和素材无法生成。已改为调用模块内部函数，并将缓存版本递增到
`2026.09.19.canvas_split_p4_5`。

验收：`node --check` 四个画布脚本全过；`smoke_check.py` `failed=0`；
`canvas_asset_check.py` 全部 200 且与磁盘 sha256 一致；五道 gate 全绿——
C 与 4.2a 备份逐字节相同；A 模块隐式全局 0 个；B 新旧等价 11,425 组输入 × 3 组桩种子
= 34,275 次比较零差异；D 11 导出↔11 包装、模块顶层零全局/零词法状态、
无 DOM / nodes / canvas / viewport 引用、75 条 `window.*` 不变、加载顺序
utils→state→layout→main；E 38 个解析期代码块中无 `imageLayout` 解析期调用。

> **更正（2026-09-19，第 4.2b 阶段）：** 上面这道 gate A 当时是**假绿**。
> 陷阱的 deps 表达式用 `globalThis.X` 取主函数，裸 vm 上下文里这些全局并不存在，
> 于是第一次调用就抛 `TypeError` 提前退出，body 后面的常量根本没被触达。
> 换成自包含桩后 gate A 立刻抓出 `imageLayout` 漏注入
> `MEDIA_GROUP_MAX_VISIBLE_ROWS`（3 处使用），已在 4.2b 闭合。
> 本阶段记录的 B/C/D/E 结论不受影响。

**新增敏感度电池 `scripts/canvas_split_phase4_2a_negative_test.py`。**
一次只改模块里的一个数字，要求 gate B 必须报差异。17 项变异中 16 项被抓到；
唯一没抓到的是无网格分支 `Math.max(round(226*s), cols*cell+32)` 的第一操作数，
经证明它是**死操作数**：该分支 `cols>=2`，第二操作数 `>= 2*(round(224*s)+8)+32 > 448*s+47 > 227*s`，
对任意 `s>0` 恒成立，所以永远轮不到它决定结果。脚本用 `0<s<=200` 的 20 万个采样复核这条
不等式，一旦邻接常量被改动使证明失效，脚本会直接报错要求把该项重新归类为「必须抓到」，
避免「今天合理、明天变成覆盖漏洞」。

电池暴露并已补齐两个真实覆盖缺口：

1. 网格分支的 `226*s` 只有在 `cols=1` 且 `s>=20` 时才参与结果 → 增加 scale 12~100 的输入；
2. `480x270 / 270x270` 兜底只有当 aspectHint 让 `emptyGenBoardSizeFromAspect()` 返回 null
   （`adaptive`/`auto`/`source`/`custom`/无法解析）时才生效；`'1:1'/'16:9'` 字面量只有
   `settings` 缺对应键时才生效 → 增加 `NULL_HINTS` 输入和第二组 `imageLayout-noSettings`
   （在共享 sandbox 里把 `settings` 清空，因此必须放在最后一组跑）。
   补完后 gate B 的输入从 4,539 涨到 11,425。

**顺带修正的两处既有检查脚本。** `canvas_split_phase4_1_check.py` 的 gate C 是逐阶段一次性的，
4.2a 动过同一文件后必然对不上，故新增 `--skip-c`；其 gate D 原要求「导出恰好等于本阶段 10 个」，
改为「本阶段搬走的必须仍在，后续阶段新增只报告、不算失败」。4.1 的 gate B 现在复用 4.2a 维护的
依赖名清单，否则 `smartLayoutDeps()` 在它的最小 sandbox 里会抛
`mediaNodeDefaultScale is not defined`。

`canvas_asset_check.py` 新增一条不变量：四个画布脚本的 `?v=` 必须完全相同，且等于
`project-manager.js` 的 `CANVAS_FRAME_VERSION`（第 2 阶段就踩过 iframe 复用旧脚本的坑）。
该断言用临时改坏的 HTML 做过负向自检，能报错，检查完 HTML 已还原。

工具：`scripts/canvas_split_phase4_2a.py`（搬迁清单，dry-run 产出 `scripts/_p42a_*.js` 预览，
带防重跑护栏与结构断言）、`scripts/canvas_split_phase4_2a_check.py`（五道 gate，支持
`--main/--layout` 指向预览）、上述负向电池。应用后正式文件与预览 md5 逐字节相同，
预览文件与 `scripts/__pycache__` 已删除，电池改为直接读正式文件（变异副本只写进系统临时目录）。

HTML 与令牌：四个画布脚本与 `CANVAS_FRAME_VERSION` 统一递增为
`?v=2026.09.19.canvas_split_p4_2a`；`smoke_check.py` 无需改动，第 4.1 阶段已把
`canvas-layout.js` 纳入清单。

回退点：`D:/压缩包/canvas_split_phase4_2a_backup_2026-09-19/`
（`smart-canvas.js`、`canvas-layout.js`、`smart-canvas.html`、`smoke_check.py`、
`canvas_asset_check.py` 与 4.1 的 check/harness，即第 4.1 阶段完成态）。

用户数据：本阶段所有校验只读 `data/canvases/`，脚本中不存在以写模式打开 `data/` 的路径，
`smoke_check.py` 只 GET `/api/health`。校验期间 `md5sum data/canvases/*.json | md5sum`
由 `7cf232561ae2…` 变为 `1bfe6fa64aba…`，唯一变化的是 `59e412c1….json`，
其内部 `updated_at=1789763344505` 与文件 mtime（04:29:04.515）逐毫秒吻合，
是正在运行的应用自身保存的，与拆分无关；后续阶段沿用同一聚合值作对照时需以最新值为基线。

## 第 4.1 阶段执行记录：纯布局计算拆分（2026-09-19）

新增 `static/canvas/js/modules/canvas-layout.js`（202 行，10 个函数，IIFE，只暴露
`window.SmartCanvasLayout`），`smart-canvas.js` 由 31,553 行降到 31,425 行（-128）。

搬走的 10 个纯布局计算，按职责分组：

- 节点缩放：`nodeScale`
- 空生成板尺寸：`emptyGenBoardSizeFromAspect`
- 智能分组尺寸：`smartGroupLayoutSize`
- 媒体与单图布局：`mediaLayoutSize`、`standardImageFixedSize`、`singleImageLayout`
- 多图网格：`groupImageGridLayout`
- 输入缩略图排布：`smartNodeInputThumbRows`、`smartNodeInputThumbsHeight`、`smartNodeLayoutImages`

尺寸规则、比例规则、阈值、取整方式一字未改；不碰 DOM，不读写 `nodes`/`canvas`/`viewport`，
不 render、不 save。

**保留原位的 2 个候选（第 9、10 项）**：`promptNodeMinHeight`、`promptNodeExpandedHeight`。
原因不是「没看清依赖」，而是查清后判定不该搬：

1. 它们要调 `promptNodeInputImages` 与 `promptNodeUpstreamPromptItems`，这两者经
   `inputNodesFor` → `upstreamNodesForKinds` **读 `nodes` 与 `canvas.connections`**，是节点图遍历，
   搬走就得把图遍历能力注入一个自称「纯布局」的模块，模块边界就糊了。
2. 它们还要用一组 `PROMPT_*` 几何常量（`PROMPT_LLM_INSTRUCTION_DEFAULT/MIN/MAX_H`、
   `PROMPT_SPLIT_RESIZE_BAR_H`、`PROMPT_SPLIT_PREVIEW_DEFAULT/MIN/MAX_H`），这些常量在主文件
   被别处共用，且 `promptLlmInstructionHeight` / `promptNodeSplitExtraHeight` /
   `promptNodeSplitPreviewHeight` 三个辅助函数也得一起拖过去。
   为约 9 行算术铺一张 8 依赖的注入表，收益不抵复杂度。
   它们属于第 4 阶段「prompt 节点布局」那一组，届时连同 `promptNodeLayoutSize` 一起处理更合适。

其余未被点名的布局函数（`imageLayout`、`promptNodeLayoutSize`、`smartMinimaxLayoutSize`、
`smartGroupThumbLayout`、`nodeRect`、`mediaNodeDefaultScale` 等）同样未动，属第 4 阶段主体。

手法沿用第 3 阶段：布局常量在主文件另有 2-22 处引用，因此**全部留在主文件、按引用注入**，
参数名与原常量一致，函数体逐字节照搬；主文件保留同名包装，由新增的
`smartLayoutDeps()` 在调用期组装。全部常量都核对过 **没有** `typeof X !== "undefined"` 兜底，
所以不存在第 3 阶段 `EMPTY_GEN_NODE_WIDTH` 那种「搬走就静默退化」的坑。

一处真实改动（由校验挡下，值得记录）：`singleImageLayout` 内部会调
`standardImageFixedSize` 与 `emptyGenBoardSizeFromAspect`。这两个函数进了同一模块后
同样需要 deps，而模块内部调用不带 deps 会撞上 `needDeps` 显式报错。
因此该函数把 deps 收成具名 `deps` 并在两处调用实参里带上，运算体未动。
**`needDeps` 的设计在这里起了作用**：它让这个问题在验证阶段炸出来，
而不是退化成「永远返回兜底的 480x270」这种静默错版。

`groupImageGridLayout` 的 `pad=32, gap=8, maxVisibleRows=MEDIA_GROUP_MAX_VISIBLE_ROWS`
三个默认值留在主文件包装上，模块侧只收实参，行为与原调用点完全一致。

验收（令牌 `2026.09.19.canvas_split_p4_1`，四个画布脚本与 `CANVAS_FRAME_VERSION` 同步）：

- `node --check` 全过；`smoke_check.py` `failed=0`；`canvas_asset_check.py` 全过，
  加载顺序断言已扩为 `canvas-utils.js -> canvas-state.js -> canvas-layout.js -> smart-canvas.js`。
- **A 全局访问陷阱**：把 canvas-layout.js 单独装进裸 vm，依赖全部以实参传入后调用每个导出，
  它读取的全局为 **0 个** —— 模块完全靠注入。
- **B 新旧等价**：同一表达式分别跑拆分前定义与「真实包装 + 模块」，输入取自
  `data/canvases/` 全部 8 个画布、168 个真实节点及其 image 对象（只读），
  外加阈值边界/异常值种子（scale=1.6/0.8、w/h 跨 150/130/220/340 阈值、
  25 种缩略图数量、64 组网格组合、41 种比例串含 `square`/`wide`/`21:9`/`16/9`/畸形值），
  **10 组 1,959 次比对零差异**。
- **C 无损重建**：10 个包装换回原定义、剪掉 `smartLayoutDeps` 后与备份**逐字节相同**。
- **D 静态一致**：10 导出↔10 包装、模块顶层零全局零状态、代码内无 DOM/nodes/canvas/viewport 引用、
  无重名、75 条 `window.*` 不变、state/utils 的 19/52 导出未回归。
- **E 解析期调用**：38 个解析期代码块中无任何对被搬函数的调用（`nodeScale` 包装位于其依赖常量之前，
  顶层调用会踩 TDZ，已确认不存在）。
- **B 做过负向自检**：把 `standardImageFixedSize` 兜底高度 270 改成 271，等价组立刻在 6 个输入上报错；
  还原后恢复全绿。
- 累计回归：第 3/3.5 阶段 5,334 组仍零差异，第 2 阶段 13,700 组仍零差异。
  `data/assets/output/workflows/runtime_core/lan/server.py` 零改动（md5 聚合值未变）。

工具：`scripts/canvas_split_phase4_1.py`（搬迁清单，带防重跑护栏）、
`scripts/canvas_split_phase4_1_check.py` + `_harness.js`（五道 gate，夹具写系统临时目录）。
`canvas_split_phase3_check.py` 的 gate C 是**每阶段一次性**的重建证明，第 4.1 阶段动过同一文件后
它必然失真，已加 `--skip-c` 显式跳过（实测失败点恰好在 `nodeScale` 处的注入助手，
没有夹带别的问题）；累计的等价证明由各阶段的 B 门负责。

遗留观察：`imageLayout` 是布局层的真正枢纽（`nodeRect`、`render` 都走它），
它按 `node.type` 分派到 5 个以上子布局函数，是第 4 阶段的核心，本次刻意未动。
第 2 阶段记录的 `SIZE_MAP` 死代码仍在。

回退点：`D:/压缩包/canvas_split_phase4_1_backup_2026-09-19/`（第 3.5 阶段完成态的
`smart-canvas.js`、`smart-canvas.html`、`smoke_check.py` 与三个校验脚本）。
更早：`canvas_split_phase3_5_backup_*`、`canvas_split_phase3_backup_*`、`canvas_split_phase2_backup_*`。


## 第 3.5 阶段执行记录：保存契约收敛（2026-09-19）

结论：**`saveCanvas` 的内联契约循环与 `normalizeLegacySmartNode` 不是重复实现，不能合并。**
两者只是读起来像。取证方式是把 `data/canvases/` 全部 168 个真实节点，外加针对每一类
差异手工种入的节点，分别喂给两套实现比对（只读）：168 个真实节点里有 **167 个结果一致**，
唯一分歧的是 `test_sync_1789616524.json` 里那个完全没有 `type` 字段的 `node-1`
（命中下表第 1 类），其余分歧都由种子节点稳定复现。

| # | 分歧点 | saveCanvas 循环 | normalizeLegacySmartNode |
|---|---|---|---|
| 1 | 缺 `type` 的节点 | 不补 | 补成 `'smart-image'` |
| 2 | 裁剪触发条件 | 只认 `node.isCroppedVideo` | 额外认 `videoCropVersion` 与首图 `trimIn/trimOut` |
| 2 | 裁剪区间钳制 | `tOut <= tIn` 时强制 `tOut = tIn + 10` | 无此钳制（`trimOut:2` 保持 2，duration 落到 0.1） |
| 2 | 副作用 | 不改 `type/genKind` | 改写为 `smart-video` + `genKind:'video'` |
| 3 | 空生成板 | 仅 w/h 无效时补尺寸，不动坐标 | 额外在 `w===340`、`w===EMPTY_GEN_NODE_WIDTH`、`h>270 且无图` 时 resize **并平移 x/y 重居中** |
| 4 | 裁剪元数据写入范围 | 写**每一张** image | 只写 `images[0]` |
| 5 | 单图节点 w/h | 保留 | **`delete node.w; delete node.h`** |

第 5 条是决定性的：`normalizeLegacySmartNode` 删 w/h 对加载期的克隆对象是对的，
但 `saveCanvas` 改写的是**实时 nodes**，一存盘就把单图节点的尺寸抹掉，布局会当场塌掉。
第 2、3 条同样会在保存路径上制造用户可见的位置/尺寸跳变。所以按第 3、7 条要求，
**不强行合并，保留原逻辑**。

实际做的最小安全收敛：把那段 41 行的内联循环**逐字搬进** `canvas-state.js`，
命名为 `normalizeSmartNodesForSave(nodes, deps)`，主文件留同名包装
`function normalizeSmartNodesForSave(nodes){ return window.SmartCanvasState... }`，
`saveCanvas` 里 41 行变成一行 `normalizeSmartNodesForSave(nodes);`。
效果是：保存格式、字段、版本号、迁移结果**全部零变化**，但两套契约策略现在并排住在
同一个数据契约模块里，上表五条差异直接写成了函数上方的注释——分叉从「跨 31k 行文件的
隐性重复」变成「同一文件里并排的显式决策」。搬动沿用第 3 阶段的同名参数注入手法，
`nodes.forEach` 也原样保留（没加 `|| []` 兜底，null 仍会在同一位置抛错）。

`canvas-state.js` 331 → 387 行（19 个导出）；`smart-canvas.js` 31,592 → 31,553 行（−39）。
令牌递增为 `2026.09.19.canvas_split_p3_5`（三个画布脚本 + `CANVAS_FRAME_VERSION`）。

验收：`node --check` 全过；`smoke_check.py` `failed=0`；`canvas-state.js` 200 且与磁盘一致。
五道 gate 全绿，其中新增 `normalizeSmartNodesForSave` 等价组——两边都是**逐字同源的循环**
（旧侧把备份里的内联块重新包一层函数，新侧是真实包装 + 模块），输入是**节点数组**，
因此对实时 nodes 的就地改写本身也在比对范围内：116 组零差异。
总量 20 组 / 5,334 组比对零差异；重建 gate 与第 3 阶段备份逐字节相同；
模块读取的全局仍为 **0 个**；`window.*` 75 条赋值不变；第 2 阶段 13,700 组回归未受影响。
`data / assets / output / workflows / runtime_core / lan / server.py` 零改动（`-newermt` 与 md5 双重核对）。

**这道 gate 做过负向自检**：把提升后的循环里那条 `tOut <= tIn` 钳制删掉，等价组立刻在
对应的三个种子输入上报 6 个失败（两种 i18n 状态各 3 个）；还原后恢复全绿。

工具：`scripts/canvas_split_phase3_5.py`（搬迁脚本，带防重跑护栏；它同时校验内联块
含全部预期 token 且在文件中唯一，避免误搬同名的其它 `nodes.forEach`）。
`canvas_split_phase3_check.py` 扩展为覆盖第 3 与 3.5 阶段：新增 gate C 的内联块还原、
第 19 个导出的包装配对、以及五类分歧的种子夹具。它现在通过 `--main/--state/--backup`
接受路径覆盖，便于后续阶段先验预览再落地；内联块的定位逻辑与该脚本**各自独立实现**，
避免同一个错误假设同时满足搬迁和自证。

顺带记录一个**既存的数据往返不稳定**（本次未修，因为修它等于改变保存结果）：
旧画布若存在 `isCroppedVideo` 且 `trimOut <= trimIn` 的节点，加载期 normalize 不钳制、
保存期循环钳成 `trimIn + 10`，于是「打开—不改—保存」就会让 trimOut 跳增 10 秒、
duration 变成 10。这属于两套策略分歧（第 2 条）的直接后果，要不要修需要产品层面决定，
建议连同上表一起作为第 4/5 阶段的输入。

回退点：`D:/压缩包/canvas_split_phase3_5_backup_2026-09-19/`（第 3 阶段完成态的
`smart-canvas.js`、`canvas-state.js`、三个校验脚本与 `smoke_check.py`）。
更早：`canvas_split_phase3_backup_2026-09-19/`、`canvas_split_phase2_backup_2026-09-19/`。


## 第 3 阶段执行记录（2026-09-19）

新增 `static/canvas/js/modules/canvas-state.js`（331 行，18 个函数，无状态、无 I/O），
`smart-canvas.js` 由 31,838 行降到 31,592 行（-246）。

搬走的是「节点/画布数据 ↔ 存储格式」之间的纯转换：

- 设置克隆与存储清洗：`cloneSmartSettings`、`settingsForStorage`、`stripOutpaintDisplaySettings`
- 节点媒体数据持久化：`mediaItemForStorage`、`stripImageGenerationMeta`、`applyNodeMetaToImage`、
  `inheritNodeMetaFromImage`、`mergeSmartImageLists`、`countCanvasMediaItems`、
  `collectOversizedInlineImages`
- 节点规范化与旧数据迁移：`normalizeSmartImageMode`、`normalizeLegacySmartNode`、
  `clearSmartNodeTransientRunState`
- 节点序列化与画布存储对象：`serializableSmartNode`、`canvasForStorage`
- 导入数据规范化：`normalizeImportedSmartWorkflow`
- 撤销快照的临时字段清理：`pruneMediaItemForSnapshot`、`pruneNodeForSnapshot`

**关键手法：同名参数注入，函数体零改动。** 这些函数原本身兼两职——既是数据转换，
又直接读主文件的 `settings` / `canvas` / 布局常量。搬走后状态仍留在主文件，
由主文件的同名包装函数把它们原来依赖的全局**按引用**当参数传进去，
且参数名与原全局完全一致，所以函数体可以逐字节照搬、不做任何改写。
`canvasForStorage(canvas, canvasDefaultSmartSettings, initialSmartSettings, SMART_LOG_PREVIEW_NODE_ID)`
就是例子；主文件包装是
`function canvasForStorage(){ return window.SmartCanvasState.canvasForStorage(canvas, ...); }`。
`normalizeLegacySmartNode` 需要 6 个依赖（`tr`、`isEmptyGenBoard`、`isSmartVideoNode`、
`emptyGenBoardSizeFromAspect`、`EMPTY_GEN_NODE_WIDTH`、`mediaKindForItem`），
统一由主文件新增的小助手 `smartNodeMigrationDeps()` 在调用期组装。

`EMPTY_GEN_NODE_WIDTH` 必须留在主文件：它在本文件另有两处
`typeof EMPTY_GEN_NODE_WIDTH !== "undefined" ? ... : 320` 兜底，
搬进 IIFE 会让那两处**静默**从 340 退化成 320，属于会改变数据的情况。

明确没搬、且已核实原因的：

- `loadCanvas` / `saveCanvas` / `scheduleSave`：耦合局域网分支、`fetch`、DOM
  （`document.title`、`getElementById`）、`toast`/`tr` 与十余个主文件状态变量，按第 8 条要求不动。
- `saveLocalDraft` / `clearLocalDraft` / `getLocalDraft`：IndexedDB 读写，属 I/O，
  且依赖 `getDraftDB` / `DRAFT_STORE_NAME` 一整个子系统。
- `canvasSaveWouldDestroyAssets` / `rememberTrustedCanvasAssets` / `markCanvasPersistReady`：
  读写 `canvasPersistReady`、`canvasTrustedAssetSig` 两个主文件状态，是保存护栏不是数据转换。
- `selectedSmartWorkflowPayload`：读 `nodes`、`selectedNodeIds()`、`canvas.connections`，属第 6 阶段工作流。
- `snapshotForUndo`：读 `nodes`、`canvas`、`selectedId`、`selectedIds`；本次只搬走它依赖的
  `pruneNodeForSnapshot` / `pruneMediaItemForSnapshot` 两个纯清理函数。
- `migrateSmartGroupImageMembers` / `migrateGridSplitGroups` / `normalizeOrphanGridSplitChildren`：
  直接改写全局 `nodes` 数组，属状态写，留给后续阶段。
- `saveCanvas` 内部当时还内联着一段「逐节点补齐 videoCrop / genBoard 契约并清洗
  images/runSettings」的逻辑。本次没动它（改它等于重写 saveCanvas）；
  **已在第 3.5 阶段逐字搬进 `canvas-state.js` 的 `normalizeSmartNodesForSave`**，
  并查明它与 `normalizeLegacySmartNode` 是五类分歧下的两套策略，不可合并——
  见《第 3.5 阶段执行记录》。

HTML 与令牌：`canvas-state.js` 插在 `canvas-utils.js` 之后、`smart-canvas.js` 之前，
三个画布脚本版本号统一递增为 `?v=2026.09.19.canvas_split_p3`，
`CANVAS_FRAME_VERSION` 同步递增到同一令牌。

验收结果：`node --check` 全过；`smoke_check.py` `failed=0`；五道 gate 全绿——

- A 全局访问陷阱：单测 canvas-state.js 对全局的读取，加载期和调用期**均为 0 个**，
  即该模块不隐式依赖主文件任何东西。
- B 新旧等价：用 `data/canvases/` 全部 8 个画布、168 个真实节点（只读打开）加 44 个手写边界节点，
  在「有 i18n / 无 i18n」两种状态下跑同一表达式对比旧实现与新模块，
  同时比对返回值**和调用后被就地改写的入参**，共 5,218 组，零差异。
- C 无损重建：把 18 个包装替换回备份原实现并剪掉注入助手后，与备份逐字节相同。
- D 静态一致性：18 导出↔18 包装、模块顶层零全局、模块内零状态、无重名、
  75 条 `window.*` 赋值不变、加载顺序正确。
- E 解析期调用/TDZ：扫描 38 个解析期代码块（525 行），确认没有包装函数在其依赖的
  `const` 初始化之前被顶层调用；该 gate 已用两种故意注入的违规做过灵敏度自检，均被拦下。

工具脚本：`scripts/canvas_split_phase3.py`（搬迁清单，带防重跑护栏）、
`scripts/canvas_split_phase3_check.py` + `canvas_split_phase3_harness.js`（五道 gate，
可重复运行，测试夹具写到系统临时目录不进仓库）、
`scripts/canvas_asset_check.py`（从 HTML 自动抓取资源清单校验 200 与字节一致，后续阶段自动覆盖新模块）、
`scripts/canvas_split_phase2.py` 与 `scripts/canvas_split_equiv.py`（第 2 阶段的清单与回归）。
第 2 阶段的一次性重建/静态脚本已删除，其职责由本阶段的 C、D 承接。

回退点：`D:/压缩包/canvas_split_phase3_backup_2026-09-19/`（`smart-canvas.js`、
`smart-canvas.html`、`smoke_check.py` 三份，即第 2 阶段完成后的状态）。
第 2 阶段的原始备份仍在 `D:/压缩包/canvas_split_phase2_backup_2026-09-19/`。


## 第 2 阶段执行记录（2026-09-19）

新增 `static/canvas/js/modules/canvas-utils.js`（780 行，52 个函数 + 2 张分辨率查表），
`smart-canvas.js` 由 32,494 行降到 31,838 行（-656）。

模块形态：整体包在 IIFE 里，只对外暴露 `window.SmartCanvasUtils`，文件顶层不声明任何全局，
解析期不读取主文件的任何变量，因此可以安全地在 `smart-canvas.js` 之前加载。
主文件为每个搬走的函数保留同名同签名的委托包装，`window` 公共接口与 HTML `onclick` 全部不变。

搬走的 52 个函数按职责分组：

- HTML 转义：`escapeHtml`（`escapeAttr` 仍留在主文件，指向包装函数）
- 媒体 URL 解析：`smartOriginalMediaUrl`、`smartMediaPreviewUrl`、`proxiedMediaUrl`、
  `displayMediaUrl`、`playbackVideoUrl`、`outputUrlLooksVideo`、`isLocalCanvasMediaUrl`、
  `browserCanPlayHevc`、`sameMediaSrc`、`looksLikeImageMediaUrl`、
  `isRemoteVideoReferenceUrl`、`localDisplayUrlForMediaItem`、`imageForDisplay`
- 媒体尺寸缓存：`loadSmartOriginalImageDimensions`（缓存挂在 `window.__smartMediaDimensionCache`，
  不是词法状态，因此可以随函数一起搬）
- 媒体类型判定：`isVideoMediaItem`、`isAudioMediaItem`、`isTextMediaItem`、`isFileMediaItem`、
  `isInlineVideoActive`、`mediaKindForFile`、`mediaKindForItem`
- 文件名处理：`safeExportFileName`、`fileNameFromUrl`、`isMachineGeneratedMediaName`、
  `cleanMediaBaseName`、`escapeSemanticRegex`、`appendSemanticActionSuffix`、
  `extensionForMediaItem`、`downloadNameForMediaItem`、`smartImageNameFromUrl`、
  `imageNameLabel`、`imageResolutionLabel`
- 剪贴板：`copyTextWithCopyEvent`、`copyTextWithTextarea`、`clipboardMatchesText`、
  `copyTextToClipboard`
- 下载工具：`downloadBlob`
- 尺寸/比例计算：`normalizeImageRatio`、`getImageDimensions`、`getVideoDimensions`、
  `parseSizeValue`、`parseRatioValue`、`normalizedSizeLabel`、`mediaCoverWindow`、
  `getImageCropRatioValue`、`getSmartGhostDimensions`、`parseSmartAspectRatio`，
  以及只被这两个函数使用的 `STANDARD_IMAGE_RESOLUTIONS` / `STANDARD_VIDEO_RESOLUTIONS`
- 格式化：`formatMediaFileSize`、`getMediaFormatName`、`formatRunDuration`、
  `formatSmartVideoDurationTag`

明确没搬的（依赖画布状态或属于后续阶段）：`smartWorkflowFilename`（读 `canvas.title`）、
`downloadPreviewImage` / `downloadPreviewFile` / `downloadPreviewGroup` / `zipDownloadImageItems`
（读 `nodes`、`previewNavState`、`toast`）、`thumbDisplaySize`（依赖 `mediaLayoutSize` 布局）、
`mediaFileSizeCache` 及其读写函数（词法状态，留在主文件）、`smartPreviewImgHtml` 等 HTML 片段
构造器（属于第 4 阶段渲染）、`formatWorkflowTime`（属于第 6 阶段工作流）。

顺带修掉一处历史重复：`normalizeImageRatio` 在原文件第 1003 行和第 6813 行各定义了一次，
两份逐字节相同，后定义覆盖前定义，现已合并为一份。

HTML 侧：`canvas-utils.js` 插在 `canvas-trash.js` 之后、`smart-canvas.js` 之前，两者版本号
统一为 `?v=2026.09.19.canvas_split_p2`；同时把 `scripts/home/managers/project-manager.js` 的
`CANVAS_FRAME_VERSION` 递增到同一令牌，否则已打开的画布 iframe 会继续复用内存里的旧脚本。

验收结果：`node --check` 全过；`scripts/smoke_check.py` `failed=0`；新旧实现等价性对比
13,700 组输入（含局域网路由和 HEVC 支持开关共 4 种沙箱变体）零差异；把包装函数替换回原实现后
与备份逐字节相同；52 个包装函数在真实加载顺序下全部正确转发；`/static/canvas/js/modules/canvas-utils.js`
返回 200 且与磁盘内容 sha256 一致。

校验脚本：`scripts/canvas_split_phase2.py`（本次搬迁的权威清单，带防重跑护栏）与
`scripts/canvas_split_equiv.py`（新旧等价回归，仍可重复运行）。
本阶段的一次性重建/静态检查脚本已在第 3 阶段收敛掉，职责由
`canvas_split_phase3_check.py` 的 C、D 两道 gate 承接。

回退点：`D:/压缩包/canvas_split_phase2_backup_2026-09-19/`（`smart-canvas.js`、
`smart-canvas.html`、`smoke_check.py` 三份原始文件）。

## 第 5.1 阶段执行记录：磁性吸附计算拆分（2026-09-19）

新建 `static/canvas/js/modules/canvas-interaction.js`，搬出
`calculateSmartMagneticSnap()`。该函数只读取拖动节点、候选节点、视口缩放和节点边界，
返回吸附后的坐标及辅助线数据；拖动事件、状态写入和辅助线 DOM 绘制仍保留在主文件。
主文件通过 `interactionDeps()` 注入依赖，原调用签名不变。

旧实现与新模块在 400 组不同缩放、阈值、候选节点、拖动分组和边界输入下结果完全一致。
`node --check`、`smoke_check.py` 和 `canvas_asset_check.py` 全部通过；六个画布脚本的
加载顺序与缓存版本 `2026.09.19.canvas_split_p5_1` 已同步。

同阶段继续拆出 `screenToWorld()`，它只负责把屏幕坐标换算为画布世界坐标，主文件通过
`interactionDeps()` 注入容器、视口和安全缩放函数。旧实现与新模块在 300 组不同视口、
容器位置、缩放和事件输入下结果一致；缓存版本更新为 `2026.09.19.canvas_split_p5_2`。

## 比例调整后连线刷新修复（2026-09-19）

修复 `applyEmptyGenBoardAspect()` 直接改变空生成板节点位置和尺寸后未刷新连线层的问题。
比例改变完成后现在会标记小地图几何过期，并通过现有的 `scheduleInteractionLayerRefresh()`
统一刷新连线和小地图；连线算法、连接数据和用户画布数据均未修改。画布缓存令牌同步更新为
`2026.09.19.canvas_split_p5_3`。

## 第 4.3b 阶段执行记录：小地图纯数学拆分（2026-09-19）

将小地图的几何范围计算和矩形投影计算移入 `canvas-renderer.js`，主文件只保留小地图
状态、DOM 更新、刷新调度和事件处理。计算公式、最小尺寸和边界留白均保持不变，
缓存令牌同步更新为 `2026.09.19.canvas_split_p5_4`。

随后继续拆出 `worldToScreen()` 与 `viewportCenter()`。两者同样只做坐标计算，
不写 DOM、不修改交互状态；旧实现与新模块在 300 组不同容器、视口、缩放和坐标输入下
结果完全一致。

## 第 5.2 阶段执行记录：边缘自动平移速度计算（2026-09-19）

将鼠标距画布四边的距离换算成自动平移速度的纯计算移入 `canvas-interaction.js`。
拖动状态、缩放状态、素材面板遮挡判断和动画调度仍留在主文件，模块不读取 DOM 或可变状态。
缓存令牌同步更新为 `2026.09.19.canvas_split_p5_5`。

## 第 5.3 至第 6 阶段执行记录：交互收尾与功能边界（2026-09-19）

一次完成六个小步骤：选择框几何进入 `canvas-interaction.js`；新增 `canvas-workflow.js`、
`canvas-assets.js`、`canvas-generation.js`、`canvas-media-editor.js`、
`canvas-collaboration.js`，分别承接各功能中的纯计算、格式化、校验和合并逻辑。
DOM 面板、网络请求、任务轮询、保存、可变协作状态与用户数据仍由主文件单点管理。

清理全仓库零引用的旧 `SIZE_MAP`。所有模块继续使用传统脚本和主文件同名包装，未改变
HTML 内联入口或保存格式。最终缓存令牌为 `2026.09.19.canvas_split_p6_final`。
至此停止继续拆分画布核心；后续只做具体功能或性能问题，不再为了缩短主文件而拆状态型代码。

总回归同时修复一处既有注入遗漏：`canvas-renderer.js` 的虚拟化活跃节点判断需要
`dragState`，现由 `rendererDeps()` 显式传入，避免大量节点时正在拖动的节点被错误剔除。

最终检查：`smoke_check.py` 为 `failed=0`；11 个画布核心脚本资源全部返回 200、顺序正确且
缓存令牌一致；第 2 阶段 13,700 组、第 3 阶段 5,434 组、布局与连线各阶段回归全部通过；
新增功能模块契约检查与 1,024 组宫格计算对照通过。未启动新的浏览器实例，界面验收由用户完成。
