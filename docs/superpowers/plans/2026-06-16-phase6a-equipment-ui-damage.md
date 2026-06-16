# Phase 6a — Equipment / UI / Damage polish: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four polish features to the merged Phase-1–5 base WITHOUT widening `SurvivalState`, changing `Equipment.SLOTS` (stays 4), changing `Inventory.SLOTS` (stays 36), breaking the 13 regen/starve tests, or perturbing the 5 pinned `applyPlayerDamage` cases / `stats.damage(s,6)→14` / the persistence round-trips: (1) an OFF-HAND carry slot on `Equipment` (a separate `offhand` field, never a 5th armor slot), F-key-swapped with the held hotbar item and persisted additively; (2) an armor-points HUD bar + active-status-effect icon row driven by `equipment.totalDefense()` and `effects.list`; (3) a damage-TYPE-aware `applyPlayerDamage` (optional `source` param defaulting to byte-identical melee behavior) so FALL damage gets resistance + i-frames but NOT armor (MC-accurate) and controller fall routes through the chokepoint, while poison/starvation stay direct-writes; (4) PLAYER KNOCKBACK — a decaying horizontal impulse channel on `Player` (mirroring `Mob.knockback`) blended in `controller.update`, applied via an `applyPlayerKnockback` helper reusing the pure `knockbackImpulse`, wired into the mob-melee and creeper-detonate damage hooks.

