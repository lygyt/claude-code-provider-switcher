$ErrorActionPreference = "Stop"

function Test-UsesContinue {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  return $Arguments -contains "--continue" -or $Arguments -contains "-c"
}

function Test-HasPermissionModeArgument {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  foreach ($argument in $Arguments) {
    if (
      $argument -eq "--permission-mode" -or
      $argument -like "--permission-mode=*" -or
      $argument -eq "--dangerously-skip-permissions" -or
      $argument -eq "--allow-dangerously-skip-permissions"
    ) {
      return $true
    }
  }

  return $false
}

function Resolve-PermissionMode {
  $mode = $env:CLAUDE_CODE_PROVIDER_SWITCHER_PERMISSION_MODE
  if ([string]::IsNullOrWhiteSpace($mode)) {
    return "requestApproval"
  }

  $normalized = $mode.Trim()
  if ($normalized -eq "fullAccess" -or $normalized -eq "full-access" -or $normalized -eq "bypassPermissions") {
    return "fullAccess"
  }

  return "requestApproval"
}

function Add-PermissionModeArguments {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  if (Test-HasPermissionModeArgument $Arguments) {
    return @($Arguments)
  }

  $mode = Resolve-PermissionMode
  if ($mode -eq "fullAccess") {
    return @($Arguments + @("--permission-mode", "bypassPermissions"))
  }

  return @($Arguments + @("--permission-mode", "default"))
}

function Test-HasClaudeHistory {
  $projectsDirectory = Join-Path $HOME ".claude\projects"
  if (-not (Test-Path -LiteralPath $projectsDirectory)) {
    return $false
  }

  $historyFile = Get-ChildItem -LiteralPath $projectsDirectory -Filter "*.jsonl" -Recurse -File -ErrorAction SilentlyContinue |
    Select-Object -First 1
  return $null -ne $historyFile
}

function Resolve-ClaudeExecutable {
  $scriptRoot = Split-Path -Parent $PSCommandPath
  $projectRoot = Split-Path -Parent $scriptRoot
  $localWrapper = Join-Path $projectRoot "claude.cmd"

  $application = Get-Command "claude.exe" -CommandType Application -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($null -ne $application -and $application.Source) {
    return $application.Source
  }

  $command = Get-Command "claude" -All -ErrorAction SilentlyContinue |
    Where-Object { $_.Source -and $_.Source -ne $localWrapper } |
    Select-Object -First 1
  if ($null -ne $command -and $command.Source) {
    return $command.Source
  }

  Write-Error "Claude Code CLI was not found. Install Claude Code and make sure claude.exe is available in PATH."
  exit 1
}

function Set-TemporaryEnv {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [string]$Value
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    Remove-Item -LiteralPath "Env:\$Name" -ErrorAction SilentlyContinue
    return
  }

  Set-Item -LiteralPath "Env:\$Name" -Value $Value
}

function Get-ProviderConfigPath {
  if (-not [string]::IsNullOrWhiteSpace($env:CLAUDE_CODE_PROVIDER_SWITCHER_CONFIG)) {
    return $env:CLAUDE_CODE_PROVIDER_SWITCHER_CONFIG
  }

  return Join-Path $HOME ".claude-code-provider-switcher\config.json"
}

function Get-LegacyTokenPath {
  if (-not [string]::IsNullOrWhiteSpace($env:CLAUDE_CODE_PROVIDER_SWITCHER_LEGACY_TOKENS)) {
    return $env:CLAUDE_CODE_PROVIDER_SWITCHER_LEGACY_TOKENS
  }

  return Join-Path $HOME ".claude-code-provider-switcher\tokens.json"
}

