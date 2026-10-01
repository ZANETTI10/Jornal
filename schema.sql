-- =====================================================================
--  JORNAL · Nómina y asistencia para empresas colombianas
--  Soporte TI · Esquema de base de datos para Supabase (Postgres)
--
--  Cómo usarlo: Supabase → SQL Editor → New query → pegar todo → Run.
--  Se puede correr una sola vez sobre un proyecto nuevo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Perfiles y roles
--    admin   → Soporte TI: ve y edita todo, incluidos parámetros legales
--    tecnico → Soporte TI: opera todas las empresas, sin tocar parámetros
--    cliente → usuario de una empresa cliente: solo ve las empresas que
--              tenga asignadas en usuarios_empresas
--    Todo usuario nuevo nace como 'cliente' sin empresas (no ve nada)
--    hasta que un admin lo asigne o le suba el rol.
-- ---------------------------------------------------------------------
create table if not exists public.usuarios_perfil (
  id          uuid primary key references auth.users(id) on delete cascade,
  nombre      text,
  rol         text not null default 'cliente' check (rol in ('admin','tecnico','cliente')),
  creado_en   timestamptz not null default now()
);

create or replace function public.crear_perfil_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.usuarios_perfil (id, nombre)
  values (new.id, coalesce(new.raw_user_meta_data->>'nombre', new.email))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists trg_crear_perfil on auth.users;
create trigger trg_crear_perfil
  after insert on auth.users
  for each row execute function public.crear_perfil_usuario();

create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios_perfil where id = auth.uid() and rol = 'admin');
$$;

create or replace function public.es_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios_perfil where id = auth.uid() and rol in ('admin','tecnico'));
$$;