**Architecture:** Off-hand lives as a single `offhand: ItemStack | null` field on the existing `Equipment` class with `getOffhand()/setOffhand()` accessors — `ARMOR_SLOTS`, `SLOTS`, and the `slots` Record are untouched, so `Equipment.SLOTS === 4` stays true and armor math/persistence are unaffected. Off-hand persists as a single appended slot record behind `SAVE_FORMAT` 5→6 and `SAVE_VERSION` 5→6 (`MIGRATIONS[5]` seeds `offhand: null`), mirroring the Phase-5 effects 4→5 pattern exactly; the binary stream order in `writePlayer` is `…equipment…effects…offhand` (appended LAST for forward compatibility — never reorder). An F-key handler (`KeyF`, currently unoccupied) in the gameplay `keydown` listener swaps the selected hotbar slot with the off-hand, gated behind `uiBlockingGameplay()`. The HUD gains a third pure updater `updateArmorHud(equipment, effects)` in a NEW `src/ui/armor-hud.ts`, computed from `totalDefense()` (0..20 → 10 steel-blue pips via a copy of `survival-hud`'s 10-pip / 2-points formula) plus a JS-managed `#effect-bar` of badges (one per `effects.list` entry, type abbreviation + Lv + seconds = `ceil(ticksRemaining / TICKS_PER_SECOND)`); the pure state-decomposition functions (`armorPips`, `effectBadges`) are unit-tested, the DOM mutation is guarded by `typeof document === "undefined"` and is live-QA only. The damage chokepoint and the new player-knockback helper are EXTRACTED into a NEW `src/combat/player-damage.ts` so `controller.ts` can import them without the `controller → mob-driver → controller` cycle the recon flags; `mob-driver.ts` re-exports both so its existing test (which imports from `./mob-driver`) stays green untouched. `applyPlayerDamage` gains a 4th param `source: "melee" | "explosion" | "fall" = "melee"` — the default keeps the two existing call sites byte-identical; `source === "fall"` skips the armor stage and the durability loop but still honours resistance + i-frames. `Player` gains plain `knockbackX/knockbackZ` numeric fields (NOT in `PhysicsState`, which is vertical-only by contract), blended into `hx/hz` and decayed (`KNOCKBACK_DECAY` 0.5, `KNOCKBACK_EPSILON` 0.01) right before `sweepMove`, with the upward component written to `physics.vy`; `applyPlayerKnockback(player, fromXZ, strength?)` reuses the pure `knockbackImpulse`. `CombatHooks` gains an OPTIONAL `knockbackPlayer?` so existing fakes still compile.

**Tech Stack:** Babylon.js 8, TypeScript, Vite, Vitest

---

## File Structure

| Path | Action | Purpose |
|---|---|---|
| `src/inventory/equipment.ts` | **Modify** (class body after `set`, ~L42) | Add `offhand: ItemStack \| null = null` field + `getOffhand()`/`setOffhand()`. Do NOT touch `ARMOR_SLOTS`, `SLOTS`, or the `slots` Record. |
| `src/inventory/equipment.test.ts` | **Modify** (append; existing 4-case block untouched) | New off-hand tests: starts null, set/get, independent of armor slots, `SLOTS` still 4. |
| `src/save/serialize.ts` | **Modify** (`PlayerSave` L43; `SAVE_FORMAT` L205; `writePlayer` after L407; `readPlayer` after L488 + return L505) | Add `offhand: ItemStackSave \| null` to `PlayerSave`; `SAVE_FORMAT` 5→6; write offhand slot record after the effects block; read it gated on `containerFormat >= 6` (fallback `null`). |
| `src/save/serialize.test.ts` | **Modify** (both fixtures + round-trip) | Add `offhand` to `samplePlayer()` (a tool stack) and `samplePlayerMin()`/inline empties (`null`); assert round-trip. |
| `src/save/migration.ts` | **Modify** (`SAVE_VERSION` L14; `MIGRATIONS` tail L61; doc comment L31) | `SAVE_VERSION` 5→6; add `MIGRATIONS[5]` seeding `offhand: null`. |
| `src/save/migration.test.ts` | **Modify** (`emptyPlayer()` L26; pin L117–120; add v5→v6 test) | Add `offhand: null` to `emptyPlayer`; update pin to 6; add `MIGRATIONS[5]` test. |
| `src/game/persistence.ts` | **Modify** (`snapshotOffhand` near L70; `playerSave` L112) | Add `snapshotOffhand(eq)`; add `offhand: snapshotOffhand(player.equipment)` to `playerSave`. |
| `src/main.ts` | **Modify** (restore after L409; `keydown` before L630; HUD call after L1102) | Restore off-hand in `restoreFromSave`; add `KeyF` swap in the gameplay keydown; call `updateArmorHud` after `updateSurvivalHud`. |
| `src/combat/player-damage.ts` | **Create** | Extract `applyPlayerDamage` (now `source`-aware) + new `applyPlayerKnockback` here so `controller.ts` + `mob-driver.ts` both import with no cycle. |
| `src/combat/player-damage.test.ts` | **Create** | Damage-type tests: default melee byte-identical to the 5 pins; `source:"fall"` skips armor + durability but honours resistance + i-frames; knockback helper accumulates + decays. |
| `src/game/mob-driver.ts` | **Modify** (delete `applyPlayerDamage` body L520–544; re-export from player-damage; hooks L283–287 + L362–366) | Import + re-export `applyPlayerDamage`/`applyPlayerKnockback` from `../combat/player-damage`; add `knockbackPlayer` to the melee hooks; call `applyPlayerKnockback` after the creeper `explode()`. |
| `src/combat/knockback.ts` | **Modify** (doc comment L6–8) | Update the "Player knockback is DEFERRED" comment now that 6a adds the channel. |
| `src/mobs/hostile-ai.ts` | **Modify** (`CombatHooks` L46–49; melee branch after L254) | Add optional `knockbackPlayer?: (attackerXZ) => void`; call `hooks.knockbackPlayer?.(mob.feet)` after `hooks.damagePlayer(...)`. |
| `src/mobs/hostile-ai.test.ts` | **Modify** (optional; existing fakes unchanged) | Confirm existing damage-only fakes still compile (no edit usually needed — `knockbackPlayer` is optional). |
| `src/player/controller.ts` | **Modify** (fields after L73; `update` blend after L140; `respawn` L223; import) | Add `knockbackX/knockbackZ = 0` fields; blend+decay into `hx/hz` before `sweepMove`; route fall damage through `applyPlayerDamage(this, fall, currentTick, "fall")`; add optional `currentTick = -1` 5th `update` param; zero knockback in `respawn`; drop the now-unused `damage` import. |
| `src/player/controller.test.ts` | **Modify** (append; existing suites untouched) | New tests: knockback impulse moves the player then decays to 0; fall damage still survivable after rerouting; `update` works with no `currentTick` arg. |
| `src/ui/armor-hud.ts` | **Create** | Pure `armorPips(defense)` + `effectBadges(effects)` state computation; DOM-guarded `updateArmorHud(equipment, effects)`. |
| `src/ui/armor-hud.test.ts` | **Create** | Unit tests for `armorPips` (0/partial/full) and `effectBadges` (type/level/seconds, empty list). |
| `index.html` | **Modify** (inside `#hud`, after `#hunger-bar` L51) | Add `#armor-bar` (10 `.shield` pips) + empty `#effect-bar`. |
| `src/styles/hud.css` | **Modify** (vars block L18–22; after `.shank.half` L199; new effect-bar rules) | Add `--armor-full`/`--armor-empty`; position `#armor-bar` above hearts; style `.shield`/`.shield.empty`; style `#effect-bar`/`.effect-badge`. |

---

### Task 1: Off-hand field on `Equipment` (+ tests)

Add a single `offhand` carry slot to `Equipment` as a SEPARATE field — never a 5th `ARMOR_SLOT`. `Equipment.SLOTS` stays 4; `ARMOR_SLOTS` stays the 4-element tuple; `totalDefense()`/`slotFor` are untouched. Pure data; no Babylon. Tests FIRST.

**Files:**
- Modify: `src/inventory/equipment.ts`
- Modify: `src/inventory/equipment.test.ts` (append; the existing 4-test block stays byte-identical)

**Must-protect:**
- `equipment.test.ts` `expect(Equipment.SLOTS).toBe(4)` (L8) — `SLOTS` must stay 4; off-hand is a separate field, not a 5th entry in `ARMOR_SLOTS` or the `slots` Record.
- `equipment.test.ts` `for (const slot of ARMOR_SLOTS) expect(eq.get(slot)).toBeNull()` (L10) — `ARMOR_SLOTS` must remain the 4-element tuple; no `ArmorSlot` type widening.
- `equipment.test.ts` `totalDefense sums worn pieces` (L22) and `slotFor` (L28) — off-hand must not feed `totalDefense` (it can hold any item, including armor, but a carried piece confers NO defense).

Steps:

- [ ] **(CODE, UNIT)** Add the off-hand field + accessors to `Equipment` in `src/inventory/equipment.ts`. Before (the `set` method through its close, L39–42):
  ```ts
    /** Force-set a slot (used by the persistence loader). */
    set(slot: ArmorSlot, stack: ItemStack | null): void {
      this.slots[slot] = stack;
    }
  ```
  After — append the off-hand field + getter/setter immediately below `set` (still inside the class, before `equip`):
  ```ts
    /** Force-set a slot (used by the persistence loader). */
    set(slot: ArmorSlot, stack: ItemStack | null): void {
      this.slots[slot] = stack;
    }

    /**
     * The off-hand carry slot. SEPARATE from the 4 armor slots — it is NOT part
     * of ARMOR_SLOTS, does NOT count toward SLOTS (which stays 4), and confers NO
     * defense (totalDefense ignores it). It can hold ANY item; in v1 it is purely
     * a carry slot swapped via the F key.
     */
    private offhand: ItemStack | null = null;

    /** The item held in the off-hand, or null. */
    getOffhand(): ItemStack | null {
      return this.offhand ?? null;
    }

    /** Force-set the off-hand item (used by the F-key swap and the loader). */
    setOffhand(stack: ItemStack | null): void {
      this.offhand = stack;
    }
  ```
  (NOTE: `totalDefense()` iterates `ARMOR_SLOTS` only — since the off-hand is NOT in `ARMOR_SLOTS`, it is automatically excluded with NO edit to `totalDefense`. Confirm visually it still reads `for (const slot of ARMOR_SLOTS)`.)
- [ ] **(CODE, UNIT)** Append off-hand tests to `src/inventory/equipment.test.ts` (do NOT touch the existing 4-case `describe`). Add after the existing `slotFor` test, inside the same `describe("Equipment", ...)`:
  ```ts
    it("off-hand starts empty and is settable independently of armor", () => {
      const eq = new Equipment();
      expect(eq.getOffhand()).toBeNull();
      const torch = makeStack(Items.BOW, 1, 1);
      eq.setOffhand(torch);
      expect(eq.getOffhand()).toBe(torch);
      // Armor slots are unaffected by the off-hand.
      for (const slot of ARMOR_SLOTS) expect(eq.get(slot)).toBeNull();
    });
    it("off-hand is NOT an armor slot: SLOTS stays 4 and it never feeds totalDefense", () => {
      const eq = new Equipment();
      // Even an armor piece carried in the off-hand confers no defense.
      eq.setOffhand(makeStack(Items.DIAMOND_CHESTPLATE, 1, 1));
      expect(Equipment.SLOTS).toBe(4);
      expect(ARMOR_SLOTS).toHaveLength(4);
      expect(eq.totalDefense()).toBe(0);
    });
    it("setOffhand(null) clears the slot", () => {
      const eq = new Equipment();
      eq.setOffhand(makeStack(Items.ARROW, 5));
      eq.setOffhand(null);
      expect(eq.getOffhand()).toBeNull();
    });
  ```
  (`makeStack`, `Items`, `ARMOR_SLOTS`, `Equipment` are already imported at the top of the file — L1–4. `Items.BOW`/`Items.ARROW`/`Items.DIAMOND_CHESTPLATE` exist from Phase 4/5.)
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/inventory/equipment.test.ts` → all green (the 4 original cases + the 3 off-hand cases; `SLOTS===4` and `ARMOR_SLOTS` length 4 still hold).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **Commit:** `feat(equipment): add off-hand carry slot (separate field, SLOTS stays 4)`

---

### Task 2: Off-hand persistence — `SAVE_FORMAT`/`SAVE_VERSION` 5→6 (+ tests)

Persist the off-hand additively, mirroring the Phase-5 effects 4→5 pattern EXACTLY. The off-hand slot is written LAST in `writePlayer` (after the effects block) and read behind `containerFormat >= 6`; `MIGRATIONS[5]` seeds `offhand: null` for v5 saves. In-flight player knockback is transient and NOT persisted (Task 6 fields).

**Files:**
- Modify: `src/save/serialize.ts` (`PlayerSave` L43; `SAVE_FORMAT` L205 + doc L194–204; `writePlayer` after L407; `readPlayer` after L488 + return L505)
- Modify: `src/save/serialize.test.ts` (`samplePlayer()` L89; `samplePlayerMin()` L240; inline empties L230; round-trip ~L163)
- Modify: `src/save/migration.ts` (`SAVE_VERSION` L14; `MIGRATIONS` tail; doc comment)
- Modify: `src/save/migration.test.ts` (`emptyPlayer()` L26; pin L117–120; add v5→v6 test)
- Modify: `src/game/persistence.ts` (`snapshotOffhand` near L70; `playerSave` L112)

**Must-protect:**
- `serialize.test.ts` `round.player.equipment` (L162) + `round.player.effects` (L163) round-trips — both stay green; the new `offhand` block is appended AFTER effects and read behind a `>= 6` gate, so format-5 bytes never enter the offhand reader and decode unchanged.
- `serialize.test.ts` empty-array fixtures (`equipment: []`, `effects: []`) — still pass; the new offhand uses a single presence-flagged slot record (not an array), so the count-driven equipment/effects blocks are unaffected.
- `migration.test.ts` `expect(SAVE_VERSION).toBe(5)` (L118) — updated to `.toBe(6)` here (it is explicitly version-pinned).
- `migration.test.ts` `MIGRATIONS[4]` effects test (L154–159) — stays green; `MIGRATIONS[4]` is unchanged.
- `migration.test.ts` "refuses to downgrade a save newer than the target" (uses `saveAt(SAVE_VERSION + 5)`) — still passes because it reads `SAVE_VERSION` dynamically.
- `SAVE_FORMAT_MIN` stays 1; the binary stream order must remain `…inventory… spawn… equipment… effects… offhand` (offhand appended last). NEVER reorder existing fields.
- Adding `offhand` as a REQUIRED field on `PlayerSave` means EVERY fixture that constructs a `PlayerSave` directly (serialize.test + migration.test) must gain `offhand:` — this is the widest touch; do not miss one or TS fails.

Steps:

- [ ] **(CODE)** Add `offhand` to `PlayerSave` in `src/save/serialize.ts`. Before (L40–44):
  ```ts
    /** Worn armor [helmet, chestplate, leggings, boots]. Added in save v4; default all-null. */
    equipment: (ItemStackSave | null)[];
    /** Active status effects. Added in save v5; absent in older saves (migrated with []). */
    effects: EffectSave[];
  }
  ```
  After:
  ```ts
    /** Worn armor [helmet, chestplate, leggings, boots]. Added in save v4; default all-null. */
    equipment: (ItemStackSave | null)[];
    /** Active status effects. Added in save v5; absent in older saves (migrated with []). */
    effects: EffectSave[];
    /** Off-hand carry slot. Added in save v6; default null on older saves. */
    offhand: ItemStackSave | null;
  }
  ```
- [ ] **(CODE)** Bump `SAVE_FORMAT` + extend the changelog comment. Before (L194–205):
  ```ts
  /**
   * Container format version.
   *  - 1: header + player + binary columns.
   *  - 2: …plus a trailing length-prefixed JSON {@link MobSave}[] blob.
   *  - 3: …plus spawnX/spawnY/spawnZ (f64×3) appended at the end of the player record.
   *  - 4: …plus a length-prefixed equipment slot array at the end of the player record.
   *  - 5: …plus a length-prefixed status-effects array at the end of the player record.
   * Older containers are still readable (spawn defaults to the player position;
   * equipment defaults to all-null on containers older than format 4;
   * effects default to empty on containers older than format 5).
   */
  const SAVE_FORMAT = 5;
  ```
  After:
  ```ts
  /**
   * Container format version.
   *  - 1: header + player + binary columns.
   *  - 2: …plus a trailing length-prefixed JSON {@link MobSave}[] blob.
   *  - 3: …plus spawnX/spawnY/spawnZ (f64×3) appended at the end of the player record.
   *  - 4: …plus a length-prefixed equipment slot array at the end of the player record.
   *  - 5: …plus a length-prefixed status-effects array at the end of the player record.
   *  - 6: …plus a single off-hand slot record at the end of the player record.
   * Older containers are still readable (spawn defaults to the player position;
   * equipment defaults to all-null on containers older than format 4;
   * effects default to empty on containers older than format 5;
   * the off-hand defaults to null on containers older than format 6).
   */
  const SAVE_FORMAT = 6;
  ```
- [ ] **(CODE)** Append the off-hand slot record to `writePlayer`, AFTER the effects block. Before (the effects block + closing brace, L401–408):
  ```ts
    // Status effects (added in container format 5). 3×i32 each; length-prefixed.
    w.u32(p.effects.length);
    for (const fx of p.effects) {
      w.i32(fx.type);
      w.i32(fx.amplifier);
      w.i32(fx.ticksRemaining);
    }
  }
  ```
  After — append a single presence-flagged slot record (same shape as one inventory/equipment slot, NOT length-prefixed since it is exactly one slot):
  ```ts
    // Status effects (added in container format 5). 3×i32 each; length-prefixed.
    w.u32(p.effects.length);
    for (const fx of p.effects) {
      w.i32(fx.type);
      w.i32(fx.amplifier);
      w.i32(fx.ticksRemaining);
    }

    // Off-hand slot (added in container format 6). A single presence-flagged
    // slot record — not length-prefixed (it is always exactly one slot).
    if (p.offhand === null) {
      w.u8(SLOT_EMPTY);
    } else {
      w.u8(SLOT_PRESENT);
      w.i32(p.offhand.itemId);
      w.i32(p.offhand.count);
      w.i32(p.offhand.maxStack);
      const hasDur =
        p.offhand.durability !== undefined &&
        p.offhand.maxDurability !== undefined;
      if (hasDur) {
        w.u8(DURABILITY_PRESENT);
        w.i32(p.offhand.durability ?? 0);
        w.i32(p.offhand.maxDurability ?? 0);
      } else {
        w.u8(DURABILITY_ABSENT);
      }
    }
  }
  ```
- [ ] **(CODE)** Read the off-hand in `readPlayer`, gated on `containerFormat >= 6`, and add it to the return literal. Before (the effects read-block + return, L478–507):
  ```ts
    // Effects (added in container format 5). Older containers → empty list.
    const effects: EffectSave[] = [];
    if (containerFormat >= 5) {
      const fxCount = r.u32();
      for (let i = 0; i < fxCount; i++) {
        const type = r.i32();
        const amplifier = r.i32();
        const ticksRemaining = r.i32();
        effects.push({ type, amplifier, ticksRemaining });
      }
    }

    return {
      x,
      y,
      z,
      yaw,
      pitch,
      health,
      food,
      saturation,
      selectedSlot,
      inventory,
      spawnX,
      spawnY,
      spawnZ,
      equipment,
      effects,
    };
  }
  ```
  After:
  ```ts
    // Effects (added in container format 5). Older containers → empty list.
    const effects: EffectSave[] = [];
    if (containerFormat >= 5) {
      const fxCount = r.u32();
      for (let i = 0; i < fxCount; i++) {
        const type = r.i32();
        const amplifier = r.i32();
        const ticksRemaining = r.i32();
        effects.push({ type, amplifier, ticksRemaining });
      }
    }

    // Off-hand (added in container format 6). Older containers → null.
    let offhand: ItemStackSave | null = null;
    if (containerFormat >= 6) {
      const present = r.u8();
      if (present === SLOT_PRESENT) {
        const itemId = r.i32();
        const count = r.i32();
        const maxStack = r.i32();
        const durFlag = r.u8();
        if (durFlag === DURABILITY_PRESENT) {
          const durability = r.i32();
          const maxDurability = r.i32();
          offhand = { itemId, count, maxStack, durability, maxDurability };
        } else {
          offhand = { itemId, count, maxStack };
        }
      }
    }

    return {
      x,
      y,
      z,
      yaw,
      pitch,
      health,
      food,
      saturation,
      selectedSlot,
      inventory,
      spawnX,
      spawnY,
      spawnZ,
      equipment,
      effects,
      offhand,
    };
  }
  ```
- [ ] **(CODE)** Bump `SAVE_VERSION` + add `MIGRATIONS[5]` in `src/save/migration.ts`. Before (L14):
  ```ts
  export const SAVE_VERSION = 5;
  ```
  After:
  ```ts
  export const SAVE_VERSION = 6;
  ```
  Before (the `MIGRATIONS[4]` effects step + registry close, L54–62):
  ```ts
    4: (data) => ({
      ...data,
      version: 5,
      player: {
        ...data.player,
        effects: [],
      },
    }),
  };
  ```
  After — append the v5→v6 step seeding `offhand: null` (also add a `MIGRATIONS[5]` line to the doc comment above the registry, mirroring the existing `MIGRATIONS[4]` entry):
  ```ts
    4: (data) => ({
      ...data,
      version: 5,
      player: {
        ...data.player,
        effects: [],
      },
    }),
    5: (data) => ({
      ...data,
      version: 6,
      player: {
        ...data.player,
        offhand: null,
      },
    }),
  };
  ```
  Also extend the doc comment (after the `MIGRATIONS[4]` bullet, ~L31–32):
  ```ts
   * - `MIGRATIONS[5]` (v5 -> v6): adds the off-hand slot to the player record.
   *   v5 saves predate the off-hand, so it defaults to null.
  ```
- [ ] **(CODE)** Add `snapshotOffhand` + wire it into `buildWorldSave` in `src/game/persistence.ts`. After `snapshotEquipment` (ends L70), insert:
  ```ts
  /** Snapshot the off-hand carry slot into save shape (null when empty). */
  function snapshotOffhand(eq: Equipment): ItemStackSave | null {
    const stack = eq.getOffhand();
    return stack === null ? null : toItemSave(stack);
  }
  ```
  In `buildWorldSave`, before (L110–112):
  ```ts
      equipment: snapshotEquipment(player.equipment),
      effects: snapshotEffects(player),
    };
  ```
  After:
  ```ts
      equipment: snapshotEquipment(player.equipment),
      effects: snapshotEffects(player),
      offhand: snapshotOffhand(player.equipment),
    };
  ```
  (`Equipment` and `ItemStackSave` are already imported in persistence.ts — L29 and L22.)
- [ ] **(CODE, UNIT)** Update `src/save/migration.test.ts`. Add `offhand: null` to `emptyPlayer()` (after `effects: []`, L26):
  ```ts
      equipment: [],
      effects: [],
      offhand: null,
    };
  ```
  Update the pin (L117–120):
  ```ts
    it("exposes SAVE_VERSION = 6 and a MIGRATIONS registry", () => {
      expect(SAVE_VERSION).toBe(6);
      expect(typeof MIGRATIONS).toBe("object");
    });
  ```
  Add a v5→v6 migration test (model it on the existing `MIGRATIONS[4]` effects test at L154–159), after that block:
  ```ts
    it("MIGRATIONS[5] adds a null off-hand (v5 → v6)", () => {
      const v5 = saveAt(5, 99);
      const out = MIGRATIONS[5]!(v5);
      expect(out.version).toBe(6);
      expect(out.player.offhand).toBeNull();
    });
  ```
- [ ] **(CODE, UNIT)** Extend `src/save/serialize.test.ts`. Add `offhand` to `samplePlayer()` (after its `effects` array, L123–126) with a durability tool to exercise the durability path:
  ```ts
      effects: [
        { type: 5, amplifier: 1, ticksRemaining: 600 }, // strength II
        { type: 0, amplifier: 0, ticksRemaining: 200 }, // regeneration I
      ],
      offhand: { itemId: 257, count: 1, maxStack: 1, durability: 50, maxDurability: 250 },
  ```
  Add `offhand: null` to `samplePlayerMin()` (after its `effects: []`, L256) AND to the inline empty fixture at L230–231:
  ```ts
        equipment: [],
        effects: [],
        offhand: null,
  ```
  Then add a round-trip assertion next to the existing effects one (after L163):
  ```ts
    expect(round.player.offhand).toEqual(player.offhand);
  ```
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/save/serialize.test.ts src/save/migration.test.ts src/game/persistence.test.ts` → all green (equipment + effects round-trips intact; new offhand round-trips; pin is 6; `MIGRATIONS[5]` seeds null).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **Commit:** `feat(save): persist off-hand slot + SAVE_VERSION 5→6 migration`

