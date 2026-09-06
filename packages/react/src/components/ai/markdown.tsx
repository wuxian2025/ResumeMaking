import type { FC } from "react";
import React from "react";

import styles from "./index.m.scss";

/** 行内格式: **加粗**、*斜体*、`行内代码` */
const renderInline = (text: string, keyPrefix: string): React.ReactNode[] => {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g);
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (/^`[^`]+`$/.test(part)) {
      return (
        <code key={key} className={styles.inlineCode}>
          {part.slice(1, -1)}
        </code>
      );
    }
    if (/^\*[^*\s][^*]*\*$/.test(part)) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
};

/**
 * 轻量 Markdown 渲染
 * 支持标题/有序无序列表/代码块/引用/行内格式, 覆盖大模型输出的常见格式
 */
export const Markdown: FC<{ text: string }> = ({ text }) => {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let listItems: string[] = [];
  let listOrdered = false;
  let codeLines: string[] | null = null;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      const key = `p-${blocks.length}`;
      blocks.push(<p key={key}>{renderInline(paragraph.join(" "), key)}</p>);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (!listItems.length) return void 0;
    const key = `l-${blocks.length}`;
    const items = listItems.map((item, index) => (
      <li key={index}>{renderInline(item, `${key}-${index}`)}</li>
    ));
    blocks.push(listOrdered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
    listItems = [];
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      flushParagraph();
      flushList();
      if (codeLines) {
        blocks.push(
          <pre key={`c-${blocks.length}`} className={styles.codeBlock}>
            {codeLines.join("\n")}
          </pre>
        );
        codeLines = null;
      } else {
        codeLines = [];
      }
      continue;
    }
    if (codeLines) {
      codeLines.push(line);
      continue;
    }
    const heading = line.match(/^#{1,4}\s+(.*)/);
    const unordered = line.match(/^[-*]\s+(.*)/);
    const ordered = line.match(/^\d+[.、)]\s+(.*)/);
    if (heading) {
      flushParagraph();
      flushList();
      const key = `h-${blocks.length}`;
      blocks.push(<div className={styles.mdHeading}>{renderInline(heading[1], key)}</div>);
      continue;
    }
    if (unordered) {
      flushParagraph();
      if (listOrdered) flushList();
      listOrdered = false;
      listItems.push(unordered[1]);
      continue;
    }
    if (ordered) {
      flushParagraph();
      if (!listOrdered) flushList();
      listOrdered = true;
      listItems.push(ordered[1]);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  if (codeLines && codeLines.length) {
    blocks.push(
      <pre key={`c-${blocks.length}`} className={styles.codeBlock}>
        {codeLines.join("\n")}
      </pre>
    );
  }
  return <div className={styles.markdown}>{blocks}</div>;
};
