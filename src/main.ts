/**
 * main.ts — application bootstrap for the PLAYABLE build.
 *
 * Boots Babylon, builds the voxel {@link World} + a stateful {@link
 * WorldRenderer}, spawns a grounded first-person {@link Player}, and wires
 * keyboard/mouse input → movement + mine/place edits with live remeshing.
 *
 * Camera/body split: the {@link UniversalCamera} is used ONLY for mouse-look
 * (pointer lock). Its keyboard movement is removed and it never moves itself —
 * every frame we hard-set `camera.position = player.eyePosition()` and read
 * `camera.rotation.y` as the player's yaw. The Player owns all body motion.
 *
 * Fixed timestep: physics runs at a fixed 1/20 s tick via an accumulator, so
 * movement/gravity are framerate-independent. Rendering runs every frame.
 */

import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
// Side-effect import: registers ShadowGeneratorSceneComponent on the scene,
// overriding the placeholder _SceneComponentInitialization stub in shadowGenerator.js
// that would otherwise throw at `new CascadedShadowGenerator(...)` construction
// when using Babylon's deep ES module imports.
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";

import { installTestApi, type RenderDiagSnapshot } from "./test-api";
import { World } from "./world/world";
import { WorldRenderer, createTerrainMaterials } from "./rendering/world-renderer";
import { Player, type InputState } from "./player/controller";
import { raycastVoxel } from "./interaction/raycast";
import { breakBlock, placeBlock } from "./interaction/edit";
import { updateHotbarHud } from "./ui/hotbar-hud";
import { updateSurvivalHud } from "./ui/survival-hud";
import { makeStack, makeToolStack, isTool, damageTool } from "./inventory/stack";
import { Inventory } from "./inventory/inventory";
import { Blocks, EXHAUSTION, TICKS_PER_SECOND, TIME } from "./rules/mc-1.20";
import { makeClock, advance, tickOfDay, dayNumber } from "./time/clock";
import { canSleep, sleepToDawn } from "./sleep/bed";
import { skyColorAt } from "./time/sky";
import { applySky } from "./game/daynight";
import { addExhaustion } from "./survival/stats";
import { IndexedDbStore, type SaveStore } from "./save/store";
import { deserializeColumn } from "./save/serialize";
import { ChunkColumn } from "./chunk/column";
import { saveGame, loadGame, type ViewAngles } from "./game/persistence";
import { MobDriver, pickMob, attackMob } from "./game/mob-driver";
import { MobRenderer } from "./rendering/mob-renderer";
import { deserializeMobs } from "./mobs/persistence";
import { InventoryScreen } from "./ui/inventory-screen";
import { PauseMenu } from "./ui/pause-menu";
import { SettingsScreen } from "./ui/settings-screen";
import { WorkbenchScreen } from "./ui/workbench-screen";
import { HelpOverlay } from "./ui/help-overlay";
import { showDeath, hideDeath, DeathScreenState } from "./ui/death-screen";
import {
  type Prefs,
  DEFAULT_PREFS,
  clampPrefs,
  loadPrefs,
  savePrefs,
} from "./game/preferences";
import { isDead } from "./survival/stats";
import { AudioEngine } from "./audio/engine";
import { GameAudio } from "./audio/game-audio";
import { getBiome } from "./world/biome";
import type { AudioContextLike } from "./audio/engine";
import { ParticleManager } from "./effects/particles";
import { GameEffects } from "./effects/game-effects";
import { initPostFX, type PostFXController } from "./rendering/post-fx";
import { HintManager } from "./ui/hints";

/** World seed + how many columns of terrain to generate around the origin. */
const WORLD_SEED = 1337;
/** radius 3 → 7×7 = 49 columns; boots in a few seconds. */
const WORLD_RADIUS_COLUMNS = 3;
/** Reach distance for mining / placing (blocks). */
const REACH = 6;
/** Fixed physics tick length (seconds) — one Minecraft tick at 20 TPS. */
const TICK_SECONDS = 1 / TICKS_PER_SECOND;
/** Clamp the per-frame accumulator so a stall can't spiral into a tick storm. */
const MAX_FRAME_SECONDS = 0.25;
/** Wall-clock seconds between background autosaves. */
const AUTOSAVE_SECONDS = 60;

const canvas = document.getElementById("renderCanvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("#renderCanvas not found or is not a <canvas> element");
}

const engine = new Engine(canvas, true, { adaptToDeviceRatio: true });

const scene = new Scene(engine);

// --- Game clock: drives the day/night cycle (advanced 1 tick per fixed tick).
// 24000 ticks/day at 20 TPS = 1200 real seconds = 20 min (== TIME constants).
// Start at midday (tick 6000) so a fresh world spawns in bright daylight, not dim dawn.
const clock = makeClock(6000);

// Initialize the sky color from the clock's starting time-of-day.
const [sky0r, sky0g, sky0b] = skyColorAt(tickOfDay(clock));
scene.clearColor = new Color4(sky0r, sky0g, sky0b, 1);

scene.fogMode = Scene.FOGMODE_LINEAR;
scene.fogColor = new Color3(sky0r, sky0g, sky0b);
scene.fogStart = 60;
scene.fogEnd = 130;