---

### Task 3: F-key main-hand ⇄ off-hand swap + restore (LIVE-QA glue)

Restore the off-hand on load, and add the `KeyF` swap to the gameplay `keydown` listener (the FIRST one at L560, inside the `uiBlockingGameplay()` gate — NOT the F5-save listener). `KeyF` is unoccupied (`KeyH`=help, `KeyE`=inventory, `KeyW/A/S/D`=movement, `F4`=render-diag — a function key, not the letter F). Off-hand holds ANY item; the swap NEVER calls `Equipment.slotFor` (which only maps armor).

**Files:**
- Modify: `src/main.ts` (restore after the equipment block ~L409; `KeyF` handler before `setKey(e.code, true)` at L630)

**Must-protect:**
- `restoreFromSave` accesses `p.equipment ?? [null,null,null,null]` defensively (L405); the new off-hand restore must use `p.offhand ?? null` for the same reason (older/migrated saves).
- The `KeyF` swap must be inside the `if (uiBlockingGameplay()) { clearInput(); return; }` gate (so it is inert while a modal is open) and must NOT land in the SECOND keydown listener (the F5-save one at ~L1163).
- No existing test imports `main.ts`; this task is LIVE-QA. Correctness is verified by the swap being a pure exchange of two slots (no item loss).

Steps:

- [ ] **(CODE, LIVE-QA)** Restore the off-hand in `restoreFromSave` in `src/main.ts`, after the effects-restore block. Before (the effects restore — find its closing braces, ~L412–423; the block ends with the `for...push({...periodTimer:0})` loop). Append immediately after that loop's closing `}`:
  ```ts
    // Off-hand carry slot (save v6+; older saves migrate to null).
    player.equipment.setOffhand(p.offhand == null ? null : { ...p.offhand });
  ```
  (`p.offhand` is typed `ItemStackSave | null` on `PlayerSave`; the `== null` guard also covers a defensively-absent field on a migrated save object. `setOffhand` was added in Task 1.)
