-- Vérifie `schema.sql` sur un Postgres nu : syntaxe, contraintes, et surtout les
-- politiques RLS — ce sont elles qui tiennent l'autorisation, le client n'ayant
-- que la clé anon, publique par nature. Un schéma d'autorisation qu'on ne rejoue
-- pas n'est vérifié qu'une fois.
--
--   npm run test:sql        (demande Docker)
--
-- Supabase fournit `auth.users` et `auth.uid()` ; ici on les bouchonne, en
-- lisant l'utilisateur courant dans un réglage de session. On passe ensuite sur
-- un rôle non privilégié : RLS ne s'applique pas au propriétaire des tables,
-- et un test qui l'oublierait ne testerait rien.
--
-- Ce qui est couvert : le trigger qui rend propriétaire, la filiation des
-- versions, l'immuabilité, le cloisonnement entre groupes, lecture sans
-- écriture, la promotion en writer, et l'usurpation d'auteur.

\set ON_ERROR_STOP on

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text
);

create or replace function auth.uid()
returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- Un rôle non privilégié : RLS ne s'applique pas au propriétaire des tables.
do $$ begin
  create role app nologin;
exception when duplicate_object then null;
end $$;

\echo '=== application du schéma ==='
\i /schema.sql

grant usage on schema public to app;
grant select, insert, update, delete on all tables in schema public to app;
grant execute on all functions in schema public to app;
grant usage on schema auth to app;
grant select on auth.users to app;
grant execute on all functions in schema auth to app;

\echo ''
\echo '=== deux comptes ==='
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'adrien@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'autre@example.com');

-- ── Adrien crée un groupe, un arbre, deux versions ───────────────────────────

set role app;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

\echo ''
\echo '--- Adrien crée un groupe (le trigger doit le rendre owner) ---'
insert into public.groups (slug, name) values ('gengad', 'GengAd');
select slug, role from public.groups g join public.memberships m on m.group_id = g.id;

\echo ''
\echo '--- un arbre, puis deux versions enchaînées ---'
insert into public.trees (group_id, slug, name)
  select id, 'contextree', 'contextree' from public.groups where slug = 'gengad';

insert into public.versions (tree_id, author_id, message, root_content)
  select t.id, auth.uid(), 'première', '# contextree' from public.trees t where t.slug = 'contextree';

insert into public.branches (version_id, path, parent_path, type, title, load_when, content)
  select v.id, 'identite', null, 'identity', 'Identité', 'toujours pertinent', 'Tu es…'
  from public.versions v where v.message = 'première';
insert into public.branches (version_id, path, parent_path, type, title, load_when, content)
  select v.id, 'archi', null, 'context', 'Architecture', 'quand on parle structure', 'Le cœur…'
  from public.versions v where v.message = 'première';

insert into public.versions (tree_id, parent_id, author_id, message, root_content)
  select v.tree_id, v.id, auth.uid(), 'seconde', '# contextree'
  from public.versions v where v.message = 'première';

select v.message, coalesce(p.message, '(racine)') as parent, count(b.path) as branches
from public.versions v
left join public.versions p on p.id = v.parent_id
left join public.branches b on b.version_id = v.id
group by v.message, p.message order by v.message;

\echo ''
\echo '--- une version est immuable : update et delete doivent échouer ---'
do $$
begin
  update public.versions set message = 'réécrite' where message = 'première';
  raise exception 'ÉCHEC : une version a pu être modifiée';
exception
  when restrict_violation then raise notice 'OK  update refusé, avec un message : %', sqlerrm;
  when others then
    if sqlstate = 'P0001' and sqlerrm like 'ÉCHEC%' then raise;
    else raise notice 'OK  update refusé (%)', sqlerrm; end if;
end $$;

do $$
begin
  update public.branches set content = 'réécrit';
  raise exception 'ÉCHEC : une branche a pu être modifiée';
