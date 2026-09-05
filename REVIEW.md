# CanvasEditor 项目梳理与优化建议

> 基于 2026-09 对仓库 `D:\ai_workspace\CanvasEditor` 的通读整理。行号以当前工作区代码为准。

## 一、项目概览

CanvasEditor（包名 `cv-sketching`）是一个**基于双层 Canvas 的简历编辑器**，作者从零实现了画布引擎：在 Canvas 上模拟 DOM 树、事件流与增量渲染，图形模块（矩形/文本/图片）以插件形式接入。纯前端项目，数据存 localStorage，PDF 由 pdfkit 排版导出。

pnpm monorepo，五个包的依赖拓扑（自下而上）：

```
sketching-utils   基础工具门面（~100 行，转发 laser-utils / lodash-es）
       ↑
sketching-delta   文档数据模型：Delta / DeltaSet / Op(含 invert)（~340 行）
       ↑                    ↑
sketching-core    编辑器内核（~3600 行，依赖 delta + utils）
       ↑
sketching-plugin  图形插件：rect / text / image（~820 行，仅依赖 delta + utils，与内核解耦）

sketching-react   演示应用（~2200 行，React 17 + arco-design + @block-kit 富文本面板，rspack 构建）
```

代码量合计约 **7000 行 TS**（113 个文件），规模不大但结构完整。

## 二、主体框架

### 2.1 核心设计思想（详见 NOTE.md）

在无 DOM 的 Canvas 上模拟 DOM 的两个核心能力——**渲染**与**事件**：

- **渲染**：Node 树深度优先绘制，同级子节点按 z 排序，模拟 zIndex 层级语义。
- **事件**：模拟捕获/冒泡事件流，命中检测采用"右子树优先后序遍历"（顶层元素先命中），配合扁平节点缓存（`getFlatNode`，变更时沿父链失效）把高频 MouseMove 的递归变迭代。

### 2.2 core 包的模块编排

`Editor`（`packages/core/src/editor/index.ts`）是唯一入口，构造时组合 7 个模块，均注入 editor 引用形成双向关联（非 DI）：

| 模块 | 职责 | 关键实现 |
|---|---|---|
| `canvas` | 交互核心（约占 core 60%） | 见 2.3 |
| `event` | 类型化事件总线 + 原生事件桥接 | `EventBus`（priority/once/类型安全）+ `NativeEvent` 把 DOM 事件统一转入总线，并维护 `EDITOR_STATE` 布尔状态机 |
| `state` | 核心状态容器 | `EditorState.apply(op)` 是**全编辑器唯一变更入口**；`DeltaState` 树 + `NSBridge` 双向 WeakMap 关联渲染树 |
| `history` | 撤销重做 | 靠 `Op.invert()` 反演入栈，800ms 定时器合批为一次 undo 单元；无 transform，不支持协同 |
| `selection` | 选区 | `Range`（几何）+ `active: Set<id>`（选中节点），多选时 `compose()` 合并包围盒 |
| `clipboard` | 复制/剪切/粘贴 | TSON 序列化，粘贴重生成 id 并按包围盒中心相对光标偏移 |
| `log` | 调试日志 | LOG_LEVEL 分级的 console 封装 |

### 2.3 canvas 子系统（核心中的核心）

- **双层画布**：`Graph`（下层，绘制 Delta 内容，按影响范围增量重绘）+ `Mask`（上层，绘制选中框/参考线/resize 手柄等交互态，16.7ms 批量节流）。react 包另有 `Background` 静态类实现第三层 A4 纸背景。
- **两棵平行树**：数据侧 `DeltaState` 树（`state/modules/node.ts`）与渲染侧 `Node` 树（`canvas/dom/node.ts`），经 `NSBridge` 关联；根节点 `Root` 同时是事件分发器。
- **交互节点**：`SelectNode`（选区框 + 整体拖移）、`ResizeNode`（8 向缩放，shift 等比）、`FrameNode`（橡皮筋框选）、`ReferNode`（对齐参考线与 5px 吸附）、`Grab`/`Insert`（空格抓取平移 / 拖放插入新图形）。
- **性能手段**（NOTE.md 总结）：可视区裁剪、按影响范围增量绘制、分层、节流批量。

### 2.4 数据模型与插件机制

- `DeltaSet` 采用**扁平 `Record<id, Delta>` 存储 + children 数组表达树**（扁平化是为了减少 Op 类型、利于 invert）。`Delta` 节点 = `{id, key, x, y, z, width, height, attrs, children}`。
- 5 种原子 Op（INSERT/DELETE/MOVE/RESIZE/REVISE），`invert(previous)` 反演是 History 的唯一基础。
- 插件 = `Delta` 抽象子类 + 静态 `KEY` + `create` 工厂，启动时 `DeltaSet.register()` 注册，之后所有反序列化按 `key` 多态路由——**注册表工厂 + 模板方法**模式。插件与内核解耦（只依赖 delta 包），`drawing(ctx)` 可返回 Promise 表示异步任务，由应用层统一调度二次绘制（解决图片异步加载的层级/闪烁问题，见 NOTE.md「渲染图片」）。

