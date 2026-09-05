import { Delta } from "sketching-delta";
import type { DeltaOptions } from "sketching-delta";

import { DeltaState, Node, Range } from "../src/index";
import type { Editor } from "../src/index";
import { NSBridge } from "../src/state/modules/bridge";

const createRange = () => new Range({ startX: 0, startY: 0, endX: 10, endY: 10 });

class TestDelta extends Delta {
  public static KEY = "test";
  public readonly key = TestDelta.KEY;
  public drawing = () => void 0;
  public static create(options: DeltaOptions) {
    return new TestDelta(options);
  }
}

describe("Node", () => {
  it("remove should unlink the node from its parent children", () => {
    const parent = new Node(createRange());
    const childA = new Node(createRange());
    const childB = new Node(createRange());
    parent.append(childA);
    parent.append(childB);
    expect(parent.children).toEqual([childA, childB]);
    // 预热扁平节点缓存，remove 后应失效重算
    expect(parent.getFlatNode()).toContain(childA);

    childA.remove();

    expect(parent.children).toEqual([childB]);
    expect(parent.getFlatNode()).not.toContain(childA);
    expect(parent.getFlatNode()).toContain(childB);
  });
});

describe("NSBridge", () => {
  it("get should resolve both DeltaState and Node directions", () => {
    const editor = null as unknown as Editor;
    const delta = new TestDelta({ key: TestDelta.KEY, x: 0, y: 0, width: 10, height: 10 });
    const state = new DeltaState(editor, delta);
    const node = new Node(createRange());
    NSBridge.set(state, node);
    expect(NSBridge.get(state)).toBe(node);
    expect(NSBridge.get(node)).toBe(state);
    expect(NSBridge.get(null)).toBeNull();
  });
});
