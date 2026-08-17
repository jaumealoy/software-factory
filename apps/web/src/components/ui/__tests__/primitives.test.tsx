import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Badge } from "../badge";
import { Button } from "../button";
import { Card, CardDescription, CardHeader, CardTitle } from "../card";
import { Input } from "../input";
import { Label } from "../label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../select";

describe("shadcn/ui primitives", () => {
  it("renders a Button with the primary token classes and correct role", () => {
    const { container } = render(<Button>Run factory</Button>);
    const button = screen.getByRole("button", { name: "Run factory" });
    expect(button).toBeInTheDocument();
    expect(button.className).toContain("bg-primary");
    expect(container.querySelector('[data-slot="button"]')).not.toBeNull();
  });

  it("renders Badge, Card, and Label with semantic roles", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Changes</CardTitle>
          <CardDescription>A list of factory changes.</CardDescription>
        </CardHeader>
      </Card>,
    );
    render(<Badge>COMPLETED</Badge>);
    render(
      <Label htmlFor="title">
        Title
        <Input id="title" />
      </Label>,
    );

    expect(screen.getByText("Changes")).toBeInTheDocument();
    expect(screen.getByText("COMPLETED")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
  });

  it("renders a Select and opens its options", async () => {
    const user = userEvent.setup();
    render(
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="Pick a model" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="haiku">haiku</SelectItem>
          <SelectItem value="sonnet">sonnet</SelectItem>
        </SelectContent>
      </Select>,
    );

    await user.click(screen.getByRole("combobox"));
    expect(await screen.findByText("haiku")).toBeInTheDocument();
    await user.click(screen.getByText("sonnet"));
  });

  it("renders an Input with a textbox role and theme classes", () => {
    render(<Input placeholder="Add Google OAuth login" />);
    const input = screen.getByPlaceholderText("Add Google OAuth login");
    expect(input).toHaveRole("textbox");
    expect(input.className).toContain("border-input");
  });
});
