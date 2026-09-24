-- GoTrue applies app metadata in a separate step on some versions.
-- Final administrator provisioning is therefore an explicit service-role-only operation.
create function public.bootstrap_administrator(target uuid) returns void language plpgsql security definer set search_path = '' as $$
declare u auth.users;
begin
 select * into u from auth.users where id=target;
 if not found or lower(u.email)<>'ursud09@gmail.com' or u.email_confirmed_at is null or coalesce(u.raw_app_meta_data->>'admin_bootstrap','')<>'true' or coalesce(u.encrypted_password,'')='' then raise exception 'INVALID_ADMIN_BOOTSTRAP'; end if;
 update public.profiles set email=lower(u.email),is_admin=true,credits=0,must_change_password=true where id=target;
 insert into private.bootstrap_passwords(user_id,password_hash) values(target,u.encrypted_password) on conflict(user_id) do update set password_hash=excluded.password_hash;
end $$;
revoke all on function public.bootstrap_administrator(uuid) from public,anon,authenticated;
grant execute on function public.bootstrap_administrator(uuid) to service_role;
