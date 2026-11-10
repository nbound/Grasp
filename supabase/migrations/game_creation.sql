begin;

-- Existing teachers remain enrolled. Future Auth users need a trusted enrollment.
create or replace function private.sync_teacher()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_anonymous is false and new.email is not null
     and (new.raw_app_meta_data->>'grasp_role' = 'teacher'
          or exists(select 1 from public.teachers where id=new.id)) then
    insert into public.teachers(id,email,display_name)
    values(new.id,new.email,left(new.raw_user_meta_data->>'display_name',80))
    on conflict(id) do update set email=excluded.email;
  end if;
  return new;
end $$;
drop trigger on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert or update of email,is_anonymous,raw_app_meta_data
  on auth.users for each row execute function private.sync_teacher();

alter table public.quizzes add column archived boolean not null default false,
  add column revision integer not null default 0,
  add column timer_enabled boolean not null default false,
  add column feedback_mode text not null default 'after_question' check(feedback_mode in ('instant','after_question','end')),
  add column game_mode text not null default 'team' check(game_mode in ('team','duel','free_for_all'));
grant update(archived) on public.quizzes to authenticated;

create function public.save_quiz(p_id uuid, p_revision integer, p_quiz jsonb, p_questions jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_question jsonb; v_position integer:=0; v_revision integer;
begin
  if not private.is_teacher() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if jsonb_typeof(p_questions) is distinct from 'array' or jsonb_array_length(p_questions) not between 1 and 100 then
    raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  if p_id is null then
    insert into public.quizzes(teacher_id,title) values(auth.uid(),p_quiz->>'title') returning id into v_id;
  else
    select id,revision into v_id,v_revision from public.quizzes where id=p_id and teacher_id=auth.uid() for update;
    if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
    if v_revision is distinct from p_revision then raise exception 'STALE_VERSION' using errcode='P0001'; end if;
    if exists(select 1 from public.game_sessions where quiz_id=v_id) then raise exception 'QUIZ_HOSTED' using errcode='P0001'; end if;
  end if;
  update public.quizzes set title=p_quiz->>'title',description=coalesce(p_quiz->>'description',''),
    timer_enabled=coalesce((p_quiz->>'timer_enabled')::boolean,false),
    feedback_mode=coalesce(p_quiz->>'feedback_mode','after_question'),
    game_mode=coalesce(p_quiz->>'game_mode','team'),revision=revision+1 where id=v_id;
  delete from public.questions where quiz_id=v_id;
  for v_question in select value from jsonb_array_elements(p_questions) loop
    if jsonb_array_length(v_question->'choices') <> 4 then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
    insert into public.questions(quiz_id,position,prompt,choices,correct_index,explanation,points,time_limit_seconds)
    values(v_id,v_position,v_question->>'prompt',v_question->'choices',(v_question->>'correct_index')::integer,
      coalesce(v_question->>'explanation',''),coalesce((v_question->>'points')::integer,1000),
      (v_question->>'time_limit_seconds')::integer);
    v_position:=v_position+1;
  end loop;
  return v_id;
end $$;
revoke all on function public.save_quiz(uuid,integer,jsonb,jsonb) from public,anon;
grant execute on function public.save_quiz(uuid,integer,jsonb,jsonb) to authenticated;

alter table public.game_sessions add column phase text not null default 'lobby' check(phase in ('lobby','question','feedback','results')),
  add column revision integer not null default 0,
  add column question_started_at timestamptz,
  add column deadline timestamptz,
  add column timer_enabled boolean not null default false,
  add column feedback_mode text not null default 'after_question' check(feedback_mode in ('instant','after_question','end')),
  add column game_mode text not null default 'team' check(game_mode in ('team','duel','free_for_all')),
  add column request_id uuid,
  add constraint sessions_host_request_key unique(host_id,request_id);
grant insert(request_id) on public.game_sessions to authenticated;
-- Preserve previously finished sessions and put legacy active sessions at a
-- resumable boundary. No previous question deadline was authoritative.
update public.game_sessions set phase=case status when 'finished' then 'results' when 'active' then 'feedback' else 'lobby' end;
alter table public.answers add column attempts integer not null default 1 check(attempts=1),
  add column request_id uuid;
alter table public.players add column streak integer not null default 0 check(streak>=0);

create or replace function private.initialize_session()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_quiz public.quizzes%rowtype;
begin
  select * into v_quiz from public.quizzes where id=new.quiz_id for update;
  if v_quiz.archived then raise exception 'QUIZ_ARCHIVED' using errcode='P0001'; end if;
  new.timer_enabled:=v_quiz.timer_enabled;
  new.feedback_mode:=v_quiz.feedback_mode;
  new.game_mode:=v_quiz.game_mode;
  if new.game_mode='duel' then new.max_players:=2; new.team_count:=2; end if;
  return new;
end $$;

-- Students use audience-filtered server snapshots. Raw scores/answers would leak
-- delayed correctness through direct PostgREST queries, regardless of UI guards.
drop policy answers_read on public.answers;
create policy answers_read on public.answers for select to authenticated using(private.owns_session(session_id));
drop policy players_read on public.players;
create policy players_read on public.players for select to authenticated using(private.owns_session(session_id));

-- Only the trusted server can execute this transaction, using an Auth-verified UID.
-- Session row locks serialize answer/phase races; all state and points commit together.
create function public.game_command(p_user uuid,p_session uuid,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.game_sessions%rowtype; p public.players%rowtype; q public.questions%rowtype;
  a public.answers%rowtype; v_choice integer; v_correct boolean; v_next integer; v_count integer;
begin
  select * into s from public.game_sessions where id=p_session for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0001'; end if;
  if p_action='expire' then
    if s.status='finished' then return '{}'::jsonb; end if;
    if s.expires_at<=clock_timestamp() then
      update public.game_sessions set status='finished',phase='results',finished_at=clock_timestamp(),deadline=null,revision=revision+1 where id=s.id;
    elsif s.phase='question' and s.deadline<=clock_timestamp() then
      update public.players set streak=0 where session_id=s.id and not exists(select 1 from public.answers ans join public.questions que on que.id=ans.question_id where ans.player_id=players.id and que.position=(select position from public.questions where quiz_id=s.quiz_id order by position limit 1 offset s.current_question_index));
      update public.game_sessions set phase='feedback',deadline=null,revision=revision+1 where id=s.id;
    end if;
    return '{}'::jsonb;
  end if;
  if p_action='answer' then
    select * into p from public.players where session_id=s.id and user_id=p_user;
    if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
    select * into a from public.answers where player_id=p.id and question_id=(p_payload->>'questionId')::uuid;
    if found then
      if a.selected_index is distinct from (p_payload->>'choice')::integer then raise exception 'ALREADY_ANSWERED' using errcode='P0001'; end if;
      return jsonb_build_object('accepted',true,'duplicate',true);
    end if;
    if s.phase<>'question' or s.expires_at<=clock_timestamp() or s.deadline<=clock_timestamp() then
      raise exception 'ANSWER_CLOSED' using errcode='P0001'; end if;
    select * into q from public.questions where quiz_id=s.quiz_id order by position limit 1 offset s.current_question_index;
    if q.id is distinct from (p_payload->>'questionId')::uuid then raise exception 'WRONG_QUESTION' using errcode='P0001'; end if;
    v_choice:=(p_payload->>'choice')::integer;
    if v_choice is null or v_choice<0 or v_choice>=jsonb_array_length(q.choices) then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
    v_correct:=v_choice=q.correct_index;
    insert into public.answers(session_id,quiz_id,player_id,question_id,selected_index,is_correct,points_awarded,response_ms,request_id)
    values(s.id,s.quiz_id,p.id,q.id,v_choice,v_correct,case when v_correct then q.points else 0 end,
      least(2147483647,greatest(0,extract(epoch from (clock_timestamp()-s.question_started_at))*1000))::integer,
      (p_payload->>'requestId')::uuid);
    update public.players set score=score+case when v_correct then q.points else 0 end,
      streak=case when v_correct then streak+1 else 0 end where id=p.id;
    insert into public.study_days(user_id,day) values(p_user,(clock_timestamp() at time zone 'UTC')::date) on conflict do nothing;
    update public.game_sessions set revision=revision+1 where id=s.id;
    return jsonb_build_object('accepted',true,'duplicate',false);
  end if;
  if p_user is distinct from s.host_id or not exists(select 1 from public.teachers t join auth.users u on u.id=t.id where t.id=p_user and u.is_anonymous=false) then
    raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if (p_payload->>'revision')::integer is distinct from s.revision then raise exception 'STALE_VERSION' using errcode='P0001'; end if;
  if s.expires_at<=clock_timestamp() then raise exception 'SESSION_CLOSED' using errcode='P0001'; end if;
  if p_action='end' and s.phase<>'results' then
    update public.game_sessions set phase='results',status='finished',finished_at=clock_timestamp(),deadline=null,revision=revision+1 where id=s.id;
  elsif p_action='reveal' and s.phase='question' then
    update public.players set streak=0 where session_id=s.id and not exists(select 1 from public.answers ans join public.questions que on que.id=ans.question_id where ans.player_id=players.id and que.position=(select position from public.questions where quiz_id=s.quiz_id order by position limit 1 offset s.current_question_index));
    update public.game_sessions set phase='feedback',deadline=null,revision=revision+1 where id=s.id;
  elsif (p_action='start' and s.phase='lobby') or (p_action='next' and s.phase='feedback') then
    select count(*) into v_count from public.players where session_id=s.id;
    if v_count=0 or (s.game_mode='duel' and v_count<>2) then raise exception 'NEED_PLAYERS' using errcode='P0001'; end if;
    v_next:=s.current_question_index+1;
    select * into q from public.questions where quiz_id=s.quiz_id order by position limit 1 offset v_next;
    if not found then
      if s.phase='lobby' then raise exception 'EMPTY_QUIZ' using errcode='P0001'; end if;
      update public.game_sessions set phase='results',status='finished',finished_at=clock_timestamp(),deadline=null,revision=revision+1 where id=s.id;
    else
      update public.game_sessions set phase='question',status='active',current_question_index=v_next,
        question_started_at=clock_timestamp(),deadline=case when s.timer_enabled then clock_timestamp()+make_interval(secs=>coalesce(q.time_limit_seconds,30)) else null end,
        revision=revision+1 where id=s.id;
    end if;
  else raise exception 'INVALID_PHASE' using errcode='P0001'; end if;
  return '{}'::jsonb;
end $$;
revoke all on function public.game_command(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.game_command(uuid,uuid,text,jsonb) to service_role;

-- One statement gives a consistent snapshot even while another answer commits.
create function public.game_data(p_session uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('session',to_jsonb(s),'quiz',to_jsonb(q),
  'questions',coalesce((select jsonb_agg(x order by x.position) from public.questions x where x.quiz_id=s.quiz_id),'[]'::jsonb),
  'players',coalesce((select jsonb_agg(x order by x.joined_at) from public.players x where x.session_id=s.id),'[]'::jsonb),
  'teams',coalesce((select jsonb_agg(x order by x.team_number) from public.teams x where x.session_id=s.id),'[]'::jsonb),
  'answers',coalesce((select jsonb_agg(x) from public.answers x where x.session_id=s.id),'[]'::jsonb))
 from public.game_sessions s join public.quizzes q on q.id=s.quiz_id where s.id=p_session
$$;
revoke all on function public.game_data(uuid) from public,anon,authenticated;
grant execute on function public.game_data(uuid) to service_role;

create table public.practice_sets(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  questions jsonb not null, difficulty integer not null check(difficulty between 1 and 3), created_at timestamptz not null default now()
);
create table public.practice_answers(
  set_id uuid not null references public.practice_sets(id) on delete cascade, position integer not null,
  selected_index integer not null, is_correct boolean not null, created_at timestamptz not null default now(),
  primary key(set_id,position)
);
create table public.cosmetics(
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'forest' check(theme in ('forest','ocean','sunset')),
  avatar text not null default 'seed' check(avatar in ('seed','leaf','tree'))
);
create table public.study_days(user_id uuid not null references auth.users(id) on delete cascade,day date not null,primary key(user_id,day));
alter table public.study_days enable row level security;
revoke all on public.study_days from public,anon,authenticated;
grant all on public.study_days to service_role;
insert into public.study_days(user_id,day)
select distinct p.user_id,(a.created_at at time zone 'UTC')::date from public.answers a join public.players p on p.id=a.player_id
on conflict do nothing;
alter table public.practice_sets enable row level security;
alter table public.practice_answers enable row level security;
alter table public.cosmetics enable row level security;
revoke all on public.practice_sets,public.practice_answers,public.cosmetics from public,anon,authenticated;
grant all on public.practice_sets,public.practice_answers,public.cosmetics to service_role;
create index practice_sets_user_created_idx on public.practice_sets(user_id,created_at desc);

create function public.practice_answer(p_user uuid,p_set uuid,p_position integer,p_choice integer)
returns void language plpgsql security definer set search_path='' as $$
declare v_set public.practice_sets%rowtype; v_question jsonb;
begin
  select * into v_set from public.practice_sets where id=p_set and user_id=p_user for update;
  if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_position is null or p_position<0 or p_position>=jsonb_array_length(v_set.questions) or p_choice is null or p_choice not between 0 and 3 then
    raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  v_question:=v_set.questions->p_position;
  insert into public.practice_answers(set_id,position,selected_index,is_correct)
  values(p_set,p_position,p_choice,p_choice=(v_question->>'correct_index')::integer) on conflict(set_id,position) do nothing;
  if found then insert into public.study_days(user_id,day) values(p_user,(clock_timestamp() at time zone 'UTC')::date) on conflict do nothing; end if;
end $$;
revoke all on function public.practice_answer(uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.practice_answer(uuid,uuid,integer,integer) to service_role;

commit;
