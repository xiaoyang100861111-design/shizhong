<#
  把 build_server.py 生成的部署包发布到 IIS（Windows PowerShell 5.1，需要管理员权限 / 以 SYSTEM 运行的 Runner）。

    deploy_iis.ps1 -Package D:\tmp\shizhong-server-xxx [-SitePath D:\sites\shizhong] [-AppPool shizhong] [-HealthUrl http://...]

  步骤：检查 → 备份当前版本到 <SitePath>.previous → 停止应用程序池 → 覆盖文件（保留 appsettings.Production.json 和 logs\）
        → 启动应用程序池 → 等 /api/health 返回 ok；健康检查失败时自动恢复备份并报错。
  数据库迁移在程序启动时自动执行，回滚不会撤销已执行的迁移。
  网站、应用程序池、appsettings.Production.json 需要先按 部署说明.md 手动建好（只做一次）。
#>
param(
  [Parameter(Mandatory = $true)] [string]$Package,
  [string]$SitePath = $(if ($env:DEPLOY_SITE_PATH) { $env:DEPLOY_SITE_PATH } else { 'D:\sites\shizhong' }),
  [string]$AppPool = $(if ($env:DEPLOY_APP_POOL) { $env:DEPLOY_APP_POOL } else { 'shizhong' }),
  [string]$HealthUrl = $env:DEPLOY_HEALTH_URL,
  [int]$HealthTimeoutSec = 180
)

$ErrorActionPreference = 'Stop'
Import-Module WebAdministration

function Log([string]$msg) { Write-Host ("[deploy {0:HH:mm:ss}] {1}" -f (Get-Date), $msg) }

# robocopy：退出码 0-7 表示成功，8 及以上表示出错
function Copy-Tree([string]$from, [string]$to, [string[]]$extra = @()) {
  $rcArgs = @($from, $to, '/E', '/R:5', '/W:3', '/NFL', '/NDL', '/NJH', '/NJS', '/NP') + $extra
  & robocopy @rcArgs | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy $from -> $to 失败（退出码 $LASTEXITCODE）" }
  $global:LASTEXITCODE = 0
}

function Set-PoolState([string]$state) {
  $current = (Get-WebAppPoolState -Name $AppPool).Value
  if ($current -eq $state) { return }
  if ($state -eq 'Stopped') { Stop-WebAppPool -Name $AppPool } else { Start-WebAppPool -Name $AppPool }
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    if ((Get-WebAppPoolState -Name $AppPool).Value -eq $state) { return }
  }
  throw "应用程序池 $AppPool 60 秒内没有进入 $state 状态"
}

# 未指定 HealthUrl 时，按网站的 http 绑定直接请求本机（带上绑定的主机名）
function Get-HealthTarget {
  if ($HealthUrl) { return @{ Url = $HealthUrl; Host = $null } }
  $full = [IO.Path]::GetFullPath($SitePath).TrimEnd('\')
  $site = Get-Website | Where-Object {
    [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($_.physicalPath)).TrimEnd('\') -ieq $full
  } | Select-Object -First 1
  if (-not $site) { return $null }
  $binding = $site.bindings.Collection | Where-Object { $_.protocol -eq 'http' } | Select-Object -First 1
  if (-not $binding) { return $null }
  $parts = $binding.bindingInformation.Split(':')   # ip:port:host
  return @{ Url = "http://127.0.0.1:$($parts[1])/api/health"; Host = $parts[2] }
}

function Test-Health($target) {
  try {
    $req = [Net.HttpWebRequest]::Create($target.Url)
    if ($target.Host) { $req.Host = $target.Host }
    $req.Timeout = 15000
    $resp = $req.GetResponse()
    $body = (New-Object IO.StreamReader($resp.GetResponseStream())).ReadToEnd()
    $resp.Close()
    return $body -match '"ok"\s*:\s*true'
  } catch {
    return $false
  }
}

function Wait-Healthy($target) {
  if (-not $target) { Log '找不到网站的 http 绑定，跳过健康检查（可设置 DEPLOY_HEALTH_URL）'; return $true }
  Log "健康检查 $($target.Url) $(if ($target.Host) { "(Host: $($target.Host))" })"
  $deadline = (Get-Date).AddSeconds($HealthTimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (Test-Health $target) { return $true }
    Start-Sleep -Seconds 5
  }
  return $false
}

# ---- 0. 检查 ----
$Package = [IO.Path]::GetFullPath($Package)
$SitePath = [IO.Path]::GetFullPath($SitePath).TrimEnd('\')
if (-not (Test-Path (Join-Path $Package 'Shizhong.Api.dll'))) { throw "部署包不完整：$Package 里没有 Shizhong.Api.dll" }
if (-not (Test-Path "IIS:\AppPools\$AppPool")) { throw "IIS 应用程序池 '$AppPool' 不存在：请先按 部署说明.md 第 4 节创建网站和应用程序池" }
$settings = Join-Path $SitePath 'appsettings.Production.json'
if (-not (Test-Path $settings)) {
  throw "$settings 不存在：请先按 部署说明.md 第 4 节创建它（填好数据库连接字符串）。可以复制部署包里的模板：$Package\appsettings.Production.json"
}
if ((Get-Content $settings -Raw) -match 'CHANGE_ME') { throw "$settings 里的数据库密码还是 CHANGE_ME，请先改好" }

$target = Get-HealthTarget
$backup = "$SitePath.previous"
$version = (Get-Item (Join-Path $Package 'Shizhong.Api.dll')).LastWriteTime
Log "部署包 $Package → $SitePath（应用程序池 $AppPool）"

# ---- 1. 备份当前版本 ----
if (Test-Path (Join-Path $SitePath 'Shizhong.Api.dll')) {
  Log "备份当前版本 → $backup"
  if (Test-Path $backup) { Remove-Item -Recurse -Force $backup }
  Copy-Tree $SitePath $backup @('/XD', (Join-Path $SitePath 'logs'))
} else {
  $backup = $null
  Log '首次部署，没有旧版本可备份'
}

# ---- 2. 停止 → 覆盖 → 启动 ----
Log '停止应用程序池'
Set-PoolState 'Stopped'
Start-Sleep -Seconds 2   # 等 w3wp 释放文件
try {
  Log '复制新文件（保留 appsettings.Production.json 和 logs\）'
  Copy-Tree $Package $SitePath @('/XF', 'appsettings.Production.json', '/XD', (Join-Path $Package 'logs'))
  New-Item -ItemType Directory -Force (Join-Path $SitePath 'logs') | Out-Null
} finally {
  Log '启动应用程序池'
  Set-PoolState 'Started'
}

# ---- 3. 健康检查，失败则回滚 ----
if (Wait-Healthy $target) {
  Log "部署成功（程序文件时间 $version）"
  exit 0
}

Write-Host '::error::新版本健康检查失败'
if ($backup) {
  Log "回滚到 $backup"
  Set-PoolState 'Stopped'
  Start-Sleep -Seconds 2
  Copy-Tree $backup $SitePath @('/XF', 'appsettings.Production.json')
  Set-PoolState 'Started'
  if (Wait-Healthy $target) { Log '已回滚到上一个版本，网站恢复正常' } else { Log '回滚后健康检查仍然失败，请登录服务器检查（web.config 里打开 stdoutLogEnabled 看 logs\）' }
} else {
  Log '首次部署失败，没有可回滚的版本。请检查数据库连接字符串，或在 web.config 里打开 stdoutLogEnabled 看 logs\'
}
exit 1
