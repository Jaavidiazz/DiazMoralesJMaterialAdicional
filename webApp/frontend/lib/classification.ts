export type AiResult = "benign" | "malignant" | "normal";

/**
 * Normaliza el campo `classification` del backend (que llega en castellano o
 * en inglés) a un único conjunto de valores. Un valor no reconocido se trata
 * como "benign" para no bloquear la interfaz.
 */
export function normalizeClassification(
  raw: string | null | undefined,
): AiResult | null {
  if (!raw) return null;

  const value = raw.toLowerCase();

  if (value === "maligna" || value === "malignant") return "malignant";
  if (value === "normal") return "normal";
  return "benign";
}

export type ClassificationDisplay = {
  badgeClass: string;
  label: string;
};

/**
 * Clase del badge y texto para el resultado de la IA. Se usa en la lista de
 * casos, el detalle de un caso y el listado de informes.
 */
export function getClassificationDisplay(
  raw: string | null | undefined,
): ClassificationDisplay {
  if (!raw) {
    return {
      badgeClass: "bg-amber-100 text-amber-700 border-amber-200",
      label: "Pendiente IA",
    };
  }

  const result = normalizeClassification(raw);

  if (result === "malignant") {
    return {
      badgeClass: "bg-rose-100 text-rose-700 border-rose-200",
      label: "IA: sospecha maligna",
    };
  }

  if (result === "normal") {
    return {
      badgeClass: "bg-teal-100 text-teal-700 border-teal-200",
      label: "IA: estudio normal",
    };
  }

  return {
    badgeClass: "bg-emerald-100 text-emerald-700 border-emerald-200",
    label: "IA: aspecto benigno",
  };
}
