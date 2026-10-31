-- ZOT: Mock Challenge (weekly mock exam, leaderboard, history)
-- Run once in Supabase Dashboard > SQL Editor. Safe to re-run.
-- Then run mock-challenge-seed.sql to load Round 1.
-- Needs public.zot_is_main_admin() (created by payment-submissions.sql).

-- ---------- Tables ----------
create table if not exists public.mock_challenges (
  id                    uuid primary key default gen_random_uuid(),
  round_no              int  not null unique check (round_no > 0),
  title                 text not null,
  starts_at             timestamptz not null,
  closes_at             timestamptz not null,           -- last moment a student can START
  duration_minutes      int  not null default 45 check (duration_minutes between 5 and 300),
  release_delay_minutes int  not null default 30 check (release_delay_minutes between 0 and 1440),
  published             boolean not null default false,
  created_at            timestamptz not null default now(),
  check (closes_at > starts_at)
);

create table if not exists public.mock_questions (
  id           uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.mock_challenges(id) on delete cascade,
  subject      text not null,
  position     int  not null,
  question     text not null,
  option_a     text not null,
  option_b     text not null,
  option_c     text not null,
  option_d     text not null,
  correct      text not null check (correct in ('A','B','C','D')),
  explanation  text,
  unique (challenge_id, subject, position)
);

create table if not exists public.mock_attempts (
  id             uuid primary key default gen_random_uuid(),
  challenge_id   uuid not null references public.mock_challenges(id) on delete cascade,
  student_id     uuid not null,
  full_name      text not null check (char_length(full_name) between 2 and 120),
  course         text not null check (char_length(course) between 2 and 120),
  subjects       text[] not null,                      -- the 3 chosen subjects (English is always added)
  track          text not null,
  started_at     timestamptz not null default now(),
  ends_at        timestamptz not null,
  submitted_at   timestamptz,
  results_at     timestamptz,
  score          int,
  correct_count  int,
  subject_scores jsonb,
  unique (challenge_id, student_id)
);

create table if not exists public.mock_answers (
  attempt_id  uuid not null references public.mock_attempts(id) on delete cascade,
  question_id uuid not null references public.mock_questions(id) on delete cascade,
  chosen      text not null check (chosen in ('A','B','C','D')),
  saved_at    timestamptz not null default now(),
  primary key (attempt_id, question_id)
);

-- Nobody reads these tables directly. Every read/write goes through the
-- functions below, so correct answers never reach the browser early.
alter table public.mock_challenges enable row level security;
alter table public.mock_questions  enable row level security;
alter table public.mock_attempts   enable row level security;
alter table public.mock_answers    enable row level security;
revoke all on public.mock_challenges, public.mock_questions,
              public.mock_attempts,   public.mock_answers from anon, authenticated;

-- ---------- Helpers ----------
create or replace function public._zot_mock_track(p_subjects text[])
returns text language sql immutable as $$
  select case
    when p_subjects && array['Physics','Chemistry','Mathematics','Biology','Further Mathematics','Agricultural Science']
      then 'Science'
    when p_subjects && array['Economics','Commerce','Accounting','Business Studies']
      then 'Commerce'
    else 'Arts'
  end;
$$;

