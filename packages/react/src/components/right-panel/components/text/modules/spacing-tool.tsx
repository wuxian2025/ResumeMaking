import { useToolbarContext } from "@block-kit/plugin";
import type { FC } from "react";
import React from "react";

import { LETTER_SPACING_KEY } from "../utils/transform";

const MIN_SPACING = 0;
const MAX_SPACING = 20;

const clamp = (value: number) => Math.min(MAX_SPACING, Math.max(MIN_SPACING, value));

const stepButtonStyle: React.CSSProperties = {
  cursor: "pointer",
  padding: "0 4px",
  userSelect: "none",
};
const valueStyle: React.CSSProperties = {
  minWidth: 16,
  textAlign: "center",
  userSelect: "none",
};

/**
 * 富文本浮动工具栏的字间距控件
 * 交互与内置`mark`按钮一致: 纯点击步进
 * COMPAT: 不使用输入框, 避免`focus`抢占编辑器焦点导致选区高亮丢失
 */
export const SpacingTool: FC = () => {
  const { keys, refreshMarks, editor } = useToolbarContext();
  // 选区内字间距一致时回显该值, 不一致或未设置时从 0 步进
  const current = clamp(Number(keys[LETTER_SPACING_KEY]) || 0);
  const apply = (value: number) => {
    editor && editor.command.exec(LETTER_SPACING_KEY, { value: String(clamp(value)) });
    refreshMarks();
  };
  return (
    <div className="menu-toolbar-item" style={{ gap: 2, padding: "0 4px" }}>
      <div style={stepButtonStyle} onClick={() => apply(current - 1)}>
        −
      </div>
      <div style={valueStyle}>{current}</div>
      <div style={stepButtonStyle} onClick={() => apply(current + 1)}>
        +
      </div>
    </div>
  );
};
