/**
 * La surface du cœur pour une **vue** — l'extension VS Code / Cursor.
 *
 * Ce n'est pas le barillet complet (`src/index.ts`), et c'est volontaire :
 * celui-ci tire le serveur MCP, donc `@modelcontextprotocol/sdk` et `zod`. Une
 * vue n'en a pas besoin ; elle lit des fichiers, un journal, essaie un prompt
 * sur la toile et câble un agent.
 *
 * Séparer les deux, c'est ce qui permet d'embarquer le cœur dans un `.vsix`
 * sans y embarquer de `node_modules` : tout ce qui est importé ici ne dépend
 * que de Node. Le routeur en fait partie — il charge le SDK Anthropic à la
 * demande, et à défaut route par le CLI de l'utilisateur.
 */
export * from './core/types.js';
export * from './core/i18n.js';
export * from './core/store.js';
export * from './core/tree.js';
export * from './core/journal.js';
export * from './core/router.js';
export * from './core/render.js';
export * from './core/lint.js';
export * from './install.js';
