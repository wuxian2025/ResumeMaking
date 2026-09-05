# 修复计划表

> 依据 [REVIEW.md](./REVIEW.md) 第三节确认的 5 处 bug 制定。工作流程：**先写会失败的回归测试 → 确认失败 → 修复 → 测试通过 → 该包全量测试 + `tsc --noEmit` → 打钩**。

## 任务清单

- [x] **任务 0：环境准备** — 确认依赖已安装（无 node_modules 则 `pnpm install`）；跑通现有占位测试，验证 jest 可用。
  - 测试：`pnpm -r --filter 'sketching-*' run test`
- [x] **任务 1：修复 delta 包 `DeltaSet.add()` 变量遮蔽**（`packages/delta/src/delta-set.ts:57`）
  局部 `const delta = this.get(to)` 遮蔽参数，`delta.insert(delta)` 把父节点插进自己；改为 `parent.insert(delta)`。
  - 测试：`packages/delta/test/index.test.ts` 新增用例 —— `add(child, parentId)` 后父节点 children 包含 child.id。
- [x] **任务 2：修复 delta 包 `DeltaSet.remove()` 变量遮蔽**（`packages/delta/src/delta-set.ts:69`）
  `delta.removeChild(delta)` 错误；改为 `parent.removeChild(child)`。
  - 测试：`add` 后 `remove` → deltas 记录已删、父节点 children 不再包含该 id。
- [x] **任务 3：修复 core 包 `Node.remove()` splice 错数组**（`packages/core/src/canvas/dom/node.ts:104`）
  用父 children 的索引 splice 自己的 children；改为 `parent.children.splice(index, 1)`。
  - 测试：`packages/core/test/index.test.ts` 新增用例 —— 构建 Node 树，`child.remove()` 后父 children 已移除且扁平缓存失效。
- [x] **任务 4：修复 core 包 `NSBridge.get(Node)` 缺 return**（`packages/core/src/state/modules/bridge.ts:19`）
  补上 `return`；实现前先排查该方向的既有调用方，确认没有代码依赖"恒返回 null"的错误行为。
  - 测试：`NSBridge.set(state, node)` 后 `get(node)` 返回该 state、`get(state)` 返回该 node（双向断言）。
  - ✅ 2026-09-05：先 grep 全部调用方确认无人依赖错误行为（现有调用均传 DeltaState）；回归测试复现后补 `return` 修复，core 包 2 个用例通过，`tsc --noEmit` 通过。
- [x] **任务 5：修复 react 包 context-menu 清理函数误写**（`packages/react/src/components/context-menu/index.tsx:32`）
  清理函数中 `editor.event.on(MOUSE_WHEEL, ...)` 改为 `off`。
  - 验证：`pnpm build:react`（rspack 构建 + 类型检查）通过；若依赖允许再补最小 mount/unmount 测试。
  - ✅ 2026-09-05：清理函数第 32 行 `on`→`off` 修复；`pnpm build:react` 构建通过（含 TS 类型检查）。react 包无 jest 基础设施（devDependencies 无测试依赖），按计划以构建验证为准，未强行引入新测试依赖。
- [x] **任务 6：收尾全量验证** — 运行全部包 `test` 与类型检查，确认无回归；更新本表与 REVIEW.md 标注。

## 完成记录

（每完成一项在此追加一行：日期、任务号、测试结果）

- 2026-09-05 任务 0：corepack 激活 pnpm 8.11.0，`pnpm install` 完成；`pnpm -r --filter 'sketching-*' run test` 四个包占位测试全部通过。
- 2026-09-05 任务 1：回归测试先复现 bug（children 收到 `["parent"]` 而非 `["child"]`），修复为 `parent.insert(delta)` 后通过；`tsc --noEmit` 通过。另：jest 解析 workspace 包需先 `pnpm build`（utils→delta→core 顺序）。
- 2026-09-05 任务 2：回归测试复现 bug（父节点有多个 children 时误删末位元素 `splice(-1,1)`），修复为 `parent.removeChild(id)` 后通过；`tsc --noEmit` 通过。
- 2026-09-05 任务 3：回归测试复现 bug（remove 后父 children 不变），修复为 `parent.children.splice(...)` 后通过。附带修复（测试可运行的必要前提，即 REVIEW.md P1-4 深导入问题）：`core/src/canvas/dom/resize.ts` 与 `plugin/src/text/drawing.ts` 的 palette 深路径导入改为包入口导入，并补上 `utils/src/index.ts` 遗漏的 `GRAY_4` 导出（深导入的根因）。delta/core/plugin 三包 `tsc --noEmit` 均通过。注意：Windows 下 `pnpm lint:ts` 脚本不可用（cmd 无法执行 `bin/tsc`），需在 bash 中直接调用 tsc。
- 2026-09-05 任务 4：见任务 4 条目 ✅。
- 2026-09-05 任务 5：见任务 5 条目 ✅。
- 2026-09-05 任务 6：全量验证通过 —— utils 1 例 / delta 2 例 / core 2 例测试全部通过（plugin 包无 test 脚本，仅类型检查）；utils/delta/core/plugin 四包 `tsc --noEmit` 全部通过；`pnpm build:react` 构建通过。REVIEW.md 第三节已同步标注修复状态。