// --- Camera: MOUSE-LOOK ONLY (no self-movement) --------------------------
const camera = new UniversalCamera("camera", new Vector3(0, 110, 0), scene);
// Small near plane so blocks pressed up against the camera still render their near faces.
camera.minZ = 0.03;
camera.maxZ = 1000;
// Strip all keyboard movement — the Player body owns motion, not the camera.
camera.keysUp = [];
camera.keysDown = [];
camera.keysLeft = [];
camera.keysRight = [];
camera.keysUpward = [];
camera.keysDownward = [];
camera.speed = 0;
camera.inertia = 0;
// Keyboard + mouse only — drop the gamepad input so Babylon never touches the
// (headless-flaky) gamepad API, which can throw 'onGamepadConnectedObservable'.
try { camera.inputs.removeByType("FreeCameraGamepadInput"); } catch { /* no gamepad input present */ }
// Pointer-lock mouse-look attached to the canvas.
camera.attachControl(canvas, true);

// --- Lighting -------------------------------------------------------------
// Ambient sky fill — brightened toward the DESIGN.md golden-hour intent.
// (Per-frame `applySky` re-drives intensity from the clock; these are the
// initial/first-frame values and the warm/cool color split.)
// groundColor is the hemisphere's fill for downward/side-facing normals; a
// neutral mid-value prevents side faces from going near-black at midday.
const hemiLight = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
hemiLight.intensity = 1.1;
hemiLight.diffuse = new Color3(1.0, 0.98, 0.95);
// FIX 4: trimmed from 0.45 → 0.34 to reduce the flat fill that washes out
// per-face contrast. This lets faceShade brightness steps read clearly while
// keeping the scene well within the bright "golden-hour" target.
hemiLight.groundColor = new Color3(0.34, 0.35, 0.38);

// Warm 5200K-ish key light. Intensity is scaled per-frame toward ~2.4 at noon.
const sunLight = new DirectionalLight("sun", new Vector3(-0.6, -0.85, -0.4), scene);
sunLight.intensity = 2.4;
sunLight.diffuse = new Color3(1.0, 0.94, 0.82);

// Small scene-ambient floor so all faces have a legible brightness minimum.
// StandardMaterial only applies scene.ambientColor when the material's own
// ambientColor is non-black — terrain-material.ts sets ambientColor(1,1,1).
// FIX 4: trimmed from 0.25 → 0.16 to allow per-face directional brightness
// contrast (faceShade) to be visible rather than washed out by a high ambient
// floor. The world remains clearly bright at daytime SUN_MAX_INTENSITY=2.4.
scene.ambientColor = new Color3(0.16, 0.16, 0.18);

// --- Cascaded Shadow Maps: 2 cascades, PCF MEDIUM quality -----------------
// The CascadedShadowGenerator follows the sun automatically because applySky
// updates sunLight.direction every frame. Casters are registered once on mesh
// creation and removed before dispose — never per-frame.
//
// Perf note (not implemented): at the current radius (~172 meshes) adding all
// opaque chunks as casters with 2 cascades is fine. For larger view distances
// a distance-filtered getCustomRenderList per cascade (G14) would reduce GPU
// shadow-pass overhead significantly.
//
// Non-fatal guard: shadows are eye-candy only. If construction fails for any
// reason (e.g. missing scene component, WebGL context limits), we fall back to
// null and the game boots without shadows rather than showing a black screen.
let shadowGenerator: CascadedShadowGenerator | null = null;
try {
  const csg = new CascadedShadowGenerator(2048, sunLight);
  csg.numCascades = 2;
  csg.usePercentageCloserFiltering = true;
  csg.filteringQuality = CascadedShadowGenerator.QUALITY_MEDIUM;
  csg.stabilizeCascades = true;
  csg.lambda = 0.8;
  csg.shadowMaxZ = 140;
  csg.bias = 0.007;
  csg.normalBias = 0.06;
  csg.cascadeBlendPercentage = 0.1;
  shadowGenerator = csg;
} catch (e) {
  console.warn("[shadows] CascadedShadowGenerator construction failed — running without shadows.", e);
}

// --- World + renderer -----------------------------------------------------
const world = new World(WORLD_SEED);
const materials = createTerrainMaterials(scene);
// Pass the CSM sink (or null) so all opaque chunk meshes are registered as casters from build.
const renderer = new WorldRenderer(scene, world, materials, shadowGenerator ?? undefined);
renderer.buildInitial(WORLD_RADIUS_COLUMNS);

// --- Mobs: driver (spawn + AI + combat) and a separate flat-box renderer ---
// The driver owns the MobManager; the renderer only consumes manager.all().
const mobDriver = new MobDriver(world, renderer);
// Pass the CSM sink (or undefined for no shadows) so mob box meshes cast and receive shadows.
const mobRenderer = new MobRenderer(scene, shadowGenerator ?? undefined);

// --- Audio: procedural Web Audio synthesis engine + game-level mapping -----
// Construction is guarded: if AudioContext is unavailable (headless, Node, or
// before a user gesture) the engine silently becomes a no-op.
let audioEngine: AudioEngine | null = null;
let gameAudio: GameAudio | null = null;
try {
  // Construct with the default factory but catch if the environment has no
  // AudioContext at all (e.g. test runner, headless CI).
  audioEngine = new AudioEngine(() => new (AudioContext as unknown as new () => AudioContextLike)());
  gameAudio = new GameAudio(audioEngine);
} catch {
  audioEngine = null;
  gameAudio = null;
}

