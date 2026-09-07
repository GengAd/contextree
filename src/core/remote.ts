import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { stateDir } from './journal.js';

/**
 * Le backend partagé, sans SDK.
 *
 * Supabase est utilisé comme **service**, pas comme **dépendance** : son API est
 * du HTTP simple (PostgREST pour les données, GoTrue pour l'auth) et Node 20 a
 * `fetch` en global. On n'a besoin ni du temps réel, ni du storage, ni des edge
 * functions — quelques appels REST suffisent. Le projet reste à trois
 * dépendances, et ce fichier se lit d'un bout à l'autre.
 *
 * **Rien ici n'est sur le chemin du routage.** Ni `cmdHook` ni `router.ts`
 * n'importent ce module : le hook ne doit jamais dépendre du réseau, et un
 * backend injoignable ne doit pas pouvoir ralentir un prompt d'une milliseconde.
 *
 * La clé anon est publique par construction — ce sont les politiques RLS du
 * schéma (`supabase/schema.sql`) qui tiennent, pas le secret du client.
 */

/** Au-delà, on abandonne : une commande réseau doit rendre la main. */
const TIMEOUT_MS = Number(process.env['CONTEXTREE_HTTP_TIMEOUT_MS'] ?? 15000);
/** On rafraîchit un peu avant l'expiration, pour ne pas courir après une seconde. */
const REFRESH_MARGIN_S = 60;

export type RemoteConfig = { url: string; anonKey: string };

export type Session = {
  accessToken: string;
  refreshToken: string;
  /** Expiration du jeton d'accès, en secondes epoch. */
  expiresAt: number;
  userId: string;
  email?: string;
};

export type Account = { id: string; email?: string };

export type Group = { id: string; slug: string; name: string; role: string };

export class RemoteError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'RemoteError';
  }
}

// ── Configuration et session sur le disque ───────────────────────────────────

function configFile(): string {
  return path.join(stateDir(), 'config.json');
}

function sessionFile(): string {
  return path.join(stateDir(), 'session.json');
}

/**
 * L'URL du projet et sa clé anon.
 *
 * L'environnement l'emporte sur le fichier : c'est ce qui permet de pointer un
 * projet de test sans toucher à sa configuration.
 */
export async function remoteConfig(): Promise<RemoteConfig> {
  const env = {
    url: process.env['CONTEXTREE_SUPABASE_URL'],
    anonKey: process.env['CONTEXTREE_SUPABASE_ANON_KEY'],
  };
  if (env.url && env.anonKey) return { url: trimSlash(env.url), anonKey: env.anonKey };

  try {
    const raw: unknown = JSON.parse(await fs.readFile(configFile(), 'utf8'));
    const c = raw as Partial<RemoteConfig>;
    if (c?.url && c?.anonKey) return { url: trimSlash(c.url), anonKey: c.anonKey };
  } catch {
    // Pas de fichier, ou illisible : on tombe dans le message ci-dessous.
  }
  throw new RemoteError(
    'Aucun backend configuré. Lance : contextree remote <url> <clé anon>\n' +
      '(ou définis CONTEXTREE_SUPABASE_URL et CONTEXTREE_SUPABASE_ANON_KEY)',
  );
}

/** Renvoie ce qui a été écrit, pas ce qui a été demandé : l'URL est normalisée,
 *  et l'appelant doit afficher la vraie. */
export async function setRemoteConfig(
  config: RemoteConfig,
): Promise<{ file: string; config: RemoteConfig }> {
  const stored: RemoteConfig = { url: trimSlash(config.url), anonKey: config.anonKey };
  const file = configFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
  return { file, config: stored };
}

export async function readSession(): Promise<Session | null> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(sessionFile(), 'utf8'));
    const s = raw as Partial<Session>;
    if (typeof s?.accessToken === 'string' && typeof s.refreshToken === 'string') {
      return s as Session;
    }
  } catch {
    // Pas de session : on n'est pas connecté, ce n'est pas une erreur.
  }
  return null;
}

/** Le jeton est un secret : le fichier est en 0600, et hors du repo. */
async function writeSession(session: Session): Promise<void> {
  const file = sessionFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(session, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.chmod(file, 0o600).catch(() => {});
}

export async function clearSession(): Promise<void> {
  await fs.rm(sessionFile(), { force: true });
}

// ── Auth (GoTrue) ────────────────────────────────────────────────────────────

export async function signIn(email: string, password: string): Promise<Session> {
  const config = await remoteConfig();
  const body = await request<TokenResponse>(config, '/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email, password },
  });
  const session = toSession(body);
  await writeSession(session);
  return session;
}

export async function signOut(): Promise<void> {
  const session = await readSession();
  if (session) {
    try {
      const config = await remoteConfig();
      await request(config, '/auth/v1/logout', { method: 'POST', token: session.accessToken });
    } catch {
      // Le serveur a peut-être déjà oublié la session : on efface la nôtre
      // quand même, sinon on reste coincé connecté à rien.
    }
  }
  await clearSession();
}

