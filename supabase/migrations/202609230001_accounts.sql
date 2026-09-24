
-- Run once in the existing Supabase project's SQL editor or through supabase db push.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 email text not null,
 is_admin boolean not null default false,
 credits integer not null default 2 check (credits >= 0),
 disabled boolean not null default false,
 must_change_password boolean not null default false,
 created_at timestamptz not null default now()
);
create table private.bootstrap_passwords (user_id uuid primary key, password_hash text not null);
create table public.documents (
 user_id uuid not null references public.profiles(id) on delete cascade,
 id text not null check (length(id) between 1 and 100),
 data jsonb not null,
 ai_remaining integer not null check(ai_remaining >= 0),
 version integer not null default 1,
 updated_at timestamptz not null default now(),
 primary key(user_id,id)
);
create table public.quiz_sessions (
 user_id uuid not null references public.profiles(id) on delete cascade,
 id text not null check (length(id) between 1 and 100),
 data jsonb not null,
 version integer not null default 1,
 updated_at timestamptz not null default now(),
 primary key(user_id,id)
);
create table public.credit_events (
 id bigint generated always as identity primary key,
 user_id uuid not null references public.profiles(id) on delete cascade,
 actor_id uuid references public.profiles(id),
 delta integer not null,
 reason text not null,
 document_id text,
 created_at timestamptz not null default now()
);
create function public.provision_profile() returns trigger language plpgsql security definer set search_path = '' as $$
declare admin_seed boolean := lower(new.email) = 'ursud09@gmail.com' and coalesce(new.raw_app_meta_data->>'admin_bootstrap','') = 'true';
begin
 if lower(new.email) = 'ursud09@gmail.com' and not admin_seed then raise exception 'RESERVED_ACCOUNT'; end if;
 insert into public.profiles(id,email,is_admin,credits,must_change_password)
 values(new.id,lower(new.email),admin_seed,case when admin_seed then 0 else 2 end,admin_seed);
 if admin_seed then
   insert into private.bootstrap_passwords values(new.id,new.encrypted_password);
 else
   insert into public.credit_events(user_id,delta,reason) values(new.id,2,'welcome');
 end if;
 return new;
end $$;
create trigger provision_profile after insert on auth.users for each row execute function public.provision_profile();
create function public.account_active() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=auth.uid() and not p.disabled and not p.must_change_password and u.email_confirmed_at is not null);
$$;
create function public.account_admin() returns boolean language sql stable security definer set search_path = '' as $$
 select public.account_active() and exists(select 1 from public.profiles where id=auth.uid() and is_admin);
$$;
create function public.assert_account() returns void language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 if not public.account_active() then raise exception 'ACCOUNT_BLOCKED'; end if;
end $$;
alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.quiz_sessions enable row level security;
alter table public.credit_events enable row level security;
create policy profile_read on public.profiles for select to authenticated using(id=auth.uid() or public.account_admin());
create policy document_read on public.documents for select to authenticated using(user_id=auth.uid() and public.account_active());
create policy session_read on public.quiz_sessions for select to authenticated using(user_id=auth.uid() and public.account_active());
create policy credit_read on public.credit_events for select to authenticated using((user_id=auth.uid() and public.account_active()) or public.account_admin());
revoke all on public.profiles,public.documents,public.quiz_sessions,public.credit_events from anon,authenticated;
grant select on public.profiles,public.documents,public.quiz_sessions,public.credit_events to authenticated;

create function public.save_document(payload jsonb, expected_version integer default 0) returns integer language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); profile public.profiles; old public.documents; doc_id text:=payload->>'id'; v integer; amount integer;
begin
 perform public.assert_account();
 if doc_id is null or length(doc_id) not between 1 and 100 or jsonb_typeof(payload->'questions') is distinct from 'array' or jsonb_typeof(payload->'lines') is distinct from 'array' then raise exception 'INVALID_DATA'; end if;
 amount:=jsonb_array_length(payload->'questions');
 if amount>5000 or octet_length(payload::text)>3500000 then raise exception 'TOO_LARGE'; end if;
 -- Lock the account: concurrent tabs cannot spend the same last credit twice.
 select * into profile from public.profiles where id=actor for update;
 select * into old from public.documents where user_id=actor and id=doc_id for update;
 if found then
   if old.version<>expected_version then raise exception 'WRITE_CONFLICT'; end if;
   if old.data->'lines' is distinct from payload->'lines' or old.data->'name' is distinct from payload->'name' then raise exception 'SOURCE_IMMUTABLE'; end if;
   update public.documents set data=payload,version=version+1,updated_at=now() where user_id=actor and id=doc_id returning version into v;
 else
   if expected_version<>0 then raise exception 'WRITE_CONFLICT'; end if;
   if not profile.is_admin and profile.credits<1 then raise exception 'NO_CREDITS'; end if;
   if not profile.is_admin then
     update public.profiles set credits=credits-1 where id=actor;
     insert into public.credit_events(user_id,actor_id,delta,reason,document_id) values(actor,actor,-1,'document',doc_id);
   end if;
   insert into public.documents(user_id,id,data,ai_remaining) values(actor,doc_id,payload,greatest(200,amount*10+200)) returning version into v;
 end if;
 return v;