// Wire mob audio callbacks into the driver (no-op when audio is unavailable).
if (gameAudio !== null) {
  const ga = gameAudio;
  mobDriver.audioCallbacks = {
    onSpawn: (type, pos) => { ga.onMobSpawn(type, pos); },
    onHurt: (pos) => { ga.onMobHurt(pos); },
    onDeath: (type, pos) => { ga.onMobDeath(type, pos); },
    onCreeperFuse: (pos) => { ga.onCreeperFuse(pos); },
    onExplosion: (pos) => { ga.onExplosion(pos); },
  };
}

// --- Particles: procedural particle system + game-level mapping -------------
// Construction is guarded: ParticleSystem requires a live Babylon scene, so
// this is a no-op in headless/test environments that never reach this path
// (main.ts is not imported by the test suite — it throws at the HTMLCanvas
// guard above).
let particleManager: ParticleManager | null = null;
let gameEffects: GameEffects | null = null;
try {
  particleManager = new ParticleManager(scene);
  gameEffects = new GameEffects(particleManager);
} catch {
  particleManager = null;
  gameEffects = null;
}

// --- Post-FX: bloom, SSAO, film grain ----------------------------------------
// Non-fatal: degrades gracefully when WebGL2 pipeline features are unavailable.
let postFXController: PostFXController | null = null;
try {
  postFXController = initPostFX(scene, camera);
} catch (e) {
  console.warn("[post-fx] initialization failed:", e);
}

// Wire mob particle callbacks into the driver (no-op when effects unavailable).
if (gameEffects !== null) {
  const ge = gameEffects;
  // Extend mobDriver's audioCallbacks with particle hooks — we chain both
  // the existing audio callbacks and the new particle callbacks together.
  const prevAudioCallbacks = mobDriver.audioCallbacks;
  const prevOnSpawn = prevAudioCallbacks?.onSpawn;
  const prevOnCreeperFuse = prevAudioCallbacks?.onCreeperFuse;
  const newCallbacks: typeof mobDriver.audioCallbacks = {
    onHurt: (pos) => {
      prevAudioCallbacks?.onHurt?.(pos);
      // Mob hurt particles — use a warm reddish tint since the hurt callback
      // doesn't carry mob type.
      ge.onMobHurt("zombie", pos);
    },
    onDeath: (type, pos) => {
      prevAudioCallbacks?.onDeath?.(type, pos);
      ge.onMobDeath(type, pos);
    },
    onExplosion: (pos) => {
      prevAudioCallbacks?.onExplosion?.(pos);
      ge.onExplosion(pos);
    },
  };
  // Carry through optional-only callbacks that don't need particle augmentation.
  if (prevOnSpawn !== undefined) newCallbacks.onSpawn = prevOnSpawn;
  if (prevOnCreeperFuse !== undefined) newCallbacks.onCreeperFuse = prevOnCreeperFuse;
  mobDriver.audioCallbacks = newCallbacks;
}

/** Wall-clock ms between footstep sounds. */
const FOOTSTEP_INTERVAL_MS = 400;
let footstepAccumMs = 0;

// --- Spawn the player on the surface of the origin column -----------------
function findSpawn(): { x: number; y: number; z: number } {
  const x = 0;
  const z = 0;
  for (let y = 200; y >= 1; y--) {
    if (world.isSolidAt(x, y, z)) {
      // Feet two blocks above the surface block top.
      return { x: x + 0.5, y: y + 3, z: z + 0.5 };
    }
  }
  return { x: 0.5, y: 120, z: 0.5 };
}

let spawnPoint = findSpawn();
const player = new Player(spawnPoint);

// Starter inventory: blocks to place immediately + a couple of tools.
player.inventory.set(0, makeStack(Blocks.OAK_PLANKS, 64));
player.inventory.set(1, makeStack(Blocks.STONE, 64));
player.inventory.set(2, makeStack(Blocks.GLASS, 64));
player.inventory.set(3, makeStack(Blocks.COBBLESTONE, 64));
player.inventory.set(4, makeToolStack(Blocks.OAK_LOG, "wood"));
player.inventory.set(5, makeToolStack(Blocks.STONE, "stone"));
player.inventory.set(6, makeStack(Blocks.CRAFTING_TABLE, 4));
player.inventory.set(7, makeStack(Blocks.BED, 1));
player.hotbar.select(0);

// --- Persistence: store + boot restore ------------------------------------
// IndexedDB is unavailable under some headless/SSR contexts; guard so the game
// still runs (persistence simply becomes a no-op) when it is absent.
const store: SaveStore | null =
  typeof indexedDB === "undefined" ? null : new IndexedDbStore();

// --- Hint manager: first-day contextual toasts --------------------------------
// Requires a SaveStore to persist which hints have already been shown.
// Falls back to null (no hints) when IndexedDB is unavailable.
const hintManager: HintManager | null =
  store !== null ? new HintManager(store) : null;
if (hintManager !== null) {
  void hintManager.load();
}

