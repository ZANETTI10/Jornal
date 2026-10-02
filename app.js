/* =====================================================================
   JORNAL · Interfaz
   ===================================================================== */
(function () {
  'use strict';
  const db = window.JornalDatos;
  const C = window.JornalCalc;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const pesos = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  const $f = (v) => pesos.format(Math.round(+v || 0));
  const h2 = (v) => (+v || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const fechaLarga = (iso) => { const d = C.aFecha(iso); return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} ${MESES[d.getUTCMonth()].slice(0, 3)}`; };

  const SLUG = (new URLSearchParams(location.search).get('empresa') || '').trim().toLowerCase();
  const esStaff = () => estado.perfil && (estado.perfil.rol === 'admin' || estado.perfil.rol === 'tecnico');
  const esAdmin = () => estado.perfil && estado.perfil.rol === 'admin';
  const enlaceEmpresa = (e) => `${location.origin}${location.pathname}?empresa=${encodeURIComponent(e.slug)}`;
  const hacerSlug = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\(.*?\)/g, '').replace(/s\.?a\.?s\.?|ltda\.?/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const estado = { perfil: null, empresas: [], empresaId: null, empleados: [], parametros: [], liquidacion: null, periodo: null, seleccionado: null };
  const empresaActual = () => estado.empresas.find((e) => e.id === estado.empresaId);
  const nombreEmpleado = (e) => (e ? `${e.nombres} ${e.apellidos || ''}`.trim() : 'Sin asignar');

  function aviso(texto) {
    const el = $('#aviso'); el.textContent = texto; el.hidden = false;
    clearTimeout(aviso.t); aviso.t = setTimeout(() => { el.hidden = true; }, 3500);
  }
  async function intentar(fn) {
    try { return await fn(); } catch (e) { console.error(e); aviso('No se pudo completar: ' + e.message); return undefined; }
  }

  // ------------------------------------------------------------------
  // Arranque y sesión
  // ------------------------------------------------------------------
  async function iniciar() {
    const sesion = await db.sesion();
    if (!sesion) {
      $('#pantalla-login').hidden = false; $('#app').hidden = true;
      if (SLUG) {
        try {
          const [e] = (await db.rpc('empresa_por_slug', { p_slug: SLUG })) || [];
          const el = $('#login-empresa');
          el.textContent = e ? e.nombre : 'Este enlace no corresponde a ninguna empresa activa.';
          el.hidden = false;
        } catch (err) { /* sin nombre: el ingreso funciona igual */ }
      }
      return;
    }
    $('#pantalla-login').hidden = true;
    estado.perfil = await db.perfil();
    if (estado.perfil.debeCambiar && !estado.claveLista) {
      // contraseña temporal asignada por el administrador: debe cambiarla antes de seguir
      $('#pantalla-clave').hidden = false; $('#app').hidden = true;
      return;
    }
    $('#pantalla-clave').hidden = true; $('#app').hidden = false;
    const ROLES = { admin: 'Administrador', tecnico: 'Técnico', cliente: 'Empresa' };
    $('#usuario-nombre').textContent = `${estado.perfil.nombre} · ${ROLES[estado.perfil.rol] || estado.perfil.rol}`;
    $('#chip-demo').hidden = !db.demo;
    $('#btn-salir').hidden = db.demo;
    // Las empresas cliente no administran empresas ni parámetros legales
    $$('[data-vista="empresas"], [data-vista="parametros"]').forEach((b) => { b.hidden = !esStaff(); });
    $$('[data-vista="usuarios"]').forEach((b) => { b.hidden = !esAdmin(); });
    estado.parametros = await db.listar('parametros_legales', { order: 'vigente_desde' });
    await cargarEmpresas();
    if (!estado.empresas.length) {
      $('#liq-vacio').innerHTML = esStaff()
        ? '<h2>Agrega tu primera empresa</h2><p>Ve a la pestaña Empresas y crea la empresa cliente. Luego importa el archivo de su biométrico en Asistencia.</p>'
        : '<h2>Tu usuario todavía no tiene una empresa asignada</h2><p>Pídele a Soporte TI que te dé acceso a tu empresa.</p>';
    }
    prepararPeriodo();
    mostrarVista('tablero');
  }

  $('#form-login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = $('#login-error'); err.hidden = true;
    try { await db.entrar($('#login-email').value.trim(), $('#login-clave').value); iniciar(); }
    catch (e) { err.textContent = 'Usuario o contraseña incorrectos.'; err.hidden = false; }
  });
  $('#btn-salir').addEventListener('click', async () => { await db.salir(); location.reload(); });

  $('#form-clave').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = $('#clave-error'); err.hidden = true;
    const a = $('#clave-nueva').value, b = $('#clave-repite').value;
    if (a.length < 8) { err.textContent = 'La contraseña debe tener al menos 8 caracteres.'; err.hidden = false; return; }
    if (a !== b) { err.textContent = 'Las dos contraseñas no coinciden.'; err.hidden = false; return; }
    try {
      await db.cambiarClave(a);
      estado.claveLista = true;
      $('#clave-nueva').value = ''; $('#clave-repite').value = '';
      aviso('Contraseña actualizada'); iniciar();
    } catch (e) {
      const igual = /different from the old|same/i.test(e.message);
      err.textContent = igual ? 'La contraseña nueva debe ser distinta a la temporal.' : 'No se pudo guardar: ' + e.message; err.hidden = false;
    }
  });

  async function cargarEmpresas() {
    estado.empresas = await db.listar('empresas', { order: 'nombre' });
    const sel = $('#sel-empresa');
    sel.innerHTML = estado.empresas.length
      ? estado.empresas.map((e) => `<option value="${e.id}">${esc(e.nombre)}</option>`).join('')
      : '<option value="">Primero agrega una empresa</option>';
    if (SLUG && !estado.empresaId) {
      const porSlug = estado.empresas.find((e) => e.slug === SLUG);
      if (porSlug) estado.empresaId = porSlug.id;
      else if (estado.empresas.length) aviso('Tu usuario no tiene acceso a la empresa de este enlace.');
    }
    if (!estado.empresas.find((e) => e.id === estado.empresaId)) estado.empresaId = estado.empresas[0]?.id || null;
    sel.value = estado.empresaId || '';
    // Un usuario de empresa con una sola empresa no necesita el selector
    sel.disabled = !esStaff() && estado.empresas.length <= 1;
    await cargarEmpleados();
  }
  async function cargarEmpleados() {
    estado.empleados = estado.empresaId ? await db.listar('empleados', { eq: { empresa_id: estado.empresaId }, order: 'nombres' }) : [];
    const opciones = estado.empleados.filter((e) => e.activo !== false).map((e) => `<option value="${e.id}">${esc(nombreEmpleado(e))}</option>`).join('');
    $('#man-empleado').innerHTML = opciones;
    $('#asis-empleado').innerHTML = '<option value="">Todos</option>' + opciones;
  }
  $('#sel-empresa').addEventListener('change', async (ev) => {
    estado.empresaId = ev.target.value; limpiarLiquidacion();
    await cargarEmpleados(); refrescarVistaActual();
  });

  // ------------------------------------------------------------------
  // Pestañas
  // ------------------------------------------------------------------
  let vistaActual = 'liquidacion';
  function mostrarVista(v) {
    vistaActual = v;
    $$('.pestanas button').forEach((b) => b.classList.toggle('activa', b.dataset.vista === v));
    $$('.vista').forEach((s) => { s.hidden = s.id !== 'vista-' + v; });
    refrescarVistaActual();
  }
  function refrescarVistaActual() {
    ({ tablero: pintarTablero, empleados: pintarEmpleados, empresas: pintarEmpresas, novedades: pintarNovedades, parametros: pintarParametros, asistencia: verAsistencia, usuarios: pintarUsuarios }[vistaActual] || (() => {}))();
  }
  $$('.pestanas button').forEach((b) => b.addEventListener('click', () => mostrarVista(b.dataset.vista)));

  // ------------------------------------------------------------------
  // Periodo de liquidación
  // ------------------------------------------------------------------
  function prepararPeriodo() {
    // por defecto: la última quincena cerrada
    const hoy = new Date(); const d = hoy.getDate();
    let anio = hoy.getFullYear(), mes = hoy.getMonth() + 1, tramo = 'q1';
    if (d <= 15) { mes -= 1; tramo = 'q2'; if (mes === 0) { mes = 12; anio -= 1; } }
    $('#liq-mes').value = `${anio}-${String(mes).padStart(2, '0')}`;
    $('#liq-tramo').value = tramo;
    if (db.demo) { $('#liq-mes').value = '2026-09'; $('#liq-tramo').value = 'q2'; }
    $('#tab-mes').value = $('#liq-mes').value; $('#tab-tramo').value = $('#liq-tramo').value;
    actualizarRango();
  }
  function rangoPeriodo(pref = 'liq') {
    const [a, m] = $('#' + pref + '-mes').value.split('-').map(Number);
    if (!a) return null;
    const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
    const mm = String(m).padStart(2, '0');
    const t = $('#' + pref + '-tramo').value;
    if (t === 'q1') return { inicio: `${a}-${mm}-01`, fin: `${a}-${mm}-15` };
    if (t === 'q2') return { inicio: `${a}-${mm}-16`, fin: `${a}-${mm}-${ultimo}` };
    return { inicio: `${a}-${mm}-01`, fin: `${a}-${mm}-${ultimo}` };
  }
  function actualizarRango() {
    const r = rangoPeriodo();
    $('#liq-rango').textContent = r ? `${fechaLarga(r.inicio)} → ${fechaLarga(r.fin)} · ${C.dias360(r.inicio, r.fin)} días` : '—';
    limpiarLiquidacion();
  }
  $('#liq-mes').addEventListener('change', actualizarRango);
  $('#liq-tramo').addEventListener('change', actualizarRango);
  ['#tab-mes', '#tab-tramo'].forEach((id) => $(id).addEventListener('change', () => {
    $('#liq-mes').value = $('#tab-mes').value; $('#liq-tramo').value = $('#tab-tramo').value;
    actualizarRango(); pintarTablero();
  }));

  function limpiarLiquidacion() {
    estado.liquidacion = null; estado.periodo = null; estado.seleccionado = null;
    $('#tabla-liq').hidden = true; $('#detalle').hidden = true; $('#liq-resumen').innerHTML = '';
    $('#liq-vacio').hidden = false; $('#liq-estado').hidden = true;
    $('#btn-excel').disabled = true; $('#btn-cerrar').disabled = true;
  }

  // ------------------------------------------------------------------
  // Calcular
  // ------------------------------------------------------------------
  async function calcular() {
    const r = rangoPeriodo(); const empresa = empresaActual();
    if (!r || !empresa) { aviso('Elige una empresa y un periodo.'); return; }
    await intentar(async () => {
      const res = await obtenerLiquidacion(empresa, r);
      estado.periodo = res.periodo; estado.liquidacion = res.liquidacion;
      pintarLiquidacion();
    });
  }
  // Liquidación de un periodo: la foto guardada si está cerrado, o el cálculo con los datos actuales
  async function obtenerLiquidacion(empresa, r) {
    const periodos = await db.listar('periodos', { eq: { empresa_id: empresa.id, fecha_inicio: r.inicio, fecha_fin: r.fin } });
    const periodo = periodos[0] || null;
    if (periodo && periodo.estado === 'cerrado' && periodo.resultado) return { periodo, liquidacion: periodo.resultado, marcaciones: null };
    const margenIni = C.isoDia(C.sumarDias(C.aFecha(r.inicio), -1));
    const margenFin = C.isoDia(C.sumarDias(C.aFecha(r.fin), 2));
    const [marcaciones, novedades] = await Promise.all([
      db.listar('marcaciones', { eq: { empresa_id: empresa.id, anulada: false }, gte: { fecha_hora: margenIni }, lte: { fecha_hora: margenFin } }),
      db.listar('novedades', { eq: { empresa_id: empresa.id }, gte: { fecha: r.inicio }, lte: { fecha: r.fin } }),
    ]);
    const empleados = estado.empleados.filter((e) => e.activo !== false || (e.fecha_retiro && e.fecha_retiro >= r.inicio));
    const liquidacion = C.liquidarPeriodo({ empresa, empleados, marcaciones, novedades, parametros: estado.parametros, inicio: r.inicio, fin: r.fin });
    return { periodo, liquidacion, marcaciones };
  }

  // ------------------------------------------------------------------
  // Tablero gerencial de la empresa
  // ------------------------------------------------------------------
  const EXT = ['HED', 'HEN', 'HEDDF', 'HENDF'], REC = ['RN', 'RDF', 'RNDF'];
  const TOPE_EXTRA_DIA = 2, TOPE_EXTRA_SEMANA = 12;      // máximo legal de horas extra (CST art. 22 Ley 50/1990)

  function periodoAnterior(r) {
    const ini = C.aFecha(r.inicio);
    const finAnt = C.isoDia(C.sumarDias(ini, -1));
    if (ini.getUTCDate() === 16) return { inicio: r.inicio.slice(0, 8) + '01', fin: finAnt };
    if (C.dias360(r.inicio, r.fin) <= 15) return { inicio: finAnt.slice(0, 8) + '16', fin: finAnt };
    return { inicio: finAnt.slice(0, 8) + '01', fin: finAnt };
  }
  const etiquetaPeriodo = (r) => {
    const mes = MESES[+r.inicio.slice(5, 7) - 1].slice(0, 3);
    if (r.inicio.slice(8) === '16') return `2Q ${mes}`;
    return C.dias360(r.inicio, r.fin) <= 15 ? `1Q ${mes}` : mes;
  };

  function metricas(L, r) {
    const E = L.empleados; const suma = (f) => E.reduce((s, e) => s + f(e), 0);
    const horas = suma((e) => Object.values(e.horas).reduce((a, b) => a + b, 0));
    const hExtra = suma((e) => EXT.reduce((a, c) => a + e.horas[c], 0));
    const vExtra = suma((e) => EXT.reduce((a, c) => a + e.valores[c], 0));
    const vRec = suma((e) => REC.reduce((a, c) => a + e.valores[c], 0));
    // Asistencia estimada: días con marcación frente a los días laborales esperados
    const diasCal = Math.round((C.aFecha(r.fin) - C.aFecha(r.inicio)) / 86400000) + 1;
    const dias360 = C.dias360(r.inicio, r.fin) || 1;
    const fichas = new Map(estado.empleados.map((e) => [e.id, e]));
    let esperados = 0, asistidos = 0;
    // Topes legales de horas extra
    let diasSobreTope = 0; const sobreDia = new Set(), sobreSemana = new Set();
    E.forEach((e) => {
      const dl = +(fichas.get(e.empleado_id) || {}).dias_laborales_semana || 6;
      const esp = diasCal * (dl / 7) * Math.min(1, e.dias / dias360);
      esperados += esp; asistidos += Math.min(e.detalleDias.length, esp);
      const semanas = {};
      e.detalleDias.forEach((d) => {
        const x = EXT.reduce((a, c) => a + (d.horas[c] || 0), 0);
        if (x > TOPE_EXTRA_DIA + 0.01) { diasSobreTope += 1; sobreDia.add(e.nombre); }
        const f = C.aFecha(d.fecha); const lunes = C.isoDia(C.sumarDias(f, -((f.getUTCDay() + 6) % 7)));
        semanas[lunes] = (semanas[lunes] || 0) + x;
      });
      if (Object.values(semanas).some((v) => v > TOPE_EXTRA_SEMANA + 0.01)) sobreSemana.add(e.nombre);
    });
    return {
      diasCal, diasConDatos: new Set(E.flatMap((e) => e.detalleDias.map((x) => x.fecha))).size,
      personas: E.length, conMarcas: E.filter((e) => e.detalleDias.length).length,
      horas, hExtra, vExtra, vRec,
      hOrd: suma((e) => e.horas.ORD), hNoct: suma((e) => e.horas.RN),
      hDom: suma((e) => e.horas.RDF + e.horas.RNDF), hExtDiur: suma((e) => e.horas.HED), hExtNoct: suma((e) => e.horas.HEN),
      hExtDom: suma((e) => e.horas.HEDDF + e.horas.HENDF),
      neto: L.totales.neto, devengado: L.totales.devengado, aportes: L.totales.aportes, provisiones: L.totales.provisiones, costo: L.totales.costo,
      costoHora: horas ? L.totales.costo / horas : 0,
      asistencia: esperados ? asistidos / esperados : 0,
      porRevisar: suma((e) => e.inconsistencias.length),
      diasSobreTope, sobreDia: [...sobreDia], sobreSemana: [...sobreSemana],
    };
  }

  // Variación frente al periodo anterior, con flecha y texto (nunca solo color)
  function delta(actual, anterior, menosEsMejor) {
    if (!anterior || !isFinite(anterior)) return '<small class="tenue">sin periodo anterior para comparar</small>';
    const v = (actual - anterior) / anterior;
    if (Math.abs(v) < 0.005) return '<small class="tenue">igual que el periodo anterior</small>';
    const bien = menosEsMejor ? v < 0 : v > 0;
    return `<small class="delta ${bien ? 'delta-bien' : 'delta-mal'}">${v > 0 ? '▲' : '▼'} ${Math.abs(Math.round(v * 100))} % frente al periodo anterior</small>`;
  }
  const barras = (items, fmt) => {
    const max = Math.max(1, ...items.map((i) => i.valor));
    const total = items.reduce((s, i) => s + i.valor, 0) || 1;
    return items.map((i) => `<div class="fila-barra" title="${esc(i.nombre)}: ${fmt(i.valor)} (${Math.round((i.valor / total) * 100)} %)">
      <span class="fila-nombre">${esc(i.nombre)}</span><span class="fila-pista"><span class="fila-valor" style="width:${(i.valor / max) * 100}%"></span></span>
      <span class="fila-num">${fmt(i.valor)} · ${Math.round((i.valor / total) * 100)} %</span></div>`).join('');
  };

  let tableroPeticion = 0;
  async function pintarTablero() {
    const cont = $('#tablero');
    const r = rangoPeriodo('tab'); const empresa = empresaActual();
    $('#tab-rango').textContent = r ? `${fechaLarga(r.inicio)} → ${fechaLarga(r.fin)}` : '—';
    if (!empresa) { cont.innerHTML = $('#liq-vacio').innerHTML; return; }
    const yo = ++tableroPeticion;
    cont.innerHTML = '<p class="nota">Calculando…</p>';
    const rAnt = periodoAnterior(r);
    const datos = await intentar(() => Promise.all([obtenerLiquidacion(empresa, r), obtenerLiquidacion(empresa, rAnt)]));
    if (yo !== tableroPeticion || !datos) return;
    const [res, resAnt] = datos;
    const L = res.liquidacion, E = L.empleados;
    const m = metricas(L, r), a = metricas(resAnt.liquidacion, rAnt);
    // Solo se compara si el periodo anterior tiene marcaciones en al menos la mitad de sus días
    const hayAnterior = a.diasConDatos >= a.diasCal / 2;
    const sinComparar = a.diasConDatos ? 'el periodo anterior está incompleto' : 'sin datos del periodo anterior';
    const d = (act, ant, menos) => (hayAnterior ? delta(act, ant, menos) : `<small class="tenue">${sinComparar}</small>`);
    const fichas = estado.empleados.filter((e) => String(e.documento).startsWith('ZK-')).length;
    const cerrado = res.periodo && res.periodo.estado === 'cerrado';
    const extras = (e) => EXT.reduce((s, c) => s + e.horas[c], 0);
    const vExtras = (e) => EXT.reduce((s, c) => s + e.valores[c], 0);

    // Horas por día
    const porDia = {};
    E.forEach((e) => e.detalleDias.forEach((dd) => {
      const h = Object.values(dd.horas).reduce((x, y) => x + y, 0);
      porDia[dd.fecha] = porDia[dd.fecha] || { h: 0, personas: 0 }; porDia[dd.fecha].h += h; porDia[dd.fecha].personas += 1;
    }));
    const dias = [];
    for (let f = C.aFecha(r.inicio); C.isoDia(f) <= r.fin; f = C.sumarDias(f, 1)) dias.push(C.isoDia(f));
    const maxDia = Math.max(1, ...dias.map((x) => (porDia[x] || { h: 0 }).h));
    const barrasDia = dias.map((x) => {
      const v = porDia[x] || { h: 0, personas: 0 }; const fest = C.esDominicalOFestivo(x);
      return `<div class="col${fest ? ' col-fest' : ''}" title="${fechaLarga(x)}${C.nombreFestivo(x) ? ' · ' + C.nombreFestivo(x) : ''}: ${h2(v.h)} h · ${v.personas} personas">
        <span class="col-barra" style="height:${Math.max(v.h ? 3 : 0, (v.h / maxDia) * 100)}%"></span><span class="col-dia">${+x.slice(8)}</span></div>`;
    }).join('');

    // Quién concentra las horas extra
    const top = [...E].sort((x, y) => extras(y) - extras(x)).filter((e) => extras(e) > 0).slice(0, 8);
    const maxExt = Math.max(1, ...top.map(extras));
    const barrasExt = top.map((e) => `<div class="fila-barra" title="${esc(e.nombre)}: ${h2(extras(e))} h extra · ${$f(vExtras(e))}">
        <span class="fila-nombre">${esc(e.nombre)}</span><span class="fila-pista"><span class="fila-valor" style="width:${(extras(e) / maxExt) * 100}%"></span></span><span class="fila-num">${h2(extras(e))} h · ${$f(vExtras(e))}</span></div>`).join('')
      || '<p class="nota">Nadie tiene horas extra en este periodo.</p>';
    const top3 = top.slice(0, 3).reduce((s, e) => s + extras(e), 0);

    const composicion = barras([
      { nombre: 'Salarios y auxilios', valor: Math.max(0, m.devengado - m.vRec - m.vExtra) },
      { nombre: 'Recargos nocturnos y dominicales', valor: m.vRec },
      { nombre: 'Horas extra', valor: m.vExtra },
      { nombre: 'Seguridad social y parafiscales', valor: m.aportes },
      { nombre: 'Prestaciones (provisión)', valor: m.provisiones },
    ], $f);
    const tipos = barras([
      { nombre: 'Ordinarias diurnas', valor: m.hOrd }, { nombre: 'Ordinarias nocturnas', valor: m.hNoct },
      { nombre: 'Dominicales y festivas', valor: m.hDom }, { nombre: 'Extra diurnas', valor: m.hExtDiur },
      { nombre: 'Extra nocturnas', valor: m.hExtNoct }, { nombre: 'Extra en dominical o festivo', valor: m.hExtDom },
    ].filter((i) => i.valor > 0), (v) => h2(v) + ' h') || '<p class="nota">Sin horas registradas en este periodo.</p>';

    const lista = (arr) => esc(arr.slice(0, 6).join(', ')) + (arr.length > 6 ? ` y ${arr.length - 6} más` : '');
    const alertas = [
      m.sobreSemana.length && `<div class="alerta alerta-critica"><strong>${m.sobreSemana.length}</strong> ${m.sobreSemana.length === 1 ? 'persona superó' : 'personas superaron'} las ${TOPE_EXTRA_SEMANA} horas extra en una semana, el máximo legal: ${lista(m.sobreSemana)}.</div>`,
      m.diasSobreTope && `<div class="alerta"><strong>${m.diasSobreTope}</strong> jornadas con más de ${TOPE_EXTRA_DIA} horas extra en el día (${m.sobreDia.length} personas): ${lista(m.sobreDia)}.</div>`,
      m.porRevisar && `<div class="alerta"><strong>${m.porRevisar}</strong> marcaciones sin pareja. Mientras no se corrijan, esas horas no se pagan. <button class="btn btn-mini" data-ir="asistencia" type="button">Revisar en Asistencia</button></div>`,
      fichas && `<div class="alerta"><strong>${fichas}</strong> empleados con ficha incompleta: las cifras en pesos usan el salario mínimo provisional. <button class="btn btn-mini" data-ir="empleados" type="button">Completar fichas</button></div>`,
    ].filter(Boolean).join('') || '<p class="nota">Sin alertas en este periodo.</p>';

    cont.innerHTML = `
      <div class="tablero-cabecera"><div><span class="eyebrow">${esc(empresa.nombre)} · Tablero gerencial</span>
        <h2>${fechaLarga(r.inicio)} a ${fechaLarga(r.fin)}</h2></div>
        ${cerrado ? '<span class="chip chip-ok">Periodo cerrado</span>' : '<span class="chip">Periodo en curso · cifras estimadas</span>'}</div>
      <div class="resumen">
        <div class="cifra destacada"><span class="eyebrow">Costo laboral total</span><b>${$f(m.costo)}</b>${d(m.costo, a.costo, true)}</div>
        <div class="cifra"><span class="eyebrow">Neto a pagar</span><b>${$f(m.neto)}</b><small>${m.personas} empleados</small></div>
        <div class="cifra"><span class="eyebrow">Costo por hora trabajada</span><b>${$f(m.costoHora)}</b>${d(m.costoHora, a.costoHora, true)}</div>
        <div class="cifra"><span class="eyebrow">Horas extra</span><b>${h2(m.hExtra)} h</b>${d(m.hExtra, a.hExtra, true)}</div>
        <div class="cifra"><span class="eyebrow">Costo de extras y recargos</span><b>${$f(m.vExtra + m.vRec)}</b><small>${m.devengado ? Math.round(((m.vExtra + m.vRec) / m.devengado) * 100) : 0} % de lo devengado</small></div>
        <div class="cifra"><span class="eyebrow">Asistencia estimada</span><b>${Math.round(m.asistencia * 100)} %</b><small>${m.conMarcas} de ${m.personas} personas marcaron</small></div>
      </div>
      <div class="tablero-grid">
        <div class="panel"><h3>En qué se va el costo laboral</h3><p class="nota">Lo que le cuesta el periodo a la empresa, incluido lo que no se le paga directo al trabajador.</p>${composicion}</div>
        <div class="panel"><h3>Horas trabajadas por tipo</h3><p class="nota">${h2(m.horas)} horas en total. Las extra son el ${m.horas ? Math.round((m.hExtra / m.horas) * 100) : 0} %.</p>${tipos}</div>
        <div class="panel"><h3>Horas trabajadas por día</h3><p class="nota">Todas las personas. Domingos y festivos resaltados.</p>
          <div class="columnas" role="img" aria-label="Horas trabajadas por día">${barrasDia}</div></div>
        <div class="panel"><h3>Quién concentra las horas extra</h3>${top.length ? `<p class="nota">Las 3 primeras personas hacen el ${Math.round((top3 / (m.hExtra || 1)) * 100)} % de las horas extra.</p>` : ''}${barrasExt}</div>
        <div class="panel"><h3>Costo laboral de los últimos periodos</h3><p class="nota">Costo total de la empresa por periodo.</p>
          <div id="tendencia" class="columnas columnas-anchas" role="img" aria-label="Costo laboral por periodo"><p class="nota">Calculando…</p></div></div>
        <div class="panel"><h3>Alertas para gerencia</h3><div class="alertas">${alertas}</div></div>
      </div>`;
    cont.querySelectorAll('[data-ir]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.ir === 'asistencia') { $('#asis-desde').value = r.inicio; $('#asis-hasta').value = r.fin; }
      mostrarVista(b.dataset.ir);
    }));

    // Tendencia: los 6 últimos periodos (se calcula después para no demorar el tablero)
    const periodos = [r, rAnt]; while (periodos.length < 6) periodos.push(periodoAnterior(periodos[periodos.length - 1]));
    const previos = await intentar(() => Promise.all(periodos.slice(2).map((p) => obtenerLiquidacion(empresa, p))));
    if (yo !== tableroPeticion || !previos) return;
    const serie = [L, resAnt.liquidacion, ...previos.map((x) => x.liquidacion)].map((liq, i) => ({ r: periodos[i], costo: liq.empleados.some((e) => e.detalleDias.length) ? liq.totales.costo : 0 })).reverse();
    const maxC = Math.max(1, ...serie.map((x) => x.costo));
    $('#tendencia').innerHTML = serie.map((x, i) => `<div class="col${i === serie.length - 1 ? ' col-actual' : ''}" title="${etiquetaPeriodo(x.r)}: ${x.costo ? $f(x.costo) : 'sin marcaciones'}">
      <span class="col-valor">${x.costo ? '$' + (x.costo / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' M' : '—'}</span>
      <span class="col-barra" style="height:${x.costo ? Math.max(3, (x.costo / maxC) * 82) : 0}%"></span><span class="col-dia">${etiquetaPeriodo(x.r)}</span></div>`).join('');
  }

  $('#btn-calcular').addEventListener('click', calcular);

  function pintarLiquidacion() {
    const L = estado.liquidacion; if (!L) return;
    const cerrado = estado.periodo && estado.periodo.estado === 'cerrado';
    $('#liq-vacio').hidden = true;
    $('#btn-excel').disabled = false;
    $('#btn-cerrar').disabled = cerrado || !L.empleados.length;
    const est = $('#liq-estado'); est.hidden = false;
    est.innerHTML = cerrado
      ? `<span class="chip chip-ok">Periodo cerrado</span> <span class="nota">Se muestra la liquidación guardada al cerrar. Los cambios posteriores en marcaciones no la alteran.</span>`
      : `<span class="chip">Borrador</span> <span class="nota">Calculado con las marcaciones y novedades actuales. Ciérralo cuando esté revisado y pagado.</span>`;

    const extras = L.empleados.reduce((s, e) => s + e.horas.HED + e.horas.HEN + e.horas.HEDDF + e.horas.HENDF, 0);
    const inconsist = L.empleados.reduce((s, e) => s + e.inconsistencias.length, 0);
    $('#liq-resumen').innerHTML = [
      ['Neto a pagar', $f(L.totales.neto), `${L.empleados.length} empleados`, 'destacada'],
      ['Total devengado', $f(L.totales.devengado), `deducciones ${$f(L.totales.deducciones)}`],
      ['Aportes empresa', $f(L.totales.aportes), 'seguridad social y parafiscales'],
      ['Provisiones', $f(L.totales.provisiones), 'cesantías, prima, vacaciones'],
      ['Costo total empresa', $f(L.totales.costo), 'devengado + aportes + provisiones'],
      ['Horas extra', h2(extras) + ' h', inconsist ? `${inconsist} marcaciones por revisar` : 'sin marcaciones pendientes'],
    ].map(([t, v, s, c]) => `<div class="cifra ${c || ''}"><span class="eyebrow">${t}</span><b>${v}</b><small>${s}</small></div>`).join('');

    const filas = L.empleados.map((e, i) => {
      const extra = e.horas.HED + e.horas.HEN + e.horas.HEDDF + e.horas.HENDF;
      const recargo = e.horas.RN + e.horas.RDF + e.horas.RNDF;
      const vRec = e.valores.RN + e.valores.RDF + e.valores.RNDF;
      const vExt = e.valores.HED + e.valores.HEN + e.valores.HEDDF + e.valores.HENDF;
      return `<tr class="clic ${estado.seleccionado === i ? 'sel' : ''}" data-i="${i}">
        <td>${esc(e.nombre)}<span class="sub">${esc(e.cargo)}</span></td>
        <td class="num">${e.dias}</td>
        <td class="num">${h2(e.horas.ORD + recargo + extra)}</td>
        <td class="num">${h2(recargo)}<span class="sub">${$f(vRec)}</span></td>
        <td class="num">${h2(extra)}<span class="sub">${$f(vExt)}</span></td>
        <td class="num">${$f(e.totalDevengado)}</td>
        <td class="num">${$f(e.totalDeducciones)}</td>
        <td class="num"><strong>${$f(e.neto)}</strong></td>
        <td>${e.inconsistencias.length ? `<span class="chip chip-aviso">${e.inconsistencias.length} por revisar</span>` : '<span class="chip chip-ok">OK</span>'}</td>
      </tr>`;
    }).join('');
    const t = $('#tabla-liq'); t.hidden = false;
    t.innerHTML = `<thead><tr><th>Empleado</th><th class="num">Días</th><th class="num">Horas</th><th class="num">Recargos</th><th class="num">Extras</th><th class="num">Devengado</th><th class="num">Deducciones</th><th class="num">Neto</th><th>Asistencia</th></tr></thead>
      <tbody>${filas || '<tr><td colspan="9" class="tenue">No hay empleados activos en este periodo.</td></tr>'}</tbody>
      <tfoot><tr><td>Total</td><td></td><td></td><td></td><td></td><td class="num">${$f(L.totales.devengado)}</td><td class="num">${$f(L.totales.deducciones)}</td><td class="num">${$f(L.totales.neto)}</td><td></td></tr></tfoot>`;
    t.querySelectorAll('tbody tr.clic').forEach((tr) => tr.addEventListener('click', () => { estado.seleccionado = +tr.dataset.i; pintarLiquidacion(); pintarDetalle(); }));
    if (estado.seleccionado == null) $('#detalle').hidden = true;
  }

  function pintarDetalle() {
    const e = estado.liquidacion.empleados[estado.seleccionado]; if (!e) return;
    const L = estado.liquidacion;
    const lineas = (arr, total, etiqueta) => `<div class="lineas">${arr.map((x) => `<div><span>${esc(x.concepto)}</span><span>${$f(x.valor)}</span></div>`).join('')}<div class="total"><span>${etiqueta}</span><span>${$f(total)}</span></div></div>`;
    const dias = e.detalleDias.map((d) => {
      const marca = d.festivo ? `<span class="chip chip-aviso">${esc(d.festivo)}</span>` : d.dominical ? '<span class="chip chip-aviso">Domingo</span>' : '';
      const conceptos = Object.entries(d.horas).map(([c, v]) => `${C.CONCEPTOS[c].corto} ${h2(v)}`).join(' · ');
      return `<tr class="${d.festivo || d.dominical ? 'domfest' : ''}"><td class="mono">${fechaLarga(d.fecha)} ${marca}</td><td class="mono">${d.turnos.join(', ')}</td><td>${conceptos}</td><td class="num">${$f(d.valor)}</td></tr>`;
    }).join('');
    const avisosReloj = e.detalleDias.flatMap((d) => (d.avisos || []).map((a) => `<div class="alerta">${esc(fechaLarga(d.fecha))} · ${esc(a)}. Se tomó como salida; revísalo si no es así.</div>`)).join('');
    const ficha = String(e.documento).startsWith('ZK-') ? '<div class="alerta">La ficha de este empleado está incompleta (cédula, salario y fecha de ingreso provisionales). Complétala en Empleados antes de pagar.</div>' : '';
    const alertas = ficha + avisosReloj + e.inconsistencias.map((x) => `<div class="alerta">${esc(fechaLarga(x.fecha))} · ${esc(x.hora.slice(11, 16))} — ${esc(x.motivo)}. Corrígela en Asistencia con una marcación manual.</div>`).join('');
    const det = $('#detalle'); det.hidden = false;
    det.innerHTML = `
      <div class="detalle-cabecera">
        <div><span class="eyebrow">Desprendible de pago · ${fechaLarga(L.inicio)} a ${fechaLarga(L.fin)}</span><h2>${esc(e.nombre)}</h2>
          <p>C.C. ${esc(e.documento)} · ${esc(e.cargo)} · Salario ${$f(e.salario)} · IBC ${$f(e.ibc)}</p></div>
        <button class="btn btn-fantasma" type="button" id="btn-cerrar-detalle">Cerrar detalle</button>
      </div>
      ${alertas ? `<div class="alertas">${alertas}</div>` : ''}
      <div class="desprendible">
        <div class="bloque"><h3>Devengos</h3>${lineas(e.devengos, e.totalDevengado, 'Total devengado')}</div>
        <div class="bloque"><h3>Deducciones</h3>${lineas(e.deducciones, e.totalDeducciones, 'Total deducciones')}
          <div class="neto" style="margin-top:14px"><span class="eyebrow">Neto a pagar</span><b>${$f(e.neto)}</b></div></div>
        <div class="bloque"><h3>Aportes del empleador</h3>${lineas(e.aportes, e.totalAportes, 'Total aportes')}</div>
        <div class="bloque"><h3>Provisiones</h3>${lineas(e.provisiones, e.totalProvisiones, 'Total provisiones')}
          <div class="lineas" style="margin-top:8px"><div class="total"><span>Costo total para la empresa</span><span>${$f(e.costoTotal)}</span></div></div></div>
      </div>
      <div><h3 style="margin:0 0 8px">Día a día</h3>
        <div class="tabla-envoltura"><table class="tabla"><thead><tr><th>Día</th><th>Turnos</th><th>Horas por concepto</th><th class="num">Valor adicional</th></tr></thead>
        <tbody>${dias || '<tr><td colspan="4" class="tenue">Sin marcaciones en el periodo.</td></tr>'}</tbody></table></div>
        <p class="nota">Ord. ordinaria diurna · RN recargo nocturno · RDF dominical/festivo · RNDF nocturno dominical/festivo · HED/HEN extra diurna/nocturna · HEDDF/HENDF extras en dominical/festivo.</p>
      </div>`;
    $('#btn-cerrar-detalle').addEventListener('click', () => { estado.seleccionado = null; det.hidden = true; pintarLiquidacion(); });
    det.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Cerrar periodo (guarda la foto del cálculo)
  $('#btn-cerrar').addEventListener('click', () => {
    const L = estado.liquidacion; if (!L) return;
    abrirDialogo({
      titulo: 'Cerrar periodo',
      campos: [{ tipo: 'texto', html: `<p class="ancho">Se guardará la liquidación de <strong>${esc(empresaActual().nombre)}</strong> del ${fechaLarga(L.inicio)} al ${fechaLarga(L.fin)}: ${L.empleados.length} empleados, neto ${$f(L.totales.neto)}. Después solo un administrador podrá reabrirlo.</p>` }],
      textoGuardar: 'Cerrar periodo',
      alGuardar: async () => {
        const datos = { estado: 'cerrado', resultado: L, cerrado_en: new Date().toISOString() };
        if (estado.periodo) await db.actualizar('periodos', estado.periodo.id, datos);
        else await db.insertar('periodos', [{ empresa_id: estado.empresaId, fecha_inicio: L.inicio, fecha_fin: L.fin, ...datos }]);
        aviso('Periodo cerrado'); await calcular();
      },
    });
  });

  // Exportar a Excel
  $('#btn-excel').addEventListener('click', () => {
    const L = estado.liquidacion; if (!L || !window.XLSX) return;
    const resumen = L.empleados.map((e) => ({
      Documento: e.documento, Empleado: e.nombre, Cargo: e.cargo, Salario: e.salario, Días: e.dias,
      'H. ordinarias': e.horas.ORD, 'H. recargo nocturno': e.horas.RN, 'H. dominical/festivo': e.horas.RDF, 'H. nocturna dom/fest': e.horas.RNDF,
      'H. extra diurna': e.horas.HED, 'H. extra nocturna': e.horas.HEN, 'H. extra diurna dom/fest': e.horas.HEDDF, 'H. extra nocturna dom/fest': e.horas.HENDF,
      'Valor recargos y extras': Object.values(e.valores).reduce((s, v) => s + v, 0),
      Devengado: e.totalDevengado, Deducciones: e.totalDeducciones, Neto: e.neto, IBC: e.ibc,
      'Aportes empresa': e.totalAportes, Provisiones: e.totalProvisiones, 'Costo total': e.costoTotal,
    }));
    const conceptos = L.empleados.flatMap((e) => [
      ...e.devengos.map((x) => ({ Empleado: e.nombre, Tipo: 'Devengo', Concepto: x.concepto, Valor: x.valor })),
      ...e.deducciones.map((x) => ({ Empleado: e.nombre, Tipo: 'Deducción', Concepto: x.concepto, Valor: x.valor })),
      ...e.aportes.map((x) => ({ Empleado: e.nombre, Tipo: 'Aporte empleador', Concepto: x.concepto, Valor: x.valor })),
      ...e.provisiones.map((x) => ({ Empleado: e.nombre, Tipo: 'Provisión', Concepto: x.concepto, Valor: x.valor })),
    ]);
    const diario = L.empleados.flatMap((e) => e.detalleDias.map((d) => ({
      Empleado: e.nombre, Fecha: d.fecha, Festivo: d.festivo || (d.dominical ? 'Domingo' : ''), Turnos: d.turnos.join(', '),
      ...Object.fromEntries(Object.keys(C.CONCEPTOS).map((c) => [c, d.horas[c] || 0])), 'Valor adicional': d.valor,
    })));
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(resumen), 'Resumen');
    XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(conceptos), 'Conceptos');
    XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(diario), 'Día a día');
    const nombre = `Nomina_${(empresaActual()?.nombre || 'empresa').replace(/[^\w]+/g, '_')}_${L.inicio}_${L.fin}.xlsx`;
    try { XLSX.writeFile(libro, nombre); aviso('Archivo generado: ' + nombre); }
    catch (e) { aviso('Este navegador bloqueó la descarga.'); }
  });

  // ------------------------------------------------------------------
  // Asistencia: importación del biométrico
  // ------------------------------------------------------------------
  // Nombres del reloj: "JHON JAIRO CARDONA PATIÑO" → nombres "Jhon Jairo", apellidos "Cardona Patiño"
  function separarNombre(completo) {
    const tit = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    const p = String(completo || '').trim().split(/\s+/).filter(Boolean).map(tit);
    if (p.length <= 1) return { nombres: p[0] || 'Sin nombre', apellidos: '' };
    if (p.length === 2) return { nombres: p[0], apellidos: p[1] };
    if (p.length === 3) return { nombres: p[0], apellidos: p.slice(1).join(' ') };
    return { nombres: p.slice(0, p.length - 2).join(' '), apellidos: p.slice(-2).join(' ') };
  }
  const leerBuffer = (archivo) => (archivo.arrayBuffer ? archivo.arrayBuffer() : new Promise((ok, mal) => {
    const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => mal(r.error); r.readAsArrayBuffer(archivo);
  }));
  async function leerArchivo(archivo) {
    const nombre = archivo.name.toLowerCase();
    if (/\.(xls|xlsx|xlsm|ods)$/.test(nombre)) {
      if (!window.XLSX) throw new Error('No se pudo cargar el lector de Excel. Revisa la conexión a internet.');
      const libro = XLSX.read(new Uint8Array(await leerBuffer(archivo)), { type: 'array' });
      const filas = XLSX.utils.sheet_to_json(libro.Sheets[libro.SheetNames[0]], { header: 1, raw: false, defval: '' });
      return C.leerFilasBiometrico(filas);
    }
    const texto = await archivo.text();
    // CSV/TXT con encabezados (ID, Nombre, Fecha/Hora, Estado…) o formato crudo attlog.dat
    const filas = texto.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.split(/\t|;|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.replace(/^"|"$/g, '').trim()));
    const tabla = C.leerFilasBiometrico(filas);
    return tabla.columnas ? tabla : C.leerArchivoBiometrico(texto);
  }

  let pendientes = [], nuevosEmpleados = [];
  $('#archivo-bio').addEventListener('change', async (ev) => {
    const archivo = ev.target.files[0]; if (!archivo) return;
    const previa = $('#import-previa'); previa.hidden = false; previa.textContent = 'Leyendo archivo…';
    let lectura;
    try { lectura = await leerArchivo(archivo); }
    catch (e) { previa.innerHTML = `<div class="alerta">${esc(e.message)}</div>`; return; }
    const { registros, errores } = lectura;
    const porCodigo = new Map(estado.empleados.map((e) => [String(e.codigo_biometrico), e]));
    const sinFicha = new Map();
    registros.forEach((r) => { if (!porCodigo.has(r.codigo) && !sinFicha.has(r.codigo)) sinFicha.set(r.codigo, r.nombre || ''); });
    nuevosEmpleados = [...sinFicha.entries()].map(([codigo, nombre]) => ({ codigo, nombre }));
    pendientes = registros.map((r) => ({ codigo: r.codigo, fecha_hora: r.fecha_hora, tipo: r.tipo || null }));
    const fechas = registros.map((r) => r.fecha_hora).sort();
    const conTipo = registros.filter((r) => r.tipo).length;
    previa.innerHTML = `
      <div><strong>${registros.length.toLocaleString('es-CO')}</strong> marcaciones de <strong>${new Set(registros.map((r) => r.codigo)).size}</strong> personas${fechas.length ? `, del ${fechaLarga(fechas[0].slice(0, 10))} al ${fechaLarga(fechas[fechas.length - 1].slice(0, 10))}` : ''}.${conTipo ? ` El archivo trae Entrada/Salida en ${conTipo.toLocaleString('es-CO')} de ellas.` : ''}</div>
      ${nuevosEmpleados.length ? `<div class="alerta"><label class="check-linea"><input type="checkbox" id="crear-empleados" checked> Crear ${nuevosEmpleados.length} empleados nuevos con el nombre y el código del reloj</label>
        <span class="sub">Quedan con salario mínimo provisional y marcados "Completar ficha" para que pongas cédula, salario y fecha de ingreso antes de liquidar.</span>
        <details><summary>Ver lista</summary>${nuevosEmpleados.map((n) => `<div class="mono">${esc(n.codigo)} · ${esc(n.nombre || 'sin nombre')}</div>`).join('')}</details></div>` : ''}
      ${errores.length ? `<div class="alerta">${errores.length} filas no se pudieron leer (${esc(errores.slice(0, 3).join('; '))}${errores.length > 3 ? '…' : ''}).</div>` : ''}`;
    $('#btn-importar').hidden = !registros.length;
  });
  $('#btn-importar').addEventListener('click', () => intentar(async () => {
    if (!estado.empresaId) { aviso('Elige primero la empresa.'); return; }
    if (!pendientes.length) { aviso('Primero elige el archivo del reloj.'); return; }
    const btn = $('#btn-importar'); btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const crear = $('#crear-empleados');
      if (nuevosEmpleados.length && crear && crear.checked) {
        const p = C.parametroVigente(estado.parametros, C.isoDia(new Date()));
        const inicio = pendientes.map((m) => m.fecha_hora).sort()[0].slice(0, 10);
        await db.insertar('empleados', nuevosEmpleados.map((n) => ({
          empresa_id: estado.empresaId, ...separarNombre(n.nombre), documento: 'ZK-' + n.codigo,
          codigo_biometrico: n.codigo, salario: p.smmlv, fecha_ingreso: inicio,
        })));
        await cargarEmpleados();
      }
      const porCodigo = new Map(estado.empleados.map((e) => [String(e.codigo_biometrico), e.id]));
      const filas = pendientes.map((m) => ({
        empresa_id: estado.empresaId, empleado_id: porCodigo.get(m.codigo) || null, codigo_biometrico: m.codigo,
        fecha_hora: m.fecha_hora, tipo: m.tipo, origen: 'archivo', anulada: false,
      }));
      const nuevas = await db.guardarMarcaciones(filas);
      aviso(`${nuevas.toLocaleString('es-CO')} marcaciones nuevas guardadas (${(filas.length - nuevas).toLocaleString('es-CO')} ya existían o eran repetidas)`);
      // dejar la asistencia mostrando el rango del archivo
      const fs = pendientes.map((m) => m.fecha_hora).sort();
      $('#asis-desde').value = fs[0].slice(0, 10); $('#asis-hasta').value = fs[fs.length - 1].slice(0, 10);
      pendientes = []; nuevosEmpleados = [];
      $('#archivo-bio').value = ''; $('#import-previa').hidden = true; btn.hidden = true;
      limpiarLiquidacion(); verAsistencia();
    } finally { btn.disabled = false; btn.textContent = 'Guardar marcaciones'; }
  }));

  $('#form-manual').addEventListener('submit', (ev) => {
    ev.preventDefault();
    intentar(async () => {
      const e = estado.empleados.find((x) => x.id === $('#man-empleado').value);
      if (!e) return;
      if (!e.codigo_biometrico) { aviso('Ese empleado no tiene código de biométrico en su ficha.'); return; }
      await db.insertar('marcaciones', [{ empresa_id: estado.empresaId, empleado_id: e.id, codigo_biometrico: String(e.codigo_biometrico), fecha_hora: $('#man-fecha').value.replace('T', ' ') + ':00', origen: 'manual', anulada: false, observacion: $('#man-obs').value || null }]);
      aviso('Marcación agregada'); $('#man-obs').value = ''; limpiarLiquidacion(); verAsistencia();
    });
  });

  function rangoAsistenciaPorDefecto() {
    if ($('#asis-desde').value) return;
    const r = rangoPeriodo(); if (!r) return;
    $('#asis-desde').value = r.inicio; $('#asis-hasta').value = r.fin;
  }
  async function verAsistencia() {
    rangoAsistenciaPorDefecto();
    const desde = $('#asis-desde').value, hasta = $('#asis-hasta').value;
    const t = $('#tabla-asis');
    if (!estado.empresaId || !desde || !hasta) { t.innerHTML = ''; return; }
    await intentar(async () => {
      const marc = await db.listar('marcaciones', { eq: { empresa_id: estado.empresaId, anulada: false }, gte: { fecha_hora: desde }, lte: { fecha_hora: C.isoDia(C.sumarDias(C.aFecha(hasta), 1)) + ' 23:59:59' } });
      const filtro = $('#asis-empleado').value;
      const lista = estado.empleados.filter((e) => !filtro || e.id === filtro);
      const filas = [];
      for (const e of lista) {
        const propias = marc.filter((m) => (m.empleado_id ? m.empleado_id === e.id : String(m.codigo_biometrico) === String(e.codigo_biometrico)));
        const { turnos, inconsistencias } = C.emparejarMarcaciones(propias);
        turnos.filter((x) => x.fecha >= desde && x.fecha <= hasta).forEach((x) => filas.push({ e, fecha: x.fecha, texto: `${x.entrada.slice(11, 16)} → ${x.salida.slice(11, 16)}${x.salida.slice(0, 10) !== x.fecha ? ' (+1)' : ''}`, horas: x.minutos / 60, alerta: false }));
        inconsistencias.filter((x) => x.fecha >= desde && x.fecha <= hasta).forEach((x) => filas.push({ e, fecha: x.fecha, texto: `${x.hora.slice(11, 16)} sin pareja`, horas: 0, alerta: true }));
      }
      const sinAsignar = marc.filter((m) => !m.empleado_id && !estado.empleados.some((e) => String(e.codigo_biometrico) === String(m.codigo_biometrico))).length;
      filas.sort((a, b) => a.fecha.localeCompare(b.fecha) || nombreEmpleado(a.e).localeCompare(nombreEmpleado(b.e)));
      t.innerHTML = `<thead><tr><th>Día</th><th>Empleado</th><th>Turno</th><th class="num">Horas</th><th></th></tr></thead><tbody>${
        filas.map((f) => `<tr class="${C.esDominicalOFestivo(f.fecha) ? 'domfest' : ''}"><td class="mono">${fechaLarga(f.fecha)}${C.nombreFestivo(f.fecha) ? ` <span class="chip chip-aviso">${esc(C.nombreFestivo(f.fecha))}</span>` : ''}</td><td>${esc(nombreEmpleado(f.e))}</td><td class="mono">${f.texto}</td><td class="num">${f.horas ? h2(f.horas) : ''}</td><td>${f.alerta ? '<span class="chip chip-aviso">Revisar</span>' : ''}</td></tr>`).join('')
        || '<tr><td colspan="5" class="tenue">No hay marcaciones en estas fechas. Importa el archivo del biométrico arriba.</td></tr>'
      }</tbody>${sinAsignar ? `<tfoot><tr><td colspan="5">${sinAsignar} marcaciones con códigos del reloj que no corresponden a ningún empleado.</td></tr></tfoot>` : ''}`;
    });
  }
  $('#btn-ver-asis').addEventListener('click', verAsistencia);

  // ------------------------------------------------------------------
  // Diálogo genérico de formularios
  // ------------------------------------------------------------------
  let dialogoActual = null;
  function abrirDialogo({ titulo, campos, valores = {}, alGuardar, alEliminar, textoGuardar = 'Guardar' }) {
    dialogoActual = { campos, alGuardar, alEliminar };
    $('#dialogo-titulo').textContent = titulo;
    $('#dialogo-guardar').textContent = textoGuardar;
    $('#dialogo-error').hidden = true;
    $('#dialogo-eliminar').hidden = !alEliminar;
    $('#dialogo-campos').innerHTML = campos.map((c) => {
      if (c.tipo === 'texto') return c.html;
      const id = 'f-' + c.nombre; const v = valores[c.nombre] ?? c.defecto ?? '';
      if (c.tipo === 'check') return `<div class="check ${c.ancho ? 'ancho' : ''}"><input id="${id}" type="checkbox" ${v ? 'checked' : ''}><label for="${id}">${c.etiqueta}</label></div>`;
      if (c.tipo === 'select') return `<div class="${c.ancho ? 'ancho' : ''}"><label for="${id}">${c.etiqueta}</label><select id="${id}">${c.opciones.map(([val, txt]) => `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(txt)}</option>`).join('')}</select></div>`;
      return `<div class="${c.ancho ? 'ancho' : ''}"><label for="${id}">${c.etiqueta}</label><input id="${id}" type="${c.tipo || 'text'}" value="${esc(v)}" ${c.requerido ? 'required' : ''} ${c.paso ? `step="${c.paso}"` : ''}></div>`;
    }).join('');
    $('#dialogo').showModal();
  }
  function leerDialogo() {
    const out = {};
    dialogoActual.campos.forEach((c) => {
      if (!c.nombre) return;
      const el = $('#f-' + c.nombre);
      if (c.tipo === 'check') out[c.nombre] = el.checked;
      else if (c.tipo === 'number') out[c.nombre] = el.value === '' ? null : +el.value;
      else out[c.nombre] = el.value.trim() === '' ? null : el.value.trim();
    });
    return out;
  }
  $('#dialogo-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!$('#dialogo-form').reportValidity()) return;
    try { await dialogoActual.alGuardar(leerDialogo()); $('#dialogo').close(); }
    catch (e) { $('#dialogo-error').textContent = e.message; $('#dialogo-error').hidden = false; }
  });
  $('#dialogo-cancelar').addEventListener('click', () => $('#dialogo').close());
  let confirmarEliminar = false;
  $('#dialogo-eliminar').addEventListener('click', async () => {
    const b = $('#dialogo-eliminar');
    if (!confirmarEliminar) { confirmarEliminar = true; b.textContent = '¿Seguro? Toca otra vez'; setTimeout(() => { confirmarEliminar = false; b.textContent = 'Eliminar'; }, 4000); return; }
    confirmarEliminar = false; b.textContent = 'Eliminar';
    try { await dialogoActual.alEliminar(); $('#dialogo').close(); }
    catch (e) { $('#dialogo-error').textContent = e.message; $('#dialogo-error').hidden = false; }
  });

  // ------------------------------------------------------------------
  // Empleados
  // ------------------------------------------------------------------
  const CAMPOS_EMPLEADO = [
    { nombre: 'nombres', etiqueta: 'Nombres', requerido: true },
    { nombre: 'apellidos', etiqueta: 'Apellidos' },
    { nombre: 'documento', etiqueta: 'Cédula', requerido: true },
    { nombre: 'cargo', etiqueta: 'Cargo' },
    { nombre: 'salario', etiqueta: 'Salario mensual', tipo: 'number', requerido: true, paso: '1' },
    { nombre: 'tipo_salario', etiqueta: 'Tipo de salario', tipo: 'select', opciones: [['ordinario', 'Ordinario'], ['integral', 'Integral']] },
    { nombre: 'tipo_contrato', etiqueta: 'Contrato', tipo: 'select', opciones: [['indefinido', 'Término indefinido'], ['fijo', 'Término fijo'], ['obra_labor', 'Obra o labor'], ['aprendizaje', 'Aprendizaje']] },
    { nombre: 'fecha_ingreso', etiqueta: 'Fecha de ingreso', tipo: 'date', requerido: true },
    { nombre: 'fecha_retiro', etiqueta: 'Fecha de retiro', tipo: 'date' },
    { nombre: 'dias_laborales_semana', etiqueta: 'Días laborales por semana', tipo: 'number', defecto: 6 },
    { nombre: 'codigo_biometrico', etiqueta: 'Código en el biométrico' },
    { nombre: 'arl_riesgo', etiqueta: 'Riesgo ARL', tipo: 'select', opciones: [[1, 'I · 0,522 %'], [2, 'II · 1,044 %'], [3, 'III · 2,436 %'], [4, 'IV · 4,35 %'], [5, 'V · 6,96 %']] },
    { nombre: 'eps', etiqueta: 'EPS' }, { nombre: 'afp', etiqueta: 'Fondo de pensiones' }, { nombre: 'ccf', etiqueta: 'Caja de compensación' },
    { nombre: 'auxilio_transporte', etiqueta: 'Recibe auxilio de transporte (si gana hasta 2 SMMLV)', tipo: 'check', defecto: true, ancho: true },
    { nombre: 'activo', etiqueta: 'Activo', tipo: 'check', defecto: true },
  ];
  function pintarEmpleados() {
    const t = $('#tabla-empleados');
    if (!estado.empresaId) { t.innerHTML = '<tbody><tr><td class="tenue">Agrega primero una empresa.</td></tr></tbody>'; return; }
    t.innerHTML = `<thead><tr><th>Empleado</th><th>Cédula</th><th class="num">Salario</th><th>Ingreso</th><th>Código reloj</th><th>Estado</th></tr></thead><tbody>${
      estado.empleados.map((e) => `<tr class="clic" data-id="${e.id}"><td>${esc(nombreEmpleado(e))}<span class="sub">${esc(e.cargo || '')}</span></td><td class="mono">${esc(e.documento)}</td><td class="num">${$f(e.salario)}${e.tipo_salario === 'integral' ? '<span class="sub">integral</span>' : ''}</td><td class="mono">${esc(e.fecha_ingreso)}</td><td class="mono">${esc(e.codigo_biometrico || '—')}</td><td>${String(e.documento).startsWith('ZK-') ? '<span class="chip chip-aviso">Completar ficha</span>' : e.activo === false ? '<span class="chip">Retirado</span>' : '<span class="chip chip-ok">Activo</span>'}</td></tr>`).join('')
      || '<tr><td colspan="6" class="tenue">Esta empresa no tiene empleados todavía.</td></tr>'}</tbody>`;
    t.querySelectorAll('tr.clic').forEach((tr) => tr.addEventListener('click', () => editarEmpleado(estado.empleados.find((e) => e.id === tr.dataset.id))));
  }
  function editarEmpleado(emp) {
    abrirDialogo({
      titulo: emp ? 'Editar empleado' : 'Nuevo empleado', campos: CAMPOS_EMPLEADO, valores: emp || {},
      alGuardar: async (d) => {
        if (d.codigo_biometrico) d.codigo_biometrico = String(d.codigo_biometrico).replace(/^0+(?=\d)/, '');
        d.arl_riesgo = +d.arl_riesgo;
        if (emp) await db.actualizar('empleados', emp.id, d);
        else await db.insertar('empleados', [{ ...d, empresa_id: estado.empresaId }]);
        aviso('Empleado guardado'); await cargarEmpleados(); pintarEmpleados(); limpiarLiquidacion();
      },
      alEliminar: emp ? async () => { await db.eliminar('empleados', emp.id); aviso('Empleado eliminado'); await cargarEmpleados(); pintarEmpleados(); } : null,
    });
  }
  $('#btn-nuevo-empleado').addEventListener('click', () => { if (!estado.empresaId) { aviso('Agrega primero una empresa.'); return; } editarEmpleado(null); });

  // ------------------------------------------------------------------
  // Empresas
  // ------------------------------------------------------------------
  const CAMPOS_EMPRESA = [
    { nombre: 'nombre', etiqueta: 'Razón social', requerido: true, ancho: true },
    { nombre: 'slug', etiqueta: 'Nombre del enlace (ej. la-rufina)', ancho: true },
    { nombre: 'nit', etiqueta: 'NIT' }, { nombre: 'ciudad', etiqueta: 'Ciudad' },
    { nombre: 'periodicidad', etiqueta: 'Periodicidad de pago', tipo: 'select', opciones: [['quincenal', 'Quincenal'], ['mensual', 'Mensual']] },
    { nombre: 'exonerada_aportes', etiqueta: 'Exonerada de salud empleador, SENA e ICBF (art. 114-1 E.T.)', tipo: 'check', defecto: true, ancho: true },
  ];
  function pintarEmpresas() {
    const t = $('#tabla-empresas');
    t.innerHTML = `<thead><tr><th>Empresa</th><th>Enlace para la empresa</th><th>Pago</th><th>Aportes</th><th></th></tr></thead><tbody>${
      estado.empresas.map((e) => `<tr data-id="${e.id}"><td>${esc(e.nombre)}<span class="sub">${esc([e.nit, e.ciudad].filter(Boolean).join(' · '))}</span></td>
        <td>${e.slug ? `<span class="mono enlace">${esc(enlaceEmpresa(e))}</span> <button class="btn btn-fantasma btn-mini" data-copiar="${esc(enlaceEmpresa(e))}" type="button">Copiar</button>` : '<span class="tenue">Sin enlace: edita la empresa y ponle un nombre de enlace</span>'}</td>
        <td>${esc(e.periodicidad)}</td><td>${e.exonerada_aportes ? 'Exonerada 114-1' : 'Paga todos'}</td>
        <td class="acciones-fila"><button class="btn btn-mini" data-accesos="${e.id}" type="button">Accesos</button><button class="btn btn-mini" data-editar="${e.id}" type="button">Editar</button></td></tr>`).join('')
      || '<tr><td colspan="5" class="tenue">Agrega tu primera empresa cliente.</td></tr>'}</tbody>`;
    t.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => editarEmpresa(estado.empresas.find((e) => e.id === b.dataset.editar))));
    t.querySelectorAll('[data-accesos]').forEach((b) => b.addEventListener('click', () => verAccesos(estado.empresas.find((e) => e.id === b.dataset.accesos))));
    t.querySelectorAll('[data-copiar]').forEach((b) => b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copiar); aviso('Enlace copiado'); }
      catch (e) { const r = document.createRange(); r.selectNodeContents(b.previousElementSibling); getSelection().removeAllRanges(); getSelection().addRange(r); aviso('Selecciona y copia el enlace'); }
    }));
  }
  function editarEmpresa(emp) {
    abrirDialogo({
      titulo: emp ? 'Editar empresa' : 'Nueva empresa', campos: CAMPOS_EMPRESA, valores: emp || {},
      alGuardar: async (d) => {
        d.slug = hacerSlug(d.slug || d.nombre) || null;
        if (emp) await db.actualizar('empresas', emp.id, d);
        else { const [n] = await db.insertar('empresas', [d]); estado.empresaId = n.id; }
        aviso('Empresa guardada'); await cargarEmpresas(); pintarEmpresas();
      },
      alEliminar: emp && esAdmin() ? async () => { await db.eliminar('empresas', emp.id); aviso('Empresa eliminada'); await cargarEmpresas(); pintarEmpresas(); } : null,
    });
  }
  // Usuarios de la empresa cliente que pueden entrar por su enlace
  async function verAccesos(emp) {
    const conAcceso = (await intentar(() => db.rpc('usuarios_de_empresa', { p_empresa: emp.id }))) || [];
    const todos = esAdmin() ? ((await intentar(() => db.rpc('usuarios_jornal', {}))) || []) : [];
    const disponibles = todos.filter((u) => u.rol === 'cliente' && !conAcceso.some((c) => c.usuario_id === u.usuario_id));
    abrirDialogo({
      titulo: `Accesos · ${emp.nombre}`,
      campos: [
        { tipo: 'texto', html: `<div class="ancho lista-accesos">${conAcceso.length
          ? conAcceso.map((u) => `<div><span class="mono">${esc(U.mostrar(u.email))}</span>${esAdmin() ? `<button class="btn btn-fantasma btn-mini" type="button" data-quitar="${u.usuario_id}">Quitar</button>` : ''}</div>`).join('')
          : '<p class="nota">Ningún usuario de esta empresa tiene acceso todavía.</p>'}</div>` },
        ...(esAdmin() ? [
          disponibles.length
            ? { nombre: 'usuario', etiqueta: 'Dar acceso a', tipo: 'select', ancho: true, opciones: disponibles.map((u) => [u.usuario_id, U.mostrar(u.usuario) + (u.nombre && u.nombre !== u.usuario ? ` · ${u.nombre}` : '')]) }
            : { tipo: 'texto', html: '<p class="ancho nota">No hay usuarios de empresa libres. Créalos en la pestaña Usuarios.</p>' },
        ] : []),
      ],
      textoGuardar: esAdmin() && disponibles.length ? 'Dar acceso' : 'Cerrar',
      alGuardar: async (d) => {
        if (!esAdmin() || !d.usuario) return;
        await db.rpc('asignar_empresa_usuario', { p_usuario: d.usuario, p_empresa: emp.id });
        aviso('Acceso agregado');
      },
    });
    $$('#dialogo [data-quitar]').forEach((b) => b.addEventListener('click', async () => {
      await intentar(() => db.rpc('quitar_usuario_empresa', { p_usuario: b.dataset.quitar, p_empresa: emp.id }));
      $('#dialogo').close(); aviso('Acceso retirado'); verAccesos(emp);
    }));
  }

  $('#btn-nueva-empresa').addEventListener('click', () => editarEmpresa(null));

  // ------------------------------------------------------------------
  // Usuarios (solo administrador)
  // ------------------------------------------------------------------
  const ROLES_TXT = { admin: 'Administrador', tecnico: 'Técnico', cliente: 'Usuario de empresa' };
  const U = window.JornalUsuario;
  async function pintarUsuarios() {
    if (!esAdmin()) return;
    $('#nu-empresa').innerHTML = '<option value="">— Ninguna —</option>' + estado.empresas.map((e) => `<option value="${e.id}">${esc(e.nombre)}</option>`).join('');
    if (estado.empresaId) $('#nu-empresa').value = estado.empresaId;
    const t = $('#tabla-usuarios');
    const lista = (await intentar(() => db.rpc('usuarios_jornal', {}))) || [];
    t.innerHTML = `<thead><tr><th>Usuario</th><th>Rol</th><th>Empresas</th><th>Estado</th><th></th></tr></thead><tbody>${
      lista.map((u) => `<tr>
        <td><strong class="mono">${esc(U.mostrar(u.usuario))}</strong><span class="sub">${esc(u.nombre && u.nombre !== u.usuario ? u.nombre : '')}</span></td>
        <td><select class="sel-rol" data-id="${u.usuario_id}" aria-label="Rol de ${esc(u.usuario)}" ${u.usuario_id === estado.perfil.id ? 'disabled' : ''}>${Object.entries(ROLES_TXT).map(([k, v]) => `<option value="${k}" ${k === u.rol ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
        <td>${u.rol === 'cliente'
          ? ((u.empresas || []).map((e) => `<span class="chip">${esc(e.nombre)} <button class="quitar-chip" type="button" data-quitar="${e.id}" data-usuario="${u.usuario_id}" aria-label="Quitar ${esc(e.nombre)}">×</button></span>`).join(' ') || '<span class="tenue">Sin empresa: no ve nada</span>')
          : '<span class="tenue">Todas</span>'}</td>
        <td>${u.debe_cambiar ? '<span class="chip chip-aviso">Contraseña temporal</span>' : '<span class="chip chip-ok">Activo</span>'}${u.ultimo_ingreso ? `<span class="sub">último ingreso ${new Date(u.ultimo_ingreso).toLocaleDateString('es-CO')}</span>` : '<span class="sub">no ha entrado</span>'}</td>
        <td class="acciones-fila">${u.rol === 'cliente' ? `<button class="btn btn-mini" type="button" data-asignar="${u.usuario_id}">Asignar empresa</button>` : ''}
          <button class="btn btn-mini" type="button" data-clave="${u.usuario_id}" data-nombre="${esc(U.mostrar(u.usuario))}">Restablecer contraseña</button>
          ${u.usuario_id !== estado.perfil.id ? `<button class="btn btn-mini btn-peligro" type="button" data-eliminar="${u.usuario_id}" data-nombre="${esc(U.mostrar(u.usuario))}">Eliminar</button>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="5" class="tenue">Todavía no hay usuarios.</td></tr>'}</tbody>`;
    t.querySelectorAll('.sel-rol').forEach((sel) => sel.addEventListener('change', async () => {
      const ok = await intentar(() => db.rpc('cambiar_rol_usuario', { p_usuario: sel.dataset.id, p_rol: sel.value }));
      if (ok) aviso('Rol actualizado'); pintarUsuarios();
    }));
    t.querySelectorAll('[data-quitar]').forEach((b) => b.addEventListener('click', async () => {
      await intentar(() => db.rpc('quitar_usuario_empresa', { p_usuario: b.dataset.usuario, p_empresa: b.dataset.quitar }));
      aviso('Empresa retirada'); pintarUsuarios();
    }));
    t.querySelectorAll('[data-asignar]').forEach((b) => b.addEventListener('click', () => abrirDialogo({
      titulo: 'Asignar empresa',
      campos: [{ nombre: 'empresa', etiqueta: 'Empresa', tipo: 'select', ancho: true, opciones: estado.empresas.map((e) => [e.id, e.nombre]) }],
      textoGuardar: 'Asignar',
      alGuardar: async (d) => { await db.rpc('asignar_empresa_usuario', { p_usuario: b.dataset.asignar, p_empresa: d.empresa }); aviso('Empresa asignada'); pintarUsuarios(); },
    })));
    t.querySelectorAll('[data-clave]').forEach((b) => b.addEventListener('click', () => abrirDialogo({
      titulo: `Restablecer contraseña · ${b.dataset.nombre}`,
      campos: [
        { tipo: 'texto', html: '<p class="ancho nota">Pon una contraseña temporal y dásela a la persona. Al entrar, Jornal le pedirá cambiarla.</p>' },
        { nombre: 'clave', etiqueta: 'Contraseña temporal (mínimo 8 caracteres)', requerido: true, ancho: true },
      ],
      textoGuardar: 'Restablecer',
      alGuardar: async (d) => { await db.gestionarUsuarios({ accion: 'clave', usuario_id: b.dataset.clave, clave: d.clave }); aviso('Contraseña temporal asignada'); pintarUsuarios(); },
    })));
    t.querySelectorAll('[data-eliminar]').forEach((b) => b.addEventListener('click', () => abrirDialogo({
      titulo: `Eliminar usuario · ${b.dataset.nombre}`,
      campos: [{ tipo: 'texto', html: `<p class="ancho">El usuario <strong>${esc(b.dataset.nombre)}</strong> ya no podrá entrar a Jornal. Los datos de las empresas no se borran.</p>` }],
      textoGuardar: 'Eliminar usuario',
      alGuardar: async () => { await db.gestionarUsuarios({ accion: 'eliminar', usuario_id: b.dataset.eliminar }); aviso('Usuario eliminado'); pintarUsuarios(); },
    })));
  }
  $('#form-usuario').addEventListener('submit', (ev) => {
    ev.preventDefault();
    intentar(async () => {
      const btn = $('#btn-crear-usuario'); btn.disabled = true; btn.textContent = 'Creando…';
      try {
        const rol = $('#nu-rol').value, empresa_id = $('#nu-empresa').value || null;
        if (rol === 'cliente' && !empresa_id) { aviso('Elige la empresa a la que pertenece este usuario.'); return; }
        const clave = $('#nu-clave').value;
        if (clave.length < 8) { aviso('La contraseña temporal debe tener al menos 8 caracteres.'); return; }
        const r = await db.gestionarUsuarios({ accion: 'crear', usuario: $('#nu-usuario').value.trim(), nombre: $('#nu-nombre').value.trim() || undefined, clave, rol, empresa_id });
        aviso(`Usuario "${r.usuario}" creado. Entra con ese usuario y la contraseña temporal.`);
        ['#nu-usuario', '#nu-nombre', '#nu-clave'].forEach((id) => { $(id).value = ''; });
        pintarUsuarios();
      } finally { btn.disabled = false; btn.textContent = 'Crear usuario'; }
    });
  });

  // ------------------------------------------------------------------
  // Novedades
  // ------------------------------------------------------------------
  const TIPOS_NOVEDAD = [['bonificacion_salarial', 'Bonificación salarial'], ['bonificacion_no_salarial', 'Bonificación no salarial'], ['descuento', 'Descuento'], ['prestamo', 'Cuota de préstamo'], ['incapacidad', 'Incapacidad (días)'], ['licencia_no_remunerada', 'Licencia no remunerada (días)'], ['vacaciones', 'Vacaciones (días)']];
  const nombreTipo = (t) => (TIPOS_NOVEDAD.find((x) => x[0] === t) || [, t])[1];
  async function pintarNovedades() {
    const t = $('#tabla-novedades');
    if (!estado.empresaId) { t.innerHTML = ''; return; }
    await intentar(async () => {
      const lista = await db.listar('novedades', { eq: { empresa_id: estado.empresaId }, order: 'fecha', asc: false });
      t.innerHTML = `<thead><tr><th>Fecha</th><th>Empleado</th><th>Tipo</th><th class="num">Valor</th><th class="num">Días</th><th>Detalle</th></tr></thead><tbody>${
        lista.map((n) => `<tr class="clic" data-id="${n.id}"><td class="mono">${esc(n.fecha)}</td><td>${esc(nombreEmpleado(estado.empleados.find((e) => e.id === n.empleado_id)))}</td><td>${esc(nombreTipo(n.tipo))}</td><td class="num">${+n.valor ? $f(n.valor) : ''}</td><td class="num">${+n.dias || ''}</td><td>${esc(n.descripcion || '')}</td></tr>`).join('')
        || '<tr><td colspan="6" class="tenue">Sin novedades registradas.</td></tr>'}</tbody>`;
      t.querySelectorAll('tr.clic').forEach((tr) => tr.addEventListener('click', () => editarNovedad(lista.find((n) => n.id == tr.dataset.id))));
    });
  }
  function editarNovedad(nov) {
    abrirDialogo({
      titulo: nov ? 'Editar novedad' : 'Nueva novedad',
      campos: [
        { nombre: 'empleado_id', etiqueta: 'Empleado', tipo: 'select', opciones: estado.empleados.map((e) => [e.id, nombreEmpleado(e)]), ancho: true },
        { nombre: 'tipo', etiqueta: 'Tipo', tipo: 'select', opciones: TIPOS_NOVEDAD },
        { nombre: 'fecha', etiqueta: 'Fecha', tipo: 'date', requerido: true },
        { nombre: 'valor', etiqueta: 'Valor (pesos)', tipo: 'number', defecto: 0, paso: '1' },
        { nombre: 'dias', etiqueta: 'Días', tipo: 'number', defecto: 0, paso: '0.5' },
        { nombre: 'descripcion', etiqueta: 'Descripción', ancho: true },
      ],
      valores: nov || {},
      alGuardar: async (d) => {
        d.valor = d.valor || 0; d.dias = d.dias || 0;
        if (nov) await db.actualizar('novedades', nov.id, d); else await db.insertar('novedades', [{ ...d, empresa_id: estado.empresaId }]);
        aviso('Novedad guardada'); limpiarLiquidacion(); pintarNovedades();
      },
      alEliminar: nov ? async () => { await db.eliminar('novedades', nov.id); aviso('Novedad eliminada'); limpiarLiquidacion(); pintarNovedades(); } : null,
    });
  }
  $('#btn-nueva-novedad').addEventListener('click', () => { if (!estado.empleados.length) { aviso('Agrega primero empleados.'); return; } editarNovedad(null); });

  // ------------------------------------------------------------------
  // Parámetros legales y festivos
  // ------------------------------------------------------------------
  const pct = (v) => `${Math.round(+v * 1000) / 10} %`;
  function pintarParametros() {
    const t = $('#tabla-parametros');
    const hoy = C.isoDia(new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())));
    let vigente = null; try { vigente = C.parametroVigente(estado.parametros, hoy).vigente_desde; } catch (e) { /* sin parámetros */ }
    t.innerHTML = `<thead><tr><th>Rige desde</th><th class="num">SMMLV</th><th class="num">Aux. transporte</th><th class="num">Jornada</th><th>Nocturno</th><th class="num">Rec. nocturno</th><th class="num">Dominical</th><th class="num">Extra diurna</th><th class="num">Extra nocturna</th><th>Norma</th></tr></thead><tbody>${
      estado.parametros.map((p) => `<tr class="${estado.perfil.rol === 'admin' ? 'clic' : ''}" data-id="${p.id}"><td class="mono">${p.vigente_desde} ${p.vigente_desde === vigente ? '<span class="chip chip-ok">Vigente</span>' : ''}</td><td class="num">${$f(p.smmlv)}</td><td class="num">${$f(p.auxilio_transporte)}</td><td class="num">${+p.jornada_semanal} h</td><td class="mono">${String(p.inicio_nocturno || '19:00').slice(0, 5)}–${String(p.fin_nocturno || '06:00').slice(0, 5)}</td><td class="num">${pct(p.recargo_nocturno)}</td><td class="num">${pct(p.recargo_dominical)}</td><td class="num">${pct(p.extra_diurna)}</td><td class="num">${pct(p.extra_nocturna)}</td><td class="tenue">${esc(p.norma || '')}</td></tr>`).join('')
    }</tbody>`;
    if (estado.perfil.rol === 'admin') t.querySelectorAll('tr.clic').forEach((tr) => tr.addEventListener('click', () => editarParametro(estado.parametros.find((p) => String(p.id) === tr.dataset.id))));
    const anio = new Date().getFullYear();
    const fest = C.festivosColombia(anio);
    $('#lista-festivos').innerHTML = Object.entries(fest).sort().map(([f, n]) => `<div><span class="mono">${fechaLarga(f)}</span><span>${esc(n)}</span></div>`).join('');
    document.querySelector('#vista-parametros h3').textContent = `Festivos ${anio}`;
  }
  function editarParametro(p) {
    if (estado.perfil.rol !== 'admin') { aviso('Solo un administrador puede cambiar parámetros legales.'); return; }
    const base = p || estado.parametros[estado.parametros.length - 1] || {};
    abrirDialogo({
      titulo: p ? 'Editar vigencia' : 'Nueva vigencia',
      campos: [
        ...(p ? [] : [{ tipo: 'texto', html: '<p class="ancho nota">Se copian los valores de la última vigencia. Cambia solo lo que cambió.</p>' }]),
        { nombre: 'vigente_desde', etiqueta: 'Rige desde', tipo: 'date', requerido: true },
        { nombre: 'smmlv', etiqueta: 'Salario mínimo', tipo: 'number', requerido: true, paso: '1' },
        { nombre: 'auxilio_transporte', etiqueta: 'Auxilio de transporte', tipo: 'number', requerido: true, paso: '1' },
        { nombre: 'jornada_semanal', etiqueta: 'Jornada semanal (horas)', tipo: 'number', requerido: true, paso: '0.5' },
        { nombre: 'inicio_nocturno', etiqueta: 'Inicio jornada nocturna', tipo: 'time', defecto: '19:00' },
        { nombre: 'fin_nocturno', etiqueta: 'Fin jornada nocturna', tipo: 'time', defecto: '06:00' },
        { nombre: 'recargo_nocturno', etiqueta: 'Recargo nocturno (0,35 = 35 %)', tipo: 'number', paso: '0.01' },
        { nombre: 'recargo_dominical', etiqueta: 'Recargo dominical/festivo', tipo: 'number', paso: '0.01' },
        { nombre: 'extra_diurna', etiqueta: 'Recargo extra diurna', tipo: 'number', paso: '0.01' },
        { nombre: 'extra_nocturna', etiqueta: 'Recargo extra nocturna', tipo: 'number', paso: '0.01' },
        { nombre: 'norma', etiqueta: 'Norma que lo fija', ancho: true },
      ],
      valores: p ? { ...p, inicio_nocturno: String(p.inicio_nocturno || '').slice(0, 5), fin_nocturno: String(p.fin_nocturno || '').slice(0, 5) }
                 : { ...base, vigente_desde: '', norma: '', inicio_nocturno: String(base.inicio_nocturno || '19:00').slice(0, 5), fin_nocturno: String(base.fin_nocturno || '06:00').slice(0, 5) },
      alGuardar: async (d) => {
        if (p) await db.actualizar('parametros_legales', p.id, d); else await db.insertar('parametros_legales', [d]);
        estado.parametros = await db.listar('parametros_legales', { order: 'vigente_desde' });
        aviso('Parámetros guardados'); limpiarLiquidacion(); pintarParametros();
      },
      alEliminar: p ? async () => { await db.eliminar('parametros_legales', p.id); estado.parametros = await db.listar('parametros_legales', { order: 'vigente_desde' }); pintarParametros(); } : null,
    });
  }
  $('#btn-nuevo-parametro').addEventListener('click', () => editarParametro(null));

  iniciar().catch((e) => { console.error(e); aviso('Error al iniciar: ' + e.message); });
})();