-- Scores an attempt (idempotent). Called on submit, and automatically when time runs out.
create or replace function public._zot_mock_finalize(p_attempt uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  a   public.mock_attempts%rowtype;
  c   public.mock_challenges%rowtype;
  subj text; tot int; cor int; sc int := 0; cc int := 0; ss jsonb := '{}'::jsonb; sub_at timestamptz;
begin
  select * into a from public.mock_attempts where id = p_attempt for update;
  if not found or a.submitted_at is not null then return; end if;
  select * into c from public.mock_challenges where id = a.challenge_id;
  sub_at := least(now(), a.ends_at);

  foreach subj in array (array['English Language'] || a.subjects) loop
    select count(*), count(*) filter (where ans.chosen = q.correct)
      into tot, cor
      from public.mock_questions q
      left join public.mock_answers ans
        on ans.question_id = q.id and ans.attempt_id = a.id
     where q.challenge_id = a.challenge_id and q.subject = subj;
    ss := ss || jsonb_build_object(subj, jsonb_build_object(
            'correct', cor, 'total', tot,
            'score', case when tot > 0 then round(cor * 100.0 / tot) else 0 end));
    sc := sc + case when tot > 0 then round(cor * 100.0 / tot)::int else 0 end;
    cc := cc + cor;
  end loop;

  update public.mock_attempts
     set submitted_at = sub_at,
         results_at = sub_at + make_interval(mins => c.release_delay_minutes),
         score = sc, correct_count = cc, subject_scores = ss
   where id = a.id;
end $$;

create or replace function public._zot_mock_own_attempt(p_attempt uuid)
returns public.mock_attempts language plpgsql security definer set search_path = public as $$
declare a public.mock_attempts%rowtype;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  select * into a from public.mock_attempts where id = p_attempt and student_id = auth.uid();
  if not found then raise exception 'Attempt not found.'; end if;
  if a.submitted_at is null and now() >= a.ends_at then
    perform public._zot_mock_finalize(a.id);
    select * into a from public.mock_attempts where id = a.id;
  end if;
  return a;
end $$;

-- ---------- Student functions ----------
-- List of published rounds, plus this student's attempt (history) on each.
create or replace function public.zot_mock_list()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  -- close out any of this student's attempts whose time has run out
  perform public._zot_mock_finalize(id) from public.mock_attempts
   where student_id = auth.uid() and submitted_at is null and ends_at <= now();

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'round_no', c.round_no, 'title', c.title,
      'starts_at', c.starts_at, 'closes_at', c.closes_at,
      'duration_minutes', c.duration_minutes,
      'subjects', (select coalesce(jsonb_agg(distinct q.subject), '[]'::jsonb)
                     from public.mock_questions q where q.challenge_id = c.id),
      'attempt_id', a.id, 'attempt_ends_at', a.ends_at,
      'submitted_at', a.submitted_at, 'results_at', a.results_at,
      'score', case when a.results_at <= now() then a.score end,
      'server_now', now()
    ) order by c.round_no)
    from public.mock_challenges c
    left join public.mock_attempts a on a.challenge_id = c.id and a.student_id = auth.uid()
    where c.published
  ), '[]'::jsonb);
end $$;

-- Subjects a student can pick for a round (English is always included)
create or replace function public.zot_mock_subjects(p_challenge uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  return coalesce((
    select jsonb_agg(s order by s) from (
      select distinct q.subject as s from public.mock_questions q
      join public.mock_challenges c on c.id = q.challenge_id
      where q.challenge_id = p_challenge and c.published and q.subject <> 'English Language'
    ) x), '[]'::jsonb);
end $$;

create or replace function public.zot_mock_start(
  p_challenge uuid, p_full_name text, p_course text, p_subjects text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.mock_challenges%rowtype; a public.mock_attempts%rowtype; subs text[]; s text;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  select * into c from public.mock_challenges where id = p_challenge and published;
  if not found then raise exception 'This mock is not available.'; end if;

  select * into a from public.mock_attempts where challenge_id = c.id and student_id = auth.uid();
  if found then return jsonb_build_object('attempt_id', a.id, 'resumed', true); end if;

  if now() < c.starts_at then raise exception 'This mock has not started yet.'; end if;
  if now() > c.closes_at then raise exception 'This mock is closed. You can no longer start it.'; end if;

  p_full_name := btrim(coalesce(p_full_name, ''));
  p_course    := btrim(coalesce(p_course, ''));
  if char_length(p_full_name) < 2 then raise exception 'Enter your full name.'; end if;
  if char_length(p_course) < 2 then raise exception 'Enter the course you are applying for.'; end if;

  select array_agg(distinct btrim(x)) into subs from unnest(p_subjects) x;
  if subs is null or array_length(subs, 1) <> 3 then raise exception 'Choose exactly 3 subjects besides English.'; end if;
  foreach s in array subs loop
    if s = 'English Language' or not exists (
      select 1 from public.mock_questions where challenge_id = c.id and subject = s) then
      raise exception 'Subject "%" is not available in this mock.', s;
    end if;
  end loop;

  insert into public.mock_attempts (challenge_id, student_id, full_name, course, subjects, track, ends_at)
  values (c.id, auth.uid(), p_full_name, p_course, subs, public._zot_mock_track(subs),
          now() + make_interval(mins => c.duration_minutes))
  returning * into a;
  return jsonb_build_object('attempt_id', a.id, 'resumed', false);
end $$;

-- Questions WITHOUT correct answers, plus saved answers and the server-side deadline.
create or replace function public.zot_mock_get_attempt(p_attempt uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.mock_attempts%rowtype; c public.mock_challenges%rowtype; subs text[];
begin
  a := public._zot_mock_own_attempt(p_attempt);
  select * into c from public.mock_challenges where id = a.challenge_id;
  if a.submitted_at is not null then
    return jsonb_build_object('status', 'submitted', 'results_at', a.results_at, 'server_now', now());
  end if;
  subs := array['English Language'] || a.subjects;
  return jsonb_build_object(
    'status', 'in_progress',
    'title', c.title, 'full_name', a.full_name,
    'ends_at', a.ends_at, 'server_now', now(),
    'subjects', to_jsonb(subs),
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'subject', q.subject, 'position', q.position, 'question', q.question,
        'options', jsonb_build_object('A', q.option_a, 'B', q.option_b, 'C', q.option_c, 'D', q.option_d)
      ) order by array_position(subs, q.subject), q.position)
      from public.mock_questions q
      where q.challenge_id = a.challenge_id and q.subject = any(subs)), '[]'::jsonb),
    'answers', coalesce((
      select jsonb_object_agg(question_id::text, chosen)
      from public.mock_answers where attempt_id = a.id), '{}'::jsonb)
  );