/** View angles for the save snapshot (camera owns yaw=rotation.y, pitch=rotation.x). */
function currentView(): ViewAngles {
  return { yaw: camera.rotation.y, pitch: camera.rotation.x };
}

/**
 * Restore live state from a previously-persisted save: replace the world's
 * columns with the deserialized ones, set the clock, the player's body +
 * survival + inventory + selected slot + camera angles, then rebuild meshes.
 */
function restoreFromSave(save: Awaited<ReturnType<typeof loadGame>>): void {
  if (save === null) return;

  // Replace world columns with the persisted set.
  world.columns.clear();
  for (const [key, bytes] of Object.entries(save.columns)) {
    const col: ChunkColumn = deserializeColumn(bytes);
    world.columns.set(key, col);
  }

  // Clock.
  clock.totalTicks = save.totalTicks;

  // Player body + view.
  const p = save.player;
  player.feet = { x: p.x, y: p.y, z: p.z };
  camera.rotation.y = p.yaw;
  camera.rotation.x = p.pitch;

  // Restore bed spawn point.
  spawnPoint = { x: p.spawnX, y: p.spawnY, z: p.spawnZ };
  player.setSpawn(spawnPoint);

  // Survival economy.
  player.survival.health = p.health;
  player.survival.food = p.food;
  player.survival.saturation = p.saturation;
  player.survival.exhaustion = 0;
  player.survival.regenTimer = 0;
  player.survival.starveTimer = 0;

  // Inventory + selection.
  for (let i = 0; i < Inventory.SLOTS; i++) {
    const slot = p.inventory[i] ?? null;
    player.inventory.set(i, slot === null ? null : { ...slot });
  }
  player.hotbar.select(p.selectedSlot);

  // Live mobs (save v2+; absent on older saves → empty list).
  mobDriver.manager.load(deserializeMobs(save.mobs ?? []));

  // Rebuild all meshes against the restored world (disposes old sections).
  renderer.buildInitial(WORLD_RADIUS_COLUMNS);
}

// --- Preferences: live values applied to camera / audio / render ----------
let currentPrefs: Prefs = { ...DEFAULT_PREFS };

/**
 * Apply a Prefs snapshot to live subsystems.
 * FOV is stored in degrees; Babylon expects radians.
 * angularSensibility is inverse-sensitivity (lower → faster), so we divide a
 * tuned base constant (2400) by the user sensitivity so sensitivity=1 → the
 * original feel.
 */
function applyPrefs(p: Prefs): void {
  currentPrefs = clampPrefs(p);

  // Camera FOV (degrees → radians).
  camera.fov = (currentPrefs.fov * Math.PI) / 180;

  // Mouse look: Babylon's angularSensibility is pixels-per-radian (higher =
  // slower). We pick 2400 as the "neutral 1.0" reference.
  camera.angularSensibility = 2400 / currentPrefs.mouseSensitivity;

  // Audio volumes — no-op if the engine is unavailable.
  if (audioEngine !== null) {
    audioEngine.setVolume("master", currentPrefs.masterVolume);
    audioEngine.setVolume("sfx", currentPrefs.sfxVolume);
    audioEngine.setVolume("ambient", currentPrefs.ambientVolume);
  }
}

// Apply defaults immediately so the camera starts with reasonable values.
applyPrefs(currentPrefs);

// --- UI screens: inventory + hand-craft, pause menu, death overlay --------
const inventoryScreen = new InventoryScreen();
const settingsScreen = new SettingsScreen();
const workbenchScreen = new WorkbenchScreen();
const helpOverlay = new HelpOverlay();

const pauseMenu = new PauseMenu({
  onResume: () => {
    /* close handled by the menu; loop resumes once isOpen() is false */
  },
  onSave: () => {
    void requestSave();
  },
  onSettings: () => {
    // Open the settings screen on top of (after closing) the pause menu.
    pauseMenu.close();
    settingsScreen.open(currentPrefs, (newPrefs) => {
      const prevRenderDistance = currentPrefs.renderDistance;
      applyPrefs(newPrefs);
      // Rebuild the world live if render distance changed.
      if (currentPrefs.renderDistance !== prevRenderDistance) {
        renderer.rebuild(currentPrefs.renderDistance);
      }
    });
    releasePointer();
  },
});
const deathState = new DeathScreenState();

/**
 * Gameplay is gated whenever a modal UI is up: the inventory panel, the pause
 * menu, the death overlay, the settings screen, the workbench, or the help
 * overlay. While gated the fixed-tick loop freezes (no physics/mobs/clock)
 * and canvas clicks must not mine/place.
 */
function uiBlockingGameplay(): boolean {
  return (
    inventoryScreen.isOpen() ||
    pauseMenu.isOpen() ||
    deathState.isShown() ||
    settingsScreen.isOpen() ||
    workbenchScreen.isOpen() ||
    helpOverlay.isOpen()
  );
}

// --- Input state ----------------------------------------------------------
const input: InputState = {
  forward: false,
  back: false,
  left: false,
  right: false,
  jump: false,
  sprint: false,
};

/** Zero all movement intent (used when a modal UI gates gameplay). */
function clearInput(): void {
  input.forward = false;
  input.back = false;
  input.left = false;
  input.right = false;
  input.jump = false;
  input.sprint = false;
}

