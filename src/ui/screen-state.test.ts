import { describe, it, expect } from "vitest";
import { DeathScreenState, showDeath, hideDeath } from "./death-screen";
import { PauseMenu } from "./pause-menu";

describe("DeathScreenState", () => {
  it("starts hidden with no cause", () => {
    const s = new DeathScreenState();
    expect(s.isShown()).toBe(false);
    expect(s.cause()).toBe("");
  });

  it("show() fires only on the rising edge", () => {
    const s = new DeathScreenState();
    expect(s.show("Fell from a high place")).toBe(true);
    expect(s.isShown()).toBe(true);
    expect(s.cause()).toBe("Fell from a high place");
    // Already shown — no second edge.
    expect(s.show("Slain by a zombie")).toBe(false);
    expect(s.cause()).toBe("Fell from a high place");
  });

  it("hide() fires only on the falling edge and clears the cause", () => {
    const s = new DeathScreenState();
    s.show("Starved");
    expect(s.hide()).toBe(true);
    expect(s.isShown()).toBe(false);
    expect(s.cause()).toBe("");
    expect(s.hide()).toBe(false);
  });

  it("show/hide DOM helpers are safe no-ops without a document", () => {
    let called = false;
    expect(() => showDeath("x", () => (called = true))).not.toThrow();
    expect(() => hideDeath()).not.toThrow();
    expect(called).toBe(false);
  });
});

describe("PauseMenu", () => {
  it("starts closed and toggles open/closed", () => {
    const m = new PauseMenu();
    expect(m.isOpen()).toBe(false);
    expect(m.toggle()).toBe(true);
    expect(m.isOpen()).toBe(true);
    expect(m.toggle()).toBe(false);
    expect(m.isOpen()).toBe(false);
  });

  it("open()/close() set the state explicitly", () => {
    const m = new PauseMenu();
    m.open();
    expect(m.isOpen()).toBe(true);
    m.close();
    expect(m.isOpen()).toBe(false);
  });

  it("constructs without a DOM and does not throw", () => {
    expect(() => new PauseMenu({ onResume: () => {}, onSave: () => {} })).not.toThrow();
  });
});

describe("InventoryScreen (headless)", () => {
  it("constructs and toggles open-state without a DOM", async () => {
    const { InventoryScreen } = await import("./inventory-screen");
    const screen = new InventoryScreen();
    expect(screen.isOpen()).toBe(false);
    screen.open();
    expect(screen.isOpen()).toBe(true);
    screen.close();
    expect(screen.isOpen()).toBe(false);
  });
});
