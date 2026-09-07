-- contextree — schéma du backend partagé (phase 2, étape 1).
--
-- À appliquer sur un projet Supabase : SQL Editor, ou `supabase db push`.
-- Idempotent : peut être rejoué.
--
-- Trois idées portent tout le reste :
--
--  1. **Une version est un ensemble de branches, pas un blob.** `versions` porte
--     l'instantané, `branches` ses lignes. C'est ce qui permettra à `pull` de
--     dire quelle branche a changé, et à `push` de refuser un conflit sur une
--     branche précise plutôt que sur tout l'arbre.
--  2. **Une version est immuable.** On n'update jamais : on crée une version
--     enfant. `parent_id` porte la filiation — le modèle est git, pas Dropbox,
--     et c'est lui qui rend un conflit détectable.
--  3. **L'autorisation est dans la base, pas dans le client.** Le client n'a que
--     la clé anon, publique par nature : ce sont les politiques RLS qui tiennent.
--     Elles préfigurent la hiérarchie de la phase 4 — un groupe qui gagnerait un
--     `parent_id` étendrait `is_member` sans toucher au reste.

create extension if not exists pgcrypto;

-- ── Comptes ──────────────────────────────────────────────────────────────────
--
-- Les comptes sont ceux de Supabase Auth (`auth.users`). On n'en crée pas
-- d'autres : un profil sert seulement à afficher un nom à côté d'une version.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

-- ── Groupes et appartenance ──────────────────────────────────────────────────

do $$ begin
  create type public.member_role as enum ('owner', 'writer', 'reader');
exception when duplicate_object then null;
end $$;

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null default 'reader',
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists memberships_user_idx on public.memberships (user_id);

-- ── Arbres, versions, branches ───────────────────────────────────────────────

create table if not exists public.trees (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  slug text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (group_id, slug)
);

