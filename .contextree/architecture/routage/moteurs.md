---
type: reference
title: Moteurs de routage
load_when: quand on touche au choix du moteur (clé Anthropic ou OpenAI, sampling MCP, CLI claude / codex / gemini), au modèle utilisé, ou au lancement d'un CLI sous Windows
---

**`pickEngine`, dans cet ordre** — une clé explicite, puis le modèle du client MCP, puis un CLI déjà authentifié :

- **`anthropic`** — `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`. Sortie structurée par JSON Schema, `thinking: disabled`, `effort: low`. Choisi seulement si le SDK est résolvable (`hasSdk`) : il ne l'est pas dans l'extension. Modèle par défaut `claude-opus-5`, jamais mesuré contre haiku/sonnet faute de clé.
- **`openai`** — `OPENAI_API_KEY` : un `fetch` sur `${OPENAI_BASE_URL}/chat/completions`, **pas de SDK**. Couvre OpenAI, Groq, OpenRouter, Ollama, LM Studio. Corps minimal (modèle + messages) : `temperature`, `max_tokens`, `response_format` sont refusés par une partie de ces endpoints.
- **`sampling`** — **dans le serveur MCP seulement**, quand le client annonce la capacité : le tri est demandé au modèle **du client** (`sampling/createMessage`). C'est ce qui fait router Copilot sur un poste sans clé ni CLI. Le routeur reçoit une fonction `Complete` et ne sait rien de MCP. `maxTokens: 256`, `includeContext: 'none'`, `modelPreferences` rapide et bon marché. Synchrone, budget d'un CLI : au premier appel VS Code ouvre une invite de consentement. **Un refus coupe le sampling pour la session** (redemander rouvrirait l'invite à chaque tâche) ; une réponse illisible ne coupe rien. Côté VS Code : modèles autorisés par *MCP: List Servers → Configure Model Access* ; bug connu microsoft/vscode#267354 sans modèle choisi. Jamais vu en vrai.
- **`claude`, `codex`, `gemini`** — le premier binaire trouvé : l'abonnement de l'utilisateur, aucune clé. Même mécanique (`CliSpec`) : prompt par stdin, environnement débarrassé des `CLAUDE*` hérités (`CLAUDE_EFFORT` faisait réfléchir le routeur) sauf `CLAUDE_CONFIG_DIR`. `claude -p` sans outils ni MCP ni hook, modèle `haiku` ; `codex exec -` en `--sandbox read-only --skip-git-repo-check` ; `gemini` lit stdin. 5 à 60 s.
- **`none`** — rien de tout ça : repli, et `error` le dit.

**Le modèle n'est deviné pour personne** hors `claude` : le défaut de l'utilisateur sur `codex`/`gemini`. **Un moteur forcé n'est pas vérifié** : `CONTEXTREE_ROUTER=codex` sans `codex` tombe dans le fallback plutôt que sur un moteur non demandé. Pas de `--json-schema` sur les CLI : un tour de plus, latence doublée.

**Le journal dit qui a trié** : `engine` sur chaque tour qui a appelé un modèle.

**Sous Windows** : le binaire se cherche par `PATHEXT` (`claude.exe` natif comme `claude.cmd` de npm, plus `%APPDATA%\npm`). Un `.cmd`/`.bat` ne se lance que par `cmd.exe` : `cmd /d /s /c` avec l'échappement en deux couches de `cross-spawn` (`cmdLine`), consigne système sur stdin (`cmd` coupe au premier saut de ligne). **Le prompt ne passe jamais en argument** — c'est ce qui rend `cmd.exe` sûr. Jamais `shell: true`. `windowsHide: true` sur tous les `spawn`. Prouvé par un faux CLI dans `npm test`, pas sur un vrai poste.