function setKey(code: string, down: boolean): void {
  switch (code) {
    case "KeyW":
      input.forward = down;
      break;
    case "KeyS":
      input.back = down;
      break;
    case "KeyA":
      input.left = down;
      break;
    case "KeyD":
      input.right = down;
      break;
    case "Space":
      input.jump = down;
      break;
    case "ShiftLeft":
    case "ShiftRight":
      input.sprint = down;
      break;
    default:
      break;
  }
}

/** Exit pointer lock + reveal the OS cursor (used when a modal UI opens). */
function releasePointer(): void {
  if (pointerLocked()) document.exitPointerLock();
}

window.addEventListener("keydown", (e) => {
  // F4 toggles the render-diagnostics overlay (debug aid; no gameplay effect).
  if (e.code === "F4") {
    e.preventDefault();
    renderDiagVisible = !renderDiagVisible;
    if (renderDiagEl !== null) {
      renderDiagEl.textContent = renderDiagVisible ? renderDiagEl.textContent : "";
    }
    return;
  }

  // Esc closes the topmost open screen, or toggles the pause menu.
  if (e.code === "Escape") {
    if (helpOverlay.isOpen()) {
      helpOverlay.close();
    } else if (settingsScreen.isOpen()) {
      settingsScreen.close();
      if (store !== null) { void savePrefs(store, currentPrefs); }
    } else if (workbenchScreen.isOpen()) {
      workbenchScreen.close();
    } else if (inventoryScreen.isOpen()) {
      inventoryScreen.close();
    } else {
      pauseMenu.toggle();
      if (pauseMenu.isOpen()) releasePointer();
    }
    clearInput();
    return;
  }

  // H / ? toggles the help overlay.
  if (e.code === "KeyH" || e.key === "?") {
    if (helpOverlay.isOpen()) {
      helpOverlay.close();
    } else if (!uiBlockingGameplay()) {
      helpOverlay.open();
      releasePointer();
    }
    clearInput();
    return;
  }

  // E toggles the inventory + hand-craft screen.
  if (e.code === "KeyE") {
    if (inventoryScreen.isOpen()) {
      inventoryScreen.close();
    } else if (workbenchScreen.isOpen()) {
      workbenchScreen.close();
    } else if (!uiBlockingGameplay()) {
      inventoryScreen.open();
      inventoryScreen.render(player.inventory, player.hotbar);
      hintManager?.onInventoryOpen();
      releasePointer();
    }
    clearInput();
    return;
  }

  // While a modal UI is open, gate gameplay input entirely.
  if (uiBlockingGameplay()) {
    clearInput();
    return;
  }

  // Digit keys 1..9 select a hotbar slot.
  if (e.code.startsWith("Digit")) {
    const n = Number(e.code.slice(5));
    if (n >= 1 && n <= 9) player.hotbar.select(n - 1);
    return;
  }
  setKey(e.code, true);
});
window.addEventListener("keyup", (e) => {
  setKey(e.code, false);
});

// Mouse wheel cycles the hotbar (ignored while a modal UI gates gameplay).
window.addEventListener(
  "wheel",
  (e) => {
    if (uiBlockingGameplay()) return;
    player.hotbar.cycle(e.deltaY > 0 ? 1 : -1);
  },
  { passive: true },
);

// Track whether audio has been unlocked (requires first user gesture).
let audioUnlocked = false;

// Pointer lock on click for mouse-look. Suppressed while a modal UI is open so
// inventory/pause/death clicks land on the UI, not back into the locked world.
canvas.addEventListener("click", () => {
  if (uiBlockingGameplay()) return;
  void canvas.requestPointerLock();

  // Unlock Web Audio on the first click (browser autoplay policy).
  if (!audioUnlocked && audioEngine !== null && gameAudio !== null) {
    audioUnlocked = true;
    audioEngine.unlock();
    // Start ambient wind loop.
    gameAudio.setAmbientBiome(getBiome(0, 0, WORLD_SEED));
  }
});

// Suppress the context menu so right-click can place blocks.
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

/** Is the pointer currently locked to the canvas? */
function pointerLocked(): boolean {
  return document.pointerLockElement === canvas;
}

/** Distance from the eye to the entry corner of a hit voxel (for mob-vs-block). */
function blockHitDistance(
  eye: { x: number; y: number; z: number },
  hit: { block: { x: number; y: number; z: number } },
): number {
  const dx = hit.block.x + 0.5 - eye.x;
  const dy = hit.block.y + 0.5 - eye.y;
  const dz = hit.block.z + 0.5 - eye.z;
  return Math.hypot(dx, dy, dz);
}

