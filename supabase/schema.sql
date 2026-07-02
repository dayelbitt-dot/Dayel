-- ============================================================
--  Banco de dados do "Meu Assistente" (Supabase)
--  Aplicado automaticamente pelo GitHub Actions a cada mudança.
--  (Também pode ser colado manualmente no SQL Editor, se quiser.)
--  Tabelas: tarefas, notas, lembretes, clientes e processos.
--  Cada usuário só enxerga os próprios dados (Row Level Security).
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

-- ---------- Lembretes gerais (ordenados por data) ----------
create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  body text,
  remind_on date,
  created_at timestamptz not null default now()
);

-- ---------- Clientes (pasta cadastral) ----------
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  nome text not null,
  cpf text,
  rg text,
  tel text,
  email text,
  nasc date,
  endereco text,
  area text,
  origem text,
  obs text,
  created_at timestamptz not null default now()
);

-- ---------- Processos (vinculados ao cliente, com andamentos) ----------
create table if not exists public.processes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid references public.clients (id) on delete set null,
  num text,
  nome text not null,
  tipo text,
  vara text,
  tribunal text,
  partes text,
  data_distribuicao date,
  fase text,
  status text default 'Ativo',
  valor numeric(14,2),
  obs text,
  andamentos jsonb not null default '[]',
  created_at timestamptz not null default now()
);

-- ---------- Grau do processo (1º / 2º) ----------
alter table public.processes add column if not exists grau text default '1';

-- ---------- Vínculos das tarefas ao CRM (para a captura inteligente) ----------
alter table public.tasks add column if not exists description text;
alter table public.tasks add column if not exists due_time text;
alter table public.tasks add column if not exists client_id  uuid references public.clients (id)   on delete set null;
alter table public.tasks add column if not exists process_id uuid references public.processes (id) on delete set null;

-- ---------- Anexos das tarefas (arquivos embutidos: nome, tipo, tamanho, dados) ----------
alter table public.tasks add column if not exists attachments jsonb not null default '[]';

-- ============================================================
--  Segurança: Row Level Security (cada usuário só acessa o seu)
-- ============================================================
alter table public.tasks enable row level security;
alter table public.notes enable row level security;
alter table public.reminders enable row level security;
alter table public.clients enable row level security;
alter table public.processes enable row level security;

do $$
declare t text;
begin
  foreach t in array array['tasks', 'notes', 'reminders', 'clients', 'processes'] loop
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
create index if not exists idx_rem_user  on public.reminders (user_id, remind_on);
create index if not exists idx_client_user on public.clients (user_id, nome);
create index if not exists idx_proc_user   on public.processes (user_id, status);
create index if not exists idx_proc_client on public.processes (client_id);
