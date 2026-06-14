/**
 * settings-screen.ts — the Settings overlay (DOM, fully guarded).
 *
 * Provides sliders / number inputs for all {@link Prefs} fields. Each change
 * calls `onChange` immediately with the new clamped Prefs (live apply). A
 * "Done" button closes the overlay.
 *
 * The screen is safe to construct and call under node / headless tests — every
 * DOM path is behind a {@link hasDom} guard.
 *
 * Styled with DESIGN.md tokens.
 */

import { clampPrefs, type Prefs } from "../game/preferences";
import {
  type ColorblindMode,
  setColorblindMode,
  setUIScale,
} from "./a11y";

/** Whether the DOM is available (false under node / unit tests). */
function hasDom(): boolean {
  return typeof document !== "undefined";
}

/** Shared button styling (mirrors pause-menu.ts). */
function styleButton(btn: HTMLButtonElement, bg: string, fg: string): void {
  btn.style.padding = "10px 28px";
  btn.style.fontSize = "16px";
  btn.style.fontWeight = "600";
  btn.style.color = fg;
  btn.style.background = bg;
  btn.style.border = "none";
  btn.style.borderRadius = "6px";
  btn.style.cursor = "pointer";
  btn.style.transition = "background 120ms ease";
}

/** Render a labeled slider row inside `container`. Returns the <input>. */
function addSlider(
  container: HTMLElement,
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (v: number) => void,
): HTMLInputElement {
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.alignItems = "center";
  row.style.gap = "12px";

  const lbl = document.createElement("label");
  lbl.textContent = label;
  lbl.style.color = "var(--text-primary, #e8e6e1)";
  lbl.style.fontSize = "14px";
  lbl.style.width = "160px";
  lbl.style.flexShrink = "0";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(value);
  slider.style.flex = "1";
  slider.style.accentColor = "var(--accent, #d4a843)";

  const display = document.createElement("span");
  display.textContent = String(Math.round(value * 100) / 100);
  display.style.color = "var(--text-secondary, #9a978f)";
  display.style.fontSize = "13px";
  display.style.width = "42px";
  display.style.textAlign = "right";

  slider.addEventListener("input", () => {
    const v = Number(slider.value);
    display.textContent = String(Math.round(v * 100) / 100);
    onChange(v);
  });

  lbl.htmlFor = `settings-slider-${label.replace(/\s/g, "-").toLowerCase()}`;
  slider.id = lbl.htmlFor;

  row.appendChild(lbl);
  row.appendChild(slider);
  row.appendChild(display);
  container.appendChild(row);
  return slider;
}

/** Render a labeled checkbox toggle row inside `container`. Returns the <input>. */
function addToggle(
  container: HTMLElement,
  label: string,
  value: boolean,
  onChange: (v: boolean) => void,
): HTMLInputElement {
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.alignItems = "center";
  row.style.gap = "12px";

  const id = `settings-toggle-${label.replace(/\s/g, "-").toLowerCase()}`;

  const lbl = document.createElement("label");
  lbl.textContent = label;
  lbl.htmlFor = id;
  lbl.style.color = "var(--text-primary, #e8e6e1)";
  lbl.style.fontSize = "14px";
  lbl.style.width = "160px";
  lbl.style.flexShrink = "0";
  lbl.style.cursor = "pointer";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.id = id;
  checkbox.checked = value;
  checkbox.style.accentColor = "var(--accent, #d4a843)";
  checkbox.style.width = "16px";
  checkbox.style.height = "16px";
  checkbox.style.cursor = "pointer";

  checkbox.addEventListener("change", () => {
    onChange(checkbox.checked);
  });

  row.appendChild(lbl);
  row.appendChild(checkbox);
  container.appendChild(row);
  return checkbox;
}

/** Render a labeled dropdown (select) row inside `container`. Returns the <select>. */
function addDropdown(
  container: HTMLElement,
  label: string,
  options: ReadonlyArray<{ label: string; value: string }>,
  selectedValue: string,
  onChange: (v: string) => void,
): HTMLSelectElement {
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.alignItems = "center";
  row.style.gap = "12px";

  const id = `settings-dropdown-${label.replace(/\s/g, "-").toLowerCase()}`;

  const lbl = document.createElement("label");
  lbl.textContent = label;
  lbl.htmlFor = id;
  lbl.style.color = "var(--text-primary, #e8e6e1)";
  lbl.style.fontSize = "14px";
  lbl.style.width = "160px";
  lbl.style.flexShrink = "0";
  lbl.style.cursor = "pointer";

  const select = document.createElement("select");
  select.id = id;
  select.style.flex = "1";
  select.style.background = "var(--bg-panel, #1a1d24)";
  select.style.color = "var(--text-primary, #e8e6e1)";
  select.style.border = "1px solid var(--slot-border, #3a3d45)";
  select.style.borderRadius = "4px";
  select.style.padding = "4px 8px";
  select.style.fontSize = "13px";
  select.style.cursor = "pointer";

  for (const opt of options) {
    const el = document.createElement("option");
    el.value = opt.value;
    el.textContent = opt.label;
    if (opt.value === selectedValue) el.selected = true;
    select.appendChild(el);
  }

  select.addEventListener("change", () => {
    onChange(select.value);
  });

  row.appendChild(lbl);
  row.appendChild(select);
  container.appendChild(row);
  return select;
}