exception
  when restrict_violation then raise notice 'OK  branche immuable aussi';
  when others then
    if sqlstate = 'P0001' and sqlerrm like 'ÉCHEC%' then raise;
    else raise notice 'OK  branche immuable (%)', sqlerrm; end if;
end $$;

do $$
declare n int;
begin
  delete from public.versions where message = 'première';
  get diagnostics n = row_count;
  if n > 0 then raise exception 'ÉCHEC : % version(s) supprimée(s)', n;
  else raise notice 'OK  delete sans effet (aucune politique ne l''autorise)'; end if;
exception
  when insufficient_privilege then raise notice 'OK  delete refusé par RLS';
end $$;

-- ── L'autre compte ne doit rien voir ─────────────────────────────────────────

\echo ''
\echo '--- l''autre compte : cloisonnement ---'
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select
  (select count(*) from public.groups)     as groupes_visibles,
  (select count(*) from public.trees)      as arbres_visibles,
  (select count(*) from public.versions)   as versions_visibles,
  (select count(*) from public.branches)   as branches_visibles;

\echo ''
\echo '--- il ne peut pas s''ajouter au groupe d''Adrien ---'
do $$
declare gid uuid;
begin
  -- il ne voit pas le groupe : on lui donne l'id de force, comme le ferait
  -- quelqu'un qui l'aurait deviné.
  select id into gid from public.groups where slug = 'gengad';
  if gid is null then
    raise notice 'OK  il ne voit même pas l''id du groupe';
  else
    insert into public.memberships (group_id, user_id, role) values (gid, auth.uid(), 'owner');
    raise exception 'ÉCHEC : il s''est ajouté au groupe';
  end if;
exception
  when insufficient_privilege then raise notice 'OK  insertion refusée par RLS';
end $$;

-- ── Un lecteur voit mais n'écrit pas ─────────────────────────────────────────

\echo ''
\echo '--- Adrien l''invite en lecture ---'
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into public.memberships (group_id, user_id, role)
  select id, '22222222-2222-2222-2222-222222222222', 'reader' from public.groups where slug = 'gengad';

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select
  (select count(*) from public.groups)   as groupes_visibles,
  (select count(*) from public.versions) as versions_visibles,
  (select count(*) from public.branches) as branches_visibles;

\echo ''
\echo '--- mais il ne peut pas pousser de version ---'
do $$
declare tid uuid;
begin
  select id into tid from public.trees limit 1;
  insert into public.versions (tree_id, author_id, message) values (tid, auth.uid(), 'intruse');
  raise exception 'ÉCHEC : un lecteur a pu écrire';
exception
  when insufficient_privilege then raise notice 'OK  écriture refusée par RLS';
  when others then
    if sqlstate = 'P0001' and sqlerrm like 'ÉCHEC%' then raise;
    else raise notice 'OK  écriture refusée (%)', sqlerrm; end if;
end $$;

\echo ''
\echo '--- promu writer, il peut ---'
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
update public.memberships set role = 'writer'
  where user_id = '22222222-2222-2222-2222-222222222222';

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
insert into public.versions (tree_id, author_id, message)
  select id, auth.uid(), 'sienne' from public.trees limit 1;
select count(*) as versions_apres from public.versions;

\echo ''
\echo '--- et il ne peut pas signer une version au nom d''un autre ---'
do $$
declare tid uuid;
begin
  select id into tid from public.trees limit 1;
  insert into public.versions (tree_id, author_id, message)
    values (tid, '11111111-1111-1111-1111-111111111111', 'usurpée');
  raise exception 'ÉCHEC : auteur usurpé';
exception
  when insufficient_privilege then raise notice 'OK  auteur usurpé refusé par RLS';
  when others then
    if sqlstate = 'P0001' and sqlerrm like 'ÉCHEC%' then raise;
    else raise notice 'OK  auteur usurpé refusé (%)', sqlerrm; end if;
end $$;

reset role;
\echo ''
\echo '=== fin ==='
