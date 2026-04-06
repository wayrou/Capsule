param(
    [string]$Triplet = "x64-windows-static-md"
)

$ErrorActionPreference = "Stop"

function Resolve-VcpkgRoot {
    $candidates = @(
        $env:VCPKG_INSTALLATION_ROOT,
        "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\vcpkg",
        "C:\Program Files (x86)\Microsoft Visual Studio\2022\Community\VC\vcpkg",
        "C:\Program Files (x86)\Microsoft Visual Studio\2022\Enterprise\VC\vcpkg",
        "C:\vcpkg"
    ) | Where-Object { $_ } | Select-Object -Unique

    foreach ($candidate in $candidates) {
        $exe = Join-Path $candidate "vcpkg.exe"
        if (Test-Path -LiteralPath $exe) {
            return $candidate
        }
    }

    $command = Get-Command vcpkg.exe -ErrorAction SilentlyContinue
    if ($command) {
        return Split-Path -Parent $command.Source
    }

    return $null
}

$manifestRoot = Split-Path -Parent $PSScriptRoot
$vcpkgRoot = Resolve-VcpkgRoot
$installRoot = Join-Path $manifestRoot "vcpkg_installed"

if (-not $vcpkgRoot) {
    throw "Unable to locate a vcpkg installation. Install Visual Studio Build Tools with the vcpkg component, install vcpkg separately, or set VCPKG_INSTALLATION_ROOT."
}

$vcpkgExe = Join-Path $vcpkgRoot "vcpkg.exe"

if (-not (Test-Path -LiteralPath $vcpkgExe)) {
    throw "Unable to find vcpkg.exe at '$vcpkgExe'. Install Visual Studio Build Tools with the vcpkg component or set VCPKG_INSTALLATION_ROOT."
}

Write-Host "Installing native archive dependencies via vcpkg..."
& $vcpkgExe install `
    --triplet $Triplet `
    --vcpkg-root $vcpkgRoot `
    --x-manifest-root $manifestRoot `
    --x-install-root $installRoot