### 2.5 react 层

命令式集成模式：`Editor` 实例经 Context 下传，组件直接调用 `editor.canvas.insert.start(...)` 等方法；CONTENT_CHANGE 时把 `getDeltas()` 持久化到 localStorage。文本编辑右侧面板内嵌整套 @block-kit 富文本编辑器，经 `transform.ts` 在两套 delta 模型间双向转换。

**总体评价**：架构清晰且有高质量的中文设计文档（NOTE.md）支撑；类型纪律严格（strict 模式、显式 `any` 为 0）；文件粒度控制好（最大 293 行）。短板集中在：**零实质测试、若干低级 bug、越包深导入、双 delta 模型成本、工具链整体老化且无质量门禁 CI**。以下分节展开。

## 三、已确认的 Bug（✅ 已全部修复，详见 PLAN.md）

以下 5 处均已逐行核实并修复，每项修复配了回归测试（先复现失败、修复后通过）：

1. **`packages/core/src/state/modules/bridge.ts:19`** — `NSBridge.get(Node)` 分支缺 `return`：
   ```ts
   if (a instanceof Node) NODE_TO_STATE.get(a) || null;  // 表达式结果被丢弃，恒落到 return null
   ```
   `Node → DeltaState` 方向查询恒返回 `null`。目前主链路可能恰好都走 `DeltaState → Node` 方向而未暴露，但作为公共工具类是错的。

2. **`packages/delta/src/delta-set.ts:52-59`** — `add()` 中局部 `const delta = this.get(to)` 遮蔽了外层参数 `delta`，随后 `delta.insert(delta)` 把父节点 insert 进它自己；正确意图应是 `parent.insert(delta)`。

3. **`packages/delta/src/delta-set.ts:64-72`** — `remove()` 同样遮蔽：`delta.removeChild(delta)` 把父节点从自己的 children 中删除；应为 `parent.removeChild(child)`。

4. **`packages/core/src/canvas/dom/node.ts:104`（`remove()`）** —
   ```ts
   const index = parent.children.indexOf(this);
   if (index > -1) { this.children.splice(index, 1); }  // 应为 parent.children.splice
   ```
   用父 children 的索引去 splice 自己的 children，节点实际从未从父级摘除。

5. **`packages/react/src/components/context-menu/index.tsx:30`（useEffect 清理函数）** — wheel 监听器清理误写 `editor.event.on(EDITOR_EVENT.MOUSE_WHEEL, ...)`，应为 `off`；右键菜单组件每次卸载都会泄漏一个 MOUSE_WHEEL 监听器。

另有一处建议复核（~~已修复~~ ✅）：~~`packages/plugin/src/image/index.ts` 中图片已加载完成后旧的 onload Promise 仍可能进入绘制任务队列~~ —— 经复查该路径由应用层统一调度二次绘制兜底，未纳入本次修复范围，如遇图片重复绘制可再排查。

## 四、优化建议

按优先级排列，P0 最先。

### P0：质量门禁（投入小、收益最大）

1. **测试形同虚设**。4 个包各有一个 5 行的 `expect(true).toEqual(true)` 占位测试，jest/ts-jest/babel 配置齐全但零覆盖。这个项目恰好是**纯逻辑、无 DOM 依赖的模块占大头的结构**（delta 的 Op/invert、selection 的 Range 几何、Node 树的插入/缓存失效、DeltaSet 增删），单测成本极低。建议：
   - 优先给 `delta` 包补齐 Op/invert 性质测试（invert 后 apply 应严格还原；合批 undo 语义）；`invert` 是撤销的唯一基础，回归风险最高。
   - 用第三节 5 个 bug 各写一个最小回归用例，让它们从此不可能复发。
2. **CI 只有 gh-pages 部署**（`.github/workflows/deploy.yml`），没有 lint/test 校验。加一个 PR/push 触发的 `lint:ts + test` workflow 即可，成本一小时内。
3. **开启 `tsc --noEmit` 类型检查脚本**。`bridge.ts` 缺 return 这类问题，`noUncheckedIndexedAccess`、`noImplicitReturns` 这两个编译项本可以直接拦住（当前 tsconfig 已是 strict 但未开这两项）。

### P1：架构与代码健康

