import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./badge";

describe("Badge", () => {
  it("renders its label", () => {
    render(<Badge>IA: sospecha maligna</Badge>);
    expect(screen.getByText("IA: sospecha maligna")).toBeInTheDocument();
  });

  it("applies the outline variant classes used for classification badges", () => {
    render(<Badge variant="outline">Pendiente IA</Badge>);
    const badge = screen.getByText("Pendiente IA");
    expect(badge).toHaveClass("text-foreground");
  });

  it("merges a custom className on top of the variant classes", () => {
    render(
      <Badge variant="outline" className="bg-rose-100 text-rose-700">
        IA: sospecha maligna
      </Badge>,
    );
    const badge = screen.getByText("IA: sospecha maligna");
    expect(badge).toHaveClass("bg-rose-100");
    expect(badge).toHaveClass("text-rose-700");
  });
});