end $$;

create or replace function public.zot_mock_save_answer(p_attempt uuid, p_question uuid, p_choice text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.mock_attempts%rowtype;
begin
  a := public._zot_mock_own_attempt(p_attempt);
  if a.submitted_at is not null or now() > a.ends_at + interval '5 seconds' then
    raise exception 'Time is up. This attempt has been submitted.';
  end if;
  if not exists (select 1 from public.mock_questions
                  where id = p_question and challenge_id = a.challenge_id
                    and subject = any(array['English Language'] || a.subjects)) then
    raise exception 'Unknown question.';
  end if;
  if p_choice is null then
    delete from public.mock_answers where attempt_id = a.id and question_id = p_question;
  else
    p_choice := upper(p_choice);
    if p_choice not in ('A','B','C','D') then raise exception 'Invalid option.'; end if;
    insert into public.mock_answers (attempt_id, question_id, chosen)
    values (a.id, p_question, p_choice)
    on conflict (attempt_id, question_id) do update set chosen = excluded.chosen, saved_at = now();
  end if;
end $$;

create or replace function public.zot_mock_submit(p_attempt uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.mock_attempts%rowtype;
begin
  a := public._zot_mock_own_attempt(p_attempt);
  if a.submitted_at is null then
    perform public._zot_mock_finalize(a.id);
    select * into a from public.mock_attempts where id = a.id;
  end if;
  return jsonb_build_object('submitted_at', a.submitted_at, 'results_at', a.results_at, 'server_now', now());
end $$;

-- Score + full review. Returns nothing sensitive until results_at has passed.
create or replace function public.zot_mock_result(p_attempt uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.mock_attempts%rowtype; c public.mock_challenges%rowtype; r int; n int;
begin
  a := public._zot_mock_own_attempt(p_attempt);
  select * into c from public.mock_challenges where id = a.challenge_id;
  if a.submitted_at is null then raise exception 'This attempt is still in progress.'; end if;
  if now() < a.results_at then
    return jsonb_build_object('released', false, 'results_at', a.results_at,
                              'submitted_at', a.submitted_at, 'server_now', now(), 'title', c.title);
  end if;

  perform public._zot_mock_finalize(id) from public.mock_attempts
   where challenge_id = a.challenge_id and submitted_at is null and ends_at <= now();

  select count(*) + 1 into r from public.mock_attempts o
   where o.challenge_id = a.challenge_id and o.submitted_at is not null
     and (o.score > a.score or (o.score = a.score and
          (o.submitted_at - o.started_at) < (a.submitted_at - a.started_at)));
  select count(*) into n from public.mock_attempts
   where challenge_id = a.challenge_id and submitted_at is not null;

  return jsonb_build_object(
    'released', true, 'title', c.title, 'challenge_id', c.id, 'round_no', c.round_no,
    'full_name', a.full_name, 'course', a.course, 'track', a.track, 'subjects', a.subjects,
    'score', a.score, 'out_of', 100 * (1 + array_length(a.subjects, 1)),
    'correct_count', a.correct_count, 'subject_scores', a.subject_scores,
    'rank', r, 'participants', n,
    'time_taken_seconds', extract(epoch from (a.submitted_at - a.started_at))::int,
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'subject', q.subject, 'position', q.position, 'question', q.question,
        'options', jsonb_build_object('A', q.option_a, 'B', q.option_b, 'C', q.option_c, 'D', q.option_d),
        'correct', q.correct, 'chosen', ans.chosen, 'explanation', q.explanation
      ) order by array_position(array['English Language'] || a.subjects, q.subject), q.position)
      from public.mock_questions q
      left join public.mock_answers ans on ans.question_id = q.id and ans.attempt_id = a.id
      where q.challenge_id = a.challenge_id and q.subject = any(array['English Language'] || a.subjects)
    ), '[]'::jsonb)
  );