/**
 * Une session valide, rafraîchie si besoin.
 *
 * Renvoie `null` quand personne n'est connecté — un appelant doit le dire, pas
 * échouer bizarrement.
 */
export async function currentSession(): Promise<Session | null> {
  const session = await readSession();
  if (!session) return null;
  if (session.expiresAt - REFRESH_MARGIN_S > Math.floor(Date.now() / 1000)) return session;

  const config = await remoteConfig();
  try {
    const body = await request<TokenResponse>(config, '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: { refresh_token: session.refreshToken },
    });
    const refreshed = toSession(body);
    await writeSession(refreshed);
    return refreshed;
  } catch {
    // Jeton de rafraîchissement mort : on nettoie plutôt que de laisser une
    // session fantôme qui échouera à chaque appel.
    await clearSession();
    return null;
  }
}

/** Le compte connecté, ou `null`. */
export async function me(): Promise<Account | null> {
  const session = await currentSession();
  if (!session) return null;
  const config = await remoteConfig();
  const user = await request<{ id: string; email?: string }>(config, '/auth/v1/user', {
    token: session.accessToken,
  });
  return { id: user.id, ...(user.email ? { email: user.email } : {}) };
}

// ── Groupes (PostgREST) ──────────────────────────────────────────────────────

/**
 * Les groupes dont on est membre, avec son rôle.
 *
 * On interroge `memberships` et non `groups` : la ligne d'appartenance porte le
 * rôle, et RLS ne renvoie de toute façon que les siennes.
 */
export async function myGroups(): Promise<Group[]> {
  const session = await requireSession();
  const config = await remoteConfig();
  const rows = await request<{ role: string; groups: { id: string; slug: string; name: string } | null }[]>(
    config,
    '/rest/v1/memberships?select=role,groups(id,slug,name)&order=created_at.asc',
    { token: session.accessToken },
  );
  return rows.flatMap(r =>
    r.groups ? [{ id: r.groups.id, slug: r.groups.slug, name: r.groups.name, role: r.role }] : [],
  );
}

/** Crée un groupe. Un trigger du schéma en fait de son auteur un `owner`. */
export async function createGroup(slug: string, name: string): Promise<Group> {
  const session = await requireSession();
  const config = await remoteConfig();
  const [row] = await request<{ id: string; slug: string; name: string }[]>(
    config,
    '/rest/v1/groups?select=id,slug,name',
    {
      method: 'POST',
      token: session.accessToken,
      body: { slug, name },
      headers: { Prefer: 'return=representation' },
    },
  );
  if (!row) throw new RemoteError('Le groupe a été créé mais le serveur n\'a rien renvoyé.');
  return { ...row, role: 'owner' };
}

// ── Arbres, versions, branches (PostgREST) ───────────────────────────────────

export type RemoteTree = { id: string; groupId: string; slug: string; name: string };
export type RemoteVersion = {
  id: string;
  parentId: string | null;
  message: string | null;
  rootContent: string;
  createdAt: string;
};
export type RemoteBranch = {
  path: string;
  parentPath: string | null;
  type: string;
  title: string;
  loadWhen: string;
  content: string;
};

/** L'arbre `<groupe>/<arbre>`, ou `null`. RLS ne renvoie que ceux qu'on peut voir. */
export async function findTree(groupSlug: string, treeSlug: string): Promise<RemoteTree | null> {
  const session = await requireSession();
  const config = await remoteConfig();
  const rows = await request<{ id: string; group_id: string; slug: string; name: string }[]>(
    config,
    `/rest/v1/trees?select=id,group_id,slug,name,groups!inner(slug)` +
      `&slug=eq.${encodeURIComponent(treeSlug)}&groups.slug=eq.${encodeURIComponent(groupSlug)}`,
    { token: session.accessToken },
  );
  const row = rows[0];
  return row ? { id: row.id, groupId: row.group_id, slug: row.slug, name: row.name } : null;
}

export async function createTree(groupId: string, slug: string, name: string): Promise<RemoteTree> {
  const session = await requireSession();
  const config = await remoteConfig();
  const [row] = await request<{ id: string; group_id: string; slug: string; name: string }[]>(
    config,
    '/rest/v1/trees?select=id,group_id,slug,name',
    {
      method: 'POST',
      token: session.accessToken,
      body: { group_id: groupId, slug, name },
      headers: { Prefer: 'return=representation' },
    },
  );
  if (!row) throw new RemoteError("L'arbre a été créé mais le serveur n'a rien renvoyé.");
  return { id: row.id, groupId: row.group_id, slug: row.slug, name: row.name };
}

/** La version la plus récente d'un arbre, ou `null` s'il est vierge. */
export async function headVersion(treeId: string): Promise<RemoteVersion | null> {
  const session = await requireSession();
  const config = await remoteConfig();
  const rows = await request<RawVersion[]>(
    config,
    `/rest/v1/versions?select=id,parent_id,message,root_content,created_at` +
      `&tree_id=eq.${treeId}&order=created_at.desc&limit=1`,
    { token: session.accessToken },
  );
  return rows[0] ? toVersion(rows[0]) : null;
}

