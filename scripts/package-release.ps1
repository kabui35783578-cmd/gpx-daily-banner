$ErrorActionPreference = "Stop"

$pluginRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $pluginRoot "manifest.json"
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$version = [string]$manifest.version
if ([string]::IsNullOrWhiteSpace($version)) {
  throw "manifest.json does not contain a version."
}

$releaseDirectory = Join-Path $pluginRoot "releases"
$archivePath = Join-Path $releaseDirectory ("gpx-daily-banner-{0}.zip" -f $version)
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("gpx-daily-banner-" + [guid]::NewGuid().ToString("N"))
$stagingDirectory = Join-Path $tempRoot "gpx-daily-banner"
$files = @("main.js", "manifest.json", "styles.css", "versions.json", "README.md", "LICENSE", "CHANGELOG.md")

try {
  New-Item -ItemType Directory -Path $releaseDirectory -Force | Out-Null
  New-Item -ItemType Directory -Path $stagingDirectory -Force | Out-Null

  foreach ($file in $files) {
    $source = Join-Path $pluginRoot $file
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
      throw "Release file is missing: $file"
    }
    Copy-Item -LiteralPath $source -Destination (Join-Path $stagingDirectory $file)
  }

  if (Test-Path -LiteralPath $archivePath -PathType Leaf) {
    Remove-Item -LiteralPath $archivePath -Force
  }
  Compress-Archive -Path (Join-Path $stagingDirectory "*") -DestinationPath $archivePath -CompressionLevel Optimal
  Write-Output "Created $archivePath"
} finally {
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