/** Cast from the eye along the camera forward; break or place on hit. */
function handleClick(button: number): void {
  if (uiBlockingGameplay()) return;
  if (!pointerLocked()) {
    showToast("Click to lock the mouse — then Left-click to mine, Right-click to place. 1-9 selects the hotbar.");
    return;
  }
  const eye = player.eyePosition();
  const fwd = camera.getDirection(Vector3.Forward());
  const dir = { x: fwd.x, y: fwd.y, z: fwd.z };
  const hit = raycastVoxel(
    eye,
    dir,
    REACH,
    (bx, by, bz) => world.getBlock(bx, by, bz),
  );

  // LMB: a mob in front (and closer than any block hit) is attacked instead of
  // breaking a block. Right-click never targets mobs.
  if (button === 0) {
    const mob = pickMob(eye, dir, REACH, mobDriver.manager.all());
    if (mob !== null) {
      const mobDist = Math.hypot(
        mob.feet.x - eye.x,
        mob.feet.y - eye.y,
        mob.feet.z - eye.z,
      );
      const blockDist = hit === null ? Infinity : blockHitDistance(eye, hit);
      if (mobDist <= blockDist) {
        attackMob(mob, clock.totalTicks);
        // Play hurt sound at mob position.
        gameAudio?.onMobHurt(mob.feet);
        return; // this click hit a mob; skip the block break
      }
    }
  }

  if (hit === null) return;
  if (button === 0) {
    const brokenId = world.getBlock(hit.block.x, hit.block.y, hit.block.z);
    breakBlock(world, hit, renderer, player.inventory);
    const breakPos = {
      x: hit.block.x + 0.5,
      y: hit.block.y + 0.5,
      z: hit.block.z + 0.5,
    };
    // Play break sound at block world position.
    gameAudio?.onBreak(brokenId, breakPos);
    // Spawn block-debris particles at the same position.
    gameEffects?.onBreak(brokenId, breakPos);
    // Hint: first block broken → show "place a block" hint.
    hintManager?.onBlockBreak();
    // Breaking costs exhaustion; if a tool is held, wear it down by one use
    // and write the result back (clearing the slot when the tool breaks).
    addExhaustion(player.survival, EXHAUSTION.BREAK_BLOCK);
    const slot = player.hotbar.selected;
    const held = player.inventory.get(slot);
    if (held !== null && isTool(held)) {
      player.inventory.set(slot, damageTool(held));
    }
  } else if (button === 2) {
    // RMB on a crafting table → open the workbench (do NOT place a block).
    const targetBlock = world.getBlock(hit.block.x, hit.block.y, hit.block.z);
    if (targetBlock === Blocks.CRAFTING_TABLE) {
      workbenchScreen.open(player.inventory, player.hotbar);
      releasePointer();
      return;
    }
    // RMB on a bed → sleep (or show "can only sleep at night" message).
    if (targetBlock === Blocks.BED) {
      if (canSleep(clock)) {
        sleepToDawn(clock);
        // Update the player's spawn point to one block above the bed.
        const bedSpawn = {
          x: hit.block.x + 0.5,
          y: hit.block.y + 2,
          z: hit.block.z + 0.5,
        };
        spawnPoint = bedSpawn;
        player.setSpawn(bedSpawn);
        showToast("Good morning!");
      } else {
        showToast("You can only sleep at night.");
      }
      return;
    }
    placeBlock(world, hit, renderer, player);
    const placePos = {
      x: hit.previous.x + 0.5,
      y: hit.previous.y + 0.5,
      z: hit.previous.z + 0.5,
    };
    // Play place sound at the placement position.
    gameAudio?.onPlace(placePos);
    // Spawn placement-puff particles.
    gameEffects?.onPlace(placePos);
  }
}

canvas.addEventListener("mousedown", (e) => {
  handleClick(e.button);
});

// --- Render diagnostics overlay (F4 toggleable) ---------------------------
// Reads material/texture readiness from live objects; zero rendering impact.
const renderDiagEl = document.getElementById("render-diag");
let renderDiagVisible = true;
let renderDiagLastUpdate = 0;

/** Sample and display render-diagnostics; called from the render loop ~2x/s. */
function updateRenderDiag(nowMs: number): void {
  if (renderDiagEl === null || !renderDiagVisible) return;
  if (nowMs - renderDiagLastUpdate < 500) return;
  renderDiagLastUpdate = nowMs;

  const opaqueMeshCount = renderer.getMeshCount();
  const opaqueMaterialReady = materials.opaque.isReady();
  const transparentMaterialReady = materials.transparent.isReady();
  // Retrieve the atlas texture from the opaque material's active texture list.
  const activeTextures = materials.opaque.getActiveTextures();
  const atlasTex = activeTextures.find((t) => t.name === "terrain-atlas") ?? null;
  const atlasTextureReady = atlasTex !== null ? atlasTex.isReady() : false;

  renderDiagEl.textContent =
    `meshes:${opaqueMeshCount} ` +
    `opq:${opaqueMaterialReady ? "ok" : "NO"} ` +
    `trn:${transparentMaterialReady ? "ok" : "NO"} ` +
    `atlas:${atlasTextureReady ? "ok" : "NO"}`;
}

// --- FPS element + ready promise ------------------------------------------
const fpsEl = document.getElementById("fps");

let resolveReady: (() => void) | undefined;
const readyPromise = new Promise<void>((resolve) => {
  resolveReady = resolve;
});
let firstFrameRendered = false;

// --- Fixed-timestep render loop -------------------------------------------
let accumulator = 0;
let lastTime = performance.now();

