import { withAncestors } from './tree.js';
import type { RouteResult } from './router.js';
import type { ContextTree } from './types.js';

/**
 * Mesurer le routage, au lieu de le retoucher à l'aveugle.
 *
 * Le `load_when`, le prompt du routeur, le format du catalogue, le seuil de
 * court-circuit, le modèle : chacun de ces réglages change ce qui est injecté à
 * chaque appel, et rien ne disait si un changement améliorait ou dégradait quoi
 * que ce soit. Un jeu de prompts réels avec les branches qu'on **attend** donne
 * un chiffre à comparer d'une version à l'autre.
 *
 * Ce n'est pas un test et ça ne doit jamais le devenir : il faut un moteur, la
 * réponse d'un modèle varie, et un échec ici veut dire « le routage s'est
 * dégradé », pas « le code est cassé ». `npm test` reste hermétique ; la mesure
 * est opt-in (`npm run eval`).
 */

export type EvalCase = { prompt: string; expect: string[] };

export type CaseResult = {
  prompt: string;
  /** Attendu et obtenu. */
  hit: string[];
  /** Obtenu sans être attendu — du contexte payé pour rien. */
  extra: string[];
  /** Attendu et manquant — la branche que l'IA n'aura pas. */
  missing: string[];
  /** Attendu mais absent de l'arbre : le fichier d'éval a vieilli. */
  unknown: string[];
  ms: number;
  reason: RouteResult['reason'];
  error?: string;
};

export type EvalReport = {
  cases: CaseResult[];
  /** Part de ce qui a été chargé qui était attendu. */
  precision: number;
  /** Part de ce qui était attendu qui a été chargé. */
  recall: number;
  avgMs: number;
};

/**
 * Lit un fichier d'éval, en écartant ce qui n'a pas la forme.
 *
 * Tolérant, comme le reste : un cas mal écrit se saute, il ne fait pas échouer
 * la mesure des dix-neuf autres.
 */
export function parseEvalCases(raw: unknown): EvalCase[] {
  if (!Array.isArray(raw)) return [];
  const cases: EvalCase[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    const prompt = typeof c['prompt'] === 'string' ? c['prompt'].trim() : '';
    const expect = Array.isArray(c['expect'])
      ? c['expect'].filter((x): x is string => typeof x === 'string')
      : [];
    if (prompt) cases.push({ prompt, expect });
  }
  return cases;
}

/**
 * Route chaque cas et compare, **ancêtres compris** des deux côtés.
 *
 * Un `expect` cite la branche qui compte ; ses parents sont chargés d'office
 * par `withAncestors`, et les compter comme « en trop » ferait mentir le score
 * sur une règle qui n'est pas discutable.
 *
 * Les cas sont routés **en séquence** : un moteur CLI lance un process par
 * appel, et vingt en parallèle mesureraient la machine plutôt que le routeur.
 *
 * Précision et rappel sont **micro-moyennés** — on somme les branches de tous
 * les cas, on ne moyenne pas des taux par cas. Un cas à une seule branche
 * attendue ne pèse pas autant qu'un cas à six, et c'est ce qu'on veut : le
 * score dit ce que coûte une session entière, pas ce que vaut un prompt moyen.
 */
export async function evaluateRouting(
  tree: ContextTree,
  cases: EvalCase[],
  run: (prompt: string) => Promise<RouteResult>,
): Promise<EvalReport> {
  const results: CaseResult[] = [];
  let hits = 0;
  let got = 0;
  let wanted = 0;
  let total = 0;

  for (const c of cases) {
    const unknown = c.expect.filter(p => !tree.branches.has(p));
    const expected = withAncestors(tree, c.expect);
    const started = Date.now();
    let selected = new Set<string>();
    let reason: RouteResult['reason'] = 'fallback';
    let error: string | undefined;
    try {
      const result = await run(c.prompt);
      selected = result.selected;
      reason = result.reason;
      error = result.error;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const ms = Date.now() - started;

    const hit = [...selected].filter(p => expected.has(p));
    results.push({
      prompt: c.prompt,
      hit,
      extra: [...selected].filter(p => !expected.has(p)),
      missing: [...expected].filter(p => !selected.has(p)),
      unknown,
      ms,
      reason,
      ...(error ? { error } : {}),
    });

    hits += hit.length;
    got += selected.size;
    wanted += expected.size;
    total += ms;
  }

  return {
    cases: results,
    precision: got ? hits / got : 0,
    recall: wanted ? hits / wanted : 0,
    avgMs: results.length ? Math.round(total / results.length) : 0,
  };
}
