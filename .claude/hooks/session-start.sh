#!/bin/bash
# Sessions cloud : dist/ n'est pas versionné, or .mcp.json et le hook
# UserPromptSubmit lancent `node dist/cli.js`. Sans ce build, le serveur MCP
# contextree ne démarre pas et le hook échoue à chaque prompt.
# stdout d'un hook SessionStart part dans le contexte du modèle : toute la
# trace npm va sur stderr.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
npm install --no-audit --no-fund >&2
npm run build >&2
