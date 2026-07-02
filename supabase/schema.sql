-- ============================================================
--  Banco de dados do "Meu Assistente" (Supabase)
--  Cole tudo isto no Supabase → SQL Editor → Run.
--  Cria as tabelas (tarefas e notas) e garante que cada usuário
--  só vê os seus próprios dados.
-- ============================================================

-- ---------- Tarefas (Pessoal e Profissional) ----------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  area text not null default 'pessoal' check (area in ('pessoal', 'profissional')),
  priority text default 'media' check (priority in ('baixa', 'media', 'alta')),
  due_date date,
  done boolean not null default false,
  done_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- Notas ----------
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text,
  body text,
  created_at timestamptz not null default now()
);

-- ============================================================
--  Segurança: Row Level Security (cada usuário só acessa o seu)
-- ============================================================
alter table public.tasks enable row level security;
alter table public.notes enable row level security;

do $$
declare t text;
begin
  foreach t in array array['tasks', 'notes'] loop
    execute format('drop policy if exists "own_select" on public.%I;', t);
    execute format('drop policy if exists "own_insert" on public.%I;', t);
    execute format('drop policy if exists "own_update" on public.%I;', t);
    execute format('drop policy if exists "own_delete" on public.%I;', t);

    execute format('create policy "own_select" on public.%I for select using (auth.uid() = user_id);', t);
    execute format('create policy "own_insert" on public.%I for insert with check (auth.uid() = user_id);', t);
    execute format('create policy "own_update" on public.%I for update using (auth.uid() = user_id);', t);
    execute format('create policy "own_delete" on public.%I for delete using (auth.uid() = user_id);', t);
  end loop;
end $$;

-- Índices úteis
create index if not exists idx_task_user on public.tasks (user_id, done);
create index if not exists idx_note_user on public.notes (user_id, created_at);
