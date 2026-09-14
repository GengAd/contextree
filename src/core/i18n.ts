import { execFileSync } from 'node:child_process';

/**
 * La langue de l'outil — **un seul endroit** la décide (14 septembre 2026).
 *
 * contextree parle français ou anglais : ce qu'un humain lit (CLI, install,
 * erreurs, extension) et ce qu'un modèle lit (instructions, descriptions
 * d'outils, bloc injecté, consigne `bootstrap`). Le **contenu des branches**
 * n'est jamais traduit, et le prompt du routeur non plus (voir `router.ts`).
 *
 * Ordre de résolution :
 *
 * 0. `setLang` — l'extension y passe la langue de VS Code, pour sa copie du
 *    cœur seulement ;
 * 1. `CONTEXTREE_LANG` — posé à la main, ou par `--lang` sur la ligne de
 *    commande ;
 * 2. `LC_ALL`, `LC_MESSAGES`, `LANG` — sauf `C` et `POSIX`, qui ne disent rien ;
 * 3. sous macOS, la langue des préférences (`AppleLanguages`) ;
 * 4. la locale d'`Intl` — c'est elle qui marche sous Windows, où `LANG`
 *    n'existe pas ;
 * 5. l'anglais.
 *
 * **Pourquoi macOS a sa ligne.** Mesuré sur un Mac réglé en français
 * (`AppleLocale fr_FR`) : `LANG=C.UTF-8` et `Intl` rend `en-US`, dans un shell
 * comme dans un environnement vidé. Se fier à `Intl` seul aurait donné de
 * l'anglais au mainteneur. On lit donc la préférence du système — un process
 * `defaults`, une fois par process, jamais plus.
 *
 * **Le hook et le serveur MCP ne paient pas ce process à chaque prompt** :
 * `install` inscrit `--lang <langue>` dans la commande qu'il écrit. Les agents
 * les lancent avec un environnement appauvri (le transport stdio du SDK MCP ne
 * garde ni `LANG` ni `LC_*`) : la langue écrite en toutes lettres est la seule
 * qui arrive à coup sûr.
 */
export type Lang = 'fr' | 'en';

export const LANGS: readonly Lang[] = ['fr', 'en'];

let cached: Lang | undefined;
let override: Lang | undefined;

/**
 * Fixe la langue **de cette copie du cœur**, sans toucher à l'environnement.
 *
 * C'est le chemin de l'extension : sa langue est celle de VS Code
 * (`vscode.env.language`). Poser `CONTEXTREE_LANG` dans le process de l'hôte
 * d'extensions l'aurait fait hériter à tout ce que les autres extensions y
 * lancent — jusqu'au hook de Claude Code, qui aurait changé de langue avec
 * l'interface de l'éditeur.
 */
export function setLang(lang: Lang | undefined): void {
  override = lang;
}

/** La langue de ce process. Relue si `CONTEXTREE_LANG` change — c'est ce qui
 *  permet à la CLI de la poser après le chargement du module. */
export function currentLang(): Lang {
  if (override) return override;
  const forced = asLang(process.env['CONTEXTREE_LANG']);
  if (forced) return forced;
  cached ??= resolveLang();
  return cached;
}

/** La résolution elle-même, sans cache — simulable en test. */
export function resolveLang(
  env: NodeJS.ProcessEnv = process.env,
  opts: { platform?: NodeJS.Platform; appleLanguage?: () => string | undefined; intlLocale?: () => string } = {},
): Lang {
  const forced = asLang(env['CONTEXTREE_LANG']);
  if (forced) return forced;

  for (const key of ['LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const value = env[key];
    if (value && !/^(C|POSIX)([._@]|$)/i.test(value)) return fromLocale(value);
  }

  if ((opts.platform ?? process.platform) === 'darwin') {
    const apple = (opts.appleLanguage ?? readAppleLanguage)();
    if (apple) return fromLocale(apple);
  }

  const intl = (opts.intlLocale ?? (() => Intl.DateTimeFormat().resolvedOptions().locale))();
  return fromLocale(intl);
}

/** `fr`, `fr_FR.UTF-8`, `fr-CA` → `fr` ; tout le reste → `en`. Une locale qu'on
 *  ne parle pas vaut l'anglais, pas le français. */
export function fromLocale(locale: string): Lang {
  return /^fr([-_.@]|$)/i.test(locale.trim()) ? 'fr' : 'en';
}

/** Une valeur explicite de langue, ou rien. */
export function asLang(value: string | undefined): Lang | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  return v === 'fr' || v === 'en' ? v : v ? fromLocale(v) : undefined;
}

/** La première langue des préférences macOS, ou rien — en moins d'une demi-seconde. */
function readAppleLanguage(): string | undefined {
  try {
    const out = execFileSync('defaults', ['read', '-g', 'AppleLanguages'], {
      encoding: 'utf8',
      timeout: 500,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.match(/"?([A-Za-z]{2}(?:[-_][A-Za-z0-9]+)*)"?/)?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Un dictionnaire : la langue de référence donne la forme, l'autre doit la
 * remplir **clé pour clé, signature pour signature**. Une clé absente ou en
 * trop casse le typecheck, jamais l'affichage.
 */
export type Dictionary<T> = { [K in keyof T]: T[K] extends (...args: infer A) => string ? (...args: A) => string : string };

/** Choisit la moitié d'une paire de dictionnaires selon la langue courante. */
export function pick<T>(dicts: Record<Lang, T>, lang: Lang = currentLang()): T {
  return dicts[lang];
}
