# Changelog

## 0.1.7

- Serialize provider config read-modify-write operations so concurrent commands cannot drop providers.
- Recover custom providers from the in-memory backup when `config.json` is truncated or corrupt.
- Keep atomic config writes with a unique temporary file and `0600` permissions.
- Clear inherited `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` when launching Claude Code terminals.
- Add regression tests for corruption recovery, disk-loss fallback, and concurrent provider updates.

## 0.1.0

- Initial MVP for provider profiles, SecretStorage-backed tokens, QuickPick commands, status bar switching, isolated terminals, tests, and packaging.