- [ ] **(CODE, LIVE-QA)** Add the `KeyF` swap to the gameplay keydown listener in `src/main.ts`. Before (L624–630):
  ```ts
    // Digit keys 1..9 select a hotbar slot.
    if (e.code.startsWith("Digit")) {
      const n = Number(e.code.slice(5));
      if (n >= 1 && n <= 9) player.hotbar.select(n - 1);
      return;
    }
    setKey(e.code, true);
  ```
  After — insert the `KeyF` swap between the Digit block and `setKey` (both are reached only AFTER the `uiBlockingGameplay()` gate at L619, so the swap is correctly gated):
  ```ts
    // Digit keys 1..9 select a hotbar slot.
    if (e.code.startsWith("Digit")) {
      const n = Number(e.code.slice(5));
      if (n >= 1 && n <= 9) player.hotbar.select(n - 1);
      return;
    }
    // F swaps the held hotbar item with the off-hand (MC's off-hand key). The
    // off-hand holds ANY item, so this bypasses Equipment.slotFor entirely.
    if (e.code === "KeyF") {
      const slot = player.hotbar.selected;
      const main = player.inventory.get(slot);
      const off = player.equipment.getOffhand();
      player.inventory.set(slot, off);
      player.equipment.setOffhand(main);
      return;
    }
    setKey(e.code, true);
  ```
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors. (No new unit tests — the swap is DOM/input glue; its correctness was unit-proven via `getOffhand`/`setOffhand` in Task 1.)
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/inventory src/save` → still green (this task changes only main.ts glue).
- [ ] **(LIVE-QA)** Run the app: select a hotbar slot with an item, press `F` → the held item moves to the off-hand and whatever was there returns to the slot (no loss); press `F` again → it swaps back; open inventory (E) and press `F` → no swap (gated). Save (F5), reload → the off-hand item persists. Manual.
- [ ] **Commit:** `feat(player): F-key off-hand swap + restore off-hand from save`

---

### Task 4: Damage-type-aware `applyPlayerDamage` + route fall damage (+ tests)

Extract the chokepoint into a NEW `src/combat/player-damage.ts` (so `controller.ts` can import it WITHOUT the `controller → mob-driver → controller` cycle the recon flags), add an optional `source` param (default `"melee"` keeps the two existing call sites byte-identical), make `source:"fall"` skip armor + durability but keep resistance + i-frames, and route `controller.ts` fall damage through it. `mob-driver.ts` RE-EXPORTS `applyPlayerDamage` so its existing test (which imports from `./mob-driver`) needs no edits.

**Files:**
- Create: `src/combat/player-damage.ts`, `src/combat/player-damage.test.ts`
- Modify: `src/game/mob-driver.ts` (delete the `applyPlayerDamage` body L520–544 + its imports it no longer needs; import + re-export from `../combat/player-damage`)
- Modify: `src/player/controller.ts` (`update` signature + fall block L178–185; drop unused `damage` import L41)
- Modify: `src/player/controller.test.ts` (append; existing suites untouched)

**Must-protect:**
- `mob-driver.test.ts` 5 pinned `applyPlayerDamage` cases (L290–336): no-armor 6→14; iron-chestplate 6→15; durability decrement; fully-absorbed 2-dmg costs no health + no durability; second hit in i-frame window ignored — ALL call with NO 4th arg, so `source` defaults to `"melee"` and the path is BYTE-IDENTICAL. The re-export keeps the import `applyPlayerDamage` from `./mob-driver` valid.
- `mob-driver.test.ts` 2 resistance cases (L355–375) — `source` defaults to `"melee"`; resistance still applies after armor. Unchanged.
- `stats.test.ts` `damage(s,6)→14` (L263) — tests `damage()` in stats.ts directly; that function is NOT touched. Unaffected.
- `controller.test.ts` fall-damage test (L83–100) — after rerouting through `applyPlayerDamage(this, fall, currentTick, "fall")` with no Resistance active and `lastDamageTick = -1` (never hit → `isInvulnerable` false), the same `onLand()` amount reaches `damage()`; the test's `health > 0 && health < 20` still holds. The default `currentTick = -1` keeps existing `update()` callers (tests + the gravity/wall suites) unchanged.
- `controller.test.ts` gravity/landing, wall, eyePosition, speedMultiplier suites — `update` gains only an OPTIONAL 5th param; all current callers pass no extra arg.
- `armor.test.ts` (`armorReduction`) and `iframes.test.ts` (`isInvulnerable`) — both reused unchanged.

Steps:

- [ ] **(CODE, UNIT)** Create `src/combat/player-damage.ts` — move the chokepoint here, `source`-aware, plus the new knockback helper (knockback fields/helper are exercised in Task 5; the helper is defined here now so both live in one place):
  ```ts
  /**
   * player-damage.ts — the player-side combat chokepoint (Phase 6a).
   *
   * EXTRACTED from mob-driver.ts so controller.ts can route fall damage through
   * the chokepoint WITHOUT a controller → mob-driver → controller import cycle
   * (mob-driver imports `type { Player }` from controller; a runtime import back
   * would be circular). mob-driver re-exports both functions so its existing
   * tests/imports are unchanged.
   *
   * applyPlayerDamage applies, in order: armor reduction (skipped for fall) →
   * resistance → clamp → i-frame gate → durability wear (skipped for fall) →
   * survival damage. The `source` param defaults to "melee" so the pre-Phase-6a
   * call sites are byte-identical. Fall damage (MC-accurate) ignores armor and
   * does not wear it, but still honours Resistance and i-frames. Poison and
   * starvation deliberately do NOT pass through here (they write health directly).
   *
   * applyPlayerKnockback adds a decaying horizontal impulse to the player's
   * knockback channel (controller.update blends + decays it) and writes the
   * upward component to physics.vy — mirroring attackMob's mob knockback.
   */

  import type { Player } from "../player/controller";
  import { damage } from "../survival/stats";
  import { damageTool } from "../inventory/stack";
  import { armorReduction } from "./armor";
  import { isInvulnerable } from "./iframes";
  import { resistanceFraction } from "../effects/status";
  import { knockbackImpulse } from "./knockback";
  import { ARMOR_SLOTS } from "../inventory/equipment";

  /** Where a hit came from. Drives whether armor (and its wear) applies. */
  export type DamageSource = "melee" | "explosion" | "fall";

  /**
   * Apply `rawAmount` damage to the player through the unified chokepoint.
   *
   * @param source defaults to "melee". "melee"/"explosion" apply armor reduction
   *   and wear armor on a real hit; "fall" skips BOTH (MC-accurate) but still
   *   honours Resistance and the i-frame gate.
   */
  export function applyPlayerDamage(
    player: Player,
    rawAmount: number,
    currentTick: number,
    source: DamageSource = "melee",
  ): void {
    const applyArmor = source !== "fall";
    const defense = player.equipment.totalDefense();
    const armored = applyArmor ? armorReduction(rawAmount, defense) : rawAmount;
    // Resistance stage: armor → resistance → clamp. Rounds to the integer
    // half-heart economy. resistanceFraction is 0 with no Resistance active, so
    // this is a no-op for the pinned no-effect tests.
    const fraction = resistanceFraction(player.effects);
    const effective =
      fraction > 0 ? Math.max(0, Math.round(armored * (1 - fraction))) : armored;
    if (effective <= 0) return; // fully absorbed — no health loss, no durability wear
    // i-frames: ignore hits within the immunity window of the last real hit.
    if (isInvulnerable(player.survival.lastDamageTick, currentTick)) return;
    // Decrement durability on each worn piece that took the hit (armor sources
    // only — fall damage does not wear armor).
    if (applyArmor) {
      for (const slot of ARMOR_SLOTS) {
        const piece = player.equipment.get(slot);
        if (piece !== null) {
          player.equipment.set(slot, damageTool(piece));
        }
      }
    }
    damage(player.survival, effective);
    player.survival.lastDamageTick = currentTick;
  }

  /**
   * Add a horizontal knockback impulse to the player, pushing AWAY from
   * `fromXZ`. Reuses the pure {@link knockbackImpulse}. The XZ components feed
   * the decaying knockback channel (blended in controller.update); the upward
   * component is written to physics.vy (picked up next tick by the vertical
   * integrator), mirroring attackMob's treatment of mob knockback.
   */
  export function applyPlayerKnockback(
    player: Player,
    fromXZ: { x: number; z: number },
    strength?: number,
  ): void {
    const k = knockbackImpulse(fromXZ, player.feet, strength);
    player.knockbackX += k.x;
    player.knockbackZ += k.z;
    player.physics.vy = k.y;
  }
  ```
  (NOTE: `player.knockbackX/knockbackZ` are added to `Player` in Task 5. `player-damage.ts` is created here but `applyPlayerKnockback`'s wiring + the Player fields land in Task 5/6 — defining it now keeps the chokepoint and the knockback helper co-located, as the recon prescribes. `typecheck` will pass only AFTER Task 5 adds the fields; therefore the Player-fields edit in Task 5 is sequenced to land in the SAME logical change. To keep THIS task self-contained and green, the Player `knockbackX/knockbackZ` fields are added as the FIRST step of Task 5 — see the note in the verify step below.)
- [ ] **(CODE)** Add the `knockbackX/knockbackZ` fields to `Player` NOW (so `player-damage.ts` typechecks). In `src/player/controller.ts`, before (fields L72–74):
  ```ts
    /** Active status effects (potions). SEPARATE from SurvivalState. */
    readonly effects: EffectState;
    private readonly spawn: Vec3;
  ```
  After:
  ```ts
    /** Active status effects (potions). SEPARATE from SurvivalState. */
    readonly effects: EffectState;
    /**
     * Decaying horizontal knockback impulse (blocks/tick) on the XZ plane.
     * SEPARATE from PhysicsState (which is vertical-only by contract). Blended
     * into the input-derived horizontal velocity each tick in update() and
     * decayed toward 0. The upward component rides physics.vy (see
     * applyPlayerKnockback). Transient — never persisted.
     */
    knockbackX = 0;
    knockbackZ = 0;
    private readonly spawn: Vec3;
  ```
  (The blend/decay in `update` and the `respawn` zeroing land in Task 5; defining the fields here unblocks `player-damage.ts`. With zero knockback applied, no behavior changes yet — all controller tests stay green.)
- [ ] **(CODE)** Replace the `applyPlayerDamage` definition in `src/game/mob-driver.ts` with a re-export. Before (the whole function + its doc, L514–544 — and note imports `damage`, `armorReduction`, `isInvulnerable`, `resistanceFraction`, `knockbackImpulse`, `damageTool`, `ARMOR_SLOTS` at L21–30):
  ```ts
  export function applyPlayerDamage(
    player: Player,
    rawAmount: number,
    currentTick: number,
  ): void {
    const defense = player.equipment.totalDefense();
    const armored = armorReduction(rawAmount, defense);
    // Resistance stage (Phase 5): armor → resistance → clamp. Rounds to the
    // integer half-heart economy. resistanceFraction is 0 when no Resistance
    // effect is active, so this is a no-op for the pinned no-effect tests.
    const fraction = resistanceFraction(player.effects);
    const effective = fraction > 0 ? Math.max(0, Math.round(armored * (1 - fraction))) : armored;
    if (effective <= 0) return; // fully absorbed — no health loss, no durability wear
    // i-frames: ignore hits within the immunity window of the last real hit.
    if (isInvulnerable(player.survival.lastDamageTick, currentTick)) return;
    // Decrement durability on each worn piece that took the hit.
    for (const slot of ARMOR_SLOTS) {
      const piece = player.equipment.get(slot);
      if (piece !== null) {
        player.equipment.set(slot, damageTool(piece));
      }
    }
    damage(player.survival, effective);
    player.survival.lastDamageTick = currentTick;
  }
  ```
  After — re-export from the extracted module (keep the doc comment above pointing at the new home):
  ```ts
  // The player-side combat chokepoint now lives in src/combat/player-damage.ts
  // (extracted in Phase 6a so controller.ts can route fall damage through it
  // without a circular import). Re-exported here so existing callers/tests that
  // import from "./mob-driver" are unaffected.
  export {
    applyPlayerDamage,
    applyPlayerKnockback,
    type DamageSource,
  } from "../combat/player-damage";
  ```
  Then add the runtime import near the top of mob-driver.ts (for the in-file uses in `aiTick`/`detonateCreeper`). After the existing `import { knockbackImpulse } from "../combat/knockback";` (L29), add:
  ```ts
  import { applyPlayerDamage, applyPlayerKnockback } from "../combat/player-damage";
  ```
  Then fix the imports. VERIFIED against the live code (these have ZERO uses outside the extracted body, so DELETE them): `import { damage } from "../survival/stats";` (L21), `import { armorReduction } from "../combat/armor";` (L26), `import { isInvulnerable } from "../combat/iframes";` (L27), `import { resistanceFraction } from "../effects/status";` (L28), and `import { ARMOR_SLOTS } from "../inventory/equipment";` (L30). CHANGE the combined stack import `import { makeStack, damageTool } from "../inventory/stack";` (L24) to `import { makeStack } from "../inventory/stack";` — KEEP `makeStack` (used in `handleDeath` ~L400), DROP `damageTool` (no other use). KEEP `import { knockbackImpulse } from "../combat/knockback";` (L29 — still used in `attackMob` ~L560). The project's strict typecheck flags unused imports, so the VERIFY step below catches any mistake.
- [ ] **(CODE)** Thread `currentTick` into `Player.update` and route fall damage through the chokepoint in `src/player/controller.ts`. Before (`update` signature L103–108):
  ```ts
    update(
      input: InputState,
      yaw: number,
      world: World,
      speedMultiplier: number = 1,
    ): void {
  ```
  After — add the optional `currentTick` (default `-1` = "never damaged" sentinel, so existing callers are unchanged and `isInvulnerable` treats the first fall as eligible):
  ```ts
    update(
      input: InputState,
      yaw: number,
      world: World,
      speedMultiplier: number = 1,
      currentTick: number = -1,
    ): void {
  ```
  Before (the landing/fall block L178–185):
  ```ts
      // Landing transition: airborne → grounded applies fall damage.
      this.physics.onGround = result.onGround;
      if (result.onGround && !wasOnGround) {
        const fall = onLand(this.physics);
        if (fall > 0) {
          damage(this.survival, fall);
        }
      }
  ```
  After — `onLand` is STILL called unconditionally (it resets fallDistance/vy as a side effect); only the damage routing changes:
  ```ts
      // Landing transition: airborne → grounded applies fall damage through the
      // unified chokepoint (source "fall": resistance + i-frames apply, armor
      // does NOT — MC-accurate). onLand() still runs unconditionally to reset
      // the fall accounting.
      this.physics.onGround = result.onGround;
      if (result.onGround && !wasOnGround) {
        const fall = onLand(this.physics);
        if (fall > 0) {
          applyPlayerDamage(this, fall, currentTick, "fall");
        }
      }
  ```
  Update imports in controller.ts: add `import { applyPlayerDamage } from "../combat/player-damage";` (near the Equipment/effects imports, L34–35). Then check the `damage` import (L41, from `../survival/stats`): if fall damage was its ONLY use in controller.ts, remove `damage` from that import list. (Starvation lives in `tickSurvival`, not here.) Run a Grep for `\bdamage(` in controller.ts first; remove the import ONLY if zero non-import matches remain.
- [ ] **(CODE)** Pass `currentTick` at the `player.update` call-site in `src/main.ts`. Before (L997–1002):
  ```ts
      player.update(
          input,
          camera.rotation.y,
          world,
          swiftnessMultiplier(player.effects),
        );
  ```
  After — thread the clock's monotonic tick so fall i-frames share the timeline with mob hits:
  ```ts
      player.update(
          input,
          camera.rotation.y,
          world,
          swiftnessMultiplier(player.effects),
          clock.totalTicks,
        );
  ```
  (ORDERING NOTE — VERIFIED in main.ts: the `player.update(...)` call at L997 runs BEFORE `advance(clock, 1)` (L1003) and BEFORE the local `const currentTick = clock.totalTicks` is computed (L1006). So at the player.update line, the `currentTick` LOCAL is NOT yet in scope — use `clock.totalTicks` directly (the pre-advance value). This is consistent: the fall i-frame is stamped with the tick at which `update` runs, and the mob tick a few lines later uses the post-advance `currentTick`. A 1-tick offset between the two timelines is harmless for the i-frame window (10 ticks). Do NOT move the `player.update` call after `advance`; keep `clock.totalTicks` here.)
- [ ] **(CODE, UNIT)** Create `src/combat/player-damage.test.ts` — prove the default melee path matches the pins and the fall path skips armor + durability but keeps resistance + i-frames:
  ```ts
  import { describe, it, expect } from "vitest";
  import { Player } from "../player/controller";
  import { applyPlayerDamage, applyPlayerKnockback } from "./player-damage";
  import { applyEffect } from "../effects/status";
  import { makeArmorStack } from "../inventory/stack";
  import { Items } from "../rules/items";

  describe("applyPlayerDamage source semantics", () => {
    it("default source is melee: armor reduces fall-free damage (parity with pins)", () => {
      const player = new Player({ x: 0, y: 0, z: 0 });
      player.survival.health = 20;
      applyPlayerDamage(player, 6, 100); // no 4th arg → "melee"
      expect(player.survival.health).toBe(14);
    });
    it("fall source SKIPS armor: full damage reaches survival despite armor", () => {
      const player = new Player({ x: 0, y: 0, z: 0 });
      player.survival.health = 20;
      player.equipment.equip("chestplate", makeArmorStack(Items.IRON_CHESTPLATE));
      const startDur = player.equipment.get("chestplate")!.durability!;
      applyPlayerDamage(player, 6, 100, "fall");
      // No armor mitigation → full 6 lands → 14.
      expect(player.survival.health).toBe(14);
      // Fall damage does NOT wear armor.
      expect(player.equipment.get("chestplate")!.durability).toBe(startDur);
    });
    it("fall source STILL honours resistance", () => {
      const player = new Player({ x: 0, y: 0, z: 0 });
      player.survival.health = 20;
      applyEffect(player.effects, "resistance", 0, 1000); // 20% off
      applyPlayerDamage(player, 10, 100, "fall"); // 10 × 0.8 = 8 → 12
      expect(player.survival.health).toBe(12);
    });
    it("fall source STILL honours i-frames", () => {
      const player = new Player({ x: 0, y: 0, z: 0 });
      player.survival.health = 20;
      applyPlayerDamage(player, 6, 100, "fall");
      expect(player.survival.health).toBe(14);
      applyPlayerDamage(player, 6, 101, "fall"); // within window → ignored
      expect(player.survival.health).toBe(14);
    });
  });

  describe("applyPlayerKnockback", () => {
    it("pushes the player away from the attacker on XZ and sets upward vy", () => {
      const player = new Player({ x: 5, y: 0, z: 0 });
      applyPlayerKnockback(player, { x: 0, z: 0 }); // attacker at origin, player at +X
      expect(player.knockbackX).toBeGreaterThan(0); // pushed +X (away)
      expect(player.knockbackZ).toBeCloseTo(0, 6);
      expect(player.physics.vy).toBeGreaterThan(0); // upward component
    });
    it("a zero-separation hit still produces a non-zero push (default +X)", () => {
      const player = new Player({ x: 0, y: 0, z: 0 });
      applyPlayerKnockback(player, { x: 0, z: 0 });
      expect(Math.hypot(player.knockbackX, player.knockbackZ)).toBeGreaterThan(0);
    });
  });
  ```
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/combat/player-damage.test.ts src/game/mob-driver.test.ts src/survival/stats.test.ts src/combat/armor.test.ts src/combat/iframes.test.ts` → all green. The 5 pinned + 2 resistance `applyPlayerDamage` cases (via the re-export) and `stats.damage(s,6)→14` are unchanged.
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/player/controller.test.ts` → the fall-damage test still shows `health > 0 && < 20`; gravity/wall/eye/speedMultiplier suites green.
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors (catches any unused/missing mob-driver import).
- [ ] **Commit:** `feat(combat): damage-type-aware chokepoint + route fall damage (fall skips armor)`

---

### Task 5: Player knockback channel — blend + decay in `controller.update` (+ tests)

Blend the decaying knockback impulse into the input-derived horizontal velocity each tick, mirroring `mobs/physics.ts:185–191`, and zero it on respawn. The `knockbackX/knockbackZ` fields and `applyPlayerKnockback` already exist (Task 4); this task adds the per-tick blend/decay and the respawn reset, plus the unit tests.

**Files:**
- Modify: `src/player/controller.ts` (blend/decay after `hz` is computed L140, before the velocity Vec3 L156; decay constants; `respawn` L218–223)
- Modify: `src/player/controller.test.ts` (append; existing suites untouched)

**Must-protect:**
- `controller.test.ts` all suites (gravity/landing, wall, fall damage, eyePosition, speedMultiplier) stay green — the knockback fields default to 0, so with no impulse applied `hx/hz` are unchanged and movement is byte-identical.
- `physics.test.ts` — `PhysicsState` is NOT modified (knockback is on Player, vertical-only contract preserved).
- The blend must ADD knockback to `hx/hz` AFTER the input-derivation block (L140) and BEFORE the velocity Vec3 is constructed (L156) — the player recomputes horizontal velocity from input every tick, so adding it after the literal would miss it.
- `KNOCKBACK_DECAY = 0.5` / `KNOCKBACK_EPSILON = 0.01` mirror `mobs/physics.ts:25–27` — define module-local constants in controller.ts (do NOT hardcode magic numbers, and do NOT import from `mobs/physics.ts` which keeps them module-private).

Steps:

- [ ] **(CODE)** Add the decay constants near the top of `src/player/controller.ts` (after the `EYE_HEIGHT` const, L58):
  ```ts
  /** Per-tick decay of the player's horizontal knockback channel (mirrors mobs). */
  const KNOCKBACK_DECAY = 0.5;
  /** Below this magnitude the knockback channel snaps to 0. */
  const KNOCKBACK_EPSILON = 0.01;
  ```
- [ ] **(CODE)** Blend + decay the knockback into `hx/hz` in `update`, right after the input block and before the vertical/velocity section. Before (the end of the horizontal block + the vertical comment, L140–142):
  ```ts
        hx = worldX * perTick;
        hz = worldZ * perTick;
      }

      // --- Vertical: jump gating + per-tick velocity integration -------------
  ```
  After — add the blend/decay between the closing `}` of the horizontal block and the vertical comment:
  ```ts
        hx = worldX * perTick;
        hz = worldZ * perTick;
      }

      // --- Knockback channel: add the decaying impulse to the horizontal move,
      // then decay it (mirrors mobs/physics.ts). The upward component was already
      // written to physics.vy by applyPlayerKnockback and rides the vertical
      // integrator below.
      hx += this.knockbackX;
      hz += this.knockbackZ;
      this.knockbackX *= KNOCKBACK_DECAY;
      this.knockbackZ *= KNOCKBACK_DECAY;
      if (Math.abs(this.knockbackX) < KNOCKBACK_EPSILON) this.knockbackX = 0;
      if (Math.abs(this.knockbackZ) < KNOCKBACK_EPSILON) this.knockbackZ = 0;

      // --- Vertical: jump gating + per-tick velocity integration -------------
  ```
- [ ] **(CODE)** Zero the knockback channel in `respawn` in `src/player/controller.ts`. Before (L218–223):
  ```ts
    /** Reset the body to `spawn` with a full survival state and fresh physics. */
    respawn(spawn: Vec3): void {
      this.feet = { x: spawn.x, y: spawn.y, z: spawn.z };
      this.physics = makePhysicsState();
      this.survival = makeSurvivalState();
      this.effects.list.length = 0;
    }
  ```
  After:
  ```ts
    /** Reset the body to `spawn` with a full survival state and fresh physics. */
    respawn(spawn: Vec3): void {
      this.feet = { x: spawn.x, y: spawn.y, z: spawn.z };
      this.physics = makePhysicsState();
      this.survival = makeSurvivalState();
      this.effects.list.length = 0;
      this.knockbackX = 0;
      this.knockbackZ = 0;
    }
  ```
- [ ] **(CODE, UNIT)** Append knockback tests to `src/player/controller.test.ts` (reuse the existing `flatFloor`/`noInput` helpers; do NOT touch existing suites). Add at the end of the file:
  ```ts
  describe("Player.update — knockback channel", () => {
    it("an applied impulse moves the player on XZ, then decays to zero", () => {
      const world = flatFloor(63); // floor top at y=64
      const player = new Player({ x: 0, y: 64, z: 0 });
      // Settle on the floor first.
      for (let i = 0; i < 5; i++) player.update(noInput(), 0, world);
      const startX = player.feet.x;
      // Inject a +X impulse directly into the channel (as applyPlayerKnockback would).
      player.knockbackX = 0.4;
      player.update(noInput(), 0, world);
      expect(player.feet.x).toBeGreaterThan(startX); // pushed +X this tick
      // The channel decays (0.4 → 0.2 → 0.1 → ... → snaps to 0 under epsilon).
      for (let i = 0; i < 10; i++) player.update(noInput(), 0, world);
      expect(player.knockbackX).toBe(0);
    });
    it("no impulse → movement is unchanged (knockback defaults to 0)", () => {
      const world = flatFloor(63);
      const a = new Player({ x: 0, y: 64, z: 0 });
      const b = new Player({ x: 0, y: 64, z: 0 });
      const input = { ...noInput(), forward: true };
      for (let i = 0; i < 20; i++) {
        a.update(input, 0, world);
        b.update(input, 0, world);
      }
      expect(a.feet.x).toBeCloseTo(b.feet.x, 10);
      expect(a.feet.z).toBeCloseTo(b.feet.z, 10);
    });
    it("respawn zeroes the knockback channel", () => {
      const player = new Player({ x: 0, y: 64, z: 0 });
      player.knockbackX = 0.4;
      player.knockbackZ = -0.4;
      player.respawn({ x: 0, y: 64, z: 0 });
      expect(player.knockbackX).toBe(0);
      expect(player.knockbackZ).toBe(0);
    });
    it("update still works with no currentTick arg (fall i-frame sentinel)", () => {
      const world = flatFloor(63);
      const player = new Player({ x: 0, y: 64, z: 0 });
      // No 5th arg → currentTick defaults to -1; must not throw.
      expect(() => player.update(noInput(), 0, world)).not.toThrow();
    });
  });
  ```
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/player/controller.test.ts src/player/physics.test.ts` → all green (existing suites unchanged; new knockback suite passes; `PhysicsState` untouched).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **Commit:** `feat(player): decaying knockback channel blended in update + zeroed on respawn`

