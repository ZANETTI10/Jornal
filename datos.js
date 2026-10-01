/* =====================================================================
   JORNAL · Capa de datos
   Misma interfaz para Supabase (producción) y para el modo demo
   (memoria del navegador, con datos de ejemplo).
   ===================================================================== */
(function () {
  'use strict';
  const cfg = window.JORNAL_CONFIG || {};
  // Si la persona llega desde el correo de invitación o de recuperación, el enlace
  // trae "type=invite" o "type=recovery"; se lee antes de que Supabase limpie la URL.
  const TIPO_ENLACE = (/[#&?]type=(invite|recovery)/.exec(location.hash + location.search) || [])[1] || null;
  const MODO_DEMO = !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase;

  // ------------------------------------------------------------------
  // Supabase
  // ------------------------------------------------------------------
  function crearSupabase() {
    const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    const aplicar = (q, f = {}) => {
      Object.entries(f.eq || {}).forEach(([k, v]) => { q = q.eq(k, v); });
      Object.entries(f.gte || {}).forEach(([k, v]) => { q = q.gte(k, v); });
      Object.entries(f.lte || {}).forEach(([k, v]) => { q = q.lte(k, v); });
      if (f.order) q = q.order(f.order, { ascending: f.asc !== false });
      return q;
    };
    const fallo = (error) => { if (error) throw new Error(error.message); };
    return {
      demo: false,
      async sesion() { const { data } = await sb.auth.getSession(); return data.session; },
      async entrar(email, clave) { const { error } = await sb.auth.signInWithPassword({ email, password: clave }); fallo(error); },
      async salir() { await sb.auth.signOut(); },
      async perfil() {
        const s = await this.sesion(); if (!s) return null;
        const { data } = await sb.from('usuarios_perfil').select('*').eq('id', s.user.id).maybeSingle();
        return { id: s.user.id, email: s.user.email, nombre: data?.nombre || s.user.email, rol: data?.rol || 'cliente' };
      },
      async listar(tabla, f) {
        // pagina de a 1000 filas (límite por defecto de Supabase)
        const filas = [];
        for (let desde = 0; ; desde += 1000) {
          const { data, error } = await aplicar(sb.from(tabla).select('*'), f).range(desde, desde + 999);
          fallo(error); filas.push(...data);
          if (data.length < 1000) return filas;
        }
      },
      async insertar(tabla, filas) {
        const salida = [];
        for (let i = 0; i < filas.length; i += 500) {
          const { data, error } = await sb.from(tabla).insert(filas.slice(i, i + 500)).select(); fallo(error); salida.push(...data);
        }
        return salida;
      },
      async rpc(nombre, args) { const { data, error } = await sb.rpc(nombre, args); fallo(error); return data; },
      tipoEnlace: TIPO_ENLACE,
      async cambiarClave(clave) { const { error } = await sb.auth.updateUser({ password: clave }); fallo(error); },
      async recuperarClave(email, volverA) { const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: volverA }); fallo(error); },
      async invitar(datos) {
        const s = await this.sesion();
        const r = await fetch(`${cfg.SUPABASE_URL}/functions/v1/invitar-usuario`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: cfg.SUPABASE_ANON_KEY, Authorization: `Bearer ${s ? s.access_token : cfg.SUPABASE_ANON_KEY}` },
          body: JSON.stringify(datos),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'No se pudo enviar la invitación');
        return j;
      },
      async actualizar(tabla, id, cambios) { const { error } = await sb.from(tabla).update(cambios).eq('id', id); fallo(error); },
      async eliminar(tabla, id) { const { error } = await sb.from(tabla).delete().eq('id', id); fallo(error); },
      async guardarMarcaciones(filas) {
        let nuevas = 0;
        for (let i = 0; i < filas.length; i += 500) {
          const lote = filas.slice(i, i + 500);
          const { data, error } = await sb.from('marcaciones')
            .upsert(lote, { onConflict: 'empresa_id,codigo_biometrico,fecha_hora', ignoreDuplicates: true }).select('id');
          fallo(error); nuevas += data.length;
        }
        return nuevas;
      },
    };
  }

  // ------------------------------------------------------------------
  // Modo demo: todo en memoria
  // ------------------------------------------------------------------
  function crearDemo() {
    const t = datosDemo();
    let seq = 1000;
    const id = () => 'demo-' + (++seq);
    const cumple = (fila, f = {}) =>
      Object.entries(f.eq || {}).every(([k, v]) => fila[k] === v) &&
      Object.entries(f.gte || {}).every(([k, v]) => String(fila[k]) >= String(v)) &&
      Object.entries(f.lte || {}).every(([k, v]) => String(fila[k]) <= String(v));
    return {
      demo: true,
      async sesion() { return { user: { email: 'demo@soporteti.co' } }; },
      async entrar() {}, async salir() {},
      tipoEnlace: null,
      async cambiarClave() {}, async recuperarClave() {},
      async invitar(d) { (t.accesos = t.accesos || []).push({ usuario_id: 'u' + (++seq), email: d.email, nombre: d.nombre, rol: d.rol || 'cliente', empresa_id: d.empresa_id }); return { ok: true, estado: 'invitado', email: d.email }; },
      async perfil() { return { id: 'demo-user', email: 'demo@soporteti.co', nombre: 'Modo demo', rol: 'admin' }; },
      async rpc(nombre, args) {
        if (nombre === 'empresa_por_slug') return t.empresas.filter((e) => e.slug === String(args.p_slug).toLowerCase()).map((e) => ({ id: e.id, nombre: e.nombre }));
        if (nombre === 'usuarios_de_empresa') return (t.accesos || []).filter((a) => a.empresa_id === args.p_empresa);
        if (nombre === 'asignar_usuario_empresa') { (t.accesos = t.accesos || []).push({ usuario_id: 'u' + (++seq), email: args.p_email, rol: 'cliente', empresa_id: args.p_empresa }); return 'ok'; }
        if (nombre === 'listar_usuarios') return (t.accesos || []).map((a) => ({ usuario_id: a.usuario_id, email: a.email, nombre: a.nombre || '', rol: a.rol, confirmado: false, empresas: t.empresas.filter((e) => e.id === a.empresa_id).map((e) => ({ id: e.id, nombre: e.nombre })) }));
        if (nombre === 'cambiar_rol_usuario') { (t.accesos || []).filter((a) => a.usuario_id === args.p_usuario).forEach((a) => { a.rol = args.p_rol; }); return 'ok'; }
        if (nombre === 'asignar_empresa_usuario') { const a = (t.accesos || []).find((x) => x.usuario_id === args.p_usuario); if (a) t.accesos.push({ ...a, empresa_id: args.p_empresa }); return 'ok'; }
        if (nombre === 'quitar_usuario_empresa') { t.accesos = (t.accesos || []).filter((a) => !(a.usuario_id === args.p_usuario && a.empresa_id === args.p_empresa)); return 'ok'; }
        return null;
      },
      async listar(tabla, f = {}) {
        let filas = (t[tabla] || []).filter((x) => cumple(x, f)).map((x) => ({ ...x }));
        if (f.order) filas.sort((a, b) => String(a[f.order]).localeCompare(String(b[f.order])) * (f.asc === false ? -1 : 1));
        return filas;
      },
      async insertar(tabla, filas) {
        const nuevas = filas.map((x) => ({ id: id(), creado_en: new Date().toISOString(), ...x }));
        (t[tabla] = t[tabla] || []).push(...nuevas); return nuevas;
      },
      async actualizar(tabla, idFila, cambios) { const f = t[tabla].find((x) => x.id === idFila); if (f) Object.assign(f, cambios); },
      async eliminar(tabla, idFila) { t[tabla] = t[tabla].filter((x) => x.id !== idFila); },
      async guardarMarcaciones(filas) {
        const llave = (m) => `${m.empresa_id}|${m.codigo_biometrico}|${m.fecha_hora}`;
        const existentes = new Set(t.marcaciones.map(llave));
        const nuevas = filas.filter((m) => !existentes.has(llave(m)));
        await this.insertar('marcaciones', nuevas);
        return nuevas.length;
      },
    };
  }

  // Datos de ejemplo: una floricultora y un taller con turnos reales de septiembre 2026
  function datosDemo() {
    const E1 = 'demo-emp-1', E2 = 'demo-emp-2';
    const empresas = [
      { id: E1, nombre: 'Floricultora Altamira (demo)', slug: 'altamira', nit: '900.000.001-1', ciudad: 'Rionegro', periodicidad: 'quincenal', exonerada_aportes: true, activa: true },
      { id: E2, nombre: 'Taller Mecánico El Llano (demo)', slug: 'el-llano', nit: '900.000.002-2', ciudad: 'Marinilla', periodicidad: 'quincenal', exonerada_aportes: true, activa: true },
    ];
    const base = { tipo_salario: 'ordinario', tipo_contrato: 'indefinido', dias_laborales_semana: 6, auxilio_transporte: true, activo: true, eps: 'Sura', afp: 'Protección', ccf: 'Comfama' };
    const empleados = [
      { ...base, id: 'demo-e1', empresa_id: E1, documento: '1036600111', nombres: 'Luz Marina', apellidos: 'Ospina Gómez', cargo: 'Operaria de poscosecha', salario: 1750905, fecha_ingreso: '2023-02-01', arl_riesgo: 1, codigo_biometrico: '1' },
      { ...base, id: 'demo-e2', empresa_id: E1, documento: '1036600222', nombres: 'Jhon Fredy', apellidos: 'Zapata Ríos', cargo: 'Celador', salario: 1900000, fecha_ingreso: '2022-08-16', arl_riesgo: 2, codigo_biometrico: '2' },
      { ...base, id: 'demo-e3', empresa_id: E1, documento: '1036600333', nombres: 'Daniela', apellidos: 'Henao Restrepo', cargo: 'Supervisora de cultivo', salario: 3200000, fecha_ingreso: '2021-03-01', arl_riesgo: 3, codigo_biometrico: '3' },
      { ...base, id: 'demo-e4', empresa_id: E1, documento: '1036600444', nombres: 'Carlos Andrés', apellidos: 'Muñoz Valencia', cargo: 'Fumigador', salario: 1850000, fecha_ingreso: '2026-09-21', arl_riesgo: 4, codigo_biometrico: '4' },
      { ...base, id: 'demo-e5', empresa_id: E1, documento: '1036600555', nombres: 'Sandra Milena', apellidos: 'Arango Duque', cargo: 'Jefa administrativa', salario: 6500000, fecha_ingreso: '2020-01-13', arl_riesgo: 1, codigo_biometrico: '5', dias_laborales_semana: 5, auxilio_transporte: false },
      { ...base, id: 'demo-e6', empresa_id: E2, documento: '1036600666', nombres: 'Wilmar', apellidos: 'Castaño Giraldo', cargo: 'Mecánico', salario: 2400000, fecha_ingreso: '2024-05-02', arl_riesgo: 3, codigo_biometrico: '1' },
    ];

    // Marcaciones 1–30 sept 2026
    const marcaciones = [];
    let n = 0;
    const marca = (emp, cod, dia, hhmm) => marcaciones.push({ id: 'demo-m' + (++n), empresa_id: emp, codigo_biometrico: cod, fecha_hora: `2026-09-${String(dia).padStart(2, '0')} ${hhmm}:00`, origen: 'archivo', anulada: false });
    const turno = (emp, cod, dia, ent, sal) => { marca(emp, cod, dia, ent); const [h] = sal.split(':'); const diaSal = +h < +ent.split(':')[0] ? dia + 1 : dia; if (diaSal <= 30) marca(emp, cod, diaSal, sal); };
    const jitter = (d, k) => String((d * 7 + k * 3) % 9).padStart(2, '0');
    for (let d = 1; d <= 30; d++) {
      const w = new Date(Date.UTC(2026, 8, d)).getUTCDay();         // 0 = domingo
      if (w !== 0) {
        // Operaria: 6:00–13:00, sábados largos (temporada) hasta 15:30
        turno(E1, '1', d, `05:5${d % 9}`, w === 6 ? '15:30' : `13:0${d % 7}`);
        // Supervisora: 7:00–15:00, a veces se queda tarde
        if (d !== 29 && d !== 30) turno(E1, '3', d, `06:${50 + (d % 9)}`, d % 4 === 0 ? '17:45' : '15:05');   // incapacitada 29–30
        // Administrativa: lunes a viernes 8:00–17:00 con almuerzo marcado
        if (w !== 6) { marca(E1, '5', d, `07:5${d % 8}`); marca(E1, '5', d, '12:30'); marca(E1, '5', d, '13:28'); marca(E1, '5', d, `17:0${d % 6}`); }
        // Mecánico
        turno(E2, '1', d, `07:${jitter(d, 1)}`, w === 6 ? '12:00' : '16:00');
      } else if (d === 20) {
        turno(E1, '1', d, '06:00', '12:00');     // domingo de temporada
      }
      // Celador: turno de noche 18:00–06:00, descansa los martes
      if (w !== 2) turno(E1, '2', d, '18:00', '06:00');
      // Fumigador (ingresó el 21)
      if (d >= 21 && w !== 0) turno(E1, '4', d, '05:30', '12:30');
    }
    // Una marcación sin pareja para mostrar inconsistencias
    marcaciones.push({ id: 'demo-m' + (++n), empresa_id: E1, codigo_biometrico: '3', fecha_hora: '2026-09-25 12:02:00', origen: 'archivo', anulada: false });
    marcaciones.forEach((m) => { const e = empleados.find((x) => x.empresa_id === m.empresa_id && x.codigo_biometrico === m.codigo_biometrico); m.empleado_id = e ? e.id : null; });

    const novedades = [
      { id: 'demo-n1', empresa_id: E1, empleado_id: 'demo-e1', fecha: '2026-09-30', tipo: 'bonificacion_no_salarial', valor: 80000, dias: 0, descripcion: 'Bono de temporada' },
      { id: 'demo-n2', empresa_id: E1, empleado_id: 'demo-e2', fecha: '2026-09-30', tipo: 'prestamo', valor: 150000, dias: 0, descripcion: 'Cuota 2 de 6' },
      { id: 'demo-n3', empresa_id: E1, empleado_id: 'demo-e3', fecha: '2026-09-29', tipo: 'incapacidad', valor: 0, dias: 2, descripcion: 'Incapacidad EPS' },
    ];
    const parametros_legales = [
      { id: 1, vigente_desde: '2026-01-01', smmlv: 1750905, auxilio_transporte: 249095, jornada_semanal: 44, inicio_nocturno: '19:00', fin_nocturno: '06:00', recargo_nocturno: 0.35, recargo_dominical: 0.80, extra_diurna: 0.25, extra_nocturna: 0.75, norma: 'Dec. 1469 y 1470 de 2025; Ley 2466 de 2025 (dominical 80 %); jornada 44 h' },
      { id: 2, vigente_desde: '2026-07-01', smmlv: 1750905, auxilio_transporte: 249095, jornada_semanal: 44, inicio_nocturno: '19:00', fin_nocturno: '06:00', recargo_nocturno: 0.35, recargo_dominical: 0.90, extra_diurna: 0.25, extra_nocturna: 0.75, norma: 'Ley 2466 de 2025 art. 14: dominical/festivo 90 %' },
      { id: 3, vigente_desde: '2026-07-15', smmlv: 1750905, auxilio_transporte: 249095, jornada_semanal: 42, inicio_nocturno: '19:00', fin_nocturno: '06:00', recargo_nocturno: 0.35, recargo_dominical: 0.90, extra_diurna: 0.25, extra_nocturna: 0.75, norma: 'Ley 2101 de 2021: jornada 42 h semanales' },
    ];
    return { empresas, empleados, marcaciones, novedades, parametros_legales, periodos: [] };
  }

  window.JornalDatos = MODO_DEMO ? crearDemo() : crearSupabase();
})();