/** Respawn the player at the world spawn, hide the death screen, and resume. */
function respawnPlayer(): void {
  player.respawn(spawnPoint);
  deathState.hide();
  hideDeath();
  // Drop any accumulated frame time so play resumes cleanly (no tick storm).
  accumulator = 0;
  lastTime = performance.now();
}

// --- Cleanup: dispose post-FX pipelines and hint DOM on page unload ----------
window.addEventListener("beforeunload", () => {
  postFXController?.dispose();
  hintManager?.dispose();
});

// TODO: migrate hardcoded key checks in setKey() to the keybinds system using isActionKey().
// The isActionKey import is available; wiring requires threading a live keybinds Record
// through setKey, which is a larger refactor deferred to a dedicated pass.

engine.runRenderLoop(() => {
  const now = performance.now();
  let frameSeconds = (now - lastTime) / 1000;
  lastTime = now;
  if (frameSeconds > MAX_FRAME_SECONDS) frameSeconds = MAX_FRAME_SECONDS;

  // FREEZE: while a modal UI is up (inventory / pause / death) the simulation
  // is paused — drop accumulated time so resuming doesn't fast-forward, render
  // the open inventory, and skip all ticks. Rendering continues below.
  const frozen = uiBlockingGameplay();
  if (frozen) {
    accumulator = 0;
    clearInput();
  } else {
    accumulator += frameSeconds;
  }

  // Advance the body + game clock in fixed ticks (framerate-independent).
  while (!frozen && accumulator >= TICK_SECONDS) {
    player.update(input, camera.rotation.y, world);
    advance(clock, 1);
    // Mobs advance on the same fixed tick. currentTick is the clock's monotonic
    // counter (post-advance), shared by spawn gating, AI, and combat timing.
    const currentTick = clock.totalTicks;
    mobDriver.spawnTick(player.feet, clock, Math.random);
    hintManager?.onSpawn();
    mobDriver.aiTick(player, clock, currentTick);

    // Death: the loop owns the death → screen → respawn cycle (the controller
    // no longer auto-respawns). On the rising edge, show the overlay; the
    // outer freeze (deathState.isShown()) then halts ticks until Respawn.
    if (isDead(player.survival)) {
      if (deathState.show("You ran out of health")) {
        showDeath(deathState.cause(), respawnPlayer);
        releasePointer();
      }
      break;
    }
    accumulator -= TICK_SECONDS;
  }

  // Camera follows the body's eye; camera never moves itself.
  const eye = player.eyePosition();
  camera.position.set(eye.x, eye.y, eye.z);

  // Inside-block safeguard: if the eye penetrates terrain, render both faces so
  // blocks still read as solid up close instead of culling to see-through.
  const eyeInSolid = world.isSolidAt(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z));
  materials.opaque.backFaceCulling = !eyeInSolid;

  // --- Audio: update listener position/yaw every frame ---------------------
  if (audioEngine !== null) {
    audioEngine.updateListener(eye, camera.rotation.y);
  }

  // --- Footsteps: play ~every 0.4 s when grounded + moving -----------------
  if (!frozen && (audioEngine !== null || gameEffects !== null)) {
    const movingH =
      (input.forward || input.back || input.left || input.right) &&
      player.physics.onGround;
    if (movingH) {
      footstepAccumMs += frameSeconds * 1000;
      if (footstepAccumMs >= FOOTSTEP_INTERVAL_MS) {
        footstepAccumMs = 0;
        // Sample the block directly underfoot.
        const ux = Math.floor(player.feet.x);
        const uy = Math.floor(player.feet.y) - 1;
        const uz = Math.floor(player.feet.z);
        const underBlock = world.getBlock(ux, uy, uz);
        gameAudio?.onFootstep(underBlock, player.feet);
        gameEffects?.onFootstep(underBlock, player.feet);
      }
    } else {
      footstepAccumMs = 0;
    }
  }

  // Keep the inventory / workbench panel in sync with live inventory while open.
  if (inventoryScreen.isOpen()) {
    inventoryScreen.render(player.inventory, player.hotbar);
  }
  if (workbenchScreen.isOpen()) {
    workbenchScreen.render(player.inventory, player.hotbar);
  }

  // Drive the sky / sun / fog from the clock's time-of-day.
  applySky({ scene, sun: sunLight, hemi: hemiLight }, clock);

  // Reconcile mob boxes with the live mob set (mobs move; no frozen matrices).
  mobRenderer.sync(mobDriver.manager.all());

  scene.render();

  updateHotbarHud(player.inventory, player.hotbar);
  updateSurvivalHud(player.survival, clock);

  if (!firstFrameRendered) {
    firstFrameRendered = true;
    resolveReady?.();
  }
  if (fpsEl) {
    fpsEl.textContent = `${engine.getFps().toFixed(0)} FPS`;
  }
  updateRenderDiag(performance.now());
});

window.addEventListener("resize", () => {
  engine.resize();
});

// --- Save / autosave wiring -----------------------------------------------

/** Display a brief toast message in the HUD (no-op if the element is absent). */
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showToast(msg: string): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById("toast");
  if (el === null) return;
  el.textContent = msg;
  el.style.opacity = "1";
  if (toastTimer !== undefined) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.style.opacity = "0";
  }, 2000);
}