/**
 * The settings overlay. Construct once; call {@link open} / {@link close} to
 * toggle, and read {@link isOpen} in the game loop for modal gating.
 */
export class SettingsScreen {
  private open_ = false;
  private root: HTMLElement | null = null;
  private currentPrefs: Prefs | null = null;
  private onChangeFn: ((p: Prefs) => void) | null = null;

  constructor() {
    if (hasDom()) this.build();
  }

  /** Is the screen currently open? */
  isOpen(): boolean {
    return this.open_;
  }

  /**
   * Open the settings screen, displaying the given prefs. `onChange` is called
   * with the new clamped Prefs whenever any control changes (live apply).
   */
  open(prefs: Prefs, onChange: (p: Prefs) => void): void {
    this.open_ = true;
    this.currentPrefs = { ...prefs };
    this.onChangeFn = onChange;
    if (this.root !== null) {
      this.populate(prefs);
      this.root.style.display = "flex";
    }
  }

  /** Close the screen. */
  close(): void {
    this.open_ = false;
    if (this.root !== null) this.root.style.display = "none";
  }

  // --- DOM construction (guarded) ------------------------------------------

  private sliders: {
    renderDistance: HTMLInputElement | null;
    fov: HTMLInputElement | null;
    mouseSensitivity: HTMLInputElement | null;
    masterVolume: HTMLInputElement | null;
    sfxVolume: HTMLInputElement | null;
    ambientVolume: HTMLInputElement | null;
    uiScale: HTMLInputElement | null;
  } = {
    renderDistance: null,
    fov: null,
    mouseSensitivity: null,
    masterVolume: null,
    sfxVolume: null,
    ambientVolume: null,
    uiScale: null,
  };

  private toggles: {
    bloomEnabled: HTMLInputElement | null;
    ssaoEnabled: HTMLInputElement | null;
    filmGrainEnabled: HTMLInputElement | null;
  } = {
    bloomEnabled: null,
    ssaoEnabled: null,
    filmGrainEnabled: null,
  };

  private dropdowns: {
    colorblindMode: HTMLSelectElement | null;
  } = {
    colorblindMode: null,
  };

