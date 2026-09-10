param(
    [string]$Model = "glm-5.2",
    [string]$BaseUrl = "https://open.bigmodel.cn/api/paas/v4"
)

$ErrorActionPreference = "Stop"

Write-Host "Iris GLM dual-draft setup"
Write-Host "The key is stored only in Windows user environment variables, never in the extension or repository."
Write-Host ""

$secureKey = Read-Host "Paste GLM API key" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
    $apiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
}
finally {
    if ($bstr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

if ([string]::IsNullOrWhiteSpace($apiKey)) {
    throw "API key is empty."
}

[Environment]::SetEnvironmentVariable("IRIS_GLM_API_KEY", $apiKey, "User")
[Environment]::SetEnvironmentVariable("IRIS_GLM_MODEL", $Model, "User")
[Environment]::SetEnvironmentVariable("IRIS_GLM_BASE_URL", $BaseUrl, "User")

Write-Host ""
Write-Host "Iris GLM dual-draft settings saved. Restart Iris for the new settings to take effect."
