param(
    [ValidateSet('Fastest', 'Optimal', 'NoCompression')]
    [string]$Compression = 'Fastest',
    [switch]$Force
)

$root = Split-Path -Parent $PSScriptRoot

# 1. Read version from VERSION.json
$version = '1.0.0'
$versionJsonPath = Join-Path $root 'VERSION.json'
if (Test-Path $versionJsonPath) {
    try {
        $vData = Get-Content -Raw -Path $versionJsonPath -Encoding UTF8 | ConvertFrom-Json
        if ($vData.version) { $version = $vData.version.Trim() }
    } catch {}
}

$stage = Join-Path (Split-Path $root -Parent) "XXPD_v${version}_release_staging"
$zip = Join-Path $root "小小办公_v${version}_完整版发布包.zip"

# 确保 小小办公.exe 已编译
$rootExe = Join-Path $root "小小办公.exe"
if (-not (Test-Path $rootExe)) {
    Write-Output "[构建] 正在生成主程序 小小办公.exe..."
    $py = "python"
    $pyCandidates = @(
        (Join-Path $root "python\python.exe"),
        "C:\Users\绿豆鲨\AppData\Local\Programs\Python\Python311\python.exe"
    )
    foreach ($c in $pyCandidates) {
        if (Test-Path $c) { $py = $c; break }
    }
    & $py (Join-Path $root "scripts\build_exe.py")
}

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
if (Test-Path $zip) { Remove-Item $zip -Force }
New-Item -ItemType Directory $stage | Out-Null

# 2. Exclude top-level dev/cache/user data directories
$skip = @('__pycache__','.git','.idea','.vscode','.pytest_cache','scratch','video_frames','video_frames_latest','data','output','assets','workflows')
Get-ChildItem $root -Force | Where-Object { $skip -notcontains $_.Name } | ForEach-Object { Copy-Item $_.FullName $stage -Recurse -Force }

# 3. Create fresh clean user directory structure
@('data','data/canvases','assets','assets/input','assets/library','assets/output','assets/uploads','output','workflows','runtime_core/data') | ForEach-Object { New-Item -ItemType Directory (Join-Path $stage $_) -Force | Out-Null }

# 4. Remove unneeded desktop-shell node_modules (Electron binary is pre-bundled in desktop-shell/electron)
$stageNodeModules = Join-Path $stage 'desktop-shell/node_modules'
if (Test-Path $stageNodeModules) {
    Remove-Item $stageNodeModules -Recurse -Force
}

# 5. Clean up junk, backup files, and ad-hoc test pages
Get-ChildItem $stage -Recurse -File -Force | Where-Object {
    $_.Name -in @('temp_test.js','launcher_error.log','.env') -or
    $_.Extension -in @('.log','.pyc','.pyo','.tmp','.temp') -or
    $_.Name -like '*.bak*' -or
    $_.Name -like 'test-*.html'
} | Remove-Item -Force

# 6. Clean up runtime_core redundant directories
# 安全断言：runtime_core/data 在正常运行下只应是导入期 os.makedirs 留下的空壳。
# 若其中出现非空 JSON，说明有模块的路径常量在 import 期绑定了旧目录、且未被 server.py 重绑，
# 下面的 Remove-Item 会静默销毁这些用户数据（提示词库曾因此丢档）。故在此中止，要求人工确认。
$rcData = Join-Path $stage 'runtime_core/data'
if ((Test-Path $rcData) -and (-not $Force)) {
    $stray = @(Get-ChildItem $rcData -Recurse -File -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -eq '.json' -and $_.Length -gt 2 })
    if ($stray.Count -gt 0) {
        Write-Output "[中止] runtime_core/data 下检测到 $($stray.Count) 个非空 JSON，可能是路径常量漏绑导致的用户数据："
        $stray | ForEach-Object { Write-Output ("    " + $_.FullName.Substring($stage.Length + 1) + "  (" + $_.Length + " bytes)") }
        Write-Output "请先确认这些数据已迁移到根 data/ 并修复漏绑的常量；确认无价值后可加 -Force 强制打包。"
        if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
        exit 1
    }
}
@('runtime_core/data','runtime_core/assets','runtime_core/output','runtime_core/workflows','runtime_core/lan') | ForEach-Object {
    $p = Join-Path $stage $_
    if (Test-Path $p) { Remove-Item $p -Recurse -Force }
}
New-Item -ItemType Directory (Join-Path $stage 'runtime_core/data') -Force | Out-Null

# 7. Compress release package
Write-Output "[打包] 正在压缩发布包 (压缩等级: $Compression)..."
Compress-Archive (Join-Path $stage '*') $zip -CompressionLevel $Compression -Force
Write-Output "$zip`n$((Get-Item $zip).Length) bytes"
