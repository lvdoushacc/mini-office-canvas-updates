$ErrorActionPreference = 'SilentlyContinue'
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$projectRootLower = $projectRoot.ToLowerInvariant()
$serverPathLower = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'server.py')).ToLowerInvariant()
$serverExeLower = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'server.exe')).ToLowerInvariant()
$launcherPathLower = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'launcher.pyw')).ToLowerInvariant()
$mainExeLower = [System.IO.Path]::GetFullPath((Join-Path $projectRoot '小小办公.exe')).ToLowerInvariant()
$bundledElectronLower = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'desktop-shell\electron\electron.exe')).ToLowerInvariant()
$desktopShellLower = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'desktop-shell')).ToLowerInvariant()

$stoppedCount = 0

# 1. 终止属于当前项目的桌面窗口 (Electron) 与启动器
Get-CimInstance Win32_Process |
    Where-Object {
        $_.ProcessId -ne $PID -and
        (
            ($_.ExecutablePath -and $_.ExecutablePath.ToLowerInvariant() -eq $mainExeLower) -or
            ($_.ExecutablePath -and $_.ExecutablePath.ToLowerInvariant() -eq $bundledElectronLower) -or
            ($_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($desktopShellLower) -and $_.Name -match '^electron') -or
            ($_.CommandLine -and (
                $_.CommandLine.ToLowerInvariant().Contains($launcherPathLower) -or
                ($_.CommandLine.ToLowerInvariant().Contains('launcher.pyw') -and (
                    ($_.ExecutablePath -and $_.ExecutablePath.ToLowerInvariant().StartsWith($projectRootLower)) -or
                    $_.CommandLine.ToLowerInvariant().Contains($projectRootLower)
                ))
            ))
        )
    } |
    ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        $stoppedCount++
    }

# 2. 终止属于当前项目的后端服务进程 (二进制 server.exe 或 Python 脚本)
Get-CimInstance Win32_Process |
    Where-Object {
        $_.ProcessId -ne $PID -and
        (
            ($_.ExecutablePath -and $_.ExecutablePath.ToLowerInvariant() -eq $serverExeLower) -or
            ($_.CommandLine -and (
                $_.CommandLine.ToLowerInvariant().Contains($serverPathLower) -or
                (
                    $_.CommandLine.ToLowerInvariant().Contains('server.py') -and
                    (
                        ($_.ExecutablePath -and $_.ExecutablePath.ToLowerInvariant().StartsWith($projectRootLower)) -or
                        $_.CommandLine.ToLowerInvariant().Contains($projectRootLower)
                    )
                )
            ))
        )
    } |
    ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        $stoppedCount++
    }

if ($stoppedCount -gt 0) {
    Write-Output "小小办公服务与桌面窗口已安全退出 (共终止 $stoppedCount 个进程) "
} else {
    Write-Output "未发现当前项目正在运行的服务或窗口 "
}
