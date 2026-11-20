param([switch] $Stop, [switch] $Probe, [switch] $NoActivity)

$ErrorActionPreference = 'Stop'
$mutexName = 'Local\ClosureCodexLifecycle.v1'
$stopName = 'Local\ClosureCodexLifecycle.Stop.v1'
if ($Stop) {
    try { $signal = [Threading.EventWaitHandle]::OpenExisting($stopName) }
    catch [Threading.WaitHandleCannotBeOpenedException] { return }
    try { [void]$signal.Set() } finally { $signal.Dispose() }
    return
}

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class ClosureLifecycleWindows {
    private delegate bool VisitWindow(IntPtr window, IntPtr ignored);
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] private static extern bool EnumWindows(VisitWindow visit, IntPtr ignored);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out int pid);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint relation);
    [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect bounds);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder result, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder result, int count);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr window, uint message, IntPtr first, IntPtr second);
    [DllImport("user32.dll")] private static extern bool PostThreadMessage(uint thread, uint message, IntPtr first, IntPtr second);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr CommandLineToArgvW(string line, out int count);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);

    public static int[] OpenWindowProcesses() {
        var processes = new HashSet<int>();
        EnumWindows((window, unused) => {
            if (!IsWindowVisible(window) || GetWindow(window, 4) != IntPtr.Zero || (GetWindowLong(window, -20) & 0x80) != 0) return true;
            var kind = new StringBuilder(48);
            GetClassName(window, kind, kind.Capacity);
            if (kind.ToString() != "Chrome_WidgetWin_1") return true;
            Rect bounds;
            if (!IsIconic(window) && (!GetWindowRect(window, out bounds) || bounds.Right == bounds.Left || bounds.Bottom == bounds.Top)) return true;
            int pid;
            GetWindowThreadProcessId(window, out pid);
            if (pid != 0) processes.Add(pid);
            return true;
        }, IntPtr.Zero);
        var ids = new int[processes.Count];
        processes.CopyTo(ids);
        return ids;
    }

    public static bool CloseHelper(int processId, bool crt) {
        bool sent = false;
        string expected = crt ? "Closure CRT Overlay" : "\u53ef\u9732\u5e0c\u5c14 \u00b7 Codex \u684c\u5ba0";
        EnumWindows((window, unused) => {
            int owner;
            uint thread = GetWindowThreadProcessId(window, out owner);
            if (owner != processId) return true;
            var title = new StringBuilder(64);
            GetWindowText(window, title, title.Capacity);
            if (title.ToString() != expected) return true;
            sent = crt ? PostThreadMessage(thread, 0x0012, IntPtr.Zero, IntPtr.Zero) : PostMessage(window, 0x0010, IntPtr.Zero, IntPtr.Zero);
            return false;
        }, IntPtr.Zero);
        return sent;
    }

    public static string[] SplitCommandLine(string command) {
        int count;
        IntPtr memory = CommandLineToArgvW(command, out count);
        if (memory == IntPtr.Zero) return new string[0];
        try {
            var args = new string[count];
            for (int i = 0; i < count; i++) args[i] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(memory, i * IntPtr.Size));
            return args;
        } finally { LocalFree(memory); }
    }
}
'@

$sessionId = (Get-Process -Id $PID).SessionId
$outputRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workRoot = [IO.Path]::GetFullPath((Join-Path $outputRoot '../work'))
$crtExe = Join-Path $outputRoot 'closure-crt/ClosureCrt.exe'
$petApp = Join-Path $outputRoot 'closure-companion'
$electronExe = Join-Path $workRoot 'companion-runtime/electron/electron.exe'
$knownProcesses = @{}

function Test-CodexOpen {
    $windowProcesses = [ClosureLifecycleWindows]::OpenWindowProcesses()
    foreach ($id in @($knownProcesses.Keys)) {
        if ($id -notin $windowProcesses) { $knownProcesses.Remove($id) }
    }
    foreach ($id in $windowProcesses) {
        if (!$knownProcesses.ContainsKey($id)) {
            $process = Get-Process -Id $id -ErrorAction SilentlyContinue
            $knownProcesses[$id] = $process -and $process.SessionId -eq $sessionId -and
                $process.Path -match '\\WindowsApps\\OpenAI\.Codex_[^\\]+__2p2nqsd0c76g0\\app\\(?:ChatGPT|Codex)\.exe$'
        }
        if ($knownProcesses[$id]) { return $true }
    }
    return $false
}

