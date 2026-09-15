---
type: reference
title: Langue de l'outil (fr / en)
load_when: quand on touche à la langue affichée ou lue par le modèle, à i18n.ts, à --lang, à CONTEXTREE_LANG, ou à la traduction de l'extension et de la toile
---

**Résolution, à un seul endroit** (`i18n.ts`) : `setLang` (l'extension, pour sa copie du cœur) > `CONTEXTREE_LANG` (ou `--lang`) > `LC_ALL`/`LC_MESSAGES`/`LANG` hors `C`/`POSIX` > préférences macOS (`defaults read -g AppleLanguages`) > `Intl` > anglais. La ligne macOS existe parce qu'un Mac réglé en français donne `LANG=C.UTF-8` et `Intl` en `en-US`.

`install` inscrit `--lang <langue>` dans les commandes du hook et du serveur : les agents les lancent sans `LANG`, et le hook ne paie pas le process `defaults` à chaque prompt.

**Ce que lit le modèle** suit la même langue, figée à la création du serveur. Le contenu des branches n'est jamais traduit.

**L'extension, trois mécanismes** :
- manifeste : `package.nls.json` (anglais) et `package.nls.fr.json`, `%clés%` dans `package.json` ;
- code : `vscode.l10n.t('texte anglais', …)` et `l10n/bundle.l10n.fr.json` ;
- toile (pas d'API) : l'hôte traduit `CANVAS_STRINGS` et pose le JSON dans la page, lu par `tr()` dans `canvas.js`. Un texte absent de `CANVAS_STRINGS` s'affiche en anglais — un test le vérifie.

Le cœur embarqué reçoit la langue par `setLang`, **jamais par `CONTEXTREE_LANG`** : l'environnement de l'hôte d'extensions est hérité par tout ce qu'il lance, jusqu'au hook de Claude Code.

Non vérifié : un vrai VS Code lancé en `--locale fr` / `--locale en`.
