-- Private, durable scan jobs. Original files never pass through Vercel request bodies.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('quiz-sources','quiz-sources',false,52428800,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict(id) do nothing;
create table public.scan_jobs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 name text not null check(length(name) between 1 and 300),
 size integer not null check(size between 1 and 52428800),
 extension text not null check(extension in ('pdf','docx')),
 study boolean not null default false,
 pages integer not null default 0,
 next_page integer not null default 1,
 status text not null default 'uploading' check(status in ('uploading','processing','complete')),
 lease_token uuid,
 lease_until timestamptz,
 created_at timestamptz not null default now()
);
create index scan_jobs_owner on public.scan_jobs(user_id,created_at);
create table public.scan_chunks (
 job_id uuid not null references public.scan_jobs(id) on delete cascade,
 first_page integer not null,
 last_page integer not null,
 lines jsonb not null check(jsonb_typeof(lines)='array' and octet_length(lines::text)<2000000),
 primary key(job_id,first_page)
);
alter table public.scan_jobs enable row level security;
alter table public.scan_chunks enable row level security;
create policy scan_job_read on public.scan_jobs for select to authenticated
 using(user_id=auth.uid() and public.account_active());
create policy scan_chunks_read on public.scan_chunks for select to authenticated
 using(exists(select 1 from public.scan_jobs j where j.id=job_id and j.user_id=auth.uid()) and public.account_active());
revoke all on public.scan_jobs,public.scan_chunks from anon,authenticated;
grant select on public.scan_jobs,public.scan_chunks to authenticated;
create policy source_read on storage.objects for select to authenticated
 using(bucket_id='quiz-sources' and (storage.foldername(name))[1]=auth.uid()::text and public.account_active());
create policy source_upload on storage.objects for insert to authenticated
 with check(bucket_id='quiz-sources' and (storage.foldername(name))[1]=auth.uid()::text and public.account_active()
 and exists(select 1 from public.scan_jobs j where j.user_id=auth.uid() and j.id::text=(storage.foldername(name))[2] and j.status='uploading'));
create policy source_delete on storage.objects for delete to authenticated
 using(bucket_id='quiz-sources' and (storage.foldername(name))[1]=auth.uid()::text and public.account_active());
create function public.create_scan(file_name text,file_size integer,file_extension text,study_mode boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); p public.profiles; job uuid;
begin
 perform public.assert_account();
 select * into p from public.profiles where id=actor for update;
 if not p.is_admin and p.credits<1 then raise exception 'NO_CREDITS'; end if;
 if (select count(*) from public.scan_jobs where user_id=actor and not exists(select 1 from public.documents d where d.user_id=actor and d.data->>'extractionJob'=scan_jobs.id::text))>=3 then raise exception 'SCAN_LIMIT'; end if;
 insert into public.scan_jobs(user_id,name,size,extension,study) values(actor,file_name,file_size,file_extension,study_mode) returning id into job;
 return job;
end $$;
create function public.claim_scan(job uuid,token uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform public.assert_account();
 update public.scan_jobs set lease_token=token,lease_until=now()+interval '150 seconds'
 where id=job and user_id=auth.uid() and status<>'complete' and (lease_until is null or lease_until<now());
 return found;
end $$;
create function public.save_scan_chunk(job uuid,token uuid,first integer,last integer,total integer,content jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare j public.scan_jobs;
begin
 perform public.assert_account();
 select * into j from public.scan_jobs where id=job and user_id=auth.uid() for update;
 if not found or j.lease_token is distinct from token or j.lease_until<now() then raise exception 'SCAN_LEASE'; end if;
 if first<>j.next_page or last<first or last>total or total>5000 then raise exception 'INVALID_DATA'; end if;
 if exists(select 1 from jsonb_array_elements(content) l where (l->>'page')::integer<first or (l->>'page')::integer>last) then raise exception 'INVALID_DATA'; end if;
 insert into public.scan_chunks values(job,first,last,content);
 update public.scan_jobs set pages=total,next_page=last+1,status=case when last=total then 'complete' else 'processing' end,lease_until=now()+interval '150 seconds' where id=job;
end $$;
create function public.release_scan(job uuid,token uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.scan_jobs set lease_token=null,lease_until=null where id=job and user_id=auth.uid() and lease_token=token;
end $$;
create function public.cancel_scan(job uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.assert_account();
 if exists(select 1 from public.documents where user_id=auth.uid() and data->>'extractionJob'=job::text) then raise exception 'SOURCE_IN_USE'; end if;
 delete from public.scan_jobs where id=job and user_id=auth.uid();
end $$;
revoke all on function public.create_scan(text,integer,text,boolean),public.claim_scan(uuid,uuid),public.save_scan_chunk(uuid,uuid,integer,integer,integer,jsonb),public.release_scan(uuid,uuid),public.cancel_scan(uuid) from public,anon;
grant execute on function public.create_scan(text,integer,text,boolean),public.claim_scan(uuid,uuid),public.save_scan_chunk(uuid,uuid,integer,integer,integer,jsonb),public.release_scan(uuid,uuid),public.cancel_scan(uuid) to authenticated;

-- Preserve the existing credit/version implementation and extend only source validation.
do $migration$
declare definition text; original text;
begin
 select pg_get_functiondef('public.save_document(jsonb,integer)'::regprocedure) into original;
 definition := replace(original, 'perform public.assert_account();', 'perform public.assert_account();
 if payload ? ''extractionJob'' and not exists(select 1 from public.scan_jobs j where j.id::text=payload->>''extractionJob'' and j.user_id=actor and j.status=''complete'' and j.name=payload->>''name'' and payload->''lines''=''[]''::jsonb) then raise exception ''INVALID_DATA''; end if;');
 definition := replace(definition, 'if old.data->''lines'' is distinct from payload->''lines'' or old.data->''name'' is distinct from payload->''name'' then', 'if (old.data->''lines'' is distinct from payload->''lines'' or old.data->''name'' is distinct from payload->''name'') and not (old.data->>''name''=payload->>''name'' and payload ? ''extractionJob'') then');
 if definition=original or position('scan_jobs' in definition)=0 then raise exception 'SCAN_SOURCE_MIGRATION'; end if;
 execute definition;
end $migration$;