/** Briefly flash a "Saved" indicator if the (optional) element exists. */
let saveIndicatorTimer: ReturnType<typeof setTimeout> | undefined;
function flashSaved(): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById("save-indicator");
  if (el === null) return;
  el.textContent = "Saved";
  el.style.opacity = "1";
  if (saveIndicatorTimer !== undefined) clearTimeout(saveIndicatorTimer);
  saveIndicatorTimer = setTimeout(() => {
    el.style.opacity = "0";
  }, 1200);
}

/** Persist the current game, then flash the indicator on success. */
async function requestSave(): Promise<void> {
  if (store === null) return;
  const ok = await saveGame(
    store,
    world,
    player,
    clock,
    currentView(),
    mobDriver.manager,
  );
  if (ok) flashSaved();
}

// F5 saves (preventing the browser's reload).
window.addEventListener("keydown", (e) => {
  if (e.code === "F5") {
    e.preventDefault();
    void requestSave();
  }
});

// Autosave when the tab is hidden (best chance to persist before unload).
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    void requestSave();
  }
});

// Periodic autosave every AUTOSAVE_SECONDS of wall-clock time.
if (store !== null) {
  setInterval(() => {
    void requestSave();
  }, AUTOSAVE_SECONDS * 1000);
}

// --- Boot restore: load a prior save (if any) before play begins ----------
if (store !== null) {
  // Load preferences first (fast), then load the world save.
  void loadPrefs(store).then((prefs) => {
    applyPrefs(prefs);
    if (store !== null) {
      return loadGame(store).then((save) => {
        if (save !== null) restoreFromSave(save);
      });
    }
    return Promise.resolve();
  });
}

/** Clamp a value to [min, max] (inclusive). */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const testApiBase = {
  ready: () => readyPromise,
  state: () => ({
    meshCount: renderer.getMeshCount(),
    fps: engine.getFps(),
    // Flat aliases kept for any callers that use the old shape.
    playerY: player.feet.y,
    health: player.health,
    food: player.survival.food,
    saturation: player.survival.saturation,
    selectedSlot: player.hotbar.selected,
    day: dayNumber(clock),
    totalTicks: clock.totalTicks,
    // Nested shapes expected by smoke tests.
    player: {
      position: { x: player.feet.x, y: player.feet.y, z: player.feet.z },
    },
    clock: {
      tod: tickOfDay(clock),
      totalTicks: clock.totalTicks,
      day: dayNumber(clock),
    },
  }),
  renderDiag: (): RenderDiagSnapshot => {
    const activeTextures = materials.opaque.getActiveTextures();
    const atlasTex = activeTextures.find((t) => t.name === "terrain-atlas") ?? null;
    return {
      opaqueMeshCount: renderer.getMeshCount(),
      opaqueMaterialReady: materials.opaque.isReady(),
      transparentMaterialReady: materials.transparent.isReady(),
      atlasTextureReady: atlasTex !== null ? atlasTex.isReady() : false,
    };
  },
  /**
   * Set the clock to the given tick-of-day within the current day.
   * The tod is clamped to [0, 23999] and the clock is updated so that
   * tickOfDay(clock) === tod while preserving the day number.
   */
  setTime: (tod: number): void => {
    const safeToD = clamp(Math.floor(tod), 0, TIME.TICKS_PER_DAY - 1);
    const dayStart = dayNumber(clock) - 1;
    clock.totalTicks = dayStart * TIME.TICKS_PER_DAY + safeToD;
  },
  /**
   * Attempt to sleep: if it is night, sleepToDawn + set spawn to player feet.
   * Returns a result snapshot for assertions.
   */
  trySleep: () => {
    const todBefore = tickOfDay(clock);
    const wasNight = canSleep(clock);
    if (wasNight) {
      sleepToDawn(clock);
      const newSpawn = { x: player.feet.x, y: player.feet.y, z: player.feet.z };
      spawnPoint = newSpawn;
      player.setSpawn(newSpawn);
    }
    return {
      wasNight,
      todBefore,
      todAfter: tickOfDay(clock),
      day: dayNumber(clock),
      spawn: { ...spawnPoint },
    };
  },
};

if (audioEngine !== null && gameAudio !== null) {
  const ae = audioEngine;
  const ga = gameAudio;
  const baseWithAudio = {
    ...testApiBase,
    audio: {
      state: () => ae.state(),
      playTest: () => {
        ga.onBreak(Blocks.STONE, player.eyePosition());
      },
    },
  };
  if (particleManager !== null && gameEffects !== null) {
    const pm = particleManager;
    const ge = gameEffects;
    installTestApi({
      ...baseWithAudio,
      effects: {
        burstAt: (x: number, y: number, z: number) => { ge.onBreak(Blocks.STONE, { x, y, z }); },
        activeCount: () => pm.activeCount(),
      },
    });
  } else {
    installTestApi(baseWithAudio);
  }
} else if (particleManager !== null && gameEffects !== null) {
  const pm = particleManager;
  const ge = gameEffects;
  installTestApi({
    ...testApiBase,
    effects: {
      burstAt: (x: number, y: number, z: number) => { ge.onBreak(Blocks.STONE, { x, y, z }); },
      activeCount: () => pm.activeCount(),
    },
  });
} else {
  installTestApi(testApiBase);
}
