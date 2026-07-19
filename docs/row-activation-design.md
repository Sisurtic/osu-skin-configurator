# 行激活边 (Row Activation Edge) 设计文档

## 0. 目标与一句话定义

允许表格组里"选中某行的某个 option 时,**单向**强制另一行的某个 option 被选中、并禁用该目标行的其他 option",用来表达主从/蕴含关系。

例:父行 Style 有 C/D/S,选中 C 时自动锁定子行 LN-Style 的 C,并禁用 LN-Style 行的 D/S。用户只点一次,多处受控。

本文档是实施参照,不是已实现的功能。所有"现有"行号/函数以核实时的代码为准。

---

## 1. 背景:为什么需要它

mania 皮肤有 Note 和 LN 两类对象。Note 有 C/D/S 三种样式;LN 在 C/D/S 之上还有 Normal/Percy 两种 mode,Percy 又有 P1/P2/P3 三种 variant。需求:

1. **每个预设只写一次**(无内容冗余):Note-C preset 只管 Note,LN-C preset 只管 LN,Percy-P1 preset 只管 Percy。
2. **联动**:选 Note 的 C 时,LN 也应落到 C。
3. **正交下钻**:Style 定了之后,LN 能单独再选 N/P,P 能再选 P1/P2/P3,且不污染 Note。

这三条在"一个单选行"模型下互斥。激活边把"联动"从内容冗余/操作两次,变成**一次选择自动约束另一行**——于是三条同时满足。

### 为什么不用级联钩子,用声明式边

级联钩子(在 `tableRowSelection` 写入处硬编码"选 C 就改 LN")是隐式行为,每种联动都要专门写。激活边是**显式数据**:用户在编辑模式拖拽绑定,存成一张表;一个通用重算器吃所有边。比钩子干净、可复用、可显示。

---

## 2. 现有架构(已核实,不动)

表格组(`group.type === "table"`)是仓库里唯一带"选择 + 应用"语义的系统。三个关键不变量:

### 2.1 展开 = 选中,二者强制绑定
- 子表格组的子行只有在该子表格组**被选中**(→ 派生展开态)时才被 `collectTableRows` 渲染。
- `preset-selector.js` line 575 `sel[rowKey] = groupKey` 紧跟 line 576 `expanded[ownerGid].add(childGid)`:选中和展开是同一点击的两个副作用。
- line 594-603 的循环:凡 `sel` 值是 `'group:xxx'` 的行,强制把 xxx 加进 `expanded`(展开是选中的派生,不是独立可点的箭头)。
- 取消选中(line 552-559 / 566-573 mutex)同步把子表格组移出 `expanded`,`collectTableRows`(line 791)不再递归,子行从渲染消失。
- **结论:不存在"展开但未选中"或"选中子行而父行未选中"的状态**,这是结构性强制。

### 2.2 `tableRowSelection` 是 single source of truth
- 后端 `preset_applier.rs` `collect_units`(line 836-889)只做一件事:`collect_table_rows` 算出可见行 → 对每行**直接读 `tableRowSelection[rowKey]`**(line 860)→ 是 presetId 就查 actions 推进 ini/copies/deletes/tints 桶,是 `'group:xxx'` 就递归。
- 后端**不读激活边、不重算选择**。line 754-755 注释:"A row's selection is read from tableRowSelection[rowKey]"——读,不是算。
- **结论:激活边子系统是纯前端 + `compact_ids` remap。后端 apply 链路零改动。** 对后端而言"用户点的 a1"和"激活边锁的 a1"不可区分,都是 `sel[rowKey] === 'a1'`,走同一个查表分支。

### 2.3 交替嵌套,行内仅 1 层普通子组
- 表格组 → 行(普通子组)→ 子表格组 → 行 → … 严格交替。`flatten_group_subgroups`(preset_manager.rs)阻断三层普通组。
- 嵌套深度无硬上限,`table_expanded_children` 按 gid 键控支持多级展开。

### 2.4 seed 兜底
- line 586-592:每次选择变化后,循环扫描所有可见行,把**未选中**的行填成左起第一项。语义是"每行必有选"。

---

## 3. 数据结构

新增第三张按 gid 键控的表格状态 map,与 `tableExpandedChildren` / `tableRowSelection` 并列。

### 3.1 `tableActivations`

```js
// state 字段,持久化,结构:
tableActivations: {
  // 按源表格组分桶;重算时按组遍历
  "<srcGid>": [
    {
      srcRowKey:  "<源 rowKey>",        // collectTableRows 产生的稳定路径 "<gid>:<gid>:..."
      srcOption:  "<源 option>",        // presetId 或 'group:<gid>',与 sel[rowKey] 存法一致
      targets: [
        { dstGid, dstRowKey, dstOption } // dstOption 同 srcOption 的两种形态
        // ...
      ]
    }
    // ...
  ]
}
```

