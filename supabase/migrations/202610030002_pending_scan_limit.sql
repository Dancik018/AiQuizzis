-- Completed scans hidden from the upload area must not count as unfinished work.
create or replace function public.create_scan(file_name text,file_size integer,file_extension text,study_mode boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); p public.profiles; job uuid;
begin
 perform public.assert_account();
 select * into p from public.profiles where id=actor for update;
 if not p.is_admin and p.credits<1 then raise exception 'NO_CREDITS'; end if;
 if (select count(*) from public.scan_jobs where user_id=actor and status<>'complete' and not exists(select 1 from public.documents d where d.user_id=actor and d.data->>'extractionJob'=scan_jobs.id::text))>=3 then raise exception 'SCAN_LIMIT'; end if;
 insert into public.scan_jobs(user_id,name,size,extension,study) values(actor,file_name,file_size,file_extension,study_mode) returning id into job;
 return job;
end $$;
