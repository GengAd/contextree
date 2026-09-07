/** Frontmatter minimal : uniquement des scalaires `clé: valeur` sur une ligne.
 *  Volontairement pas de dépendance YAML — le format doit rester assez simple
 *  pour être écrit à la main, et assez strict pour ne jamais surprendre. */

export type Frontmatter = Record<string, string>;

const FENCE = '---';

export function parseFrontmatter(raw: string): { data: Frontmatter; body: string } {
  const text = raw.replace(/^﻿/, '');
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== FENCE) return { data: {}, body: text.trim() };

  const data: Frontmatter = {};
  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === FENCE) break;
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    let value = line.slice(sep + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    if (key) data[key] = value;
  }
  return { data, body: lines.slice(i + 1).join('\n').trim() };
}

export function serializeFrontmatter(data: Frontmatter, body: string): string {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined && v !== '');
  const head = entries.map(([k, v]) => `${k}: ${needsQuotes(v) ? JSON.stringify(v) : v}`);
  return `${FENCE}\n${head.join('\n')}\n${FENCE}\n\n${body.trim()}\n`;
}

/** Les valeurs multi-lignes ou commençant par un caractère de structure sont
 *  échappées en JSON — c'est un sur-ensemble sûr des scalaires YAML. */
function needsQuotes(value: string): boolean {
  return /[\n\r]/.test(value) || /^[>|&*!%@`[{#-]/.test(value) || value !== value.trim();
}
