import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const replace = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const signInWithPassword = vi.fn();
const single = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { signInWithPassword },
    from: () => ({
      select: () => ({
        eq: () => ({ single }),
      }),
    }),
  }),
}));

// Import after the mocks above so the component picks them up.
const { default: LoginPage } = await import("./page");

describe("LoginPage", () => {
  beforeEach(() => {
    signInWithPassword.mockReset();
    single.mockReset();
    replace.mockReset();
    refresh.mockReset();
  });

  it("shows an error and does not redirect when the credentials are wrong", async () => {
    const user = userEvent.setup();
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid login credentials" },
    });

    render(<LoginPage />);

    await user.type(screen.getByLabelText("Email"), "doctor@breastia.es");
    await user.type(screen.getByLabelText("Contraseña"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Entrar" }));

    expect(
      await screen.findByText(
        "Error al iniciar sesión. Verifica tus credenciales.",
      ),
    ).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("redirects a doctor to /doctor/dashboard after a successful login", async () => {
    const user = userEvent.setup();
    signInWithPassword.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    single.mockResolvedValue({ data: { role: "doctor" }, error: null });

    render(<LoginPage />);

    await user.type(screen.getByLabelText("Email"), "doctor@breastia.es");
    await user.type(screen.getByLabelText("Contraseña"), "correct-password");
    await user.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/doctor/dashboard"),
    );
  });

  it("redirects an admin to /admin/dashboard after a successful login", async () => {
    const user = userEvent.setup();
    signInWithPassword.mockResolvedValue({
      data: { user: { id: "user-2" } },
      error: null,
    });
    single.mockResolvedValue({ data: { role: "admin" }, error: null });

    render(<LoginPage />);

    await user.type(screen.getByLabelText("Email"), "admin@breastia.es");
    await user.type(screen.getByLabelText("Contraseña"), "correct-password");
    await user.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/admin/dashboard"),
    );
  });
});
