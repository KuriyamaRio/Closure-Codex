param(
    [switch] $Uninstall,
    [ValidateSet('Dark', 'Light')] [string] $CopyTheme,
    [string] $StartupFolder = [Environment]::GetFolderPath('Startup'),
    [switch] $SkipStart
)

$ErrorActionPreference = 'Stop'
if ($CopyTheme) {
    $theme = Join-Path $PSScriptRoot ('outputs/closure-theme/closure-' + $CopyTheme.ToLowerInvariant() + '.txt')
    Set-Clipboard -Value ([IO.File]::ReadAllText($theme).Trim())
    return
}

$autostart = Join-Path $PSScriptRoot 'outputs/closure-autostart'
$config = Join-Path $autostart 'Configure.ps1'
$watcher = Join-Path $autostart 'Watch-Codex.ps1'
$shortcutPath = Join-Path $StartupFolder 'Closure Codex Lifecycle.lnk'
$shell = New-Object -ComObject WScript.Shell
$previous = if (Test-Path -LiteralPath $shortcutPath -PathType Leaf) { $shell.CreateShortcut($shortcutPath) }
$registration = @{ StartupFolder = $StartupFolder; SkipStart = $SkipStart }

if ($Uninstall) {
    if ($previous -and $previous.Arguments -like ('*"' + [WildcardPattern]::Escape($watcher) + '"*')) {
        & $config @registration -Disable
    }
    return
}

if (!(Get-AppxPackage -Name OpenAI.Codex)) {
    throw 'Install the Microsoft Store version of Codex for Windows first.'
}
if ([Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITECTURE') -ne 'AMD64' -and
    [Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITEW6432') -ne 'AMD64') {
    throw 'This release requires Windows x64.'
}

$preserveNoActivity = [bool]($previous.Arguments -match ' -NoActivity(?:\s|$)')
if ($previous -and !$SkipStart) {
    & $watcher -Stop
    $lifecycle = [Threading.Mutex]::new($false, 'Local\ClosureCodexLifecycle.v1')
    try {
        try { $released = $lifecycle.WaitOne(7000) }
        catch [Threading.AbandonedMutexException] { $released = $true }
        if (!$released) { throw 'The previous Closure Codex watcher is still exiting. Run Install.cmd again.' }
        $lifecycle.ReleaseMutex()
    } finally {
        $lifecycle.Dispose()
    }
}
try {
    & $config @registration -NoActivity:$preserveNoActivity
} catch {
    if ($previous -and !$SkipStart) {
        Start-Process -FilePath $previous.TargetPath -ArgumentList $previous.Arguments -WorkingDirectory $previous.WorkingDirectory -WindowStyle Hidden
    }
    throw
}
Write-Output 'Closure Codex is registered for this Windows user.'
