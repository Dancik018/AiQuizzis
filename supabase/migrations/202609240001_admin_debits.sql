create or replace function public.manage_account(target uuid, extra_credits integer default 0, blocked boolean default null) returns void language plpgsql security definer set search_path = '' as $$
declare balance integer;
begin
 if not public.account_admin() then raise exception 'ADMIN_REQUIRED'; end if;
 if extra_credits is null or extra_credits < -1000 or extra_credits>1000 then raise exception 'INVALID_DATA'; end if;
 select credits into balance from public.profiles where id=target and not is_admin for update;
 if not found then raise exception 'USER_NOT_FOUND'; end if;
 if balance+extra_credits<0 then raise exception 'INSUFFICIENT_CREDITS'; end if;
 update public.profiles set credits=credits+extra_credits,disabled=coalesce(blocked,disabled) where id=target;
 insert into public.credit_events(user_id,actor_id,delta,reason) values(target,auth.uid(),extra_credits,
   case when extra_credits<0 then 'admin_debit' when blocked is null then 'admin_credit' when blocked then 'admin_block' else 'admin_unblock' end);
end $$;
