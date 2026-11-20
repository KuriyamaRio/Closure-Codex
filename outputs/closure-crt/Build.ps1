$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (!(Test-Path -LiteralPath $compiler)) {
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework/v4.0.30319/csc.exe'
}
if (!(Test-Path -LiteralPath $compiler)) {
    throw 'The Windows .NET Framework C# compiler is unavailable.'
}
$source = Join-Path $PSScriptRoot 'ClosureCrt.cs'
$output = Join-Path $PSScriptRoot 'ClosureCrt.exe'
& $compiler /nologo /target:winexe /optimize+ /reference:System.Drawing.dll /reference:System.Windows.Forms.dll "/out:$output" $source
if ($LASTEXITCODE -ne 0) {
    throw "Closure CRT compilation failed with exit code $LASTEXITCODE."
}
