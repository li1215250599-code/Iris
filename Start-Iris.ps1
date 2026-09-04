param(
    [switch]$SkipEKanYaLogin,
    [switch]$OpenStandalone
)

$ErrorActionPreference = "Stop"

$IrisDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WorkspaceDir = Split-Path -Parent $IrisDir
$EKanYaDir = Join-Path $WorkspaceDir "EKanYa AutoLogin"
$ConfigPath = Join-Path $EKanYaDir "config.json"
$LogsDir = Join-Path $IrisDir "logs"
$IrisLogPath = Join-Path $LogsDir "iris-launch.log"
$LastErrorPath = Join-Path $LogsDir "iris-last-error.txt"

New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null

function Write-IrisLog {
    param([string]$Message)
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"
    Add-Content -LiteralPath $IrisLogPath -Encoding UTF8 -Value "[$stamp] $Message"
    Write-Host "[Iris] $Message"
}

function Resolve-PythonCommand {
    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($env:IRIS_PYTHON_PATH)) {
        $candidates += $env:IRIS_PYTHON_PATH
    }
    $candidates += (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe")
    $candidates += (Join-Path $IrisDir ".venv\Scripts\python.exe")

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return @{ FileName = $candidate; Args = @() }
        }
    }

    $py = Get-Command "py.exe" -ErrorAction SilentlyContinue
    if ($py) {
        return @{ FileName = $py.Source; Args = @("-3") }
    }

    $python = Get-Command "python.exe" -ErrorAction SilentlyContinue
    if ($python -and $python.Source -notlike "*\WindowsApps\python.exe") {
        return @{ FileName = $python.Source; Args = @() }
    }

    throw "Python was not found. Please install Python 3, then run Iris again."
}

function Resolve-ChromePath {
    param($Config)

    if (-not [string]::IsNullOrWhiteSpace($Config.chromePath)) {
        if (Test-Path -LiteralPath $Config.chromePath) {
            return $Config.chromePath
        }
        throw "chromePath in config.json does not exist: $($Config.chromePath)"
    }

    $candidates = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
    )

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return $candidate
        }
    }

    $command = Get-Command "chrome.exe" -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    throw "Chrome was not found. Please set chromePath in config.json to the full path of chrome.exe."
}

function Import-IrisUserEnvironment {
    foreach ($name in @("IRIS_AI_PROVIDER", "IRIS_AI_BASE_URL", "IRIS_AI_MODEL", "IRIS_AI_API_KEY", "IRIS_CEPH_MODEL")) {
        $value = [Environment]::GetEnvironmentVariable($name, "User")
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

function Test-IrisServer {
    param([int]$Port)
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 2
        return $health.ok -eq $true
    }
    catch {
        return $false
    }
}

function Start-IrisServer {
    param(
        [int]$Port,
        [string]$PythonFile,
        [string]$ConfigFile
    )

    if (Test-IrisServer -Port $Port) {
        Write-IrisLog "Iris service is already running on port $Port."
        return
    }

    $python = Resolve-PythonCommand
    $stdoutPath = Join-Path $LogsDir "iris-server.out.log"
    $stderrPath = Join-Path $LogsDir "iris-server.err.log"
    $arguments = @()
    $arguments += $python.Args
    $arguments += @($PythonFile, "--host", "127.0.0.1", "--port", "$Port", "--config", $ConfigFile)
    $argumentLine = Join-QuotedArguments -Arguments $arguments

    Write-IrisLog "Starting Iris service on port $Port."
    Start-Process -FilePath $python.FileName `
        -ArgumentList $argumentLine `
        -WorkingDirectory $IrisDir `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath | Out-Null

    $deadline = (Get-Date).AddSeconds(12)
    while ((Get-Date) -lt $deadline) {
        if (Test-IrisServer -Port $Port) {
            Write-IrisLog "Iris service is ready."
            return
        }
        Start-Sleep -Milliseconds 500
    }

    throw "Iris service did not become ready. Please check logs\iris-server.err.log."
}

function Join-QuotedArguments {
    param([string[]]$Arguments)

    $escapedArguments = foreach ($argument in $Arguments) {
        if ($null -eq $argument) {
            '""'
        }
        elseif ($argument -match '[\s"]') {
            '"' + ($argument -replace '"', '\"') + '"'
        }
        else {
            $argument
        }
    }
    return ($escapedArguments -join " ")
}

function Open-IrisPage {
    param(
        [string]$ChromePath,
        [string]$ProfileDir,
        [int]$DebugPort,
        [int]$IrisPort
    )

    New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
    $url = "http://127.0.0.1:$IrisPort/"
    $arguments = @(
        "--remote-debugging-port=$DebugPort",
        "--user-data-dir=$ProfileDir",
        "--no-first-run",
        "--new-window",
        $url
    )
    $argumentLine = Join-QuotedArguments -Arguments $arguments

    Write-IrisLog "Opening Iris page."
    Start-Process -FilePath $ChromePath -ArgumentList $argumentLine -WindowStyle Normal | Out-Null
}

try {
    Remove-Item -LiteralPath $LastErrorPath -ErrorAction SilentlyContinue
    Write-IrisLog "----- Iris launch started -----"

    if (-not (Test-Path -LiteralPath $ConfigPath)) {
        throw "Config file not found: $ConfigPath"
    }
    $config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    Import-IrisUserEnvironment
    $irisPort = if ($config.irisPort) { [int]$config.irisPort } else { 9323 }
    $debugPort = if ($config.debugPort) { [int]$config.debugPort } else { 9223 }
    $profileDir = if ([string]::IsNullOrWhiteSpace($config.profileDir)) { Join-Path $EKanYaDir "chrome-profile" } else { $config.profileDir }
    $chromePath = Resolve-ChromePath -Config $config

    Start-IrisServer -Port $irisPort -PythonFile (Join-Path $IrisDir "iris_server.py") -ConfigFile $ConfigPath

    if (-not $SkipEKanYaLogin) {
        Write-IrisLog "Opening EKanYa and preparing the logged-in session."
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $EKanYaDir "Start-EKanYa.ps1")
    }

    if ($OpenStandalone) {
        Open-IrisPage -ChromePath $chromePath -ProfileDir $profileDir -DebugPort $debugPort -IrisPort $irisPort
    }
    Write-IrisLog "----- Iris launch completed -----"
}
catch {
    $lines = @(
        "Iris failed to start",
        "Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
        "Message: $($_.Exception.Message)",
        "Log: $IrisLogPath"
    )
    Set-Content -LiteralPath $LastErrorPath -Encoding UTF8 -Value $lines
    Write-Host ""
    Write-Host "Iris failed to start:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host "Details: $LastErrorPath"
    exit 1
}