end $$;

-- Leaderboard for one round. Students see it once their own results are released; admin any time.
create or replace function public.zot_mock_leaderboard(p_challenge uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare allowed boolean;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  allowed := public.zot_is_main_admin() or exists (
    select 1 from public.mock_attempts
     where challenge_id = p_challenge and student_id = auth.uid()
       and submitted_at is not null and results_at <= now());
  if not allowed then raise exception 'The leaderboard is not available yet.'; end if;
  perform public._zot_mock_finalize(id) from public.mock_attempts
   where challenge_id = p_challenge and submitted_at is null and ends_at <= now();

  return coalesce((
    select jsonb_agg(to_jsonb(t) order by t.rank, t.time_taken_seconds) from (
      select rank() over (order by a.score desc,
                                   (a.submitted_at - a.started_at) asc) as rank,
             a.full_name, a.course, a.track, a.subjects, a.score, a.correct_count,
             extract(epoch from (a.submitted_at - a.started_at))::int as time_taken_seconds,
             (a.student_id = auth.uid()) as is_me
        from public.mock_attempts a
       where a.challenge_id = p_challenge and a.submitted_at is not null
       limit 500
    ) t), '[]'::jsonb);
end $$;

-- ---------- Admin functions ----------
create or replace function public.zot_admin_mock_list()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.zot_is_main_admin() then raise exception 'Admin only.'; end if;
  perform public._zot_mock_finalize(id) from public.mock_attempts
   where submitted_at is null and ends_at <= now();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'round_no', c.round_no, 'title', c.title, 'starts_at', c.starts_at,
      'closes_at', c.closes_at, 'duration_minutes', c.duration_minutes,
      'release_delay_minutes', c.release_delay_minutes, 'published', c.published,
      'question_counts', (select coalesce(jsonb_object_agg(subject, n), '{}'::jsonb)
                            from (select subject, count(*) n from public.mock_questions
                                   where challenge_id = c.id group by subject) s),
      'attempts', (select count(*) from public.mock_attempts where challenge_id = c.id),
      'submitted', (select count(*) from public.mock_attempts
                     where challenge_id = c.id and submitted_at is not null)
    ) order by c.round_no)
    from public.mock_challenges c), '[]'::jsonb);
end $$;

