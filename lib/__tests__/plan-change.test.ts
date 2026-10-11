import { describe, it, expect } from "vitest";
import { planChange } from "@/lib/billing/plan-change";

describe("planChange", () => {
  it("same tier → noop", () => {
    expect(planChange("pro", "pro")).toEqual({ kind: "noop" });
  });
  it("free → pro is an upgrade", () => {
    expect(planChange("free", "pro")).toEqual({ kind: "upgrade", target: "pro" });
  });
  it("pro → ultimate is an upgrade", () => {
    expect(planChange("pro", "ultimate")).toEqual({ kind: "upgrade", target: "ultimate" });
  });
  it("ultimate → pro is a downgrade", () => {
    expect(planChange("ultimate", "pro")).toEqual({ kind: "downgrade", target: "pro" });
  });
  it("pro → free is a cancel", () => {
    expect(planChange("pro", "free")).toEqual({ kind: "cancel" });
  });
  it("free → free is noop", () => {
    expect(planChange("free", "free")).toEqual({ kind: "noop" });
  });
});