create table if not exists public.versions (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid not null references public.trees (id) on delete cascade,
  -- La version dont celle-ci descend. `null` = première version de l'arbre.
  -- `restrict` : on ne casse pas une filiation en supprimant un maillon.
  parent_id uuid references public.versions (id) on delete restrict,
  author_id uuid not null references auth.users (id),
  message text,
  -- `root.md` : toujours injecté, jamais routé. Il n'est pas une branche, donc
  -- il vit sur la version.
  root_content text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists versions_tree_idx on public.versions (tree_id, created_at desc);

-- Le point de la carte : une version est un **ensemble de lignes**, pas un blob.
-- Les colonnes reprennent exactement `Branch` côté cœur — le parent vient du
-- chemin, le type du frontmatter, et `load_when` est le signal de routage.
create table if not exists public.branches (
  version_id uuid not null references public.versions (id) on delete cascade,
  path text not null,
  parent_path text,
  type text not null check (type in ('identity', 'rule', 'context', 'reference', 'skill')),
  title text not null,
  load_when text not null,
  content text not null default '',
  primary key (version_id, path)
);

-- ── Qui a le droit ───────────────────────────────────────────────────────────
--
-- `security definer` est obligatoire ici : une politique sur `memberships` qui
-- lirait `memberships` récurserait. La fonction lit la table en contournant RLS,
-- et ne renvoie qu'un booléen sur l'appelant courant.

create or replace function public.is_member(gid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.group_id = gid and m.user_id = auth.uid()
  );
$$;

create or replace function public.can_write(gid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.group_id = gid and m.user_id = auth.uid()
      and m.role in ('owner', 'writer')
  );
$$;

create or replace function public.is_owner(gid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.group_id = gid and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

-- Le groupe d'un arbre, et celui d'une version : les politiques de `versions` et
-- `branches` remontent jusqu'au groupe par ces deux-là.
create or replace function public.tree_group(tid uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select t.group_id from public.trees t where t.id = tid;
$$;

create or replace function public.version_group(vid uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select t.group_id
  from public.versions v
  join public.trees t on t.id = v.tree_id
  where v.id = vid;
$$;

-- Une version est immuable, et ça doit s'entendre.
--
-- L'absence de politique `update` suffirait à empêcher la modification — RLS
-- rendrait l'ordre sans effet — mais silencieusement : zéro ligne touchée, aucun
-- message, un client qui croit avoir réécrit l'histoire. Un déclencheur au
-- niveau de l'ordre, lui, se déclenche même quand aucune ligne ne correspond.
--
-- Seul `update` est traité ainsi. `delete` reste gouverné par RLS (aucune
-- politique, donc aucune ligne) : un déclencheur casserait le `on delete
-- cascade` qui permet de supprimer un arbre entier, cascade qui contourne RLS
-- mais déclenche bien les triggers.

create or replace function public.forbid_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Immuable : crée une version enfant plutôt que de réécrire celle-ci.'
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists versions_immutable on public.versions;
create trigger versions_immutable
  before update on public.versions
  for each statement execute function public.forbid_update();

drop trigger if exists branches_immutable on public.branches;
create trigger branches_immutable
  before update on public.branches
  for each statement execute function public.forbid_update();

-- Créer un groupe fait de son auteur un `owner`. Sans ça, personne ne peut
-- s'ajouter à un groupe qu'il vient de créer : la politique d'insertion sur
-- `memberships` demande d'en être déjà propriétaire.
create or replace function public.claim_new_group()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.memberships (group_id, user_id, role)
  values (new.id, auth.uid(), 'owner');
  return new;
end;
$$;

drop trigger if exists groups_claim_owner on public.groups;
create trigger groups_claim_owner
  after insert on public.groups
  for each row execute function public.claim_new_group();

-- ── Politiques ───────────────────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.memberships enable row level security;
alter table public.trees enable row level security;
alter table public.versions enable row level security;
alter table public.branches enable row level security;

drop policy if exists profiles_read_self on public.profiles;
create policy profiles_read_self on public.profiles
  for select using (id = auth.uid());

drop policy if exists profiles_write_self on public.profiles;
create policy profiles_write_self on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists groups_read on public.groups;
create policy groups_read on public.groups
  for select using (public.is_member(id));

-- Tout compte authentifié peut créer un groupe ; le trigger le rend propriétaire.
drop policy if exists groups_create on public.groups;
create policy groups_create on public.groups
  for insert with check (auth.uid() is not null);

drop policy if exists groups_update on public.groups;
create policy groups_update on public.groups
  for update using (public.is_owner(id)) with check (public.is_owner(id));

drop policy if exists memberships_read on public.memberships;
create policy memberships_read on public.memberships
  for select using (public.is_member(group_id));

drop policy if exists memberships_manage on public.memberships;
create policy memberships_manage on public.memberships
  for all using (public.is_owner(group_id)) with check (public.is_owner(group_id));

drop policy if exists trees_read on public.trees;
create policy trees_read on public.trees
  for select using (public.is_member(group_id));

drop policy if exists trees_write on public.trees;
create policy trees_write on public.trees
  for all using (public.can_write(group_id)) with check (public.can_write(group_id));

-- Une version ne s'update ni ne se supprime : elle est un instantané. Seuls
-- `select` et `insert` ont une politique — le reste est refusé par défaut.
drop policy if exists versions_read on public.versions;
create policy versions_read on public.versions
  for select using (public.is_member(public.tree_group(tree_id)));

drop policy if exists versions_create on public.versions;
create policy versions_create on public.versions
  for insert with check (
    public.can_write(public.tree_group(tree_id)) and author_id = auth.uid()
  );

drop policy if exists branches_read on public.branches;
create policy branches_read on public.branches
  for select using (public.is_member(public.version_group(version_id)));

drop policy if exists branches_create on public.branches;
create policy branches_create on public.branches
  for insert with check (public.can_write(public.version_group(version_id)));