end $$;
create function public.delete_document(doc_id text) returns void language plpgsql security definer set search_path = '' as $$
begin
 perform public.assert_account();
 delete from public.documents where user_id=auth.uid() and id=doc_id;
 -- Deletion deliberately never refunds a used generation credit.
end $$;
create function public.save_quiz(payload jsonb, expected_version integer default 0) returns integer language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); old public.quiz_sessions; session_id text:=payload->>'id'; v integer;
begin
 perform public.assert_account();
 if session_id is null or length(session_id) not between 1 and 100 or jsonb_typeof(payload->'questions') is distinct from 'array' then raise exception 'INVALID_DATA'; end if;
 if jsonb_array_length(payload->'questions')>5000 or octet_length(payload::text)>3500000 then raise exception 'TOO_LARGE'; end if;
 if exists(select 1 from jsonb_array_elements(payload->'questions') q where not exists(select 1 from public.documents d where d.user_id=actor and d.id=q->>'documentId')) then raise exception 'DOCUMENT_NOT_FOUND'; end if;
 perform 1 from public.profiles where id=actor for update;
 select * into old from public.quiz_sessions where user_id=actor and id=session_id for update;
 if found then
   if old.version<>expected_version then raise exception 'WRITE_CONFLICT'; end if;
   update public.quiz_sessions set data=payload,version=version+1,updated_at=now() where user_id=actor and id=session_id returning version into v;
 else
   if expected_version<>0 then raise exception 'WRITE_CONFLICT'; end if;
   insert into public.quiz_sessions(user_id,id,data) values(actor,session_id,payload) returning version into v;
 end if;
 return v;
end $$;
create function public.claim_ai(doc_id text, units integer) returns void language plpgsql security definer set search_path = '' as $$
declare d public.documents;
begin
 perform public.assert_account();
 if units<1 or units>100 then raise exception 'INVALID_DATA'; end if;
 select * into d from public.documents where user_id=auth.uid() and id=doc_id for update;
 if not found then raise exception 'DOCUMENT_NOT_FOUND'; end if;
 if public.account_admin() then return; end if;
 if d.ai_remaining<units then raise exception 'DOCUMENT_AI_LIMIT'; end if;
 update public.documents set ai_remaining=ai_remaining-units where user_id=auth.uid() and id=doc_id;
end $$;
create function public.manage_account(target uuid, extra_credits integer default 0, blocked boolean default null) returns void language plpgsql security definer set search_path = '' as $$
begin
 if not public.account_admin() then raise exception 'ADMIN_REQUIRED'; end if;
 if extra_credits<0 or extra_credits>1000 then raise exception 'INVALID_DATA'; end if;
 perform 1 from public.profiles where id=target and not is_admin for update;
 if not found then raise exception 'USER_NOT_FOUND'; end if;
 update public.profiles set credits=credits+extra_credits,disabled=coalesce(blocked,disabled) where id=target;
 insert into public.credit_events(user_id,actor_id,delta,reason) values(target,auth.uid(),extra_credits,
   case when blocked is null then 'admin_credit' when blocked then 'admin_block' else 'admin_unblock' end);
end $$;
create function public.finish_password_change() returns void language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 if exists(select 1 from private.bootstrap_passwords b join auth.users u on u.id=b.user_id where b.user_id=auth.uid() and b.password_hash=u.encrypted_password) then raise exception 'PASSWORD_CHANGE_REQUIRED'; end if;
 update public.profiles set must_change_password=false where id=auth.uid();
 delete from private.bootstrap_passwords where user_id=auth.uid();
end $$;
revoke all on function public.provision_profile() from public,anon,authenticated;
revoke all on function public.account_active(),public.account_admin(),public.assert_account(),public.save_document(jsonb,integer),public.delete_document(text),public.save_quiz(jsonb,integer),public.claim_ai(text,integer),public.manage_account(uuid,integer,boolean),public.finish_password_change() from public,anon;
grant execute on function public.account_active(),public.account_admin(),public.assert_account(),public.save_document(jsonb,integer),public.delete_document(text),public.save_quiz(jsonb,integer),public.claim_ai(text,integer),public.manage_account(uuid,integer,boolean),public.finish_password_change() to authenticated;
