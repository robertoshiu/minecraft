#!/usr/bin/env bash
# verify-cc0.sh — G1 gate: confirm no proprietary asset references exist in the build output.
#
# Usage:
#   bash scripts/verify-cc0.sh [--dist-dir <path>]
#
# Exit codes:
#   0  PASS — no issues found
#   1  FAIL — one or more checks failed
#
# Checks performed:
#   1. dist/ folder exists (build must be run first)
#   2. No references to "mojang" or "minecraft" (case-insensitive) in dist/
#   3. No unreferenced .png/.jpg image files in public/ that lack an ATTRIBUTION.md entry
#   4. docs/ATTRIBUTION.md exists and is non-empty
#
# Note: The project currently uses only procedural textures (no external image files).
# This script is forward-compatible — it will catch issues when real textures are added.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${REPO_ROOT}/dist"
ATTRIBUTION_FILE="${REPO_ROOT}/docs/ATTRIBUTION.md"
PUBLIC_TEXTURES_DIR="${REPO_ROOT}/public/textures"

PASS=0
FAIL=1
exit_code=${PASS}

red()    { printf '\033[0;31m%s\033[0m\n' "$*"; }
green()  { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$*"; }
bold()   { printf '\033[1m%s\033[0m\n' "$*"; }

bold "=========================================="
bold " CC0 Asset Verification — G1 Gate"
bold "=========================================="
echo ""

# ---------------------------------------------------------------------------
# Check 1: dist/ exists
# ---------------------------------------------------------------------------
echo "[1/4] Checking dist/ directory..."
if [[ ! -d "${DIST_DIR}" ]]; then
  red "  FAIL: dist/ not found. Run 'corepack pnpm run build' first."
  exit_code=${FAIL}
else
  green "  PASS: dist/ exists."
fi
echo ""

# ---------------------------------------------------------------------------
# Check 2: No Mojang / Minecraft references in dist/
# ---------------------------------------------------------------------------
echo "[2/4] Scanning dist/ for proprietary asset references..."
if [[ ! -d "${DIST_DIR}" ]]; then
  yellow "  SKIP: dist/ not found (skipping scan)."
else
  # Search for mojang|minecraft (case-insensitive) in JS/CSS bundles only.
  # HTML files are excluded because the page <title> legitimately contains
  # "Minecraft Clone" (the project name) — that is not an asset IP issue.
  # Source map files (.map) are also excluded to avoid false positives from
  # bundled third-party code that mentions the word in comments.
  MATCHES=$(grep -ril --include="*.js" --include="*.css" \
    "mojang\|minecraft" "${DIST_DIR}" 2>/dev/null || true)

  if [[ -n "${MATCHES}" ]]; then
    red "  FAIL: Proprietary references found in dist/:"
    while IFS= read -r line; do
      red "    ${line}"
    done <<< "${MATCHES}"
    red "  Review each file above. If the reference is in a comment inside"
    red "  a legitimate open-source library, add a per-file exclusion here."
    exit_code=${FAIL}
  else
    green "  PASS: No 'mojang' or 'minecraft' references found in dist/."
  fi
fi
echo ""

# ---------------------------------------------------------------------------
# Check 3: All image files in public/textures/ have an ATTRIBUTION.md entry
# ---------------------------------------------------------------------------
echo "[3/4] Checking image files in public/textures/ against ATTRIBUTION.md..."
if [[ ! -d "${PUBLIC_TEXTURES_DIR}" ]]; then
  green "  PASS: public/textures/ does not exist yet (no external textures added)."
else
  UNATTRIBUTED=()
  while IFS= read -r -d '' img; do
    # Get the base filename without path for the lookup.
    basename_img="$(basename "${img}")"
    # Check if this filename appears anywhere in ATTRIBUTION.md.
    if [[ ! -f "${ATTRIBUTION_FILE}" ]] || ! grep -qF "${basename_img}" "${ATTRIBUTION_FILE}"; then
      UNATTRIBUTED+=("${img}")
    fi
  done < <(find "${PUBLIC_TEXTURES_DIR}" -type f \( -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" \) -print0 2>/dev/null)

  if [[ ${#UNATTRIBUTED[@]} -gt 0 ]]; then
    red "  FAIL: The following image files have no entry in docs/ATTRIBUTION.md:"
    for img in "${UNATTRIBUTED[@]}"; do
      red "    ${img}"
    done
    red "  Add a row to docs/ATTRIBUTION.md for each file listed above."
    exit_code=${FAIL}
  else
    green "  PASS: All image files in public/textures/ are attributed."
  fi
fi
echo ""

# ---------------------------------------------------------------------------
# Check 4: docs/ATTRIBUTION.md exists and is non-empty
# ---------------------------------------------------------------------------
echo "[4/4] Checking docs/ATTRIBUTION.md..."
if [[ ! -f "${ATTRIBUTION_FILE}" ]]; then
  red "  FAIL: docs/ATTRIBUTION.md is missing."
  exit_code=${FAIL}
elif [[ ! -s "${ATTRIBUTION_FILE}" ]]; then
  red "  FAIL: docs/ATTRIBUTION.md is empty."
  exit_code=${FAIL}
else
  # Count data rows in the attribution table (lines starting with | that are not the header/separator).
  row_count=$(grep -cE '^\| ' "${ATTRIBUTION_FILE}" 2>/dev/null || true)
  if [[ "${row_count}" -lt 2 ]]; then
    yellow "  WARN: docs/ATTRIBUTION.md appears to have no asset rows (only ${row_count} table line(s))."
  else
    green "  PASS: docs/ATTRIBUTION.md exists with ${row_count} table line(s)."
  fi
fi
echo ""

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
bold "=========================================="
if [[ ${exit_code} -eq ${PASS} ]]; then
  green " RESULT: PASS — G1 gate satisfied."
else
  red " RESULT: FAIL — fix the issues above before merging."
fi
bold "=========================================="
echo ""

exit ${exit_code}