---

### Task 6: Wire player knockback into the mob-melee + creeper-detonate hooks

Thread the attacker XZ into both damage hooks: extend `CombatHooks` with an OPTIONAL `knockbackPlayer?`, call it from the hostile-AI melee branch with `mob.feet`, build it in `aiTick`'s hooks literal, and call `applyPlayerKnockback` from `detonateCreeper` after the blast. The optional hook keeps every existing `CombatHooks` fake compiling.

**Files:**
- Modify: `src/mobs/hostile-ai.ts` (`CombatHooks` L46–49; melee branch after L254)
- Modify: `src/game/mob-driver.ts` (`aiTick` hooks L283–287; `detonateCreeper` after `explode()` L368)
- Modify: `src/combat/knockback.ts` (doc comment L6–8)

**Must-protect:**
- `hostile-ai.test.ts` — `CombatHooks` fakes that define only `damagePlayer`/`playerEyePos` stay valid because `knockbackPlayer` is OPTIONAL (`?:`) and is invoked via `hooks.knockbackPlayer?.(mob.feet)` (optional chaining).
- `mob-driver.test.ts` — the existing `CombatHooks` usage in `aiTick` and the `applyPlayerDamage`/`attackMob` suites are unaffected (adding an optional hook + a knockback call does not change damage math or i-frames).
- `knockback.test.ts` — `knockbackImpulse` is pure and unchanged; only the file's header comment is edited.
- `detonateCreeper` removes the mob via `this.remove(mob.id)` AFTER `explode()`; `mob.feet` is still valid at the `applyPlayerKnockback` call (the local `mob` object stays alive). The knockback call must come BEFORE or independent of removal but use `mob.feet` while it is in scope.

