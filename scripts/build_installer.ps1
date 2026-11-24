param(
    [switch]$OpenAfterBuild
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$iss = Join-Path $root 'installer\小小办公.iss'
$releaseScript = Join-Path $PSScriptRoot 'make_release.ps1'
$iscc = Get-Command iscc.exe -ErrorAction SilentlyContinue
if (-not $iscc) {
    $candidates = @(
        'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
        'C:\Program Files\Inno Setup 6\ISCC.exe',
        'C:\Program Files\Inno Setup 7\ISCC.exe',
        'C:\Program Files (x86)\Inno Setup 7\ISCC.exe',
        'D:\Inno Setup 6\ISCC.exe',
        'D:\Inno Setup 7\ISCC.exe'
    )
    $found = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($found) { $iscc = Get-Command $found }
}
if (-not $iscc) {
    throw '未找到 Inno Setup 编译器，请先安装 Inno Setup。'
}

# 先生成不含个人数据的干净发布目录，避免把开发机数据打进安装包。
& $releaseScript -Force
$stage = Join-Path (Split-Path $root -Parent) 'XXPD_v1.0.0_release_staging'
if (-not (Test-Path $stage)) {
    throw "未找到干净发布目录：$stage"
}

& $iscc.Source "/DAppSource=$stage" $iss
if ($LASTEXITCODE -ne 0) {
    throw "Inno Setup 编译失败，退出码：$LASTEXITCODE"
}

$output = Join-Path $root 'release\小小办公-安装程序-v1.0.0.exe'
Write-Host "安装程序已生成：$output"
if ($OpenAfterBuild -and (Test-Path $output)) {
    Start-Process explorer.exe "/select,`"$output`""
}
