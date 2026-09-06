import type { RichTextLines } from "../src/text/types";
import { RichText } from "../src/text/rich-text";
import { TEXT_ATTRS } from "../src/text/constant";

/**
 * 最小化的 Canvas 2D 上下文桩
 * 每个`char`的`measureText`宽度固定为 10，便于断言排版计算
 */
const createContextStub = () => {
  const ctx = {
    font: "",
    measureText: (text: string) => ({
      width: text.length * 10,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
    }),
  };
  // RichText 构造时需要`document.createElement("canvas").getContext("2d")`
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => ({ getContext: () => ctx }),
  };
};

const createLines = (config: Record<string, string>): RichTextLines => {
  const chars = "ab".split("").map(char => ({ char, config: {} }));
  return [{ chars, config }];
};

describe("RichText.parse with LETTER_SPACING", () => {
  beforeEach(() => {
    createContextStub();
  });

  it("should keep original width when letter spacing is unset", () => {
    const richText = new RichText();
    const matrices = richText.parse(createLines({}), 100);
    expect(matrices.length).toEqual(1);
    expect(matrices[0].width).toEqual(20);
    expect(matrices[0].items.map(item => item.width)).toEqual([10, 10]);
  });

  it("should accumulate letter spacing into line width", () => {
    const richText = new RichText();
    const matrices = richText.parse(createLines({ [TEXT_ATTRS.LETTER_SPACING]: "2" }), 100);
    expect(matrices.length).toEqual(1);
    // 两个字符各追加 2px 间距：(10 + 2) * 2 = 24
    expect(matrices[0].width).toEqual(24);
    // 字形本身的测量宽度不受间距影响
    expect(matrices[0].items.map(item => item.width)).toEqual([10, 10]);
  });

  it("should wrap earlier when letter spacing pushes the line beyond width", () => {
    const richText = new RichText();
    // 宽度 22 时：无间距可以放下两个字符(20)，有 2px 间距后第二个字符 (12 + 10 + 2) 超宽
    const withoutSpacing = richText.parse(createLines({}), 22);
    expect(withoutSpacing.length).toEqual(1);
    const withSpacing = richText.parse(createLines({ [TEXT_ATTRS.LETTER_SPACING]: "2" }), 22);
    expect(withSpacing.length).toEqual(2);
    expect(withSpacing[0].items.map(item => item.char)).toEqual(["a"]);
    expect(withSpacing[1].items.map(item => item.char)).toEqual(["b"]);
  });

  it("should treat invalid letter spacing values as zero", () => {
    const richText = new RichText();
    const matrices = richText.parse(createLines({ [TEXT_ATTRS.LETTER_SPACING]: "abc" }), 100);
    expect(matrices[0].width).toEqual(20);
  });

  it("should apply fragment level letter spacing to its own characters only", () => {
    const richText = new RichText();
    const lines: RichTextLines = [
      {
        chars: [
          { char: "a", config: { [TEXT_ATTRS.LETTER_SPACING]: "5" } },
          { char: "b", config: {} },
        ],
        config: {},
      },
    ];
    const matrices = richText.parse(lines, 100);
    // 只有字符"a"追加 5px 间距：(10 + 5) + 10 = 25
    expect(matrices[0].width).toEqual(25);
    expect(matrices[0].items.map(item => item.width)).toEqual([10, 10]);
    expect(matrices[0].items.map(item => item.config[TEXT_ATTRS.LETTER_SPACING])).toEqual([
      "5",
      undefined,
    ]);
  });

  it("should use line level letter spacing as the default for characters", () => {
    const richText = new RichText();
    const lines: RichTextLines = [
      {
        chars: [
          { char: "a", config: { [TEXT_ATTRS.LETTER_SPACING]: "1" } },
          { char: "b", config: {} },
        ],
        config: { [TEXT_ATTRS.LETTER_SPACING]: "3" },
      },
    ];
    const matrices = richText.parse(lines, 100);
    // "a"用自身的 1px，"b"回落到行级默认 3px：(10 + 1) + (10 + 3) = 24
    expect(matrices[0].width).toEqual(24);
  });
});