### 3.2 存 rowKey 不存索引
行索引随展开/重排漂移;rowKey 是 `collectTableRows` 算出的稳定路径,与 `tableRowSelection` 用同一个键,天然一致。这也支持"绑定暂时不可见的目标行"——rowKey 稳定,目标展开后边才生效。

### 3.3 option 的两种形态(与现有 `sel` 一致)
- preset option → 存 `presetId`(数字)
- group option(子表格组)→ 存 `'group:<gid>'`(字符串)
重算器赋值时直接写,不用转换。

---

## 4. 核心不变量:`sel` 的所有权

一个行的 `sel` 值有三个潜在写者,必须定死优先级,否则闪烁:

| 写者 | 何时写 | 优先级 |
|---|---|---|
| 用户点击 | option click handler(line 535) | 事件源,最先 |
| seed 循环 | 选择变化后(line 586-592) | 中,但**豁免锁定行** |
| 激活重算器 | 选择变化后(新增) | **最高,最后跑,无条件覆盖锁定行** |

**三条铁律:**

1. **锁定行豁免 seed 循环。** 收集所有激活边命中的 `dstRowKey` 成 `lockedRows`;seed 循环里 `if (lockedRows.has(row.rowKey)) continue;`。否则 seed 先填左起第一项、重算器再覆盖,中间帧错态。
2. **锁定行拦截用户点击。** option click handler 开头:`if (lockedRows.has(rowKey)) return;`。否则用户能手动改一个本该被激活边管的行,改完又被下次重算覆盖,体验崩。
3. **激活重算器最后跑。** 顺序:用户点击 → mutex 清理(line 552-559)→ seed 兜底 → **激活重算器收尾覆盖** → 写 state。锁定行的值完全归激活边管,seed 填什么无所谓。

**重算器循环顺序** = 用户点击 handler 内现有的 while 循环(line 580-605)之后,追加激活重算;或并入该循环。关键是它必须在 seed 之后。

---

## 5. 激活判定:仅对展开行生效

> 细节(用户确认):如果一个 option 指定了多个目标,应当仅应用**展开行**的对象。

例:父行 A/B/C,A 展开 a1/a2/a3、B 展开 b1/b2/b3、C 展开 c1/c2/c3,同时绑了 A→a1、B→b1、C→c1。选中 A 时**只锁 a1**;B→b1、C→c1 休眠(B、C 未选中,其子行不在渲染输出)。

### 判定规则(三条全满足才激活)
一条边生效,当且仅当:
1. 源 option 的**父行**在 `collectTableRows` 当前输出里(源 option 所在层已展开),且 `sel[srcRowKey] === srcOption`(源 option 被选中);
2. 目标行在 `collectTableRows` 当前输出里(目标层已展开)。

新增的是第 2 条"目标行在渲染输出里",它自动过滤"B→b1 在选 A 时不生效"(b1 行不在输出)。**零新增标志位**——`collectTableRows` 结果本来就要遍历,顺带 `has` 一下。

### 这带来的简化
- **多源指向同一目标行不再是冲突。** 同一时刻只有一个源处于激活态(只有被选中 option 的子行被展开)。处理规则:遍历所有边,目标行被多条命中时取源激活的那条;理论上不会多条同时激活(同行 option 互斥),保险起见后写赢。**编辑模式无需检测绑定冲突,可自由绑定。**
- **收起不清 `sel` 是安全的。** a1 行随 A 收起从渲染消失;后端只遍历可见行(`collect_units` line 859),残留 `sel` 不被读;再展开 A 时激活边重新求值覆盖。与 `tableRowSelection` 现有"不主动清"一致,免费自洽。

---

## 6. 重算器伪代码

挂在 line 580-605 的 while 循环之后(或在循环末尾追加一轮)。输入:`collectTableRows` 当前输出、`sel`、`expanded`、`tableActivations`。