Steps:

- [ ] **(CODE)** Extend `CombatHooks` in `src/mobs/hostile-ai.ts`. Before (L46–49):
  ```ts
  export interface CombatHooks {
    damagePlayer: (amount: number) => void;
    playerEyePos: () => Vec3;
  }
  ```
  After — add the optional knockback hook:
  ```ts
  export interface CombatHooks {
    damagePlayer: (amount: number) => void;
    playerEyePos: () => Vec3;
    /**
     * Optional: push the player away from `attackerXZ` (the mob's feet) on a
     * melee hit. Optional so plain test fakes that only record damage compile.
     */
    knockbackPlayer?: (attackerXZ: { x: number; z: number }) => void;
  }
  ```
- [ ] **(CODE)** Call the knockback hook in the melee branch of `tickHostile` in `src/mobs/hostile-ai.ts`. Before (L252–256):
  ```ts
    if (attackReady(mob, bodyDist, attackRange, cooldown, currentTick)) {
      mob.aiState = "attack";
      hooks.damagePlayer(attackDamage);
      mob.extra[LAST_ATTACK_KEY] = currentTick;
    }
  ```
  After — push the player away from the mob's own feet on the same hit:
  ```ts
    if (attackReady(mob, bodyDist, attackRange, cooldown, currentTick)) {
      mob.aiState = "attack";
      hooks.damagePlayer(attackDamage);
      hooks.knockbackPlayer?.({ x: mob.feet.x, z: mob.feet.z });
      mob.extra[LAST_ATTACK_KEY] = currentTick;
    }
  ```
