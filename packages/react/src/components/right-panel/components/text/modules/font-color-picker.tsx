import { ColorPicker } from "@arco-design/web-react";
import "@arco-design/web-react/es/ColorPicker/style";
import { FONT_COLOR_KEY, useToolbarContext } from "@block-kit/plugin";
import type { FC } from "react";
import React, { useEffect } from "react";

const PRESET_COLORS = [
  // 常用文字色
  "#1D2129",
  "#4E5969",
  "#86909C",
  "#C9CDD4",
  "#FFFFFF",
  // 主题色
  "#165DFF",
  "#00B42A",
  "#F7BA1E",
  "#F53F3F",
  "#722ED1",
  "#14C9C9",
  "#F5319D",
  "#FF7D00",
  "#0FC6C2",
  // 扩展色
  "#FADC19",
  "#B71DE8",
  "#7A9E3F",
  "#E8653C",
  "#24949E",
  "#3446A2",
];

const resetStyle: React.CSSProperties = {
  cursor: "pointer",
  padding: "0 3px",
  fontSize: 12,
  fontWeight: 600,
  color: "#1D2129",
  textDecoration: "line-through",
  userSelect: "none",
};

/**
 * 富文本字体颜色取色器
 * 预设色 + 色盘自由选色, 值直接透传给`color`mark
 */
export const FontColorTool: FC = () => {
  const { refreshMarks, editor } = useToolbarContext();

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      // COMPAT: 色盘弹层挂在 body 下, capture 阶段拦下事件, 避免浮动工具栏因按下而卸载
      if (target && target.closest(".arco-color-picker")) {
        e.stopPropagation();
      }
    };
    document.addEventListener("mousedown", onMouseDown, true);
    return () => document.removeEventListener("mousedown", onMouseDown, true);
  }, []);

  return (
    <div className="menu-toolbar-item" style={{ gap: 2, padding: "0 2px" }}>
      <ColorPicker
        size="mini"
        showHistory
        presetColors={PRESET_COLORS}
        onChange={value => {
          editor && editor.command.exec(FONT_COLOR_KEY, { value: String(value) });
          refreshMarks();
        }}
      ></ColorPicker>
      <div title="恢复默认颜色" style={resetStyle} onClick={() => {
        editor && editor.command.exec(FONT_COLOR_KEY, { value: "" });
        refreshMarks();
      }}>
        A
      </div>
    </div>
  );
};
