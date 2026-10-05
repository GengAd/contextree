#!/bin/bash
# Sessions cloud de ce dépôt : dist/ n'est pas versionné, or le serveur MCP et
# le hook UserPromptSubmit lancent `node dist/cli.js`.
#
#   contextree.sh install  hook SessionStart : npm install && npm run build
#   contextree.sh mcp      commande du serveur MCP. Claude Code lance les serveurs
#                          MCP en même temps que SessionStart, pas après : on
#                          attend la fin du build (tsc -b écrit tsconfig.tsbuildinfo
#                          en dernier), 25 s au plus.
#
# Le stdout d'un SessionStart part dans le contexte du modèle : trace sur stderr.
set -euo pipefail
cd "$(dirname "$0")/.."

case "${1:-}" in
  install)
    [ "${CLAUDE_CODE_REMOTE:-}" = true ] || exit 0
    npm install --no-audit --no-fund >&2
    npm run build >&2
    ;;
  mcp)
    i=0
    while [ "${CLAUDE_CODE_REMOTE:-}" = true ] && [ ! -f tsconfig.tsbuildinfo ] && [ "$i" -lt 50 ]; do
      sleep 0.5
      i=$((i + 1))
    done
    exec node dist/cli.js mcp
    ;;
esac
