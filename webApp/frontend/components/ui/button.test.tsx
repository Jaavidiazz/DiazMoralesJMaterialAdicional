import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./button";

describe("Button", () => {
  it("renders its children", () => {
    render(<Button>Guardar caso</Button>);
    expect(
      screen.getByRole("button", { name: "Guardar caso" }),
    ).toBeInTheDocument();
  });

  it("fires onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Entrar</Button>);

    await user.click(screen.getByRole("button", { name: "Entrar" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClick when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Generar informe
      </Button>,
    );

    await user.click(screen.getByRole("button", { name: "Generar informe" }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it("applies the destructive variant classes", () => {
    render(<Button variant="destructive">Eliminar</Button>);
    expect(screen.getByRole("button")).toHaveClass("bg-destructive");
  });

  it("renders as the wrapped child element when asChild is used", () => {
    render(
      <Button asChild>
        <a href="/doctor/dashboard">Ir al panel</a>
      </Button>,
    );

    const link = screen.getByRole("link", { name: "Ir al panel" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/doctor/dashboard");
  });
});