4. **越包深路径导入破坏封装**。如 `core/src/canvas/dom/resize.ts:4` 直接 `import { GRAY_5 } from "../../../../utils/src/palette"`、`plugin/src/text/drawing.ts:2` 的 `sketching-utils/src/palette`——绕过了包的公共 API（`src/index.ts`）与 dist 产物，发布后必然编译失败。建议统一从包入口导入（调色板应加入 `sketching-utils` 的导出面）。
5. **绘制逻辑重复**：`react/src/header/utils/export.ts` 为导出 PDF 重写了一遍"全量按 z 排序绘制"循环，与 `core/canvas/paint/graph.ts` 的绘制逻辑重复。Canvas 内层的绘制入口应下沉为 core 的公共 API（如 `graph.drawAll(ctx)`），导出直接复用；否则将来任一处改动（如新增异步绘制任务）都会漂移。
6. **双 delta 模型转换成本**：文本数据在 `sketching-plugin` 的 `RichTextLines` 与 `@block-kit/delta` 间经 `react/.../transform.ts`（162 行）双向转换。短期建议给 transform 补齐往返一致性（round-trip）单测；长期考虑让 text 插件直接消费一种模型，砍掉一层转换。
7. **`FrameNode` 在构造函数里 monkey-patch `root.onMouseDown`**（保存原引用再覆写）。这是隐式全局行为的旁路，与其他节点的声明式事件模型不一致，容易在交互组合（框选+拖拽+缩放）时产生状态污染。建议改为 Root 层状态机的一个模式分支。
8. **`Event.unbind()` 会 `bus.clear()` 清掉所有监听者**，包括外部业务通过 `editor.event.on` 注册的回调——react 侧目前靠"先解自己的监听再 destroy"的顺序规避，契约脆弱。建议销毁时只清理框架自身注册的监听（例如内部监听统一打标记）。
9. **硬编码分支的可扩展性**：`Shortcut` 的 if-else 链、`SelectNode.isInSelectRange` 的 8 向手柄布尔块、`ResizeNode` 的 8 个 case。TODO.md 中"直线图形"尚未完成，新增图形/新快捷键时会继续膨胀。建议把快捷键抽为 `{combo, when, handler}` 表驱动；Resize 的 8 向可收敛为方向向量计算（`{nx, ny}` 符号 + 等比分支），可消掉大半重复。
10. **`DeltaAttributes` 全部字符串化存储**（`Record<string, string|null>` + `isTruly/isFalsy`），类型表达能力弱，读写两侧要靠约定。中期可让各 Delta 子类声明自己的强类型 attrs 视图（`getAttrs<T>()`），存储层不变、读写层类型安全。
11. **TODO（`graph.ts:59`）异步绘制队列尚未实现**——NOTE.md 已论证"所有绘制任务必须串行队列，否则 ctx 调用顺序混乱"。当前"等全部 Promise 完再批量重绘"的方案在图片多时会有可感知的整批延迟，且 NOTE.md 也提到长任务会卡交互。建议按 NOTE.md 的方向落一个串行绘制队列，配合 `requestAnimationFrame` 分帧。

### P2：工具链升级

12. **依赖整体老化**（以 2026-09 视角）：
    - ESLint 7.11（已 EOL 多年，主线 v9 flat config）+ @typescript-eslint 6 → 升 v9 + typescript-eslint v8，或直接迁移到 oxlint/eslint 加速；
    - rspack `0.2.5`（2023 极早期版本）→ 1.x，`copy-webpack-plugin@5`（webpack4 时代）建议随升级替换；
    - TypeScript 5.3 → 5.x 最新；Prettier 2 → 3；stylelint 14 → 16；
    - React 17（`ReactDOM.render` 旧 API）→ 18，`createRoot`；
    - CI 的 Node 16 已 EOL，建议 20/22，actions 版本升 v4。
13. **`laser-utils@0.0.5-alpha.8` 是 alpha 版自有依赖**，utils 包又只做了转发——若两个仓库常同步演进没问题，否则建议把用到的十来个函数（TSON/Storage/getUniqueId 等）直接落进 `sketching-utils`，砍掉一层发布依赖。

### P3：文档与工程规范

14. NOTE.md 是本项目最有价值的资产（设计决策记录质量很高），建议：在 README 顶部给一节"架构导读"，用图说明 双层 Canvas / 双树 / NSBridge / Op-invert History / 插件注册 五个概念，并链接 NOTE.md 对应章节；新建包级 README 说明各包职责与依赖方向（当前只有根 README 的 FAQ）。
15. 补 CHANGELOG、CONTRIBUTING；各包 `publish.sh` 存在但版本停在 0.0.1，若真有发布计划建议接入 changesets 统一管理版本与发布。

## 五、总结

这是一个架构完成度高于代码量预期的项目：扁平 DeltaSet + 双树 + NSBridge、类型化事件总线、Op 反演式 History、key 注册插件，环环相扣且每个决策在 NOTE.md 里都有论证过程。当前最值得投入的是三件事——**修掉第三节 5 个确认 bug 并配回归测试**、**把 lint/test 纳入 CI**、**清理越包深导入**；这三项做完，项目才具备作为"可抽离的 Canvas 引擎包"（NOTE.md 中的愿景）被外部使用的资格。架构层面的进一步演进（绘制队列、快捷键表驱动、单 delta 模型）可在此基础上按 P1 顺序推进。
