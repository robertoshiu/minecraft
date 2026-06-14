# Controls Reference

## Movement

| Input | Action |
|---|---|
| W | Move forward |
| S | Move backward |
| A | Strafe left |
| D | Strafe right |
| Space | Jump (velocity 0.42 blocks/tick, MC-accurate) |
| Shift | Toggle sprint — increases movement speed, widens FOV slightly, costs extra exhaustion |
| Mouse move | Look (yaw + pitch); canvas must have pointer lock |
| Click canvas | Acquire pointer lock (also unlocks Web Audio on first click) |

**Pointer lock notes:**
- Pointer lock is released automatically when a modal opens (inventory, pause menu, etc.)
- Click the canvas again after closing a modal to re-acquire lock
- The right-click browser context menu is suppressed to allow block placement

---

## Block Interaction

| Input | Action |
|---|---|
| Left click (hold) | Break the targeted block; drops the item into the world |
| Right click | Place the selected hotbar block at the targeted face; also activates beds and crafting surfaces |
| Middle click | Pick block — copies the type of the targeted block into the active hotbar slot |

**Targeting:**
- A DDA voxel raycast identifies the target block and the face normal each frame
- Max reach is 5 blocks (configurable in `src/rules/mc-1.20.ts`)
- Crosshair highlights the targeted block face

---

## Hotbar

| Input | Action |
|---|---|
| 1 – 9 | Select hotbar slot directly |
| Scroll wheel up | Cycle to previous slot (wraps) |
| Scroll wheel down | Cycle to next slot (wraps) |

The hotbar contains 9 slots displayed at the bottom of the screen. The selected slot is highlighted and determines which block or tool is active for interaction.

---

## UI Screens

| Input | Action |
|---|---|
| E | Open inventory screen (4x9 grid + hotbar) |
| E (again) or Escape | Close inventory screen |
| H | Open help screen |
| Escape | Close the current modal, or open the pause menu if no modal is open |
| F5 | Save game to IndexedDB (also prevents browser page reload) |

**Inventory screen:**
- Drag items between slots with left click
- Right-click a stack to split it (half goes to cursor)
- Crafting grid is accessible from the inventory screen (2x2) or from a placed workbench (3x3)

**Crafting screen:**
- Open by right-clicking a workbench
- Recipes are matched automatically as you fill the grid
- Click the output slot to collect the result

**Furnace screen:**
- Open by right-clicking a furnace
- Top slot: ore/item to smelt; bottom slot: fuel; output slot: result
- Progress bar shows cook time remaining

---

## Combat

| Input | Action |
|---|---|
| Left click | Attack the mob in range (same input as break block; the raycast hits mobs first) |

- Attack cooldown applies based on the equipped tool
- Swords and axes deal more damage than bare hands
- Mobs drop items and experience on death

---

## Sleeping

| Input | Condition | Action |
|---|---|---|
| Right click on bed | Night only (after tick 12541) | Enter sleep; advances clock to dawn (tick 0); sets spawn point |

- Sleeping is blocked during the day
- Hostile mobs within 8 blocks prevent sleeping

---

## Settings

Settings are accessible from the pause menu (press **Escape** while no modal is open):

- **Mouse sensitivity** — adjusts pointer-lock angular sensitivity
- **View distance** — number of chunks rendered in each direction (default 8)
- **Audio volume** — master volume for all sound channels
- **Save / Load** — manual save and load triggers
- **Quit to title** — exits the current session
