import { describe, expect, it } from "vitest";
import { normalizeEthiopianPhone } from "./phone";

describe("normalizeEthiopianPhone", () => {
  it.each([
    ["0911223344", "+251911223344"],
    ["0711223344", "+251711223344"],
    ["+251 911 22 33 44", "+251911223344"],
    ["251911223344", "+251911223344"],
    ["911223344", "+251911223344"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeEthiopianPhone(input)).toBe(expected);
  });

  it.each(["0811223344", "091122334", "+254911223344", "abc"])("rejects %s", (input) => {
    expect(normalizeEthiopianPhone(input)).toBeNull();
  });
});