```
function recomputeActivations(g, groups, expanded, sel, activations):
  renderedRows = collectTableRows(g, groups, expanded, 0, null)
  renderedSet  = set(r.rowKey for r in renderedRows)

  // 第一步:确定哪些边激活态生效,算出每行的强制值
  lockedValue = {}    // rowKey → 被强制选中的 option
  edges = activations[g.id] || []
  for edge in edges:
    if edge.srcRowKey in renderedSet \
       and sel[edge.srcRowKey] == edge.srcOption:
      for t in edge.targets:
        if t.dstRowKey in renderedSet:           // 目标行可见才锁
          lockedValue[t.dstRowKey] = t.dstOption  // 多源命中:后写赢(理论不并发)

  lockedRows = set(lockedValue.keys())

  // 第二步:写 sel + 算每行的禁用 option 集合
  disabledOptions = {}   // rowKey → set(被禁 option key)
  for rowKey, opt in lockedValue:
    sel[rowKey] = opt
    row = find(renderedRows, r => r.rowKey == rowKey)
    if row:
      disabledOptions[rowKey] = set(optionKey(o) for o in row.options if optionKey(o) != opt)

  // 第三步:刚解锁的行(上一轮 locked、本轮不 locked)回退到左起第一项
  for row in renderedRows:
    if row.rowKey not in lockedRows and wasLockedLastRound(row.rowKey):
      sel[row.rowKey] = optionKey(row.options[0])   // seed 语义
  clearWasLockedLastRoundFlags()

  return { sel, lockedRows, disabledOptions }
```

`optionKey(o)`:`o.kind === 'preset' ? o.id : 'group:' + o.id`(与 `sel` 存法一致)。

**`lockedRows` / `disabledOptions` 要随渲染输出一起算并暴露**,供:
- seed 循环(line 586-592)查 `lockedRows` 豁免;
- click handler(line 535)查 `lockedRows` 拦截;
- option 渲染(line 853/862)查 `disabledOptions` 加禁用态。

建议把这三个集合挂在本次 render 的闭包/模块变量上,渲染完即弃;或随 state 走(若需跨 handler 共享)。

---

## 7. 禁用态渲染与交互

### 7.1 渲染(line 853 / 862)
option 渲染时,若 `disabledOptions[rowKey].has(optionKey(opt))`,加 disabled class:

```js
const isDisabled = (disabledOptions[row.rowKey] || []).has(optionKey(opt));
// class 追加 'preset-group__table-option--disabled'
// 红色高亮锁定值:class 追加 'preset-group__table-option--activated'
```

锁定值(被激活边强制选中的)红色高亮;同行其他 option 深色禁用不可选(视觉规范见第 11 节)。

### 7.2 交互
- click handler(line 535)开头:`if (lockedRows.has(rowKey)) return;`(锁定行整体不可点)。
- 单个 disabled option:点击无响应(由上面行级拦截覆盖,或额外按 option 粒度拦截)。

---

## 8. 编辑模式:绑定 UI

### 8.1 位置
基本信息 → 预览图下方 → 加一个"激活绑定"选择列表。

### 8.2 拖拽引用(不带子项)
- 用户把要绑定的源 option(预设/复选组)拖进列表,产生一个**引用条目**,源对象保持在树里原位、**不在树里搬动**。
- "不包括子项":拖拽只引用该节点本身,不连带其子树移动(区别于现有 nest/reorder 的子树移动语义)。
- 落点判定、ghost、生命周期(被引用节点删了/改名了,见第 9 节)需单独处理。

### 8.3 路径显示
- 复用 `parseOwnerGid` + rowKey 路径格式(`<gid>:<gid>:...`),渲染成 `mania ▸ LN ▸ Style ▸ C`。
- 与全局快捷键的路径显示同构,**零新机制**。

### 8.4 绑定语义
每条绑定 = {源 option, 目标行, 目标 option}。UI 上表达成"当 [源] 被选中时,锁定 [目标行] 的 [目标 option]"。多目标可批量绑定(一个源 option 指向多个目标)。

---

## 9. `compact_ids` remap

`compact_ids`(preset_manager.rs)现在已 remap `tableExpandedChildren` 和 `tableRowSelection`。`tableActivations` 要加**第三个 remap**,且更复杂——rowKey 内含 gid 段,必须拆开逐段 remap。

### 9.1 新函数 `remap_row_key_path(rowKey, idMap)`
现有两个 remap 不碰 rowKey 内部(`tableRowSelection` 的 value 里的 rowKey 被原样保留,因为 rowKey 不是 id)。但激活边的 rowKey **内含 gid 段**,必须:

```
function remap_row_key_path(rowKey, idMap):
  parts = rowKey.split(':')
  out = []
  for p in parts:
    if p == '__direct__': out.push(p)
    else if isNumeric(p): out.push(reemit_id(parseInt(p), idMap))   // 保持 number/string 类型
    else if p.startsWith('group:'): out.push('group:' + reemit_id(parseInt(p[6:]), idMap))
    else out.push(p)   // 兜底,不动
  return out.join(':')
```

用现有 `id_as_i64`(接受 number 或 numeric string)+ `reemit_id`(保持原类型:string in → string out,number in → number out)逐段处理。

