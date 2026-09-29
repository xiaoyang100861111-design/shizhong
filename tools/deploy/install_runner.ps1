<#
  在 Windows 服务器上安装 GitHub Actions Runner（一次性），之后 main 分支的新代码会自动部署到本机 IIS。
  以管理员身份打开 PowerShell 执行：

    powershell -ExecutionPolicy Bypass -File install_runner.ps1 -Token <令牌>

  令牌在 GitHub 仓库 Settings › Actions › Runners › New self-hosted runner（选 Windows）页面里，
  "./config.cmd --url ... --token XXXX" 那一行的 XXXX，一小时内有效。

  Runner 装成 Windows 服务，以 SYSTEM 身份运行（需要停/启 IIS 应用程序池、写网站目录），开机自动启动。
  它只向 github.com 发出 HTTPS 连接，不需要开放任何入站端口。
#>
param(
  [Parameter(Mandatory = $true)] [string]$Token,
  [string]$Repo = 'xiaoyang100861111-design/shizhong',
  [string]$Dir = 'C:\actions-runner',
  [string]$Name = $env:COMPUTERNAME
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw '请右键"以管理员身份运行" PowerShell 后再执行' }
if (-not (Get-Module -ListAvailable WebAdministration)) { throw '没有找到 IIS 管理模块：请先按 部署说明.md 第 1 节安装 IIS' }

$release = Invoke-RestMethod -UseBasicParsing 'https://api.github.com/repos/actions/runner/releases/latest'
$version = $release.tag_name.TrimStart('v')
$zip = Join-Path $env:TEMP "actions-runner-win-x64-$version.zip"
Write-Host "下载 GitHub Actions Runner $version ..."
Invoke-WebRequest -UseBasicParsing "https://github.com/actions/runner/releases/download/v$version/actions-runner-win-x64-$version.zip" -OutFile $zip

New-Item -ItemType Directory -Force $Dir | Out-Null
Expand-Archive -Path $zip -DestinationPath $Dir -Force
Remove-Item $zip

Push-Location $Dir
try {
  & .\config.cmd --unattended --url "https://github.com/$Repo" --token $Token --name $Name --labels shizhong `
    --runasservice --windowslogonaccount 'NT AUTHORITY\SYSTEM' --replace
  if ($LASTEXITCODE -ne 0) { throw "config.cmd 失败（退出码 $LASTEXITCODE）" }
} finally {
  Pop-Location
}

Write-Host ''
Write-Host '完成。GitHub 仓库 Settings › Actions › Runners 里应该能看到这台服务器（Idle）。'
Write-Host '最后一步：Settings › Secrets and variables › Actions › Variables 添加 DEPLOY_ENABLED = true'