- [ ] **(CODE)** Build the `knockbackPlayer` hook in `aiTick`'s `CombatHooks` literal in `src/game/mob-driver.ts`. Before (L283–287):
  ```ts
      const hooks: CombatHooks = {
        damagePlayer: (amount: number) =>
          applyPlayerDamage(player, amount, clock.totalTicks),
        playerEyePos: () => player.eyePosition(),
      };
  ```
  After:
  ```ts
      const hooks: CombatHooks = {
        damagePlayer: (amount: number) =>
          applyPlayerDamage(player, amount, clock.totalTicks),
        playerEyePos: () => player.eyePosition(),
        knockbackPlayer: (attackerXZ) => applyPlayerKnockback(player, attackerXZ),
      };
  ```
  (`applyPlayerKnockback` was imported in Task 4's mob-driver edit.)
- [ ] **(CODE)** Apply player knockback from the creeper blast in `detonateCreeper` in `src/game/mob-driver.ts`. Before (the `explode()` call + remesh, L357–377 — specifically the point right after `explode(...)` returns its `result` and before `this.remove(mob.id)`):
  ```ts
      const result = explode(
        this.world,
        center,
        CREEPER_POWER,
        this.manager.all(),
        {
          damagePlayer: (n: number) =>
            applyPlayerDamage(player, n, currentTick),
          playerPos: () => player.feet,
        },
        currentTick,
      );

      // Re-mesh + invalidate skylight for every destroyed coordinate.
  ```
  After — add the knockback push from the blast center (creeper feet) immediately after `explode()`. Use `source:"explosion"` semantics implicitly (the explosion `damagePlayer` closure still calls the default melee path — armor applies to blast damage as before; only the knockback is new). A modest strength bump (0.8) reflects the blast:
  ```ts
      const result = explode(
        this.world,
        center,
        CREEPER_POWER,
        this.manager.all(),
        {
          damagePlayer: (n: number) =>
            applyPlayerDamage(player, n, currentTick),
          playerPos: () => player.feet,
        },
        currentTick,
      );

      // Blast knockback: push the player away from the creeper's feet (blast
      // center XZ). The Mob object stays alive in the local `mob` until removal
      // below, so mob.feet is valid here.
      applyPlayerKnockback(player, { x: mob.feet.x, z: mob.feet.z }, 0.8);

      // Re-mesh + invalidate skylight for every destroyed coordinate.
  ```
  (NOTE: the blast `damagePlayer` closure keeps the DEFAULT `source` — explosion damage still goes through armor, matching pre-6a behavior. Only knockback is added. If a future sub-phase wants armor-free explosion damage, pass `source:"explosion"` there — out of scope for 6a.)
- [ ] **(CODE)** Update the stale comment in `src/combat/knockback.ts`. Before (L6–8):
  ```ts
   * Given the attacker's XZ position and the mob's feet, returns a velocity
   * impulse (blocks/tick) pointing away from the attacker on the XZ plane plus a
   * small fixed upward component. Player knockback is DEFERRED (the player body
   * recomputes horizontal velocity from input each tick — no impulse channel),
   * so this is used only for MOBS.
  ```
  After:
  ```ts
   * Given the attacker's XZ position and a target's feet, returns a velocity
   * impulse (blocks/tick) pointing away from the attacker on the XZ plane plus a
   * small fixed upward component. Used for BOTH mobs (attackMob) and the player
   * (applyPlayerKnockback, added in Phase 6a — the player now has a decaying
   * horizontal knockback channel blended in controller.update).
  ```
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/mobs/hostile-ai.test.ts src/game/mob-driver.test.ts src/combat/knockback.test.ts` → all green (optional hook keeps fakes valid; damage math unchanged; `knockbackImpulse` unchanged).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **(LIVE-QA)** Deferred to Task 8: a zombie melee hit and a creeper detonation both visibly shove the player backward (and slightly up) without otherwise altering damage. Manual.
- [ ] **Commit:** `feat(combat): apply player knockback on mob melee + creeper blast`

---

### Task 7: HUD armor bar + status-effect icons (pure state FIRST, draw is LIVE-QA)

Add the armor-points indicator (driven by `equipment.totalDefense()`) and the active-effect row (driven by `effects.list`). The pure state-decomposition (`armorPips`, `effectBadges`) is unit-tested; the DOM write is guarded by `typeof document === "undefined"` and is live-QA, matching the existing two HUD updaters.

**Files:**
- Create: `src/ui/armor-hud.ts`, `src/ui/armor-hud.test.ts`
- Modify: `index.html` (inside `#hud`, after `#hunger-bar` L51)
- Modify: `src/styles/hud.css` (vars L18–22; after `.shank.half` L199; new effect-bar rules)
- Modify: `src/main.ts` (call after `updateSurvivalHud`, L1102)

**Must-protect:**
- `src/survival/stats.ts` `SurvivalState` shape — `stats.test.ts` uses a strict `toEqual` on `makeSurvivalState()`; Phase 6a adds NO field to `SurvivalState` (armor reads `equipment`, effects read `effects.list` — both already exist).
- `src/effects/status.ts` `EffectState.list` — read-only in HUD code; never mutated here (only `getEffect`/iteration).
- `src/inventory/equipment.ts` `totalDefense()` — only CALLED by the HUD, never mutated; equipment.test stays green.
- The `typeof document === "undefined"` guard pattern from `survival-hud.ts` MUST be replicated so headless unit tests / NullEngine runs stay inert.
- No existing test imports `survival-hud.ts`/`hotbar-hud.ts`; adding a third updater cannot break existing tests, but `armor-hud.ts` MUST separate pure state (`armorPips`/`effectBadges`, unit-tested) from DOM mutation (guarded).
- Instants (`instant_health`/`instant_damage`) are NEVER stored in `effects.list` (status.ts `applyEffect` returns early for instants), so the badge loop never encounters them — no special-case needed.

Steps:

- [ ] **(CODE, UNIT)** Create `src/ui/armor-hud.ts`:
  ```ts
  /**
   * armor-hud.ts — reflects worn-armor defense + active status effects into the
   * HUD DOM (`#armor-bar` pips, `#effect-bar` badges). A third per-frame updater
   * alongside survival-hud and hotbar-hud.
   *
   * The PURE state decomposition (armorPips, effectBadges) is unit-tested; the
   * DOM mutation in updateArmorHud is guarded by `typeof document === "undefined"`
   * so it is a silent no-op in headless / NullEngine runs (mirrors survival-hud).
   *
   * Armor: totalDefense() is an integer 0..20 (full diamond = 3+8+6+3); shown as
   * 10 pips × 2 points (same formula as hearts/shanks). Effects: one badge per
   * effects.list entry — abbreviated type + level + whole seconds remaining.
   */

  import type { Equipment } from "../inventory/equipment";
  import type { EffectState, EffectType } from "../effects/status";
  import { TICKS_PER_SECOND } from "../rules/mc-1.20";

  /** Number of armor pips (each represents 2 defense points; 10 × 2 = 20 max). */
  const PIPS = 10;
  const POINTS_PER_PIP = 2;

  /** Fill state of a single pip. */
  export type Fill = "full" | "half" | "empty";

  /** Short HUD labels for each effect type. */
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

  /**
   * Decompose a 0..20 defense value into 10 pip fill states (each pip = 2 pts):
   * >= full threshold → full, >= half → half, else empty. Mirrors survival-hud's
   * pipFills exactly (copied — the original is module-private and zero-risk to
   * duplicate; it has no imports).
   */
  export function armorPips(defense: number): Fill[] {
    const fills: Fill[] = [];
    for (let i = 0; i < PIPS; i++) {
      const base = i * POINTS_PER_PIP;
      if (defense >= base + POINTS_PER_PIP) fills.push("full");
      else if (defense >= base + 1) fills.push("half");
      else fills.push("empty");
    }
    return fills;
  }

  /** A computed badge for one active effect (pure; consumed by the DOM writer). */
  export interface EffectBadge {
    type: EffectType;
    label: string;
    /** 1-based level for display (amplifier + 1). */
    level: number;
    /** Whole seconds remaining (ceil of ticks / TPS). */
    seconds: number;
  }

  /**
   * Compute one display badge per active effect, in list order. Pure — no DOM.
   * Instants never appear in effects.list, so they never produce a badge.
   */
  export function effectBadges(effects: EffectState): EffectBadge[] {
    return effects.list.map((e) => ({
      type: e.type,
      label: EFFECT_ABBREV[e.type],
      level: e.amplifier + 1,
      seconds: Math.ceil(e.ticksRemaining / TICKS_PER_SECOND),
    }));
  }

  /** Apply a fill state to a pip element by toggling the `half`/`empty` classes. */
  function applyPip(el: HTMLElement, fill: Fill): void {
    el.classList.toggle("half", fill === "half");
    el.classList.toggle("empty", fill === "empty");
  }

  /**
   * Update the armor bar + effect badges. Guarded so it is inert when the HUD
   * DOM is absent (headless / NullEngine). Always called each frame (like the
   * other HUD updaters); the guard makes it safe on frozen/modal frames too.
   */
  export function updateArmorHud(equipment: Equipment, effects: EffectState): void {
    if (typeof document === "undefined") return;

    // Armor pips. Hide the whole bar when defense is 0 to avoid a confusing
    // empty row.
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

    // Effect badges: rebuild the row each frame from the computed badges. The
    // list is short (<= 6 non-instant types), so a full rebuild is cheap and
    // avoids stale entries from expired effects.
    const effectBar = document.getElementById("effect-bar");
    if (effectBar !== null) {
      const badges = effectBadges(effects);
      // Reconcile child count without thrashing when the count is stable.
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
  ```
- [ ] **(CODE, UNIT)** Create `src/ui/armor-hud.test.ts` — pure-state coverage (no DOM):
  ```ts
  import { describe, it, expect } from "vitest";
  import { armorPips, effectBadges } from "./armor-hud";
  import { makeEffectState, applyEffect } from "../effects/status";
  import { TICKS_PER_SECOND } from "../rules/mc-1.20";

  describe("armorPips", () => {
    it("0 defense → all empty", () => {
      expect(armorPips(0)).toEqual(Array(10).fill("empty"));
    });
    it("20 defense (full diamond) → all full", () => {
      expect(armorPips(20)).toEqual(Array(10).fill("full"));
    });
    it("odd value renders a half pip at the boundary", () => {
      // 3 points → pip0 full (>=2), pip1 half (>=1, <2), rest empty.
      const pips = armorPips(3);
      expect(pips[0]).toBe("full");
      expect(pips[1]).toBe("half");
      expect(pips[2]).toBe("empty");
    });
  });

  describe("effectBadges", () => {
    it("empty list → no badges", () => {
      expect(effectBadges(makeEffectState())).toEqual([]);
    });
    it("maps type, level (amp+1), and ceil-seconds", () => {
      const s = makeEffectState();
      applyEffect(s, "strength", 1, TICKS_PER_SECOND * 5 + 1); // level 2, ~5.05 s
      const badges = effectBadges(s);
      expect(badges).toHaveLength(1);
      expect(badges[0]!.type).toBe("strength");
      expect(badges[0]!.label).toBe("STR");
      expect(badges[0]!.level).toBe(2);
      expect(badges[0]!.seconds).toBe(6); // ceil(101/20) = 6
    });
    it("preserves list order across multiple effects", () => {
      const s = makeEffectState();
      applyEffect(s, "regeneration", 0, 40);
      applyEffect(s, "resistance", 0, 40);
      const labels = effectBadges(s).map((b) => b.label);
      expect(labels).toEqual(["REGEN", "RESIST"]);
    });
  });
  ```
- [ ] **(CODE, LIVE-QA)** Add the DOM structure to `index.html`, inside `#hud`, after `#hunger-bar` (L51). Before:
  ```html
        <div id="hunger-bar">
          <div class="shank"></div>
          <div class="shank"></div>
          <div class="shank"></div>
          <div class="shank"></div>
          <div class="shank"></div>
          <div class="shank"></div>
          <div class="shank"></div>
          <div class="shank"></div>
          <div class="shank"></div>
          <div class="shank"></div>
        </div>

        <div id="day-counter">Day 1</div>
  ```
  After — insert `#armor-bar` (10 `.shield` pips) and an empty JS-managed `#effect-bar` between `#hunger-bar` and `#day-counter`:
  ```html
        <div id="hunger-bar">
          <div class="shank"></div>
          <div class="shank"></div>
          <div class="shank"></div>
          <div class="shank"></div>
          <div class="shank"></div>
          <div class="shank"></div>
          <div class="shank"></div>
          <div class="shank"></div>
          <div class="shank"></div>
          <div class="shank"></div>
        </div>

        <div id="armor-bar">
          <div class="shield"></div>
          <div class="shield"></div>
          <div class="shield"></div>
          <div class="shield"></div>
          <div class="shield"></div>
          <div class="shield"></div>
          <div class="shield"></div>
          <div class="shield"></div>
          <div class="shield"></div>
          <div class="shield"></div>
        </div>

        <div id="effect-bar"></div>

        <div id="day-counter">Day 1</div>
  ```
- [ ] **(CODE, LIVE-QA)** Add the styles to `src/styles/hud.css`. First, add the steel-blue armor vars to `:root` (after `--hunger-empty`, L21):
  ```css
    --hunger-full: #b07830;
    --hunger-empty: #2e2418;
    --armor-full: #5a88d4;
    --armor-empty: #1e2a40;
  ```
  Then add the armor-bar + shield rules after the `.shank.half` block (L193–199):
  ```css
  /* ------------------------------------------------------------- armor bar */

  #armor-bar {
    position: absolute;
    bottom: 84px; /* one 16px pip-row + gap above the health bar at 64px */
    left: 16px;
    display: flex;
    gap: 2px;
  }

  .shield {
    width: 16px;
    height: 16px;
    border-radius: 3px;
    background: var(--armor-full);
  }

  .shield.empty {
    background: var(--armor-empty);
  }

  .shield.half {
    background: linear-gradient(
      to right,
      var(--armor-full) 0 50%,
      var(--armor-empty) 50% 100%
    );
  }

  /* ------------------------------------------------------------ effect bar */

  #effect-bar {
    position: absolute;
    top: 56px; /* below the FPS counter (top:16px) + render-diag (top:36px) */
    right: 16px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    pointer-events: none;
  }

  .effect-badge {
    padding: 3px 8px;
    background: var(--bg-glass);
    color: var(--text-primary);
    border-radius: 10px;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }
  ```
- [ ] **(CODE, LIVE-QA)** Call `updateArmorHud` in the render loop in `src/main.ts`. Before (L1101–1102):
  ```ts
    updateHotbarHud(player.inventory, player.hotbar);
    updateSurvivalHud(player.survival, clock);
  ```
  After:
  ```ts
    updateHotbarHud(player.inventory, player.hotbar);
    updateSurvivalHud(player.survival, clock);
    updateArmorHud(player.equipment, player.effects);
  ```
  (Add `import { updateArmorHud } from "./ui/armor-hud";` to main.ts's import block, next to the existing `updateSurvivalHud` import.)
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/ui/armor-hud.test.ts` → all green (pure `armorPips`/`effectBadges`).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **(LIVE-QA)** Run the app: with iron armor equipped the steel-blue armor bar shows ~8 pips above the hearts; remove all armor → the bar hides. Drink a Potion of Strength/Swiftness → a badge appears top-right counting down in seconds; let it expire → the badge disappears. Verify against DESIGN.md (read it first) for color/spacing/typography consistency. Manual.
- [ ] **Commit:** `feat(hud): armor bar + status-effect badges (pure state + guarded draw)`

---

### Task 8: Full regression + live-QA gate

No new code. Run the entire suite + typecheck, then do the integrated live-QA pass that the earlier per-task live-QA steps deferred.

**Files:** none (verification only).

**Must-protect:** the FULL pinned set — `equipment.test` `SLOTS===4`; the 5 `applyPlayerDamage` pins + 2 resistance cases; `stats.damage(s,6)→14`; the 13 regen/starve tests; serialize/migration/persistence round-trips at `SAVE_VERSION` 6; `Inventory.SLOTS===36`; all `controller.test` movement suites; the `attackMob` defaulted-signature tests; `knockback.test`; `physics.test` (PhysicsState unchanged).

Steps:

- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run` → the ENTIRE suite green.
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **(VERIFY)** `corepack pnpm build` → production build succeeds (catches any DOM/import issue the unit suite cannot).
- [ ] **(LIVE-QA)** Integrated pass (read DESIGN.md first; flag any deviation):
  - Off-hand: select an item, press `F` → swaps to off-hand; `F` again → swaps back; no item loss. With inventory open, `F` does nothing.
  - Persistence: put an item in the off-hand, F5-save, reload → off-hand persists; load a pre-6a (v5) save if available → off-hand is empty, nothing crashes.
  - Armor HUD: equip/remove armor → the steel-blue bar appears/updates/hides at 0 defense.
  - Effect HUD: drink Strength/Swiftness → badges count down and clear on expiry.
  - Fall damage: jump off a ledge in iron armor → take FULL fall damage (armor does not reduce it) and armor durability is unchanged; with Resistance active, fall damage is reduced.
  - Knockback: a zombie melee hit and a creeper detonation both visibly shove the player back (and slightly up).
- [ ] **Commit:** `test(phase6a): full regression green + live-QA gate passed` (empty/docs commit if no code changed, or fold into the prior task).

---

## Self-review resolutions (planner)

- **Why a separate `offhand` field, not a 5th `ARMOR_SLOT`?** `equipment.test` pins `Equipment.SLOTS === 4` and `ARMOR_SLOTS` length 4; widening either breaks those tests AND `totalDefense`/`slotFor`/persistence semantics. A standalone field is additive and leaves all four pinned armor invariants untouched. `totalDefense()` iterates `ARMOR_SLOTS` only, so the off-hand is auto-excluded with zero edits.
- **Off-hand persistence shape — single slot record, not a length-prefixed array.** The off-hand is exactly one nullable slot, so it uses the same presence-flag + (optional durability) encoding as ONE inventory slot, appended LAST (after effects). This keeps the count-driven equipment/effects blocks byte-identical for format-5 readers and makes the `>= 6` gate trivially correct (format-5 bytes never reach the offhand reader).
- **Both `SAVE_FORMAT` (serialize.ts) and `SAVE_VERSION` (migration.ts) bump 5→6.** They are separate constants at the same value: `SAVE_FORMAT` gates the binary reader, `SAVE_VERSION` gates the migration pipeline. Missing either breaks one direction. The version-pinned `migration.test` assertion is updated to `.toBe(6)` (it is explicitly pinned and expected to change per sub-phase).
- **Damage chokepoint EXTRACTED to `src/combat/player-damage.ts` (recon option b).** Routing fall damage from `controller.ts` directly into `mob-driver.ts`'s `applyPlayerDamage` would create `controller → mob-driver → controller` (mob-driver imports `type {Player}` from controller; a runtime import back is circular). Extracting to a module that neither owns the other breaks the cycle. `mob-driver.ts` RE-EXPORTS both functions so its existing test imports (`from "./mob-driver"`) need no edits — the 5 pins stay green without touching the test file.
- **`source` default keeps melee byte-identical.** The 5 pins + 2 resistance cases all call with no 4th arg → `source = "melee"` → `applyArmor = true` → the exact pre-6a code path. Fall sets `applyArmor = false` (skip `armorReduction` and the durability loop) but keeps resistance + i-frames unconditional.
- **`currentTick` threading via optional `update(..., currentTick = -1)`.** Avoids a new required param (all existing `update()` callers and tests pass nothing → `-1` = "never damaged" sentinel, so the first fall is i-frame-eligible). main.ts passes `clock.totalTicks` so fall and mob hits share one i-frame timeline.
- **Player knockback fields on `Player`, NOT `PhysicsState`.** `PhysicsState` is vertical-only by contract and tested independently (`physics.test`). Plain `knockbackX/knockbackZ` numeric fields mirror `Mob.knockback`'s role; the blend/decay mirrors `mobs/physics.ts:185–191` with module-local `KNOCKBACK_DECAY`/`KNOCKBACK_EPSILON` (copied, not imported — the mob constants are module-private).
- **Knockback blend placement.** Added to `hx/hz` AFTER the input-derivation block and BEFORE the velocity Vec3 (the player recomputes horizontal velocity from input every tick; adding after the literal would discard it). The upward component goes to `physics.vy` (picked up next tick), exactly as `attackMob` does for mobs.
- **`CombatHooks.knockbackPlayer` is OPTIONAL.** Existing test fakes define only `damagePlayer`/`playerEyePos`; making the hook optional + calling it via `?.` keeps every fake compiling and every `hostile-ai`/`mob-driver` test green.
- **HUD: pure state separated from DOM.** `armorPips`/`effectBadges` are pure + unit-tested; `updateArmorHud` is `typeof document` guarded (mirrors `survival-hud`) so headless/NullEngine runs are inert. Armor uses the same 10-pip/2-point formula as hearts (max defense 20 = full diamond). The armor bar hides at 0 defense to avoid a confusing empty row. The effect row diffs child count rather than clobbering `innerHTML` to avoid per-frame thrash.
- **Instants never reach the badge loop.** `applyEffect` returns early for instants, so `effects.list` never contains `instant_health`/`instant_damage`; `effectBadges` needs no special-case (the abbrev map still includes them for type-completeness/HEAL/HARM labels, harmlessly).
- **Explosion damage still goes through armor.** Only knockback is added to `detonateCreeper`; the blast `damagePlayer` closure keeps the default `source` (melee/armored). Armor-free explosion damage is explicitly NOT in 6a scope.
- **Task ordering is pure-before-glue, tests-green-per-task.** Off-hand data (1) → its persistence (2) → F-key glue (3) → damage-type math + extraction (4) → knockback blend (5) → hook wiring (6) → HUD pure+draw (7) → full gate (8). Task 4 adds the `knockbackX/knockbackZ` fields as its first step so `player-damage.ts` typechecks before Task 5 uses them.

## Out of scope (later sub-phases — do NOT build here)

- **6b — Brewing + fire:** the brewing stand, brewing recipes, fire/burning damage + the `fire_resistance` effect actually mitigating it. (6a only shows `fire_resistance` as a HUD badge if present; it is otherwise inert, as in Phase 5.)
- **6c — Mob expansion + perf:** new mob types, AI/pathfinding upgrades, spawn/perf tuning, chunk/mesh optimization.
- **6d — PBR:** physically-based materials, normal/roughness maps, lighting overhaul.
- **Off-hand gameplay items:** no shield/totem/bow-in-off-hand behavior — the off-hand is purely a carry slot in 6a (no item grants an off-hand effect yet). RMB routing to the off-hand (`{kind:"offhand"}` in `resolveUse`) is explicitly deferred; the F-key is the only off-hand path.
- **`source:"explosion"` armor-free damage:** the param value exists for future use, but creeper blast damage still applies armor in 6a.
