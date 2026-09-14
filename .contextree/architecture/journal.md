---
type: reference
title: Journal des tours et surlignage
load_when: quand on touche au journal des tours, à ce qui a été chargé au dernier tour, au surlignage des branches lues dans la barre latérale ou sur la toile, ou à la trace des écritures de l'IA
---

Ce qui a été chargé, tour après tour — la donnée que `renderTrace` envoyait sur `stderr`, gardée pour que la vue montre ce qui a **réellement** servi, et pas ce que le routeur ferait d'un prompt hypothétique.

Par tour : horodatage, extrait du prompt (200 caractères, mis à plat), branches retenues, `reason` (`routed` / `all` / `fallback` / `deferred` / `catalogue` — c'est lui l'indicateur de repli, pas un booléen en double), `source` (`hook`, `mcp` ou `bg`), l'erreur du routeur s'il y en a eu une, `engine`, le moteur appelé quand il y en a eu un, `read` (les branches lues par l'agent), `session` (la session MCP) et `version` (le contextree qui a écrit, posée par `appendTurn`). `catalogue` (serveur MCP seulement) : rien de routable, l'agent a reçu la racine et le catalogue, `selected` est vide ; la barre latérale l'affiche « catalogue seul », la toile en avertissement comme un repli. Il n'existe pas de commande `contextree journal` : le journal se lit dans la vue. Ce que le routage de fond y écrit et pourquoi est dans *Mécanique du routage*.

- **Où il vit : `stateDir()`** (14 septembre 2026). `CONTEXTREE_STATE_DIR` d'abord ; sinon l'emplacement du système — `%LOCALAPPDATA%\contextree` sous Windows, `~/Library/Application Support/contextree` sous macOS, `$XDG_STATE_HOME/contextree` (défaut `~/.local/state/contextree`) ailleurs. **Plus `~/.contextree`** : le même nom que l'arbre d'un projet, pris pour un arbre (voir *Pièges*). Pas `~/Library/Caches` : `config.json` et `session.json` du backend vivent au même endroit et ne sont pas du cache. L'ancien dossier n'est pas migré.
- **Séparé du cache de sélection.** `session.ts` a un contrat dont dépend le fallback du tour suivant : un journal corrompu ne doit jamais pouvoir abîmer le routage. Deux fichiers, et le journal des écritures de l'IA en a un troisième.
- **Clé par dossier d'arbre, pas par session** (`treeKey`, sur le `realpathSync.native`). Un arbre, un journal, toutes sessions confondues — la vue ne connaît pas le `session_id` et n'a pas à deviner quel fichier lire. **Sous Windows, le chemin est mis en minuscules** avant hachage (14 septembre 2026) : VS Code donne `c:\…`, un process lancé ailleurs `C:\…`, et deux clés faisaient deux journaux. `treeKey(dir, platform)` prend la plateforme en paramètre pour se tester partout ; l'ancien journal Windows n'est pas migré.
- **`read_branch` journalise** (14 septembre 2026). En mode catalogue, `get_context` rend zéro branche et l'agent lit les siennes : sans trace, la vue affichait « catalogue seul » et n'allumait rien. `recordRead` ajoute la branche à `selected` **et** à `read` du **dernier tour du journal**, s'il vient de la même session MCP depuis moins de `READ_WINDOW_MS` (5 min) ; sinon il ouvre un tour `reason: 'read'`, `source: 'mcp'`. Pas « le dernier tour de la session » : la vue montre le dernier tour tout court, et un routage de fond intercalé cacherait la lecture. `turnLabelKey` rend `read` pour un tour `catalogue`/`read` qui a des lectures — « lues par l'agent » dans les deux vues, sans avertissement ; un tour routé enrichi de lectures reste `routed`. La racine (`:root`) n'est pas journalisée, les vues la comptent déjà lue. Les mises à jour d'un même fichier passent **à la file dans le process** (`updateLog`) : des `read_branch` parallèles s'effaçaient l'un l'autre.
- **La trace est la première ligne** des réponses de `get_context` et `read_branch`, en texte : elle fermait la réponse dans un commentaire HTML que le chat de VS Code masque.
- **Les trois chemins écrivent** : `cmdHook` (Claude Code), `get_context` (chat de Cursor et autres clients MCP), et `route-bg`. Sans les deux premiers la vue est aveugle la moitié du temps ; sans le troisième elle ne voit jamais un vrai routage sous moteur CLI.
- **50 derniers tours** (100 écritures d'IA), écriture par fichier temporaire renommé — un lecteur ne tombe jamais sur un JSON à moitié écrit.
- **`appendTurn` ne rejette jamais.** Même invariant que le hook : écrire le journal ne peut pas bloquer un prompt.

## Ce que les vues en font

Le journal alimente deux affichages à partir de la même lecture — ils ne peuvent donc pas se contredire.

**La barre latérale** (`extension/src/turn.ts`) : un `FileDecorationProvider` marque les `.md` lus au dernier tour d'une pastille `•` **et teinte le libellé** dans la couleur des correspondances de recherche. Un point de trois pixels ne se voit pas dans une liste de vingt lignes ; le fond de ligne serait mieux encore, mais l'API des vues arborescentes ne l'expose pas. La couleur est celle d'une recherche, jamais celle d'une erreur : une lecture est un fait ordinaire. Décorateur de *fichier* et pas couleur d'icône, pour que la même marque apparaisse dans l'explorateur et sur l'onglet ouvert. (Il a remplacé le badge de barre d'état le 8 septembre 2026 : personne ne regarde en bas à droite.)

Le titre de la vue porte l'état — `4/9 · routé`, `12/12 · différé`, `3/16 · routé (prochain tour)` — et l'infobulle distingue trois cas : lue au dernier tour, choisie par le routeur pour le prochain, ou injectée faute de mieux.

**La toile** : un point dans la couleur du type sur les cartes lues, à côté du badge ; le reste de l'arbre est intact. En repli, le point perd sa couleur de type et passe au gris.

Deux marches manquées avant d'arriver là, le 8 septembre 2026, et elles disent la même chose : **une lecture est un fait ordinaire, pas un événement.** Estomper le non-lu (opacité 0,32) rendait illisible la moitié de l'arbre — or c'est justement dans les branches *non* lues qu'on va corriger un `load_when`. Puis l'entourer de rouge criait pour rien.

La toile porte deux surlignages, jamais mélangés : le **dernier tour** (le journal, permanent) et la **sonde** (« que chargerait le routeur pour ce prompt ? », à la demande). La sonde l'emporte tant qu'elle est active ; ✕ ou Échap rend la toile au dernier vrai tour — on ne peut pas effacer un fait, seulement une question.

**Le canal *Sortie › contextree*** (`TurnLog`, `turn.ts`) : au premier tour, la version de l'extension et le chemin du journal surveillé ; puis une ligne par tour — heure, source, libellé, moteur, `n/total`, branches, lectures, erreur. C'est le premier endroit à regarder quand le surlignage ne suit pas. Il signale aussi, une fois, **un écart de version** : un tour signé d'une autre `version` que le cœur embarqué, ou l'ancien journal `~/.contextree/journal/<clé>.json` (`legacyJournalFile`) modifié depuis moins d'un jour et après le dernier tour lu — un contextree d'avant le déménagement de l'état écrit encore là. Tant que tout est en `0.1.0`, seul le second signe peut se déclencher.

L'observateur du journal est **non récursif** (`*.json` sur le dossier), seul motif que VS Code supporte hors du dossier ouvert. C'est lui qui fait bouger le surlignage pendant une conversation : aucun `.md` ne change quand un tour est routé.