create or replace function public.zot_admin_mock_save(
  p_id uuid, p_round_no int, p_title text, p_starts_at timestamptz, p_closes_at timestamptz,
  p_duration int, p_release_delay int, p_published boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not public.zot_is_main_admin() then raise exception 'Admin only.'; end if;
  if p_id is null then
    insert into public.mock_challenges (round_no, title, starts_at, closes_at, duration_minutes, release_delay_minutes, published)
    values (p_round_no, p_title, p_starts_at, p_closes_at, p_duration, p_release_delay, p_published)
    returning id into v;
  else
    update public.mock_challenges
       set round_no = p_round_no, title = p_title, starts_at = p_starts_at, closes_at = p_closes_at,
           duration_minutes = p_duration, release_delay_minutes = p_release_delay, published = p_published
     where id = p_id returning id into v;
    if v is null then raise exception 'Mock not found.'; end if;
  end if;
  return v;
end $$;

-- p_questions: [{subject, question, a, b, c, d, correct, explanation}, ...]
create or replace function public.zot_admin_mock_import(p_challenge uuid, p_questions jsonb, p_replace boolean)
returns int language plpgsql security definer set search_path = public as $$
declare q jsonb; n int := 0; pos int; subj text; corr text;
begin
  if not public.zot_is_main_admin() then raise exception 'Admin only.'; end if;
  if not exists (select 1 from public.mock_challenges where id = p_challenge) then
    raise exception 'Mock not found.'; end if;
  if jsonb_typeof(p_questions) <> 'array' then raise exception 'Questions must be a list.'; end if;
  if p_replace then
    if exists (select 1 from public.mock_attempts where challenge_id = p_challenge) then
      raise exception 'Students have already started this mock, so its questions cannot be replaced.';
    end if;
    delete from public.mock_questions where challenge_id = p_challenge;
  end if;
  for q in select * from jsonb_array_elements(p_questions) loop
    subj := btrim(coalesce(q->>'subject', ''));
    corr := upper(btrim(coalesce(q->>'correct', '')));
    if subj = '' or corr not in ('A','B','C','D')
       or coalesce(btrim(q->>'question'), '') = ''
       or coalesce(btrim(q->>'a'), '') = '' or coalesce(btrim(q->>'b'), '') = ''
       or coalesce(btrim(q->>'c'), '') = '' or coalesce(btrim(q->>'d'), '') = '' then
      raise exception 'Question % is incomplete (needs subject, question, a-d, correct).', n + 1;
    end if;
    select coalesce(max(position), 0) + 1 into pos from public.mock_questions
     where challenge_id = p_challenge and subject = subj;
    insert into public.mock_questions
      (challenge_id, subject, position, question, option_a, option_b, option_c, option_d, correct, explanation)
    values (p_challenge, subj, pos, btrim(q->>'question'), btrim(q->>'a'), btrim(q->>'b'),
            btrim(q->>'c'), btrim(q->>'d'), corr, nullif(btrim(coalesce(q->>'explanation', '')), ''));
    n := n + 1;
  end loop;
  return n;
end $$;

-- Grants
revoke all on function public._zot_mock_track(text[]), public._zot_mock_finalize(uuid),
                       public._zot_mock_own_attempt(uuid) from public, anon, authenticated;
revoke all on function public.zot_mock_list(), public.zot_mock_subjects(uuid),
  public.zot_mock_start(uuid, text, text, text[]), public.zot_mock_get_attempt(uuid),
  public.zot_mock_save_answer(uuid, uuid, text), public.zot_mock_submit(uuid),
  public.zot_mock_result(uuid), public.zot_mock_leaderboard(uuid),
  public.zot_admin_mock_list(),
  public.zot_admin_mock_save(uuid, int, text, timestamptz, timestamptz, int, int, boolean),
  public.zot_admin_mock_import(uuid, jsonb, boolean) from public, anon;
grant execute on function public.zot_mock_list(), public.zot_mock_subjects(uuid),
  public.zot_mock_start(uuid, text, text, text[]), public.zot_mock_get_attempt(uuid),
  public.zot_mock_save_answer(uuid, uuid, text), public.zot_mock_submit(uuid),
  public.zot_mock_result(uuid), public.zot_mock_leaderboard(uuid),
  public.zot_admin_mock_list(),
  public.zot_admin_mock_save(uuid, int, text, timestamptz, timestamptz, int, int, boolean),
  public.zot_admin_mock_import(uuid, jsonb, boolean) to authenticated;
