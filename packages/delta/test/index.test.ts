import { Delta, DeltaSet } from "../src/index";
import type { DeltaOptions } from "../src/index";

class TestDelta extends Delta {
  public static KEY = "test";
  public readonly key = TestDelta.KEY;
  public drawing = () => void 0;
  public static create(options: DeltaOptions) {
    return new TestDelta(options);
  }
}

const parentOptions: DeltaOptions = {
  id: "parent",
  key: TestDelta.KEY,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
};
const childOptions: DeltaOptions = {
  id: "child",
  key: TestDelta.KEY,
  x: 10,
  y: 10,
  width: 50,
  height: 50,
};

describe("DeltaSet", () => {
  it("add should insert the new delta into its parent children", () => {
    DeltaSet.register(TestDelta);
    const deltaSet = new DeltaSet({ parent: parentOptions });
    const parent = deltaSet.get("parent") as TestDelta;
    const child = new TestDelta(childOptions);
    deltaSet.add(child, parent.id);
    expect(parent.children).toEqual(["child"]);
    expect(deltaSet.get("child")).toBe(child);
    expect(child.getDeltaSet && child.getDeltaSet()).toBe(deltaSet);
  });

  it("remove should delete the delta record and unlink it from its parent", () => {
    DeltaSet.register(TestDelta);
    const deltaSet = new DeltaSet({
      parent: { ...parentOptions, children: ["child", "sibling"] },
      child: childOptions,
      sibling: { ...childOptions, id: "sibling", x: 20 },
    });
    const parent = deltaSet.get("parent") as TestDelta;
    expect(parent.children).toEqual(["child", "sibling"]);
    deltaSet.remove("child", "parent");
    expect(deltaSet.get("child")).toBeNull();
    expect(parent.children).toEqual(["sibling"]);
  });
});
