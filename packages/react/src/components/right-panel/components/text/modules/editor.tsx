import "./index.scss";

import type { ContentChangeEvent } from "@block-kit/core";
import { Editor as BlockEditor, EDITOR_EVENT } from "@block-kit/core";
import { LOG_LEVEL } from "@block-kit/core";
import type { Delta as BlockDelta } from "@block-kit/delta";
import {
  BackgroundPlugin,
  BoldPlugin,
  BulletListPlugin,
  DividerPlugin,
  FloatToolbar,
  FontColorPlugin,
  FontSizePlugin,
  ImagePlugin,
  IndentPlugin,
  InlineCodePlugin,
  ItalicPlugin,
  LineHeightPlugin,
  LinkPlugin,
  OrderListPlugin,
  Shortcut,
  StrikePlugin,
  ToolBarMixin as Tools,
  UnderlinePlugin,
} from "@block-kit/plugin";
import { BlockKit, Editable, MountNode } from "@block-kit/react";
import { useMemoFn } from "@block-kit/utils/dist/es/hooks";
import type { FC } from "react";
import React, { useEffect, useMemo, useRef } from "react";
import type { DeltaState } from "sketching-core";
import type { Editor } from "sketching-core";
import { Op, OP_TYPE } from "sketching-delta";
import type { Attributes } from "sketching-plugin";
import { TEXT_ATTRS } from "sketching-plugin";
import { debounce, TSON } from "sketching-utils";

import { useIsMounted } from "../../../../../hooks/is-mounted";
import { schema } from "../config/schema";
import { getDefaultTextDelta } from "../utils/constant";
import { LETTER_SPACING_KEY, textDeltaToSketch } from "../utils/transform";
import { FontColorTool } from "./font-color-picker";
import { PRESET_SHORTCUT } from "./short-cut";
import { SpacingTool } from "./spacing-tool";

export const RichTextEditor: FC<{
  dataRef: React.MutableRefObject<BlockDelta | null>;
  editor: Editor;
  state: DeltaState;
}> = props => {
  const { dataRef, editor, state } = props;
  const { mounted } = useIsMounted();

  const blockEditor = useMemo(() => {
    const instance = new BlockEditor({
      delta: dataRef.current || getDefaultTextDelta(),
      logLevel: LOG_LEVEL.ERROR,
      schema,
    });
    instance.plugin.register([
      new BoldPlugin(),
      new ItalicPlugin(),
      new UnderlinePlugin(instance),
      new StrikePlugin(instance),
      new ImagePlugin(instance),
      new InlineCodePlugin(instance),
      new LineHeightPlugin(instance),
      new FontSizePlugin(instance),
      new FontColorPlugin(instance),
      new BackgroundPlugin(instance),
      new DividerPlugin(instance),
      new BulletListPlugin(instance),
      new OrderListPlugin(instance),
      new IndentPlugin(instance),
      new LinkPlugin(instance),
      new Shortcut(instance, PRESET_SHORTCUT),
    ]);
    // 自定义字间距命令：与内置`mark`一致，作用于当前选区
    instance.command.register(LETTER_SPACING_KEY, context => {
      const sel = instance.selection.get();
      sel &&
        instance.perform.applyMarks(sel, { [LETTER_SPACING_KEY]: String(context.value ?? 0) });
    });
    return instance;
  }, [dataRef]);

  const onSaveChange = useMemoFn((current: BlockDelta) => {
    if (!mounted.current) return void 0;
    const attrs: Attributes = {
      [TEXT_ATTRS.DATA]: TSON.stringify(textDeltaToSketch(current))!,
    };
    editor.state.apply(new Op(OP_TYPE.REVISE, { id: state.id, attrs }));
  });

  useEffect(() => {
    const updateText = debounce((event: ContentChangeEvent) => {
      const { current } = event;
      dataRef.current = current;
      onSaveChange(current);
    }, 300);
    blockEditor.event.on(EDITOR_EVENT.CONTENT_CHANGE, updateText);
    return () => {
      blockEditor.event.off(EDITOR_EVENT.CONTENT_CHANGE, updateText);
    };
  }, [blockEditor.event, dataRef, onSaveChange]);

  const onMountRef = useMemoFn((e: HTMLElement | null) => {
    e && MountNode.set(blockEditor, e);
  });

  // 工具栏拖拽偏移: 选区变化触发重新定位时保持拖拽后的位置
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return void 0;
      const toolbar = target.closest(".block-kit-float-toolbar") as HTMLElement | null;
      if (!toolbar) return void 0;
      // 手柄或工具栏空白处可拖拽, 按钮与输入区域仍可正常点击
      const isGrip = !!target.closest(".toolbar-drag-grip");
      const isInteractive = !!target.closest(".menu-toolbar-item, input, textarea");
      if (!isGrip && isInteractive) return void 0;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const startTop = parseFloat(toolbar.style.top) || 0;
      const startLeft = parseFloat(toolbar.style.left) || 0;
      const startOffset = { ...dragOffsetRef.current };
      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        toolbar.style.top = `${startTop + dy}px`;
        toolbar.style.left = `${startLeft + dx}px`;
        dragOffsetRef.current = { x: startOffset.x + dx, y: startOffset.y + dy };
      };
      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onMouseUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onMouseUp);
    };
    // COMPAT: capture 阶段拦截, 避免编辑器与工具栏的按下逻辑抢先清掉选区
    document.addEventListener("mousedown", onMouseDown, true);
    return () => document.removeEventListener("mousedown", onMouseDown, true);
  }, []);

  const overridePosition = () => {
    const rect = blockEditor.rect.getRawSelectionRect();
    if (rect) {
      const t = rect.top - 8 + dragOffsetRef.current.y;
      let l = rect.left + rect.width / 2 + dragOffsetRef.current.x;
      if (l + 200 > window.innerWidth) {
        l = window.innerWidth - 200;
      }
      return { top: t, left: l };
    }
    return { top: -999999, left: -999999 };
  };

  return (
    <BlockKit editor={blockEditor} readonly={false}>
      <div className="block-kit-editor-container">
        <FloatToolbar mountDOM={document.body} overridePosition={overridePosition}>
          <div
            className="toolbar-drag-grip"
            title="按住拖动移动工具栏"
            style={{
              cursor: "move",
              padding: "0 7px",
              alignSelf: "stretch",
              display: "flex",
              alignItems: "center",
              color: "#86909c",
              fontSize: 14,
              userSelect: "none",
              letterSpacing: -2,
            }}
          >
            ⠿
          </div>
          <Tools.Bold></Tools.Bold>
          <Tools.Italic></Tools.Italic>
          <Tools.Underline></Tools.Underline>
          <Tools.Strike></Tools.Strike>
          <Tools.Link></Tools.Link>
          <Tools.InlineCode></Tools.InlineCode>
          <Tools.FontSize></Tools.FontSize>
          <Tools.FontColor></Tools.FontColor>
          <FontColorTool></FontColorTool>
          <Tools.LineHeight></Tools.LineHeight>
          <SpacingTool></SpacingTool>
        </FloatToolbar>
        <div className="block-kit-editable-container">
          <div className="block-kit-mount-dom" ref={onMountRef}></div>
          <Editable
            placeholder="Please Enter..."
            autoFocus
            className="block-kit-editable"
          ></Editable>
        </div>
      </div>
    </BlockKit>
  );
};
