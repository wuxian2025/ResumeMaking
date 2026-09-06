import { InputNumber, Modal } from "@arco-design/web-react";
import { IconLaunch } from "@arco-design/web-react/icon";
import type { Delta as BlockDelta } from "@block-kit/delta";
import { throttle } from "@block-kit/utils";
import type { FC } from "react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { DeltaState, Editor } from "sketching-core";
import { EDITOR_EVENT } from "sketching-core";
import { Op, OP_TYPE } from "sketching-delta";
import type { RichTextLines } from "sketching-plugin";
import { TEXT_ATTRS } from "sketching-plugin";
import { TSON } from "sketching-utils";

import { NAV_ENUM } from "../../../header/utils/constant";
import styles from "../index.m.scss";
import { RichTextEditor } from "./modules/editor";
import { DEFAULT_MODAL_WIDTH, getDefaultTextDelta } from "./utils/constant";
import { sketchToTextDelta, textDeltaToSketch } from "./utils/transform";

export const Text: FC<{ editor: Editor; state: DeltaState }> = props => {
  const { editor, state } = props;
  const [width, setWidth] = useState(DEFAULT_MODAL_WIDTH);
  const [modalMode, setModalMode] = useState(false);
  const dataRef = useRef<BlockDelta | null>(null);
  // 字间距变化时重挂载富文本编辑器，避免编辑器内旧数据覆盖回写
  const [spacingKey, setSpacingKey] = useState(0);
  const [spacing, setSpacing] = useState<string>("0");

  useMemo(() => {
    const data = state.getAttr(TEXT_ATTRS.DATA);
    const blockDelta = data && TSON.parse<RichTextLines>(data);
    if (blockDelta) {
      dataRef.current = sketchToTextDelta(blockDelta);
    } else {
      dataRef.current = getDefaultTextDelta();
    }
  }, [state]);

  useEffect(() => {
    const data = state.getAttr(TEXT_ATTRS.DATA);
    const lines = (data && TSON.parse<RichTextLines>(data)) || [];
    setSpacing((lines[0] && lines[0].config[TEXT_ATTRS.LETTER_SPACING]) || "0");
  }, [state]);

  const onSpacingChange = (value?: number) => {
    const next = String(value ?? 0);
    setSpacing(next);
    const current = dataRef.current ? textDeltaToSketch(dataRef.current) : [];
    const lines = current.map(line => ({
      chars: [...line.chars],
      config: { ...line.config, [TEXT_ATTRS.LETTER_SPACING]: next },
    }));
    editor.state.apply(
      new Op(OP_TYPE.REVISE, { id: state.id, attrs: { [TEXT_ATTRS.DATA]: TSON.stringify(lines)! } })
    );
    dataRef.current = sketchToTextDelta(lines);
    setSpacingKey(key => key + 1);
  };

  useEffect(() => {
    const onDoubleClick = (e: MouseEvent) => {
      if (e.detail !== 2) return void 0;
      const active = Array.from(editor.selection.getActiveDeltaIds());
      const id = active.length === 1 && active[0];
      const state = id && editor.state.getDeltaState(id);
      state && state.key === NAV_ENUM.TEXT && setModalMode(true);
    };
    editor.event.on(EDITOR_EVENT.CLICK, onDoubleClick);
    return () => {
      editor.event.off(EDITOR_EVENT.CLICK, onDoubleClick);
    };
  }, [editor.event, editor.selection, editor.state]);

  const onResizeDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = width;
    const onMouseMove = throttle((moveEvent: MouseEvent) => {
      const newWidth = startWidth + (moveEvent.clientX - startX) * 2;
      const normalized = Math.min(window.innerWidth - 100, Math.max(DEFAULT_MODAL_WIDTH, newWidth));
      setWidth(normalized);
    }, 17);
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const TextEditor = (
    <React.Fragment key={`${state.id}-${spacingKey}`}>
      {!modalMode && (
        <div className={styles.title}>
          富文本
          <IconLaunch className={styles.launch} onClick={() => setModalMode(true)} />
        </div>
      )}
      <div className={styles.item}>
        <div>字间距</div>
        <InputNumber
          className={styles.input}
          min={0}
          max={20}
          size="mini"
          value={Number(spacing) || 0}
          onChange={onSpacingChange}
        />
      </div>
      <RichTextEditor editor={editor} state={state} dataRef={dataRef}></RichTextEditor>
      <div className={styles.resize} onMouseDown={onResizeDown}></div>
    </React.Fragment>
  );

  // 弹窗拖拽: Arco 该版本的`Modal`没有`draggable`属性, 通过标题栏手动实现
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const onTitleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const start = { ...dragOffset };
    const onMove = (ev: MouseEvent) => {
      setDragOffset({ x: start.x + (ev.clientX - startX), y: start.y + (ev.clientY - startY) });
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  return modalMode ? (
    <Modal
      visible={modalMode}
      footer={null}
      focusLock={false}
      className={styles.modal}
      onCancel={() => setModalMode(false)}
      style={{ width, transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` }}
      title={
        <div
          className={styles.modalTitle}
          style={{ cursor: "move", userSelect: "none" }}
          onMouseDown={onTitleMouseDown}
        >
          富文本
        </div>
      }
    >
      {TextEditor}
    </Modal>
  ) : (
    TextEditor
  );
};