export async function getVersion(versionId: string): Promise<RemoteVersion | null> {
  const session = await requireSession();
  const config = await remoteConfig();
  const rows = await request<RawVersion[]>(
    config,
    `/rest/v1/versions?select=id,parent_id,message,root_content,created_at&id=eq.${versionId}`,
    { token: session.accessToken },
  );
  return rows[0] ? toVersion(rows[0]) : null;
}

export async function versionBranches(versionId: string): Promise<RemoteBranch[]> {
  const session = await requireSession();
  const config = await remoteConfig();
  const rows = await request<
    { path: string; parent_path: string | null; type: string; title: string; load_when: string; content: string }[]
  >(
    config,
    `/rest/v1/branches?select=path,parent_path,type,title,load_when,content` +
      `&version_id=eq.${versionId}&order=path.asc`,
    { token: session.accessToken },
  );
  return rows.map(r => ({
    path: r.path,
    parentPath: r.parent_path,
    type: r.type,
    title: r.title,
    loadWhen: r.load_when,
    content: r.content,
  }));
}

/**
 * Crée une version et ses branches.
 *
 * Deux appels, pas un : PostgREST n'a pas de transaction multi-tables. Si le
 * second échoue, la version reste sans branches — visible comme telle, et sans
 * conséquence puisqu'elle n'a écrasé personne (les versions sont immuables et
 * ne se suppriment pas). L'appelant doit le dire, pas le cacher.
 */
export async function pushVersion(input: {
  treeId: string;
  parentId: string | null;
  message: string;
  rootContent: string;
  branches: RemoteBranch[];
}): Promise<RemoteVersion> {
  const session = await requireSession();
  const config = await remoteConfig();
  const [row] = await request<RawVersion[]>(
    config,
    '/rest/v1/versions?select=id,parent_id,message,root_content,created_at',
    {
      method: 'POST',
      token: session.accessToken,
      body: {
        tree_id: input.treeId,
        parent_id: input.parentId,
        author_id: session.userId,
        message: input.message,
        root_content: input.rootContent,
      },
      headers: { Prefer: 'return=representation' },
    },
  );
  if (!row) throw new RemoteError("La version a été créée mais le serveur n'a rien renvoyé.");

  if (input.branches.length) {
    await request(config, '/rest/v1/branches', {
      method: 'POST',
      token: session.accessToken,
      body: input.branches.map(b => ({
        version_id: row.id,
        path: b.path,
        parent_path: b.parentPath,
        type: b.type,
        title: b.title,
        load_when: b.loadWhen,
        content: b.content,
      })),
      headers: { Prefer: 'return=minimal' },
    });
  }
  return toVersion(row);
}

type RawVersion = {
  id: string;
  parent_id: string | null;
  message: string | null;
  root_content: string;
  created_at: string;
};

function toVersion(r: RawVersion): RemoteVersion {
  return {
    id: r.id,
    parentId: r.parent_id,
    message: r.message,
    rootContent: r.root_content,
    createdAt: r.created_at,
  };
}

export async function requireSession(): Promise<Session> {
  const session = await currentSession();
  if (!session) throw new RemoteError('Personne n\'est connecté. Lance : contextree login');
  return session;
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  user?: { id: string; email?: string };
};

type RequestOptions = {
  method?: string;
  body?: unknown;
  token?: string;
  headers?: Record<string, string>;
};

/**
 * Un appel, avec la clé anon, un délai maximum, et un message d'erreur lisible.
 *
 * Supabase répond ses erreurs en JSON sous plusieurs formes selon le service
 * (`message`, `error_description`, `msg`, `hint`) : on les aplatit ici plutôt
 * que de laisser remonter un « 400 » nu.
 */
async function request<T>(config: RemoteConfig, route: string, opts: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${config.url}${route}`, {
      method: opts.method ?? 'GET',
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${opts.token ?? config.anonKey}`,
        ...(opts.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...opts.headers,
      },
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
      signal: controller.signal,
    });

    const raw = await response.text();
    const parsed: unknown = raw ? safeJson(raw) : null;
    if (!response.ok) {
      throw new RemoteError(errorMessage(parsed, raw, response.status), response.status);
    }
    return parsed as T;
  } catch (err) {
    if (err instanceof RemoteError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new RemoteError(`Le backend n'a pas répondu en ${TIMEOUT_MS} ms.`);
    }
    throw new RemoteError(`Backend injoignable : ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function errorMessage(parsed: unknown, raw: string, status: number): string {
  const o = (parsed ?? {}) as Record<string, unknown>;
  const fields = ['message', 'error_description', 'msg', 'error', 'hint'];
  for (const f of fields) {
    if (typeof o[f] === 'string' && o[f]) return `${o[f] as string} (HTTP ${status})`;
  }
  return `HTTP ${status}${raw ? ` — ${raw.slice(0, 200)}` : ''}`;
}

function toSession(body: TokenResponse): Session {
  const expiresAt =
    body.expires_at ?? Math.floor(Date.now() / 1000) + (body.expires_in ?? 3600);
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt,
    userId: body.user?.id ?? '',
    ...(body.user?.email ? { email: body.user.email } : {}),
  };
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
