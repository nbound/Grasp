-- LOCAL DEVELOPMENT ONLY. These are database fixtures, not login accounts.
-- No passwords, tokens, or production credentials are included. Create real
-- teacher accounts through Supabase Auth for browser testing in later phases.
begin;
insert into auth.users (id, email, is_anonymous, raw_user_meta_data, raw_app_meta_data, aud, role)
values
    ('10000000-0000-0000-0000-000000000001', 'teacher-a@example.test', false,
        '{"display_name":"Teacher A"}', '{}', 'authenticated', 'authenticated'),
    ('10000000-0000-0000-0000-000000000002', 'teacher-b@example.test', false,
        '{"display_name":"Teacher B"}', '{}', 'authenticated', 'authenticated'),
    ('20000000-0000-0000-0000-000000000001', null, true,
        '{}', '{}', 'authenticated', 'authenticated'),
    ('20000000-0000-0000-0000-000000000002', null, true,
        '{}', '{}', 'authenticated', 'authenticated'),
    ('20000000-0000-0000-0000-000000000003', null, true,
        '{}', '{}', 'authenticated', 'authenticated')
on conflict (id) do nothing;

insert into public.quizzes (id, teacher_id, title, description) values
    ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
        'Sample arithmetic', 'Local fixture owned by Teacher A'),
    ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002',
        'Sample geography', 'Local fixture owned by Teacher B')
on conflict (id) do nothing;

insert into public.questions (id, quiz_id, position, prompt, choices, correct_index, explanation) values
    ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
        0, 'What is 2 + 2?', '["3","4","5","6"]', 1, 'Two pairs make four.'),
    ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002',
        0, 'Which is an ocean?', '["Pacific","Sahara","Alps","Amazon"]', 0, 'The Pacific is an ocean.')
on conflict (id) do nothing;
commit;
