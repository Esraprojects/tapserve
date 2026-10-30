import { describe, expect, it } from "vitest";
import { am } from "./am";
import { en } from "./en";
import { format } from "./index";

function keys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" ? keys(v as object, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("i18n", () => {
  it("Amharic and English have the same keys", () => {
    expect(keys(am).sort()).toEqual(keys(en).sort());
  });

  it("keeps placeholders in translations", () => {
    expect(am.auth.verifySent).toContain("{phone}");
    expect(am.dashboard.welcome).toContain("{name}");
  });

  it("formats placeholders", () => {
    expect(format("Hi {name}", { name: "Abebe" })).toBe("Hi Abebe");
    expect(format("Hi {x}", {})).toBe("Hi {x}");
  });
});
