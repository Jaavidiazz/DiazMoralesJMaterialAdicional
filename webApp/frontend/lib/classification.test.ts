import { describe, expect, it } from "vitest";
import { getClassificationDisplay, normalizeClassification } from "./classification";

describe("normalizeClassification", () => {
  it("returns null when there is no classification yet", () => {
    expect(normalizeClassification(null)).toBeNull();
    expect(normalizeClassification(undefined)).toBeNull();
    expect(normalizeClassification("")).toBeNull();
  });

  it("maps malignant results in Spanish and English", () => {
    expect(normalizeClassification("maligna")).toBe("malignant");
    expect(normalizeClassification("malignant")).toBe("malignant");
    expect(normalizeClassification("MALIGNA")).toBe("malignant");
  });

  it("maps normal results case-insensitively", () => {
    expect(normalizeClassification("normal")).toBe("normal");
    expect(normalizeClassification("Normal")).toBe("normal");
  });

  it("maps benign results in Spanish and English", () => {
    expect(normalizeClassification("benigna")).toBe("benign");
    expect(normalizeClassification("benign")).toBe("benign");
  });

  it("treats any unrecognized value as benign instead of crashing the UI", () => {
    expect(normalizeClassification("algo-inesperado")).toBe("benign");
  });
});

describe("getClassificationDisplay", () => {
  it("shows a pending badge when there is no classification", () => {
    const display = getClassificationDisplay(null);
    expect(display.label).toBe("Pendiente IA");
    expect(display.badgeClass).toContain("amber");
  });

  it("shows the malignant badge for maligna/malignant", () => {
    expect(getClassificationDisplay("maligna").label).toBe(
      "IA: sospecha maligna",
    );
    expect(getClassificationDisplay("malignant").badgeClass).toContain(
      "rose",
    );
  });

  it("shows the normal badge for normal", () => {
    expect(getClassificationDisplay("normal").label).toBe(
      "IA: estudio normal",
    );
    expect(getClassificationDisplay("normal").badgeClass).toContain("teal");
  });

  it("shows the benign badge for benigna/benign", () => {
    expect(getClassificationDisplay("benigna").label).toBe(
      "IA: aspecto benigno",
    );
    expect(getClassificationDisplay("benign").badgeClass).toContain(
      "emerald",
    );
  });

  // La lista de casos pasa un valor ya normalizado ("benign"/"malignant"/
  // "normal"), no el string crudo del backend, y debe seguir funcionando.
  it("is idempotent when fed an already-normalized AiResult", () => {
    expect(getClassificationDisplay("malignant").label).toBe(
      "IA: sospecha maligna",
    );
    expect(getClassificationDisplay("normal").label).toBe(
      "IA: estudio normal",
    );
    expect(getClassificationDisplay("benign").label).toBe(
      "IA: aspecto benigno",
    );
  });
});
