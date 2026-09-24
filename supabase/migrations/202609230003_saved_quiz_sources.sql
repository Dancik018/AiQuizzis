-- Existing private quiz snapshots remain playable after source deletion.
create or replace function public.save_quiz(payload jsonb, expected_version integer default 0) returns integer language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); old public.quiz_sessions; session_id text:=payload->>'id'; v integer;
begin
 perform public.assert_account();
 if session_id is null or length(session_id) not between 1 and 100 or jsonb_typeof(payload->'questions') is distinct from 'array' then raise exception 'INVALID_DATA'; end if;
 if jsonb_array_length(payload->'questions')>5000 or octet_length(payload::text)>3500000 then raise exception 'TOO_LARGE'; end if;
 if exists(select 1 from jsonb_array_elements(payload->'questions') q where not exists(select 1 from public.documents d where d.user_id=actor and d.id=q->>'documentId') and not exists(select 1 from public.quiz_sessions s, jsonb_array_elements(s.data->'questions') saved where s.user_id=actor and saved->>'documentId'=q->>'documentId' and saved->>'id'=q->>'id')) then raise exception 'DOCUMENT_NOT_FOUND'; end if;
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