  private build(): void {
    const host = document.getElementById("hud") ?? document.body;

    const root = document.createElement("div");
    root.id = "settings-screen";
    root.style.position = "fixed";
    root.style.inset = "0";
    root.style.display = "none";
    root.style.alignItems = "center";
    root.style.justifyContent = "center";
    root.style.zIndex = "50";
    root.style.pointerEvents = "auto";
    root.style.background = "var(--bg-overlay, rgba(0,0,0,0.55))";
    root.style.backdropFilter = "blur(8px)";

    const card = document.createElement("div");
    card.style.background = "var(--bg-panel, #1a1d24)";
    card.style.border = "1px solid var(--slot-border, #3a3d45)";
    card.style.borderRadius = "8px";
    card.style.padding = "28px 36px";
    card.style.display = "flex";
    card.style.flexDirection = "column";
    card.style.gap = "16px";
    card.style.minWidth = "420px";
    card.style.alignItems = "stretch";

    const heading = document.createElement("div");
    heading.textContent = "Settings";
    heading.style.color = "var(--text-primary, #e8e6e1)";
    heading.style.fontSize = "28px";
    heading.style.fontWeight = "700";
    heading.style.textAlign = "center";
    heading.style.marginBottom = "8px";
    card.appendChild(heading);

    // Section label helper.
    const addSection = (text: string): void => {
      const sep = document.createElement("div");
      sep.textContent = text;
      sep.style.color = "var(--text-secondary, #9a978f)";
      sep.style.fontSize = "12px";
      sep.style.fontWeight = "600";
      sep.style.textTransform = "uppercase";
      sep.style.letterSpacing = "0.08em";
      sep.style.marginTop = "4px";
      card.appendChild(sep);
    };

    const emit = (): void => {
      if (this.currentPrefs === null || this.onChangeFn === null) return;
      this.onChangeFn(clampPrefs({ ...this.currentPrefs }));
    };

    addSection("Video");
    this.sliders.renderDistance = addSlider(card, "Render Distance", 3, 2, 6, 1, (v) => {
      if (this.currentPrefs !== null) { this.currentPrefs.renderDistance = v; emit(); }
    });
    this.sliders.fov = addSlider(card, "Field of View", 75, 60, 110, 1, (v) => {
      if (this.currentPrefs !== null) { this.currentPrefs.fov = v; emit(); }
    });

    addSection("Controls");
    this.sliders.mouseSensitivity = addSlider(card, "Mouse Sensitivity", 1, 0.2, 3, 0.05, (v) => {
      if (this.currentPrefs !== null) { this.currentPrefs.mouseSensitivity = v; emit(); }
    });

    addSection("Audio");
    this.sliders.masterVolume = addSlider(card, "Master Volume", 1, 0, 1, 0.05, (v) => {
      if (this.currentPrefs !== null) { this.currentPrefs.masterVolume = v; emit(); }
    });
    this.sliders.sfxVolume = addSlider(card, "SFX Volume", 1, 0, 1, 0.05, (v) => {
      if (this.currentPrefs !== null) { this.currentPrefs.sfxVolume = v; emit(); }
    });
    this.sliders.ambientVolume = addSlider(card, "Ambient Volume", 0.6, 0, 1, 0.05, (v) => {
      if (this.currentPrefs !== null) { this.currentPrefs.ambientVolume = v; emit(); }
    });

    addSection("Graphics");
    this.toggles.bloomEnabled = addToggle(card, "Bloom", true, (v) => {
      if (this.currentPrefs !== null) { this.currentPrefs.bloomEnabled = v; emit(); }
    });
    this.toggles.ssaoEnabled = addToggle(card, "Ambient Occlusion", true, (v) => {
      if (this.currentPrefs !== null) { this.currentPrefs.ssaoEnabled = v; emit(); }
    });
    this.toggles.filmGrainEnabled = addToggle(card, "Film Grain", true, (v) => {
      if (this.currentPrefs !== null) { this.currentPrefs.filmGrainEnabled = v; emit(); }
    });

    addSection("Accessibility");
    const colorblindOptions: ReadonlyArray<{ label: string; value: ColorblindMode }> = [
      { label: "None", value: "none" },
      { label: "Protanopia", value: "protanopia" },
      { label: "Deuteranopia", value: "deuteranopia" },
      { label: "Tritanopia", value: "tritanopia" },
    ];
    this.dropdowns.colorblindMode = addDropdown(
      card,
      "Colorblind Mode",
      colorblindOptions,
      "none",
      (v) => {
        if (this.currentPrefs !== null) {
          const mode = v as ColorblindMode;
          this.currentPrefs.colorblindMode = mode;
          void setColorblindMode(mode);
          emit();
        }
      },
    );
    this.sliders.uiScale = addSlider(card, "UI Scale", 1.0, 0.5, 2.0, 0.1, (v) => {
      if (this.currentPrefs !== null) {
        this.currentPrefs.uiScale = v;
        void setUIScale(v);
        emit();
      }
    });

    const done = document.createElement("button");
    done.textContent = "Done";
    done.style.marginTop = "8px";
    styleButton(done, "var(--accent, #d4a843)", "var(--bg-panel, #1a1d24)");
    done.addEventListener("click", () => { this.close(); });
    card.appendChild(done);

    root.appendChild(card);
    host.appendChild(root);
    this.root = root;
  }

  /** Sync slider / toggle / dropdown positions to the given prefs (called on open). */
  private populate(prefs: Prefs): void {
    if (this.sliders.renderDistance !== null) {
      this.sliders.renderDistance.value = String(prefs.renderDistance);
    }
    if (this.sliders.fov !== null) {
      this.sliders.fov.value = String(prefs.fov);
    }
    if (this.sliders.mouseSensitivity !== null) {
      this.sliders.mouseSensitivity.value = String(prefs.mouseSensitivity);
    }
    if (this.sliders.masterVolume !== null) {
      this.sliders.masterVolume.value = String(prefs.masterVolume);
    }
    if (this.sliders.sfxVolume !== null) {
      this.sliders.sfxVolume.value = String(prefs.sfxVolume);
    }
    if (this.sliders.ambientVolume !== null) {
      this.sliders.ambientVolume.value = String(prefs.ambientVolume);
    }
    if (this.toggles.bloomEnabled !== null) {
      this.toggles.bloomEnabled.checked = prefs.bloomEnabled;
    }
    if (this.toggles.ssaoEnabled !== null) {
      this.toggles.ssaoEnabled.checked = prefs.ssaoEnabled;
    }
    if (this.toggles.filmGrainEnabled !== null) {
      this.toggles.filmGrainEnabled.checked = prefs.filmGrainEnabled;
    }
    if (this.dropdowns.colorblindMode !== null) {
      this.dropdowns.colorblindMode.value = prefs.colorblindMode;
    }
    if (this.sliders.uiScale !== null) {
      this.sliders.uiScale.value = String(prefs.uiScale);
    }
  }
}
