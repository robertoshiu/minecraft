# verify-cc0.ps1 — G1 gate: confirm no proprietary asset references exist in the build output.
# Windows PowerShell equivalent of scripts/verify-cc0.sh
#
# Usage:
#   pwsh scripts/verify-cc0.ps1
#   # or from PowerShell 5.1:
#   powershell -ExecutionPolicy Bypass -File scripts\verify-cc0.ps1
#
# Exit codes:
#   0  PASS — no issues found
#   1  FAIL — one or more checks failed

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$distDir = Join-Path $repoRoot 'dist'
$attributionFile = Join-Path $repoRoot 'docs\ATTRIBUTION.md'
$publicTexturesDir = Join-Path $repoRoot 'public\textures'

$exitCode = 0

function Write-Pass  { param($msg) Write-Host "  PASS: $msg" -ForegroundColor Green }
function Write-Fail  { param($msg) Write-Host "  FAIL: $msg" -ForegroundColor Red; $script:exitCode = 1 }
function Write-Warn  { param($msg) Write-Host "  WARN: $msg" -ForegroundColor Yellow }
function Write-Skip  { param($msg) Write-Host "  SKIP: $msg" -ForegroundColor DarkGray }
function Write-Bold  { param($msg) Write-Host $msg -ForegroundColor White }

Write-Bold "=========================================="
Write-Bold " CC0 Asset Verification -- G1 Gate"
Write-Bold "=========================================="
Write-Host ""

# ---------------------------------------------------------------------------
# Check 1: dist/ exists
# ---------------------------------------------------------------------------
Write-Host "[1/4] Checking dist/ directory..."
if (-not (Test-Path $distDir -PathType Container)) {
    Write-Fail "dist/ not found. Run 'corepack pnpm run build' first."
} else {
    Write-Pass "dist/ exists."
}
Write-Host ""

# ---------------------------------------------------------------------------
# Check 2: No Mojang / Minecraft references in dist/
# ---------------------------------------------------------------------------
Write-Host "[2/4] Scanning dist/ for proprietary asset references..."
if (-not (Test-Path $distDir -PathType Container)) {
    Write-Skip "dist/ not found (skipping scan)."
} else {
    $matchFiles = @()
    # HTML files are excluded: the page <title> legitimately contains "Minecraft Clone"
    # (the project name). Only JS/CSS bundles can embed asset data illegitimately.
    $searchExts = '*.js', '*.css'
    foreach ($ext in $searchExts) {
        $files = Get-ChildItem -Recurse -Path $distDir -Filter $ext -File -ErrorAction SilentlyContinue
        foreach ($f in $files) {
            $content = Get-Content $f.FullName -Raw -ErrorAction SilentlyContinue
            if ($content -match '(?i)mojang|minecraft') {
                $matchFiles += $f.FullName
            }
        }
    }
    if ($matchFiles.Count -gt 0) {
        Write-Fail "Proprietary references found in dist/:"
        foreach ($m in $matchFiles) {
            Write-Host "    $m" -ForegroundColor Red
        }
        Write-Host "  Review each file. If the reference is in a comment inside a legitimate" -ForegroundColor Red
        Write-Host "  open-source library, add a per-file exclusion here." -ForegroundColor Red
    } else {
        Write-Pass "No 'mojang' or 'minecraft' references found in dist/."
    }
}
Write-Host ""

# ---------------------------------------------------------------------------
# Check 3: All image files in public/textures/ have an ATTRIBUTION.md entry
# ---------------------------------------------------------------------------
Write-Host "[3/4] Checking image files in public/textures/ against ATTRIBUTION.md..."
if (-not (Test-Path $publicTexturesDir -PathType Container)) {
    Write-Pass "public/textures/ does not exist yet (no external textures added)."
} else {
    $imageExts = @('.png', '.jpg', '.jpeg')
    $images = Get-ChildItem -Recurse -Path $publicTexturesDir -File -ErrorAction SilentlyContinue |
              Where-Object { $imageExts -contains $_.Extension.ToLower() }
    $unattributed = @()
    foreach ($img in $images) {
        $name = $img.Name
        if (-not (Test-Path $attributionFile)) {
            $unattributed += $img.FullName
        } else {
            $found = Select-String -Path $attributionFile -Pattern ([regex]::Escape($name)) -Quiet
            if (-not $found) {
                $unattributed += $img.FullName
            }
        }
    }
    if ($unattributed.Count -gt 0) {
        Write-Fail "The following image files have no entry in docs/ATTRIBUTION.md:"
        foreach ($u in $unattributed) {
            Write-Host "    $u" -ForegroundColor Red
        }
        Write-Host "  Add a row to docs/ATTRIBUTION.md for each file listed above." -ForegroundColor Red
    } else {
        Write-Pass "All image files in public/textures/ are attributed."
    }
}
Write-Host ""

# ---------------------------------------------------------------------------
# Check 4: docs/ATTRIBUTION.md exists and is non-empty
# ---------------------------------------------------------------------------
Write-Host "[4/4] Checking docs/ATTRIBUTION.md..."
if (-not (Test-Path $attributionFile)) {
    Write-Fail "docs/ATTRIBUTION.md is missing."
} else {
    $content = Get-Content $attributionFile -Raw
    if ([string]::IsNullOrWhiteSpace($content)) {
        Write-Fail "docs/ATTRIBUTION.md is empty."
    } else {
        $rowCount = (Select-String -Path $attributionFile -Pattern '^\|').Count
        if ($rowCount -lt 2) {
            Write-Warn "docs/ATTRIBUTION.md appears to have no asset rows (only $rowCount table line(s))."
        } else {
            Write-Pass "docs/ATTRIBUTION.md exists with $rowCount table line(s)."
        }
    }
}
Write-Host ""

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Bold "=========================================="
if ($exitCode -eq 0) {
    Write-Host " RESULT: PASS -- G1 gate satisfied." -ForegroundColor Green
} else {
    Write-Host " RESULT: FAIL -- fix the issues above before merging." -ForegroundColor Red
}
Write-Bold "=========================================="
Write-Host ""

exit $exitCode
