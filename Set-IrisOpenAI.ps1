param(
    [string]$Model = "gpt-5.5",
    [string]$BaseUrl = "https://api.openai.com/v1"
)

$ErrorActionPreference = "Stop"

Write-Host "Iris OpenAI setup"
Write-Host "This stores the API key in your Windows user environment variables, not in the Chrome extension."
Write-Host ""

$secureKey = Read-Host "Paste OpenAI API key" -AsSecureString
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

[Environment]::SetEnvironmentVariable("IRIS_AI_PROVIDER", "openai", "User")
[Environment]::SetEnvironmentVariable("IRIS_AI_BASE_URL", $BaseUrl, "User")
[Environment]::SetEnvironmentVariable("IRIS_AI_MODEL", $Model, "User")
[Environment]::SetEnvironmentVariable("IRIS_AI_API_KEY", $apiKey, "User")

Write-Host ""
Write-Host "Iris OpenAI settings saved."
Write-Host "Restart Iris for the new settings to take effect."
