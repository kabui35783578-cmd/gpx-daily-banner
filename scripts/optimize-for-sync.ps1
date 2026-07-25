param(
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$pluginRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))

if (-not $SkipBuild) {
    Push-Location $pluginRoot
    try {
        pnpm run build
        if ($LASTEXITCODE -ne 0) {
            throw "Plugin build failed."
        }
    }
    finally {
        Pop-Location
    }
}

Get-ChildItem -LiteralPath $pluginRoot -File -Filter "*.png" |
    Remove-Item -Force

$nodeModules = Join-Path $pluginRoot "node_modules"
if (Test-Path -LiteralPath $nodeModules) {
    $resolvedNodeModules = [System.IO.Path]::GetFullPath(
        (Resolve-Path -LiteralPath $nodeModules).Path
    )
    $expectedNodeModules = [System.IO.Path]::GetFullPath(
        (Join-Path $pluginRoot "node_modules")
    )

    if ($resolvedNodeModules -ne $expectedNodeModules) {
        throw "Refusing to remove unexpected path: $resolvedNodeModules"
    }

    Remove-Item -LiteralPath $resolvedNodeModules -Recurse -Force
}

$files = Get-ChildItem -LiteralPath $pluginRoot -Recurse -Force -File
$sizeBytes = ($files | Measure-Object -Property Length -Sum).Sum
$sizeMb = [math]::Round($sizeBytes / 1MB, 2)

Write-Output "GPX Daily Banner optimized for sync: $sizeMb MB"
Write-Output "Runtime files remain in: $pluginRoot"
Write-Output "Run 'pnpm install' before the next source build."
