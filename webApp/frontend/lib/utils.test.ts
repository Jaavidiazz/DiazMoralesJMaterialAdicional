import { describe, expect, it } from "vitest";
import { cn, getInitials } from "./utils";

describe("cn", () => {
  it("merges class names and drops falsy values", () => {
    expect(cn("a", false && "b", undefined, "c")).toBe("a c");
  });

  it("lets a later Tailwind class win over a conflicting earlier one", () => {
    // tailwind-merge debe quedarse solo con la última utilidad de padding,
    // no concatenar las dos (si no, el CSS resultante sería inconsistente).
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
});

describe("getInitials", () => {
  it("takes the first letter of the first two words of a full name", () => {
    expect(getInitials("Javier Diaz Morales", null)).toBe("JD");
  });

  it("uppercases a single-word name", () => {
    expect(getInitials("javier", null)).toBe("J");
  });

  it("falls back to the email when there is no name", () => {
    expect(getInitials(null, "javierdm2003.jd@gmail.com")).toBe("JA");
  });

  it("ignores an email without an @ sign", () => {
    expect(getInitials(null, "not-an-email")).toBe("??");
  });

  it("uses the given fallback when there is neither name nor email", () => {
    expect(getInitials(null, null, "DR")).toBe("DR");
    expect(getInitials(undefined, undefined)).toBe("??");
  });

  it("ignores a name that is only whitespace", () => {
    expect(getInitials("   ", "javierdm2003.jd@gmail.com")).toBe("JA");
  });
});
