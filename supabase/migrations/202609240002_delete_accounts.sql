-- Only an active administrator can permanently remove a non-admin account.
alter table public.credit_events drop constraint credit_events_actor_id_fkey;
alter table public.credit_events add constraint credit_events_actor_id_fkey
 foreign key (actor_id) references public.profiles(id) on delete set null;
create function public.delete_account(target uuid, confirmed_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare victim public.profiles;
begin
 if not public.account_admin() then raise exception 'ADMIN_REQUIRED'; end if;
 select * into victim from public.profiles where id=target for update;
 if not found then raise exception 'USER_NOT_FOUND'; end if;
 if victim.is_admin or target=auth.uid() then raise exception 'ADMIN_PROTECTED'; end if;
 if confirmed_email is null or lower(trim(confirmed_email))<>lower(victim.email) then
   raise exception 'DELETE_CONFIRMATION';
 end if;
 delete from private.bootstrap_passwords where user_id=target;
 -- Auth identities/sessions and account-owned application data cascade atomically.
 delete from auth.users where id=target;
 if not found then raise exception 'USER_NOT_FOUND'; end if;
end $$;
revoke all on function public.delete_account(uuid,text) from public,anon;
grant execute on function public.delete_account(uuid,text) to authenticated;
