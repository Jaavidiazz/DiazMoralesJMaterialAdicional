import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Iniciales para el avatar de la barra lateral: 1-2 letras a partir del
 * nombre completo, o del email si no hay nombre, o el fallback dado.
 */
export function getInitials(
  fullName?: string | null,
  email?: string | null,
  fallback = "??",
): string {
  if (fullName && fullName.trim().length > 0) {
    const parts = fullName.trim().split(/\s+/);
    const initials = parts
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("");
    if (initials) return initials;
  }

  if (email && email.includes("@")) {
    const beforeAt = email.split("@")[0];
    if (beforeAt.length > 0) {
      return beforeAt.slice(0, 2).toUpperCase();
    }
  }

  return fallback;
}
