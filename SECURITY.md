# Security Policy

## API Key Storage

API keys, auth tokens, provider profiles, and the active provider id are stored in the user config file:

```text
~/.claude-code-provider-switcher/config.json
```

Keys live under the `tokens` object, keyed by provider id. Older VS Code SecretStorage entries and the legacy `tokens.json` file are migrated into this config file when read.

Legacy SecretStorage keys used this format:

```text
claude-code-provider-switcher.token.<providerId>
```

## No Telemetry

This extension does not collect telemetry and does not upload provider configuration.

## No Config Mutation

The extension does not modify shell profiles, PowerShell profiles, `.bashrc`, `.zshrc`, or `~/.claude/settings.json`. Provider settings are injected only into terminals created by this extension.

## Reporting Vulnerabilities

Please report security issues through the repository issue tracker or the maintainer contact configured by the publisher before marketplace release. Do not include real API keys, screenshots containing secrets, or raw logs with credentials.

## User Guidance

Avoid sharing screenshots or logs that include terminal environment variables, provider tokens, or API keys. If a secret may have been exposed, rotate it with the provider immediately.