function Get-ObjectProperty {
  param(
    $Value,
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  if ($null -eq $Value) {
    return $null
  }

  $property = $Value.PSObject.Properties[$Name]
  if ($null -eq $property) {
    return $null
  }

  return $property.Value
}

function Set-ObjectProperty {
  param(
    [Parameter(Mandatory = $true)]
    $Object,
    [Parameter(Mandatory = $true)]
    [string]$Name,
    $Value
  )

  $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
}

function Read-ProviderConfig {
  $configPath = Get-ProviderConfigPath
  if (-not (Test-Path -LiteralPath $configPath)) {
    return [pscustomobject]@{
      version = 1
    }
  }

  try {
    return [System.IO.File]::ReadAllText($configPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
  } catch {
    Write-Warning "Could not read $configPath. Starting with default DeepSeek settings. $($_.Exception.GetType().FullName): $($_.Exception.Message)"
    return [pscustomobject]@{
      version = 1
    }
  }
}

function Write-ProviderConfig {
  param(
    [Parameter(Mandatory = $true)]
    $Config
  )

  $configPath = Get-ProviderConfigPath
  $directory = Split-Path -Parent $configPath
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
  $json = $Config | ConvertTo-Json -Depth 8
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($configPath, "$json`n", $utf8NoBom)
}

function New-DefaultDeepSeekProvider {
  $now = (Get-Date).ToUniversalTime().ToString("o")
  return [pscustomobject]@{
    id = "preset-deepseek"
    name = "DeepSeek"
    authType = "anthropic-auth-token"
    baseUrl = "https://api.deepseek.com/anthropic"
    model = "deepseek-v4-pro[1m]"
    opusModel = "deepseek-v4-pro[1m]"
    sonnetModel = "deepseek-v4-pro[1m]"
    haikuModel = "deepseek-v4-flash"
    subagentModel = "deepseek-v4-flash"
    effortLevel = "max"
    chatBaseUrl = "https://api.deepseek.com"
    chatModel = "deepseek-v4-pro"
    createdAt = $now
    updatedAt = $now
  }
}

function Get-ProviderList {
  param(
    [Parameter(Mandatory = $true)]
    $Config
  )

  $providers = Get-ObjectProperty $Config "providers"
  if ($null -eq $providers) {
    return @()
  }

  return @($providers)
}

function Find-ProviderById {
  param(
    [Parameter(Mandatory = $true)]
    $Config,
    [Parameter(Mandatory = $true)]
    [string]$ProviderId
  )

  foreach ($provider in (Get-ProviderList $Config)) {
    if ((Get-ObjectProperty $provider "id") -eq $ProviderId) {
      return $provider
    }
  }

  return $null
}

function Find-DeepSeekProvider {
  param(
    [Parameter(Mandatory = $true)]
    $Config
  )

  $deepSeekProvider = Find-ProviderById $Config "preset-deepseek"
  if ($null -ne $deepSeekProvider) {
    return $deepSeekProvider
  }

  foreach ($provider in (Get-ProviderList $Config)) {
    if ((Get-ObjectProperty $provider "name") -eq "DeepSeek") {
      return $provider
    }
  }

  $defaultProvider = New-DefaultDeepSeekProvider
  Set-ObjectProperty $Config "providers" @($defaultProvider)
  if (-not (Get-ObjectProperty $Config "activeProviderId")) {
    Set-ObjectProperty $Config "activeProviderId" "preset-deepseek"
  }
  return $defaultProvider
}

function Find-LaunchProvider {
  param(
    [Parameter(Mandatory = $true)]
    $Config
  )

  $activeProviderId = Get-ObjectProperty $Config "activeProviderId"
  if ($activeProviderId -is [string] -and -not [string]::IsNullOrWhiteSpace($activeProviderId)) {
    $activeProvider = Find-ProviderById $Config $activeProviderId.Trim()
    if ($null -ne $activeProvider) {
      return $activeProvider
    }
  }

  return Find-DeepSeekProvider $Config
}

function Get-StringSetting {
  param(
    $Provider,
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$DefaultValue
  )

  $value = Get-ObjectProperty $Provider $Name
  if ($value -is [string] -and -not [string]::IsNullOrWhiteSpace($value)) {
    return $value.Trim()
  }

  return $DefaultValue
}

function Get-OptionalStringSetting {
  param(
    $Provider,
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  $value = Get-ObjectProperty $Provider $Name
  if ($value -is [string] -and -not [string]::IsNullOrWhiteSpace($value)) {
    return $value.Trim()
  }

  return $null
}

function Test-AuthTypeRequiresToken {
  param(
    [string]$AuthType
  )

  return $AuthType -eq "anthropic-auth-token" -or $AuthType -eq "anthropic-api-key"
}

function Get-TokenFromConfig {
  param(
    [Parameter(Mandatory = $true)]
    $Config,
    [Parameter(Mandatory = $true)]
    [string]$ProviderId
  )

  $tokens = Get-ObjectProperty $Config "tokens"
  if ($null -eq $tokens) {
    return $null
  }

  $token = Get-ObjectProperty $tokens $ProviderId
  if ($token -is [string] -and -not [string]::IsNullOrWhiteSpace($token)) {
    return $token.Trim()
  }

  return $null
}

function Get-TokenFromLegacyFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ProviderId
  )

  $legacyPath = Get-LegacyTokenPath
  if (-not (Test-Path -LiteralPath $legacyPath)) {
    return $null
  }

  try {
    $legacyTokens = [System.IO.File]::ReadAllText($legacyPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
  } catch {
    return $null
  }

  $token = Get-ObjectProperty $legacyTokens $ProviderId
  if ($token -is [string] -and -not [string]::IsNullOrWhiteSpace($token)) {
    return $token.Trim()
  }

  return $null
}

function Set-TokenInConfig {
  param(
    [Parameter(Mandatory = $true)]
    $Config,
    [Parameter(Mandatory = $true)]
    [string]$ProviderId,
    [Parameter(Mandatory = $true)]
    [string]$Token
  )

  if ([string]::IsNullOrWhiteSpace($Token)) {
    return
  }

  $tokens = Get-ObjectProperty $Config "tokens"
  if ($null -eq $tokens) {
    $tokens = [pscustomobject]@{}
    Set-ObjectProperty $Config "tokens" $tokens
  }

  Set-ObjectProperty $tokens $ProviderId $Token.Trim()
  Write-ProviderConfig $Config
}

function Resolve-ProviderApiKey {
  param(
    [Parameter(Mandatory = $true)]
    $Config,
    [Parameter(Mandatory = $true)]
    $Provider
  )

  $providerId = Get-StringSetting $Provider "id" "preset-deepseek"
  $providerName = Get-StringSetting $Provider "name" "Provider"
  $authType = Get-StringSetting $Provider "authType" "anthropic-auth-token"
  if (-not (Test-AuthTypeRequiresToken $authType)) {
    return $null
  }

  $apiKey = $env:CLAUDE_CODE_PROVIDER_SWITCHER_API_KEY
  if ([string]::IsNullOrWhiteSpace($apiKey) -and $providerId -eq "preset-deepseek") {
    $apiKey = $env:DEEPSEEK_API_KEY
  }
  if (-not [string]::IsNullOrWhiteSpace($apiKey)) {
    return $apiKey.Trim()
  }

  $apiKey = Get-TokenFromConfig $Config $providerId
  if (-not [string]::IsNullOrWhiteSpace($apiKey)) {
    return $apiKey.Trim()
  }

  $shouldSave = $false
  if ([string]::IsNullOrWhiteSpace($apiKey)) {
    $apiKey = Get-TokenFromLegacyFile $providerId
    $shouldSave = -not [string]::IsNullOrWhiteSpace($apiKey)
  }
  if ([string]::IsNullOrWhiteSpace($apiKey)) {
    $secureKey = Read-Host "$providerName API key (saved to ~/.claude-code-provider-switcher/config.json)" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
    try {
      $apiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
      if ($bstr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
      }
    }
    $shouldSave = -not [string]::IsNullOrWhiteSpace($apiKey)
  }

  if ([string]::IsNullOrWhiteSpace($apiKey)) {
    Write-Error "$providerName API key is required. Set CLAUDE_CODE_PROVIDER_SWITCHER_API_KEY or save it in ~/.claude-code-provider-switcher/config.json."
    exit 1
  }

  if ($shouldSave) {
    Set-TokenInConfig $Config $providerId $apiKey
  }
  return $apiKey.Trim()
}

$claudeArgs = @($args)
if ((Test-UsesContinue $claudeArgs) -and -not (Test-HasClaudeHistory)) {
  Write-Host "No Claude Code history found; starting a fresh provider session instead of --continue."
  $claudeArgs = @($claudeArgs | Where-Object { $_ -ne "--continue" -and $_ -ne "-c" })
}
$claudeArgs = Add-PermissionModeArguments $claudeArgs

$claudeExecutable = Resolve-ClaudeExecutable

$providerConfig = Read-ProviderConfig
$launchProvider = Find-LaunchProvider $providerConfig
$providerName = Get-StringSetting $launchProvider "name" "DeepSeek"
$providerId = Get-StringSetting $launchProvider "id" "preset-deepseek"
$apiKey = Resolve-ProviderApiKey $providerConfig $launchProvider
$authType = Get-StringSetting $launchProvider "authType" "anthropic-auth-token"
if ($providerId -eq "preset-deepseek") {
  $baseUrl = Get-StringSetting $launchProvider "baseUrl" "https://api.deepseek.com/anthropic"
  $model = Get-StringSetting $launchProvider "model" "deepseek-v4-pro[1m]"
  $opusModel = Get-StringSetting $launchProvider "opusModel" $model
  $sonnetModel = Get-StringSetting $launchProvider "sonnetModel" $model
  $haikuModel = Get-StringSetting $launchProvider "haikuModel" "deepseek-v4-flash"
  $subagentModel = Get-StringSetting $launchProvider "subagentModel" "deepseek-v4-flash"
  $effortLevel = Get-StringSetting $launchProvider "effortLevel" "max"
} else {
  $baseUrl = Get-OptionalStringSetting $launchProvider "baseUrl"
  $model = Get-OptionalStringSetting $launchProvider "model"
  $opusModel = Get-OptionalStringSetting $launchProvider "opusModel"
  if ([string]::IsNullOrWhiteSpace($opusModel)) {
    $opusModel = $model
  }
  $sonnetModel = Get-OptionalStringSetting $launchProvider "sonnetModel"
  if ([string]::IsNullOrWhiteSpace($sonnetModel)) {
    $sonnetModel = $model
  }
  $haikuModel = Get-OptionalStringSetting $launchProvider "haikuModel"
  $subagentModel = Get-OptionalStringSetting $launchProvider "subagentModel"
  $effortLevel = Get-OptionalStringSetting $launchProvider "effortLevel"
}

$envNames = @(
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL",
  "CLAUDE_CODE_EFFORT_LEVEL"
)

$previousEnv = @{}
foreach ($name in $envNames) {
  $previousEnv[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}

try {
  Set-TemporaryEnv "ANTHROPIC_BASE_URL" $baseUrl
  if ($authType -eq "oauth") {
    Set-TemporaryEnv "ANTHROPIC_AUTH_TOKEN" $null
    Set-TemporaryEnv "ANTHROPIC_API_KEY" $null
  } elseif ($authType -eq "anthropic-api-key") {
    Set-TemporaryEnv "ANTHROPIC_AUTH_TOKEN" $null
    Set-TemporaryEnv "ANTHROPIC_API_KEY" $apiKey
  } else {
    Set-TemporaryEnv "ANTHROPIC_AUTH_TOKEN" $apiKey
    Set-TemporaryEnv "ANTHROPIC_API_KEY" $null
  }
  Set-TemporaryEnv "ANTHROPIC_MODEL" $model
  Set-TemporaryEnv "ANTHROPIC_DEFAULT_OPUS_MODEL" $opusModel
  Set-TemporaryEnv "ANTHROPIC_DEFAULT_SONNET_MODEL" $sonnetModel
  Set-TemporaryEnv "ANTHROPIC_DEFAULT_HAIKU_MODEL" $haikuModel
  Set-TemporaryEnv "CLAUDE_CODE_SUBAGENT_MODEL" $subagentModel
  Set-TemporaryEnv "CLAUDE_CODE_EFFORT_LEVEL" $effortLevel

  if ([string]::IsNullOrWhiteSpace($baseUrl)) {
    Write-Host "Launching Claude Code with $providerName"
  } else {
    Write-Host "Launching Claude Code with $providerName at $baseUrl"
  }
  & $claudeExecutable @claudeArgs
  $exitCode = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 0 }
  exit $exitCode
} finally {
  foreach ($name in $envNames) {
    $value = $previousEnv[$name]
    if ($null -eq $value) {
      Remove-Item -LiteralPath "Env:\$name" -ErrorAction SilentlyContinue
    } else {
      Set-Item -LiteralPath "Env:\$name" -Value $value
    }
  }
}
