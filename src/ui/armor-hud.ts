/**
 * armor-hud.ts — reflects worn-armor defense + active status effects into the
 * HUD DOM (#armor-bar pips, #effect-bar badges). A third per-frame updater
 * alongside survival-hud and hotbar-hud. Pure state (armorPips, effectBadges) is
 * unit-tested; the DOM mutation in updateArmorHud is guarded by
 * `typeof document === "undefined"` so it is inert headless (mirrors survival-hud).
 */

import type { Equipment } from "../inventory/equipment";
import type { EffectState, EffectType } from "../effects/status";
import { TICKS_PER_SECOND } from "../rules/mc-1.20";
import { pipFills, type Fill } from "./pips";

export type { Fill };

const PIPS = 10;
const POINTS_PER_PIP = 2;

const EFFECT_ABBREV: Record<EffectType, string> = {
  regeneration: "REGEN",
  instant_health: "HEAL",
  instant_damage: "HARM",
  poison: "POISON",
  resistance: "RESIST",
  strength: "STR",
  swiftness: "SWIFT",
  fire_resistance: "FIRE",
};

/** Decompose a 0..20 defense value into 10 pip fill states (each pip = 2 pts). */
export function armorPips(defense: number): Fill[] {
  return pipFills(defense, PIPS, POINTS_PER_PIP);
}

export interface EffectBadge {
  type: EffectType;
  label: string;
  level: number;
  seconds: number;
}

/** Compute one display badge per active effect, in list order. Pure. */
export function effectBadges(effects: EffectState): EffectBadge[] {
  return effects.list.map((e) => ({
    type: e.type,
    label: EFFECT_ABBREV[e.type],
    level: e.amplifier + 1,
    seconds: Math.ceil(e.ticksRemaining / TICKS_PER_SECOND),
  }));
}

function applyPip(el: HTMLElement, fill: Fill): void {
  el.classList.toggle("half", fill === "half");
  el.classList.toggle("empty", fill === "empty");
}

/** Update the armor bar + effect badges. Inert when the HUD DOM is absent. */
export function updateArmorHud(equipment: Equipment, effects: EffectState): void {
  if (typeof document === "undefined") return;

  const armorBar = document.getElementById("armor-bar");
  if (armorBar !== null) {
    const defense = equipment.totalDefense();
    armorBar.style.display = defense > 0 ? "flex" : "none";
    if (defense > 0) {
      const shields = armorBar.querySelectorAll<HTMLElement>(".shield");
      const fills = armorPips(defense);
      fills.forEach((fill, i) => {
        const el = shields[i];
        if (el !== undefined) applyPip(el, fill);
      });
    }
  }

  const effectBar = document.getElementById("effect-bar");
  if (effectBar !== null) {
    const badges = effectBadges(effects);
    while (effectBar.children.length > badges.length) {
      effectBar.lastElementChild?.remove();
    }
    while (effectBar.children.length < badges.length) {
      const div = document.createElement("div");
      div.className = "effect-badge";
      effectBar.appendChild(div);
    }
    badges.forEach((b, i) => {
      const el = effectBar.children[i] as HTMLElement | undefined;
      if (el !== undefined) {
        el.textContent = `${b.label} ${b.level} ${b.seconds}s`;
        el.dataset.effect = b.type;
      }
    });
  }
}