### 9.2 `tableActivations` 的 remap
- 外层 key `srcGid` → gid remap。
- `srcRowKey` / 每个 `targets[].dstRowKey` → `remap_row_key_path`。
- `srcOption` / `targets[].dstOption` → presetId remap,或 `'group:<gid>'` 里的 gid remap。
- `targets[].dstGid` → gid remap。

### 9.3 drop 规则(保守,宁删勿错)
- `srcGid` 没了 → 整个桶删。
- `srcRowKey` 路径里任何一段 gid 没了 → 这条边删。
- `srcOption` / `dstOption` 的 presetId 或 gid 没了 → 这条边删。
- 目标 `dstGid` 没了 → 该 target 删(若 targets 空了,整条边删)。

### 9.4 测试
`#[cfg(test)] mod compact_tests` 加 `tableActivations` 用例(参照现有两个 remap 的测试,覆盖 number/string 两种 id 类型 + rowKey 多段路径)。

---

## 10. 改动清单

| # | 文件 | 位置/函数 | 性质 |
|---|---|---|---|
| 1 | preset-selector.js | state 初始化、saveTableState、`state.on('tableActivations', ...)` | 新增字段,仿现有两个 map |
| 2 | preset-selector.js | `recomputeActivations`(新函数),挂 line 580-605 循环之后 | **核心新逻辑** |
| 3 | preset-selector.js | line 586-592 seed 循环加 `lockedRows` 豁免 | 改现有 |
| 4 | preset-selector.js | line 535 click handler 开头加 `lockedRows` 拦截 | 改现有 |
| 5 | preset-selector.js | line 853/862 option 渲染加 disabled/activated class | 改现有 |
| 6 | preset-editor.js / preset-list.js | 基本信息 → 预览图下 → 激活绑定列表 + 拖拽落点 | 新 UI |
| 7 | preset-list.js | 拖拽引用(不带子项,区别于 nest 子树移动) | 新逻辑 |
| 8 | (复用) | `parseOwnerGid` + rowKey 路径 → 路径显示 | 零新机制 |
| 9 | preset_manager.rs | `compact_ids` 加第三个 remap + `remap_row_key_path` | 改现有 + 新函数 |
| 10 | preset_applier.rs | — | **无改动** |

---

## 11. 视觉规范(待定,占位)
- 锁定值(被激活选中):红色高亮(具体色值/对比度待定,参考现有 `--activated` 或新增 token)。
- 同行禁用 option:深色、不可选、鼠标 not-allowed。
- 激活绑定列表条目:路径面包屑 + 删除按钮。

---

## 12. 边界与未决(实施时确认)

1. **v1 仅 preset option 激活。** group option(子表格组)作为 srcOption/dstOption 时,重算器除写 `sel` 还要同步 `expanded`(耦合 line 594-603 循环)。建议 v1 拒绝 group option 参与激活边,v2 再加。
2. **v1 限制源/目标在同一顶层表格组内。** 跨组激活边让 rowKey 解析和 remap 都变复杂,收益不大。rowKey 的 `parseOwnerGid` 能解跨组 owner,但建议先收口。
3. **"刚解锁行"的回退值。** 伪代码第三步用左起第一项(seed 语义)。也可考虑"回退到激活前的上一个用户选择"——但这要存历史,增加复杂度,建议 v1 用左起第一项。
4. **锁定行的 `sel` 残留。** 收起不清,展开时重算覆盖(第 5 节已论证安全)。
5. **option 粒度 vs 行粒度拦截。** 第 4 节按行级拦截(`lockedRows.has(rowKey)`),够用;若要更细(锁定行内仍能点锁定值本身做视觉反馈),按 option 粒度放行锁定值、拦其他。

---

## 13. 验证场景

- **场景 1(基本联动)**:Style 行选 C → LN-Style 行锁 C、D/S 禁用、C 红色高亮。后端 apply 得到 Note-C + LN-C。
- **场景 2(切换源)**:Style 改选 D → LN-Style 锁 D,C 禁用恢复可用,D 可用。无闪烁(seed 豁免 + 重算器最后跑)。
- **场景 3(下钻)**:选 C 后展开 Percy,选 P1 → apply 得到 Note-C + LN-C + Percy-P1。LN-Style 仍锁 C 不受影响。
- **场景 4(展开过滤)**:A/B/C 各绑 a1/b1/c1,选 A 只锁 a1,b1/c1 不生效(b1/c1 行不在渲染输出)。
- **场景 5(收起残留)**:选 A 锁 a1,改选 B,再选 A → a1 重新锁定,无残留错态。
- **场景 6(删 preset)**:删被引用的 preset → `compact_ids` remap 或 drop 该边,apply 不崩。
- **场景 7(跨组忽略)**:v1 拒绝/忽略跨顶层表格组的绑定。
