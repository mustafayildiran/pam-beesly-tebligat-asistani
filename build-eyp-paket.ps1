# Build: standalone EYP package from single source (ASCII-only, encoding-safe)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$tpl = Join-Path $root 'build\eyp-paket'
$out = Join-Path $root 'dist\eyp-goruntuleyici'
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item $out -ItemType Directory | Out-Null
$files = @('eyp-background.js','eyp-inject.js','eyp-jszip.min.js','eyp-parser.js','eyp-content.js','eyp-viewer.css','eyp-viewer.html','eyp-viewer.js')
foreach ($f in $files) { Copy-Item (Join-Path $root $f) $out }
Copy-Item (Join-Path $tpl 'manifest.json') $out
Copy-Item (Join-Path $tpl 'popup.html') $out
$ver = (Get-Content (Join-Path $out 'manifest.json') -Raw | ConvertFrom-Json).version
$zip = Join-Path $root ("dist\eyp-goruntuleyici-v" + $ver + ".zip")
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $out '*') -DestinationPath $zip
Write-Output ("built: " + $zip)
Get-ChildItem $out | Select-Object Name, Length
