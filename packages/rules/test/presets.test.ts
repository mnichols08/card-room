import { describe, expect, it } from "vitest";
import { familyTable, renamedPreset } from "../src/index.js";

describe("the family rules' name", () => {
  it("is Family Table; copies saved under the old name show the new one, chosen names stay", () => {
    expect(familyTable.name).toBe("Family Table");
    expect(renamedPreset({ ...familyTable, name: "brokennil's Table" }).name).toBe("Family Table");
    expect(renamedPreset({ ...familyTable, name: "Grammi's Rules" }).name).toBe("Grammi's Rules");
    expect(renamedPreset({ ...familyTable, id: "other", name: "brokennil's Table" }).name).toBe("brokennil's Table");
  });
});
