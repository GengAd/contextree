/**
 * La version de contextree, telle que ce build la porte.
 *
 * Une constante et pas une lecture de `package.json` : le cœur est **copié**
 * dans le `.vsix` sans le `package.json` du paquet, et il doit pouvoir dire sa
 * version là aussi. Un test vérifie qu'elle suit celle du paquet.
 *
 * Chaque tour du journal la porte (`appendTurn`) : c'est ce qui permet à
 * l'extension de voir qu'elle ne tourne pas avec le même contextree que le
 * serveur MCP ou le hook qui écrivent — voir `turn.ts`.
 */
export const VERSION = '0.1.0';