function Find-OpenHelpers {
    $crt = Get-Process -Name ClosureCrt -ErrorAction SilentlyContinue | Where-Object {
        $_.SessionId -eq $sessionId -and $_.Path -eq $crtExe
    } | Select-Object -First 1
    $pet = $null
    foreach ($process in (Get-CimInstance Win32_Process -Filter "Name='electron.exe' AND SessionId=$sessionId" -ErrorAction SilentlyContinue)) {
        if ($process.ExecutablePath -ne $electronExe -or !$process.CommandLine) { continue }
        $arguments = [ClosureLifecycleWindows]::SplitCommandLine($process.CommandLine)
        if ($arguments.Length -lt 2 -or $arguments -contains '--demo' -or $arguments -contains '--smoke') { continue }
        if (![IO.Path]::IsPathRooted($arguments[1])) { continue }
        if ([IO.Path]::GetFullPath($arguments[1]).TrimEnd('\') -ne $petApp) { continue }
        $pet = Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
        if ($pet) { break }
    }
    return @{ Crt = $crt; Pet = $pet }
}

function Start-Helpers($children) {
    if (!$children.Crt -and (Test-Path -LiteralPath $crtExe -PathType Leaf)) {
        $children.Crt = Start-Process -FilePath $crtExe -ArgumentList '--no-tray' -WindowStyle Hidden -PassThru
    }
    if (!$children.Pet -and (Test-Path -LiteralPath $electronExe -PathType Leaf)) {
        $env:CLOSURE_STATE_DIR = Join-Path $workRoot 'companion-profile'
        Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
        $arguments = '"' + $petApp + '" --no-tray'
        if (!$NoActivity) { $arguments += ' --follow-activity' }
        $children.Pet = Start-Process -FilePath $electronExe -ArgumentList $arguments -WindowStyle Hidden -PassThru
    }
}

function Stop-Helpers($children) {
    foreach ($key in 'Crt', 'Pet') {
        $process = $children[$key]
        if (!$process) { continue }
        try {
            if (!$process.HasExited) {
                [void][ClosureLifecycleWindows]::CloseHelper($process.Id, $key -eq 'Crt')
                if (!$process.WaitForExit(1600)) { $process.Kill() }
            }
        } catch [InvalidOperationException] { }
        finally { $process.Dispose(); $children[$key] = $null }
    }
}

if ($Probe) {
    $helpers = Find-OpenHelpers
    [pscustomobject]@{ CodexOpen = (Test-CodexOpen); Crt = $helpers.Crt.Id; Pet = $helpers.Pet.Id }
    return
}

$mutex = [Threading.Mutex]::new($false, $mutexName)
$ownsMutex = $false
$signal = $null
$children = @{ Crt = $null; Pet = $null }
try {
    try { $ownsMutex = $mutex.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (!$ownsMutex) { return }
    $signal = [Threading.EventWaitHandle]::new($false, [Threading.EventResetMode]::ManualReset, $stopName)
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $lastOpen = $null
    do {
        if (Test-CodexOpen) {
            if ($null -eq $lastOpen) {
                $children = Find-OpenHelpers
                Start-Helpers $children
            }
            $lastOpen = $clock.ElapsedMilliseconds
        } elseif ($null -ne $lastOpen -and $clock.ElapsedMilliseconds - $lastOpen -ge 1500) {
            Stop-Helpers $children
            $lastOpen = $null
        }
    } until ($signal.WaitOne(350))
} finally {
    if ($ownsMutex) {
        Stop-Helpers $children
        if ($signal) { $signal.Dispose() }
        $mutex.ReleaseMutex()
    }
    $mutex.Dispose()
}
