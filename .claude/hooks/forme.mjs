// PostToolUse (Edit|Write) : après une écriture dans un fichier de contexte, la carte
// doit rester sans avertissement. Code 2 = Claude lit stderr et corrige. Toute erreur
// du hook lui-même sort en 0 : un hook cassé ne bloque jamais le travail. Le calque perso
// (~/.claude) n'est pas dans le dépôt : un défaut là-bas ne bloque pas le travail ici.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';

try {
  const entree = JSON.parse(readFileSync(0, 'utf8'));
  const chemin = entree.tool_input?.file_path;
  if (!chemin) process.exit(0);

  const projet = process.env.CLAUDE_PROJECT_DIR ?? entree.cwd ?? process.cwd();
  const rel = relative(projet, resolve(entree.cwd ?? projet, chemin)).split(sep).join('/');
  const contexte = /^(CLAUDE\.md|AGENTS\.md|\.claude\/|plugin\/)/.test(rel) || /\/(CLAUDE|AGENTS)\.md$/.test(rel);
  if (!contexte) process.exit(0);

  const carte = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugin', 'skills', 'carte', 'scripts', 'carte.mjs');
  const { avertissements } = JSON.parse(
    execFileSync('node', [carte, '--json', '--sans-perso', '--racine', projet], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }),
  );
  if (!avertissements.length) process.exit(0);

  process.stderr.write(
    `La carte a ${avertissements.length} avertissement(s) après ta modification de ${rel} :\n` +
      avertissements.map((a) => `  - ${a.ou} — ${a.quoi}`).join('\n') +
      `\nCorrige avant de continuer, ou dis en une phrase pourquoi c'est voulu.\n`,
  );
  process.exit(2);
} catch {
  // silence : voir l'en-tête
}
process.exit(0);