-- ---------------------------------------------------------------------
-- 2. Empresas cliente
-- ---------------------------------------------------------------------
create table if not exists public.empresas (
  id                  uuid primary key default gen_random_uuid(),
  nombre              text not null,
  slug                text unique,          -- identificador del enlace: …/Jornal/?empresa=la-rufina
  nit                 text,
  ciudad              text,
  periodicidad        text not null default 'quincenal' check (periodicidad in ('quincenal','mensual')),
  -- Art. 114-1 E.T.: personas jurídicas exoneradas de salud empleador, SENA e ICBF
  -- para trabajadores que devenguen menos de 10 SMMLV
  exonerada_aportes   boolean not null default true,
  activa              boolean not null default true,
  creado_en           timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. Empleados
-- ---------------------------------------------------------------------
create table if not exists public.empleados (
  id                   uuid primary key default gen_random_uuid(),
  empresa_id           uuid not null references public.empresas(id) on delete cascade,
  documento            text not null,
  nombres              text not null,
  apellidos            text not null default '',
  cargo                text,
  salario              numeric(14,2) not null check (salario >= 0),
  tipo_salario         text not null default 'ordinario' check (tipo_salario in ('ordinario','integral')),
  tipo_contrato        text not null default 'indefinido' check (tipo_contrato in ('indefinido','fijo','obra_labor','aprendizaje')),
  fecha_ingreso        date not null,
  fecha_retiro         date,
  dias_laborales_semana int not null default 6 check (dias_laborales_semana between 1 and 7),
  auxilio_transporte   boolean not null default true,  -- se aplica solo si salario <= 2 SMMLV
  eps                  text,
  afp                  text,
  ccf                  text,
  arl_riesgo           int not null default 1 check (arl_riesgo between 1 and 5),
  codigo_biometrico    text,          -- ID del usuario en el reloj (ZKTeco, etc.)
  activo               boolean not null default true,
  creado_en            timestamptz not null default now(),
  unique (empresa_id, documento),
  unique (empresa_id, codigo_biometrico)
);
create index if not exists idx_empleados_empresa on public.empleados(empresa_id);

-- ---------------------------------------------------------------------
-- 3b. Usuarios de las empresas cliente (acceso por empresa)
-- ---------------------------------------------------------------------
create table if not exists public.usuarios_empresas (
  usuario_id  uuid not null references auth.users(id) on delete cascade,
  empresa_id  uuid not null references public.empresas(id) on delete cascade,
  creado_en   timestamptz not null default now(),
  primary key (usuario_id, empresa_id)
);

create or replace function public.puede_ver_empresa(eid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.es_staff()
      or exists (select 1 from public.usuarios_empresas where usuario_id = auth.uid() and empresa_id = eid);
$$;

-- ---------------------------------------------------------------------
-- 3c. Dispositivos biométricos por empresa
--     modo push    → el reloj envía las marcaciones (ZKTeco ADMS / nube)
--     modo pull    → un agente o servidor las consulta por IP:puerto
--     modo archivo → se suben a mano (USB / exportación)
-- ---------------------------------------------------------------------
create table if not exists public.dispositivos (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresas(id) on delete cascade,
  nombre           text not null,                 -- ej. "Portería principal"
  marca            text not null default 'ZKTeco',
  modelo           text,
  serial           text unique,                   -- el reloj se identifica con su número de serie
  ubicacion        text,
  modo             text not null default 'push' check (modo in ('push','pull','archivo')),
  ip               text,
  puerto           int default 4370,
  activo           boolean not null default true,
  ultimo_contacto  timestamptz,
  creado_en        timestamptz not null default now()
);
create index if not exists idx_dispositivos_empresa on public.dispositivos(empresa_id);

-- ---------------------------------------------------------------------
-- 4. Marcaciones del biométrico
--    Se guardan crudas; el emparejamiento entrada/salida y el cálculo de
--    recargos los hace el motor (calculo.js) al liquidar.
-- ---------------------------------------------------------------------
create table if not exists public.marcaciones (
  id                 bigint generated always as identity primary key,
  empresa_id         uuid not null references public.empresas(id) on delete cascade,
  empleado_id        uuid references public.empleados(id) on delete set null,
  codigo_biometrico  text not null,
  fecha_hora         timestamp not null,          -- hora local del reloj (Colombia, sin zona)
  origen             text not null default 'archivo' check (origen in ('archivo','push','manual')),
  tipo               text check (tipo in ('entrada','salida')),   -- lo que reporta el reloj, si lo trae
  dispositivo_id     uuid references public.dispositivos(id) on delete set null,
  anulada            boolean not null default false,
  observacion        text,
  creado_en          timestamptz not null default now(),
  unique (empresa_id, codigo_biometrico, fecha_hora)   -- evita duplicados al reimportar
);
create index if not exists idx_marcaciones_empresa_fecha on public.marcaciones(empresa_id, fecha_hora);

-- ---------------------------------------------------------------------
-- 5. Parámetros legales con vigencia
--    Nunca se "editan" valores pasados: se agrega una fila nueva con su
--    fecha de vigencia. El motor toma, para cada día, la fila vigente.
-- ---------------------------------------------------------------------
create table if not exists public.parametros_legales (
  id                     bigint generated always as identity primary key,
  vigente_desde          date not null unique,
  smmlv                  numeric(14,2) not null,
  auxilio_transporte     numeric(14,2) not null,
  jornada_semanal        numeric(5,2) not null,     -- horas
  inicio_nocturno        time not null default '19:00',
  fin_nocturno           time not null default '06:00',
  recargo_nocturno       numeric(6,4) not null,     -- 0.35 = 35 %
  recargo_dominical      numeric(6,4) not null,     -- 0.90 = 90 %
  extra_diurna           numeric(6,4) not null,     -- 0.25
  extra_nocturna         numeric(6,4) not null,     -- 0.75
  norma                  text
);

insert into public.parametros_legales
  (vigente_desde, smmlv, auxilio_transporte, jornada_semanal, recargo_nocturno, recargo_dominical, extra_diurna, extra_nocturna, norma)
values
  ('2026-01-01', 1750905, 249095, 44, 0.35, 0.80, 0.25, 0.75, 'Dec. 1469 y 1470 de 2025; Ley 2466 de 2025 (dominical 80 %); jornada 44 h'),
  ('2026-07-01', 1750905, 249095, 44, 0.35, 0.90, 0.25, 0.75, 'Ley 2466 de 2025 art. 14: dominical/festivo 90 %'),
  ('2026-07-15', 1750905, 249095, 42, 0.35, 0.90, 0.25, 0.75, 'Ley 2101 de 2021: jornada 42 h semanales')
on conflict (vigente_desde) do nothing;

-- ---------------------------------------------------------------------
-- 6. Periodos de nómina
--    Al cerrar un periodo se guarda la foto del cálculo (resultado jsonb)
--    para que cambios posteriores no alteren lo ya pagado.
-- ---------------------------------------------------------------------
create table if not exists public.periodos (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas(id) on delete cascade,
  fecha_inicio   date not null,
  fecha_fin      date not null,
  estado         text not null default 'abierto' check (estado in ('abierto','cerrado')),
  resultado      jsonb,
  cerrado_por    uuid references auth.users(id),
  cerrado_en     timestamptz,
  creado_en      timestamptz not null default now(),
  check (fecha_fin >= fecha_inicio),
  unique (empresa_id, fecha_inicio, fecha_fin)
);

-- ---------------------------------------------------------------------
-- 7. Novedades del periodo (bonificaciones, descuentos, incapacidades…)
-- ---------------------------------------------------------------------
create table if not exists public.novedades (
  id            bigint generated always as identity primary key,
  empresa_id    uuid not null references public.empresas(id) on delete cascade,
  empleado_id   uuid not null references public.empleados(id) on delete cascade,
  fecha         date not null,
  tipo          text not null check (tipo in ('bonificacion_salarial','bonificacion_no_salarial','descuento','prestamo','incapacidad','licencia_no_remunerada','vacaciones')),
  valor         numeric(14,2) not null default 0,
  dias          numeric(5,2) not null default 0,
  descripcion   text,
  creado_en     timestamptz not null default now()
);
create index if not exists idx_novedades_empleado_fecha on public.novedades(empleado_id, fecha);

-- =====================================================================
-- 8. Seguridad (Row Level Security)
--    Soporte TI (admin/tecnico) ve todas las empresas; los usuarios
--    'cliente' solo ven las empresas que tienen asignadas.
-- =====================================================================
alter table public.usuarios_perfil     enable row level security;
alter table public.usuarios_empresas   enable row level security;
alter table public.empresas            enable row level security;
alter table public.dispositivos        enable row level security;
alter table public.empleados           enable row level security;
alter table public.marcaciones         enable row level security;
alter table public.parametros_legales  enable row level security;
alter table public.periodos            enable row level security;
alter table public.novedades           enable row level security;

-- Perfiles: cada quien ve el suyo; el admin ve y edita todos
drop policy if exists perfil_select on public.usuarios_perfil;
create policy perfil_select on public.usuarios_perfil for select to authenticated
  using (id = (select auth.uid()) or public.es_admin());
drop policy if exists perfil_admin on public.usuarios_perfil;
create policy perfil_admin on public.usuarios_perfil for update to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- Asignación de usuarios a empresas: solo el admin la administra
drop policy if exists ue_select on public.usuarios_empresas;
create policy ue_select on public.usuarios_empresas for select to authenticated
  using (usuario_id = (select auth.uid()) or public.es_staff());
drop policy if exists ue_admin on public.usuarios_empresas;
create policy ue_admin on public.usuarios_empresas for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- Empresas: el staff las crea y edita; el cliente solo ve las suyas
drop policy if exists empresas_select on public.empresas;
create policy empresas_select on public.empresas for select to authenticated
  using (public.puede_ver_empresa(id));
drop policy if exists empresas_staff on public.empresas;
create policy empresas_staff on public.empresas for all to authenticated
  using (public.es_staff()) with check (public.es_staff());

-- Dispositivos: los configura el staff; el cliente los ve
drop policy if exists dispositivos_select on public.dispositivos;
create policy dispositivos_select on public.dispositivos for select to authenticated
  using (public.puede_ver_empresa(empresa_id));
drop policy if exists dispositivos_staff on public.dispositivos;
create policy dispositivos_staff on public.dispositivos for all to authenticated
  using (public.es_staff()) with check (public.es_staff());

-- Datos de nómina por empresa: quien pueda ver la empresa los opera
do $$
declare t text;
begin
  foreach t in array array['empleados','marcaciones','novedades'] loop
    execute format('drop policy if exists %1$s_rw on public.%1$s', t);
    execute format('create policy %1$s_rw on public.%1$s for all to authenticated using (public.puede_ver_empresa(empresa_id)) with check (public.puede_ver_empresa(empresa_id))', t);
  end loop;
end $$;

-- Periodos: un periodo cerrado solo lo modifica o borra un admin
drop policy if exists periodos_select on public.periodos;
drop policy if exists periodos_insert on public.periodos;
drop policy if exists periodos_update on public.periodos;
drop policy if exists periodos_delete on public.periodos;
create policy periodos_select on public.periodos for select to authenticated
  using (public.puede_ver_empresa(empresa_id));
create policy periodos_insert on public.periodos for insert to authenticated
  with check (public.puede_ver_empresa(empresa_id));
create policy periodos_update on public.periodos for update to authenticated
  using (public.puede_ver_empresa(empresa_id) and (estado = 'abierto' or public.es_admin()))
  with check (public.puede_ver_empresa(empresa_id));
create policy periodos_delete on public.periodos for delete to authenticated
  using (public.puede_ver_empresa(empresa_id) and (estado = 'abierto' or public.es_admin()));

-- Parámetros legales: todos leen, solo admin modifica
drop policy if exists parametros_select on public.parametros_legales;
create policy parametros_select on public.parametros_legales for select to authenticated using (true);
drop policy if exists parametros_admin on public.parametros_legales;
create policy parametros_admin on public.parametros_legales for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- Índices para las llaves foráneas usadas en las políticas
create index if not exists idx_usuarios_empresas_empresa on public.usuarios_empresas(empresa_id);
create index if not exists idx_marcaciones_empleado on public.marcaciones(empleado_id);
create index if not exists idx_marcaciones_dispositivo on public.marcaciones(dispositivo_id);
create index if not exists idx_novedades_empresa on public.novedades(empresa_id);
create index if not exists idx_periodos_cerrado_por on public.periodos(cerrado_por);

-- =====================================================================
-- 9. Enlace por empresa y administración de usuarios
--    (se puede correr sobre una base creada con una versión anterior)
-- =====================================================================
alter table public.empresas    add column if not exists slug text;
create unique index if not exists empresas_slug_key on public.empresas(slug);
alter table public.marcaciones add column if not exists tipo text;
do $$ begin
  alter table public.marcaciones add constraint marcaciones_tipo_check check (tipo in ('entrada','salida'));
exception when duplicate_object then null; end $$;

-- Nombre de la empresa para la pantalla de ingreso del enlace (sin iniciar sesión)
create or replace function public.empresa_por_slug(p_slug text)
returns table (id uuid, nombre text)
language sql stable security definer set search_path = public as $$
  select e.id, e.nombre from public.empresas e where e.slug = lower(p_slug) and e.activa;
$$;

-- Dar acceso a un usuario (ya creado en Authentication) a una empresa
create or replace function public.asignar_usuario_empresa(p_email text, p_empresa uuid)
returns text language plpgsql security definer set search_path = public, auth as $$
declare v_id uuid;
begin
  if not public.es_admin() then raise exception 'Solo un administrador puede dar accesos'; end if;
  select u.id into v_id from auth.users u where lower(u.email) = lower(trim(p_email));
  if v_id is null then
    raise exception 'No existe un usuario con el correo %. Créalo primero en Supabase → Authentication → Users.', p_email;
  end if;
  insert into public.usuarios_empresas (usuario_id, empresa_id) values (v_id, p_empresa) on conflict do nothing;
  return 'ok';
end $$;

create or replace function public.quitar_usuario_empresa(p_usuario uuid, p_empresa uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.es_admin() then raise exception 'Solo un administrador puede quitar accesos'; end if;
  delete from public.usuarios_empresas where usuario_id = p_usuario and empresa_id = p_empresa;
  return 'ok';
end $$;

-- Usuarios con acceso a una empresa (para la pantalla de Empresas)
create or replace function public.usuarios_de_empresa(p_empresa uuid)
returns table (usuario_id uuid, email text, rol text)
language sql stable security definer set search_path = public, auth as $$
  select u.id, u.email::text, p.rol
  from public.usuarios_empresas ue
  join auth.users u on u.id = ue.usuario_id
  left join public.usuarios_perfil p on p.id = u.id
  where ue.empresa_id = p_empresa and public.es_staff();
$$;

-- Permisos de ejecución: solo lo necesario para cada rol
revoke execute on function public.asignar_usuario_empresa(text, uuid) from public, anon;
revoke execute on function public.quitar_usuario_empresa(uuid, uuid) from public, anon;
revoke execute on function public.usuarios_de_empresa(uuid) from public, anon;
grant execute on function public.asignar_usuario_empresa(text, uuid) to authenticated;
grant execute on function public.quitar_usuario_empresa(uuid, uuid) to authenticated;
grant execute on function public.usuarios_de_empresa(uuid) to authenticated;
grant execute on function public.empresa_por_slug(text) to anon, authenticated;
