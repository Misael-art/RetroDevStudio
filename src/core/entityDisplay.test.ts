import { describe, expect, it } from "vitest";

import { getEntityDisplayName, prefabReferenceLabel } from "./entityDisplay";

describe("entityDisplay", () => {
  it("prefers display_name when available", () => {
    expect(
      getEntityDisplayName({
        entity_id: "hero_instance",
        display_name: "Hero",
        prefab: "hero.json",
      })
    ).toBe("Hero");
  });

  it("falls back to prefab basename before entity_id", () => {
    expect(
      getEntityDisplayName({
        entity_id: "hero_instance",
        display_name: null,
        prefab: "prefabs/hero.json",
      })
    ).toBe("hero");
    expect(prefabReferenceLabel("prefabs/hero.json")).toBe("hero");
  });
});
