$ErrorActionPreference = 'Stop'
$watcher = Join-Path $PSScriptRoot '../outputs/closure-autostart/Watch-Codex.ps1'
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($watcher, [ref] $tokens, [ref] $errors)
if ($errors.Count) { throw $errors[0].Message }
$update = $ast.Find({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Update-Helpers'
}, $true)
. ([scriptblock]::Create($update.Extent.Text))

function Assert-Test($condition, $message) { if (!$condition) { throw $message } }
function Write-LifecycleLog($message) { $logs.Add($message) }
function Start-Helper($key) {
    $launches.Add($key)
    if ($key -eq 'Crt' -and $fixture.FailCrt) { throw 'Simulated launch failure' }
    $process = [pscustomobject]@{ HasExited = $false; ExitCode = 17; Disposed = $false }
    $process | Add-Member -MemberType ScriptMethod -Name Dispose -Value { $this.Disposed = $true }
    return $process
}
$logs = [Collections.Generic.List[string]]::new()
$launches = [Collections.Generic.List[string]]::new()
$fixture = @{ FailCrt = $false }
$children = @{ Crt = $null; Pet = $null }
$recovery = @{
    Crt = @{ Attempts = 0; Started = 0; Due = 0 }
    Pet = @{ Attempts = 0; Started = 0; Due = 0 }
}

Update-Helpers $children $recovery 0
Assert-Test (($launches -join ',') -eq 'Crt,Pet') 'Both helpers must start.'
$crt = $children.Crt
$pet = $children.Pet
$crt.HasExited = $true
Update-Helpers $children $recovery 100
Assert-Test ($crt.Disposed -and !$children.Crt -and $children.Pet -eq $pet) 'Only the exited helper should be released.'
Update-Helpers $children $recovery 1099
Assert-Test ($launches.Count -eq 2) 'Retry delay should be respected.'
Update-Helpers $children $recovery 1100
Assert-Test ($children.Crt -and $children.Crt -ne $crt -and $children.Pet -eq $pet) 'CRT should restart independently.'
Update-Helpers $children $recovery 62000
Assert-Test ($recovery.Crt.Attempts -eq 0 -and $recovery.Pet.Attempts -eq 0) 'A stable run should reset the budget.'

$fixture.FailCrt = $true
$children.Crt.HasExited = $true
foreach ($at in 63000,64000,65000,66000,67000,68000,69000) {
    Update-Helpers $children $recovery $at
}
Assert-Test ($launches.Count -eq 7 -and $children.Pet -eq $pet) 'Repeated startup failures must stop at the retry limit.'
Assert-Test ($logs -contains 'Crt exited with code 17 while Codex was open.') 'Record the process exit.'
Assert-Test (($logs -like '*reached its launch limit*').Count -eq 1) 'Record the retry limit once.'
'Lifecycle recovery passed.'
