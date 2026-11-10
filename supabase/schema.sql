-- Generated from ordered migrations. Apply migrations to existing databases.
-- Initial Grasp schema. Apply through Supabase migrations, not on top of existing tables.
-- Browser keys use RLS; service_role is trusted and bypasses RLS.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;
revoke create on schema public from public, anon, authenticated;

create table public.teachers (
    id uuid primary key references auth.users(id) on delete cascade,
    email text not null,
    display_name text check (char_length(display_name) <= 80),
    created_at timestamptz not null default now()
);

create table public.quizzes (
    id uuid primary key default gen_random_uuid(),
    teacher_id uuid not null references public.teachers(id) on delete cascade,
    title text not null check (char_length(btrim(title)) between 1 and 200),
    description text check (char_length(description) <= 5000),
    created_at timestamptz not null default now(),
    unique (id, teacher_id)
);

-- Used in a CHECK: all choices must be nonblank strings with bounded length.
create function private.valid_choices(value jsonb)
returns boolean language sql immutable set search_path = ''
as $$
    select case when jsonb_typeof(value) = 'array' then
        jsonb_array_length(value) between 2 and 6
        and not exists (
            select 1 from jsonb_array_elements(value) as choice(item)
            where jsonb_typeof(item) <> 'string'
               or char_length(btrim(item #>> '{}')) not between 1 and 1000
        )
    else false end
$$;

create table public.questions (
    id uuid primary key default gen_random_uuid(),
    quiz_id uuid not null references public.quizzes(id) on delete cascade,
    position integer not null check (position >= 0),
    prompt text not null check (char_length(btrim(prompt)) between 1 and 5000),
    choices jsonb not null check (private.valid_choices(choices)),
    correct_index integer not null check (
        case when jsonb_typeof(choices) = 'array'
            then correct_index >= 0 and correct_index < jsonb_array_length(choices)
            else false end
    ),
    explanation text not null default '' check (char_length(explanation) <= 5000),
    -- No timer by default. Time and streaks never multiply points.
    time_limit_seconds integer check (time_limit_seconds between 5 and 600),
    points integer not null default 1000 check (points between 0 and 10000),
    created_at timestamptz not null default now(),
    unique (id, quiz_id),
    constraint questions_quiz_position_key unique (quiz_id, position)
        deferrable initially immediate
);

create table public.game_sessions (
    id uuid primary key default gen_random_uuid(),
    quiz_id uuid not null,
    host_id uuid not null references public.teachers(id) on delete cascade,
    join_code text not null unique check (join_code ~ '^[0-9]{6}$'),
    status text not null default 'lobby' check (status in ('lobby', 'active', 'finished')),
    current_question_index integer not null default -1 check (current_question_index >= -1),
    max_players integer not null default 40 check (max_players between 1 and 200),
    team_count integer not null default 2 check (team_count between 2 and 8),
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '24 hours'),
    finished_at timestamptz,
    check (expires_at > created_at),
    check (finished_at is null or finished_at >= created_at),
    foreign key (quiz_id, host_id) references public.quizzes(id, teacher_id) on delete restrict,
    unique (id, quiz_id)
);

create table public.teams (
    session_id uuid not null references public.game_sessions(id) on delete cascade,
    team_number integer not null check (team_number between 1 and 8),
    name text not null check (char_length(btrim(name)) between 1 and 80),
    primary key (session_id, team_number)
);

create table public.players (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.game_sessions(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    nickname text not null check (
        nickname = btrim(nickname)
        and char_length(nickname) between 1 and 32
        and nickname !~ '[[:cntrl:]]'
    ),
    team_number integer not null,
    score integer not null default 0 check (score >= 0),
    joined_at timestamptz not null default now(),
    foreign key (session_id, team_number)
        references public.teams(session_id, team_number) on delete restrict,
    unique (session_id, user_id),
    unique (id, session_id)
);
create unique index players_session_nickname_key
    on public.players(session_id, lower(nickname));

create table public.answers (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null,
    quiz_id uuid not null,
    player_id uuid not null,
    question_id uuid not null,
    selected_index integer not null check (selected_index between 0 and 5),
    is_correct boolean not null,
    points_awarded integer not null check (points_awarded between 0 and 10000),
    response_ms integer check (response_ms >= 0),
    created_at timestamptz not null default now(),
    foreign key (session_id, quiz_id)
        references public.game_sessions(id, quiz_id) on delete cascade,
    foreign key (player_id, session_id)
        references public.players(id, session_id) on delete cascade,
    foreign key (question_id, quiz_id)
        references public.questions(id, quiz_id) on delete restrict,
    unique (player_id, question_id)
);

create index quizzes_teacher_created_idx on public.quizzes(teacher_id, created_at desc);
create index sessions_host_created_idx on public.game_sessions(host_id, created_at desc);
create index sessions_quiz_host_idx on public.game_sessions(quiz_id, host_id);
create index sessions_expiration_idx on public.game_sessions(expires_at) where status <> 'finished';
create index players_user_idx on public.players(user_id);
create index players_session_team_idx on public.players(session_id, team_number);
create index answers_session_quiz_idx on public.answers(session_id, quiz_id);
create index answers_question_quiz_idx on public.answers(question_id, quiz_id);

-- Trigger functions have no browser execute privileges.
create function private.sync_teacher()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
    if new.is_anonymous is false and new.email is not null then
        insert into public.teachers(id, email, display_name)
        values (
            new.id, new.email,
            left(new.raw_user_meta_data ->> 'display_name', 80)
        )
        on conflict (id) do update set email = excluded.email;
    end if;
    return new;
end;
$$;
create trigger on_auth_user_created
    after insert or update of email, is_anonymous on auth.users
    for each row execute function private.sync_teacher();

-- Support migration into a project with existing Auth users.
insert into public.teachers(id, email, display_name)
select id, email, left(raw_user_meta_data ->> 'display_name', 80)
from auth.users where is_anonymous is false and email is not null;

create function private.initialize_session()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
    -- Serialize hosting against quiz edits.
    perform 1 from public.quizzes where id = new.quiz_id for update;
    return new;
end;
$$;
create trigger lock_quiz_on_host before insert on public.game_sessions
    for each row execute function private.initialize_session();

create function private.create_teams()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
    insert into public.teams(session_id, team_number, name)
    select new.id, n, 'Team ' || n from generate_series(1, new.team_count) as n;
    return new;
end;
$$;
create trigger create_session_teams after insert on public.game_sessions
    for each row execute function private.create_teams();

-- Preserve historical prompts/answers: duplicate a hosted quiz to change questions.
create function private.protect_hosted_questions()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
    v_quiz_id uuid;
begin
    if tg_op = 'UPDATE' and new.quiz_id <> old.quiz_id then
        raise exception 'Questions cannot be moved between quizzes' using errcode = '23514';
    end if;
    if tg_op = 'DELETE' then v_quiz_id := old.quiz_id; else v_quiz_id := new.quiz_id; end if;
    perform 1 from public.quizzes where id = v_quiz_id for update;
    if exists (select 1 from public.game_sessions where quiz_id = v_quiz_id) then
        raise exception 'Hosted questions are immutable; duplicate the quiz to edit'
            using errcode = '23514';
    end if;
    if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
create trigger protect_hosted_questions before insert or update or delete on public.questions
    for each row execute function private.protect_hosted_questions();

-- Definer helpers deliberately bypass table RLS to avoid recursive session/player
-- policies. They disclose only authorization booleans for the current identity.
create function private.is_teacher()
returns boolean language sql stable security definer set search_path = ''
as $$
    select coalesce((auth.jwt() ->> 'is_anonymous') = 'false', false)
       and exists (
           select 1 from public.teachers t join auth.users u on u.id = t.id
           where t.id = auth.uid() and u.is_anonymous is false
       )
$$;
create function private.owns_session(p_session_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
    select private.is_teacher() and exists (
        select 1 from public.game_sessions s
        where s.id = p_session_id and s.host_id = auth.uid()
    )
$$;
create function private.is_player(p_session_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
    select exists (
        select 1 from public.players p
        where p.session_id = p_session_id and p.user_id = auth.uid()
    )
$$;

alter table public.teachers enable row level security;
alter table public.quizzes enable row level security;
alter table public.questions enable row level security;
alter table public.game_sessions enable row level security;
alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.answers enable row level security;

create policy teachers_read_own on public.teachers for select to authenticated
    using (id = (select auth.uid()) and (select private.is_teacher()));
create policy teachers_update_own on public.teachers for update to authenticated
    using (id = (select auth.uid()) and (select private.is_teacher()))
    with check (id = (select auth.uid()) and (select private.is_teacher()));

create policy quizzes_owner on public.quizzes for all to authenticated
    using (teacher_id = (select auth.uid()) and (select private.is_teacher()))
    with check (teacher_id = (select auth.uid()) and (select private.is_teacher()));

create policy questions_owner on public.questions for all to authenticated
    using ((select private.is_teacher()) and exists (
        select 1 from public.quizzes q where q.id = questions.quiz_id
        and q.teacher_id = (select auth.uid())
    ))
    with check ((select private.is_teacher()) and exists (
        select 1 from public.quizzes q where q.id = questions.quiz_id
        and q.teacher_id = (select auth.uid())
    ));

create policy sessions_read on public.game_sessions for select to authenticated
    using ((host_id = (select auth.uid()) and (select private.is_teacher()))
        or private.is_player(id));
create policy sessions_create on public.game_sessions for insert to authenticated
    with check (host_id = (select auth.uid()) and (select private.is_teacher()));
create policy teams_read on public.teams for select to authenticated
    using (private.owns_session(session_id) or private.is_player(session_id));
create policy players_read on public.players for select to authenticated
    using (user_id = (select auth.uid()) or private.owns_session(session_id));
create policy answers_read on public.answers for select to authenticated
    using (private.owns_session(session_id) or exists (
        select 1 from public.players p where p.id = answers.player_id
        and p.user_id = (select auth.uid())
    ));

-- Remove Supabase default grants, then grant the smallest supported API surface.
revoke all on public.teachers, public.quizzes, public.questions,
    public.game_sessions, public.teams, public.players, public.answers
    from public, anon, authenticated;
grant select on public.teachers, public.quizzes, public.questions,
    public.game_sessions, public.teams, public.players, public.answers to authenticated;
grant update (display_name) on public.teachers to authenticated;
grant insert (teacher_id, title, description) on public.quizzes to authenticated;
grant update (title, description) on public.quizzes to authenticated;
grant delete on public.quizzes to authenticated;
grant insert (quiz_id, position, prompt, choices, correct_index, explanation, time_limit_seconds, points)
    on public.questions to authenticated;
grant update (position, prompt, choices, correct_index, explanation, time_limit_seconds, points)
    on public.questions to authenticated;
grant delete on public.questions to authenticated;
grant insert (quiz_id, host_id, join_code, max_players, team_count, expires_at)
    on public.game_sessions to authenticated;
grant all on public.teachers, public.quizzes, public.questions,
    public.game_sessions, public.teams, public.players, public.answers to service_role;

create function private.join_game(p_code text, p_nickname text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_session public.game_sessions%rowtype;
    v_player_id uuid;
    v_nickname text := btrim(p_nickname);
    v_team integer;
begin
    if v_user_id is null or not exists (select 1 from auth.users where id = v_user_id) then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    if p_code is null or btrim(p_code) !~ '^[0-9]{6}$' then
        raise exception 'Enter a six-digit game code' using errcode = '22023';
    end if;
    if v_nickname is null or char_length(v_nickname) not between 1 and 32
       or v_nickname ~ '[[:cntrl:]]' then
        raise exception 'Nickname must contain 1–32 characters without control characters'
            using errcode = '22023';
    end if;

    -- Serializes concurrent joins and host status changes for this session.
    select * into v_session from public.game_sessions
        where join_code = btrim(p_code) for update;
    if not found or v_session.status <> 'lobby' or v_session.expires_at <= clock_timestamp() then
        raise exception 'Game not found or unavailable' using errcode = 'P0001';
    end if;

    select id into v_player_id from public.players
        where session_id = v_session.id and user_id = v_user_id;
    if v_player_id is not null then
        -- Retry is idempotent, including when the lobby has reached capacity.
        -- Reconnect after start uses the existing membership, not this join RPC.
        return v_player_id;
    end if;
    if (select count(*) from public.players where session_id = v_session.id) >= v_session.max_players then
        raise exception 'Game is full' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.players
        where session_id = v_session.id and lower(nickname) = lower(v_nickname)) then
        raise exception 'Nickname is already in use' using errcode = '23505';
    end if;

    select t.team_number into v_team from public.teams t
    left join public.players p on p.session_id = t.session_id and p.team_number = t.team_number
    where t.session_id = v_session.id
    group by t.team_number order by count(p.id), t.team_number limit 1;

    insert into public.players(session_id, user_id, nickname, team_number)
    values (v_session.id, v_user_id, v_nickname, v_team)
    returning id into v_player_id;
    return v_player_id;
end;
$$;

-- The exposed RPC is an invoker wrapper; privileged implementation is private.
create function public.join_game(p_code text, p_nickname text)
returns uuid language sql security invoker set search_path = ''
as $$ select private.join_game(p_code, p_nickname) $$;

revoke all on all functions in schema private from public, anon, authenticated, service_role;
grant execute on function private.valid_choices(jsonb), private.is_teacher(),
    private.owns_session(uuid), private.is_player(uuid), private.join_game(text, text)
    to authenticated;
grant execute on function private.valid_choices(jsonb) to service_role;
revoke all on function public.join_game(text, text) from public, anon, authenticated, service_role;
grant execute on function public.join_game(text, text) to authenticated;

comment on table public.answers is
    'Trusted server writes only. Validate membership, phase, option bounds and scoring before inserting; persist answer and score in one transaction.';
comment on table public.players is
    'Browser writes only via join_game. Do not delete anonymous auth users until their gameplay retention period has elapsed (cascading deletes).';
comment on column public.game_sessions.host_id is
    'Teacher owner; the composite quiz FK prevents hosting another teacher''s quiz.';

commit;

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
