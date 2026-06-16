import { describe, it, expect } from "vitest";
import { Player } from "../player/controller";
import { applyPlayerDamage, applyPlayerKnockback } from "./player-damage";
import { applyEffect } from "../effects/status";
import { makeArmorStack } from "../inventory/stack";
import { Items } from "../rules/items";

describe("applyPlayerDamage source semantics", () => {
  it("default source is melee: armor reduces damage (parity with pins)", () => {
    const player = new Player({ x: 0, y: 0, z: 0 });
    player.survival.health = 20;
    applyPlayerDamage(player, 6, 100);
    expect(player.survival.health).toBe(14);
  });
  it("fall source SKIPS armor: full damage reaches survival despite armor", () => {
    const player = new Player({ x: 0, y: 0, z: 0 });
    player.survival.health = 20;
    player.equipment.equip("chestplate", makeArmorStack(Items.IRON_CHESTPLATE));
    const startDur = player.equipment.get("chestplate")!.durability!;
    applyPlayerDamage(player, 6, 100, "fall");
    expect(player.survival.health).toBe(14);
    expect(player.equipment.get("chestplate")!.durability).toBe(startDur);
  });
  it("fall source STILL honours resistance", () => {
    const player = new Player({ x: 0, y: 0, z: 0 });
    player.survival.health = 20;
    applyEffect(player.effects, "resistance", 0, 1000);
    applyPlayerDamage(player, 10, 100, "fall");
    expect(player.survival.health).toBe(12);
  });
  it("fall source STILL honours i-frames", () => {
    const player = new Player({ x: 0, y: 0, z: 0 });
    player.survival.health = 20;
    applyPlayerDamage(player, 6, 100, "fall");
    expect(player.survival.health).toBe(14);
    applyPlayerDamage(player, 6, 101, "fall");
    expect(player.survival.health).toBe(14);
  });
});

describe("applyPlayerKnockback", () => {
  it("pushes the player away from the attacker on XZ and sets upward vy", () => {
    const player = new Player({ x: 5, y: 0, z: 0 });
    applyPlayerKnockback(player, { x: 0, z: 0 });
    expect(player.knockbackX).toBeGreaterThan(0);
    expect(player.knockbackZ).toBeCloseTo(0, 6);
    expect(player.physics.vy).toBeGreaterThan(0);
  });
  it("a zero-separation hit still produces a non-zero push", () => {
    const player = new Player({ x: 0, y: 0, z: 0 });
    applyPlayerKnockback(player, { x: 0, z: 0 });
    expect(Math.hypot(player.knockbackX, player.knockbackZ)).toBeGreaterThan(0);
  });
});

describe("applyPlayerDamage fire source (Phase 6b)", () => {
  it("fire SKIPS armor: full damage lands despite armor, and does not wear it", () => {
    const player = new Player({ x: 0, y: 0, z: 0 });
    player.survival.health = 20;
    player.equipment.equip("chestplate", makeArmorStack(Items.IRON_CHESTPLATE));
    const startDur = player.equipment.get("chestplate")!.durability!;
    applyPlayerDamage(player, 6, 100, "fire");
    expect(player.survival.health).toBe(14); // full 6, no armor reduction
    expect(player.equipment.get("chestplate")!.durability).toBe(startDur); // no wear
  });
  it("fire is FULLY negated by fire_resistance (zero damage)", () => {
    const player = new Player({ x: 0, y: 0, z: 0 });
    player.survival.health = 20;
    applyEffect(player.effects, "fire_resistance", 0, 1000);
    applyPlayerDamage(player, 6, 100, "fire");
    expect(player.survival.health).toBe(20); // fully negated
  });
  it("fire honours i-frames (second hit in window ignored)", () => {
    const player = new Player({ x: 0, y: 0, z: 0 });
    player.survival.health = 20;
    applyPlayerDamage(player, 6, 100, "fire");
    expect(player.survival.health).toBe(14);
    applyPlayerDamage(player, 6, 101, "fire");
    expect(player.survival.health).toBe(14);
  });
  it("fire_resistance does NOT negate non-fire sources (melee still lands)", () => {
    const player = new Player({ x: 0, y: 0, z: 0 });
    player.survival.health = 20;
    applyEffect(player.effects, "fire_resistance", 0, 1000);
    applyPlayerDamage(player, 6, 100); // melee
    expect(player.survival.health).toBe(14);
  });
});
