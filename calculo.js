/* =====================================================================
   JORNAL · Motor de cálculo de nómina colombiana
   - Festivos de Colombia (Ley 51 de 1983 "Emiliani" + Semana Santa)
   - Lectura de archivos de biométricos (ZKTeco attlog.dat, CSV, TXT)
   - Emparejamiento de marcaciones entrada/salida
   - Clasificación de horas: ordinarias, recargos y extras (Ley 2466/2025)
   - Liquidación del periodo: devengos, deducciones, aportes y provisiones

   Todas las fechas se manejan como "hora local sin zona" (la hora del
   reloj biométrico). Internamente se usan Date en UTC solo como
   contenedor, para que el resultado no dependa de la zona del navegador.
   Funciona igual en el navegador (window.JornalCalc) y en Node.
   ===================================================================== */
(function (raiz) {
  'use strict';

  // ------------------------------------------------------------------
  // Utilidades de fecha
  // ------------------------------------------------------------------
  const DIA_MS = 86400000;
  const pad = (n) => String(n).padStart(2, '0');

  function aFecha(texto) {
    // 'YYYY-MM-DD' o 'YYYY-MM-DD HH:MM[:SS]' o 'YYYY-MM-DDTHH:MM…'
    const m = String(texto).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) throw new Error('Fecha inválida: ' + texto);
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)));
  }
  const isoDia = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const isoHora = (d) => `${isoDia(d)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  const sumarDias = (d, n) => new Date(d.getTime() + n * DIA_MS);
  const redondear = (v) => Math.round(Math.round(v * 1000) / 1000); // evita 124547,4999… por error de coma flotante

  // ------------------------------------------------------------------
  // Festivos de Colombia
  // ------------------------------------------------------------------
  function domingoPascua(anio) {
    // Algoritmo de Meeus/Jones/Butcher
    const a = anio % 19, b = Math.floor(anio / 100), c = anio % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(anio, mes - 1, dia));
  }
  const alLunes = (d) => { const w = d.getUTCDay(); return w === 1 ? d : sumarDias(d, (8 - w) % 7); };

  const cacheFestivos = {};
  function festivosColombia(anio) {
    if (cacheFestivos[anio]) return cacheFestivos[anio];
    const f = (m, d) => new Date(Date.UTC(anio, m - 1, d));
    const p = domingoPascua(anio);
    const lista = [
      [f(1, 1), 'Año Nuevo'],
      [alLunes(f(1, 6)), 'Reyes Magos'],
      [alLunes(f(3, 19)), 'San José'],
      [sumarDias(p, -3), 'Jueves Santo'],
      [sumarDias(p, -2), 'Viernes Santo'],
      [f(5, 1), 'Día del Trabajo'],
      [alLunes(sumarDias(p, 39)), 'Ascensión del Señor'],
      [alLunes(sumarDias(p, 60)), 'Corpus Christi'],
      [alLunes(sumarDias(p, 68)), 'Sagrado Corazón'],
      [alLunes(f(6, 29)), 'San Pedro y San Pablo'],
      [f(7, 20), 'Independencia'],
      [f(8, 7), 'Batalla de Boyacá'],
      [alLunes(f(8, 15)), 'Asunción de la Virgen'],
      [alLunes(f(10, 12)), 'Día de la Raza'],
      [alLunes(f(11, 1)), 'Todos los Santos'],
      [alLunes(f(11, 11)), 'Independencia de Cartagena'],
      [f(12, 8), 'Inmaculada Concepción'],
      [f(12, 25), 'Navidad'],
    ];
    const mapa = {};
    lista.forEach(([d, n]) => { mapa[isoDia(d)] = n; });
    return (cacheFestivos[anio] = mapa);
  }
  const nombreFestivo = (iso) => festivosColombia(+iso.slice(0, 4))[iso] || null;
  const esDominicalOFestivo = (iso) => aFecha(iso).getUTCDay() === 0 || !!nombreFestivo(iso);

  // ------------------------------------------------------------------
  // Parámetros legales vigentes para una fecha
  // ------------------------------------------------------------------
  function parametroVigente(parametros, iso) {
    const ordenados = [...parametros].sort((a, b) => a.vigente_desde.localeCompare(b.vigente_desde));
    let vigente = null;
    for (const p of ordenados) if (p.vigente_desde <= iso) vigente = p;
    if (!vigente) throw new Error('No hay parámetros legales vigentes para ' + iso);
    return normalizarParametro(vigente);
  }
  function normalizarParametro(p) {
    const minutos = (t) => { const [h, m] = String(t || '00:00').split(':'); return +h * 60 + +m; };
    return {
      ...p,
      smmlv: +p.smmlv, auxilio_transporte: +p.auxilio_transporte, jornada_semanal: +p.jornada_semanal,
      recargo_nocturno: +p.recargo_nocturno, recargo_dominical: +p.recargo_dominical,
      extra_diurna: +p.extra_diurna, extra_nocturna: +p.extra_nocturna,
      _iniNoc: minutos(p.inicio_nocturno || '19:00'), _finNoc: minutos(p.fin_nocturno || '06:00'),
    };
  }

  // ------------------------------------------------------------------
  // Lectura de archivos del biométrico
  //   Soporta:
  //   - ZKTeco attlog.dat:  "   12\t2026-09-01 07:58:12\t1\t0\t1\t0"
  //   - CSV/TXT exportados: "12;Juan Pérez;01/09/2026 07:58"
  //   - Fecha y hora en columnas separadas, con o sin AM/PM
  //   Devuelve { registros: [{codigo, fecha_hora}], errores: [texto] }
  // ------------------------------------------------------------------
  function leerArchivoBiometrico(texto) {
    const registros = [], errores = [];
    const lineas = String(texto).replace(/^﻿/, '').split(/\r?\n/);
    const reIso = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/;
    const reLat = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/;
    const reHora = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([aApP]\.?\s?[mM]\.?)?/;
    let colId = -1;

    lineas.forEach((linea, n) => {
      if (!linea.trim()) return;
      const campos = linea.split(/\t|;|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.replace(/^"|"$/g, '').trim());
      let fecha = null, resto = linea;
      let m = linea.match(reIso);
      if (m) { fecha = [+m[1], +m[2], +m[3]]; }
      else if ((m = linea.match(reLat))) { fecha = [+m[3], +m[2], +m[1]]; }  // dd/mm/aaaa (formato Colombia)

      if (!fecha) {
        // Encabezado: buscar la columna del código del empleado
        const i = campos.findIndex((c) => /^(ac-?no\.?|no\.?|id|user ?id|c[oó]digo|enroll ?(number|id)|n[uú]mero|pin)$/i.test(c));
        if (i >= 0) colId = i;
        else if (n > 0) errores.push(`Línea ${n + 1}: no se encontró fecha`);
        return;
      }
      resto = linea.slice(m.index + m[0].length);
      const h = resto.match(reHora);
      if (!h) { errores.push(`Línea ${n + 1}: no se encontró la hora`); return; }
      let hora = +h[1];
      const ampm = (h[4] || '').toLowerCase();
      if (ampm.startsWith('p') && hora < 12) hora += 12;
      if (ampm.startsWith('a') && hora === 12) hora = 0;

      let codigo = colId >= 0 ? campos[colId] : null;
      if (!codigo) {
        // primer campo que no sea parte de la fecha/hora y sea un identificador
        codigo = campos.find((c) => c && !reIso.test(c) && !reLat.test(c) && !reHora.test(c) && /^[A-Za-z0-9-]{1,20}$/.test(c));
      }
      if (!codigo) { errores.push(`Línea ${n + 1}: no se encontró el código del empleado`); return; }
      const [a, me, d] = fecha;
      if (me < 1 || me > 12 || d < 1 || d > 31 || hora > 23) { errores.push(`Línea ${n + 1}: fecha u hora fuera de rango`); return; }
      registros.push({
        codigo: String(codigo).replace(/^0+(?=\d)/, ''),
        fecha_hora: `${a}-${pad(me)}-${pad(d)} ${pad(hora)}:${h[2]}:${h[3] || '00'}`,
      });
    });
    return { registros, errores };
  }

  // ------------------------------------------------------------------
  // Lectura de tablas del biométrico (.xls / .xlsx / .csv con encabezados)
  //   Ej. "TransactionsReport.xls" de ZKTeco/ZKBioTime:
  //   | ID | Nombre | Fecha / Hora | Estado (Entrada/Salida) | Tipo de Registro |
  //   Recibe un arreglo de filas (cada fila un arreglo de celdas).
  //   Devuelve { registros: [{codigo, nombre, fecha_hora, tipo}], errores, columnas }
  // ------------------------------------------------------------------
  const norm = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  function detectarColumnas(fila) {
    const c = fila.map(norm);
    const buscar = (re) => c.findIndex((x) => re.test(x));
    const col = {
      id: buscar(/^(id|ac-?no\.?|no\.?|user ?id|c[o]digo|codigo|enroll ?(number|id)|numero|pin|id de usuario|id empleado)$/),
      nombre: buscar(/^(nombre|name|nombres|empleado|nombre completo)$/),
      fechaHora: buscar(/^(fecha ?\/ ?hora|fecha y hora|date ?\/ ?time|datetime|time|fecha hora|marcacion|hora de marcacion)$/),
      fecha: buscar(/^(fecha|date)$/),
      hora: buscar(/^(hora|time|hora de registro)$/),
      tipo: buscar(/^(estado|state|tipo|status|check ?type|tipo de marcacion|entrada\/salida|e\/s)$/),
    };
    const valido = col.id >= 0 && (col.fechaHora >= 0 || (col.fecha >= 0 && col.hora >= 0));
    return valido ? col : null;
  }
  function textoAFechaHora(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number' && v > 20000) {                  // número de serie de Excel
      const ms = Math.round((v - 25569) * 86400000);
      const d = new Date(ms);
      return `${isoDia(d)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    }
    if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())} ${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
    const t = String(v).trim();
    let m, a, me, d;
    if ((m = t.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) { a = +m[1]; me = +m[2]; d = +m[3]; }
    else if ((m = t.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/))) { a = +m[3]; me = +m[2]; d = +m[1]; }   // dd/mm/aaaa
    else return null;
    const h = t.slice(m.index + m[0].length).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([aApP]\.?\s?[mM]\.?)?/);
    let hora = h ? +h[1] : 0;
    const ampm = h ? (h[4] || '').toLowerCase() : '';
    if (ampm.startsWith('p') && hora < 12) hora += 12;
    if (ampm.startsWith('a') && hora === 12) hora = 0;
    if (me < 1 || me > 12 || d < 1 || d > 31 || hora > 23) return null;
    return `${a}-${pad(me)}-${pad(d)} ${pad(hora)}:${h ? h[2] : '00'}:${h && h[3] ? h[3] : '00'}`;
  }
  function tipoMarcacion(v) {
    const t = norm(v);
    if (!t) return null;
    if (/^(entrada|in|check ?in|c\/in|ingreso|e|0)$/.test(t)) return 'entrada';
    if (/^(salida|out|check ?out|c\/out|egreso|s|1)$/.test(t)) return 'salida';
    return null;
  }
  function leerFilasBiometrico(filas) {
    const registros = [], errores = [];
    let col = null, filaEnc = -1;
    for (let i = 0; i < Math.min(filas.length, 30) && !col; i++) { col = detectarColumnas(filas[i] || []); if (col) filaEnc = i; }
    if (!col) return { registros, errores: ['No se encontraron las columnas de código y fecha/hora en el archivo'], columnas: null };
    for (let i = filaEnc + 1; i < filas.length; i++) {
      const f = filas[i] || [];
      const codigo = String(f[col.id] ?? '').trim().replace(/\.0+$/, '').replace(/^0+(?=\d)/, '');
      if (!codigo) continue;                                   // filas de pie de página / vacías
      let fh = col.fechaHora >= 0 ? textoAFechaHora(f[col.fechaHora]) : null;
      if (!fh && col.fecha >= 0) {
        const fecha = textoAFechaHora(f[col.fecha]);
        const hora = String(f[col.hora] ?? '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
        if (fecha && hora) fh = `${fecha.slice(0, 10)} ${pad(+hora[1])}:${hora[2]}:${hora[3] || '00'}`;
      }
      if (!fh) { errores.push(`Fila ${i + 1}: fecha u hora no válida`); continue; }
      registros.push({
        codigo,
        nombre: col.nombre >= 0 ? String(f[col.nombre] ?? '').replace(/\s+/g, ' ').trim() : '',
        fecha_hora: fh,
        tipo: col.tipo >= 0 ? tipoMarcacion(f[col.tipo]) : null,
      });
    }
    return { registros, errores, columnas: col };
  }

  // ------------------------------------------------------------------
  // Emparejar marcaciones en turnos (entrada → salida)
  //   - Dobles marcaciones (menos de 5 min después de la anterior) se ignoran
  //   - Un turno no puede durar más de MAX_TURNO_H horas
  //   - Si el reloj indica Entrada/Salida se usa para validar:
  //       una "Salida" nunca abre un turno (queda como salida sin entrada);
  //       "Entrada → Entrada" el mismo día se acepta como turno pero con aviso
  //       (lo normal es que la persona oprimió la tecla equivocada)
  //   - El turno pertenece al día en que empezó (soporta turnos nocturnos)
  // ------------------------------------------------------------------
  const MAX_TURNO_H = 14;   // jornada máx. legal 10 h + margen; más que esto casi siempre es una marcación olvidada
  const DOBLE_MARCA_MIN = 5;
  function emparejarMarcaciones(marcaciones) {
    const ordenadas = marcaciones
      .filter((m) => !m.anulada)
      .map((m) => ({ f: aFecha(m.fecha_hora), tipo: m.tipo || null }))
      .sort((a, b) => a.f - b.f);
    const limpias = [];
    ordenadas.forEach((m) => {
      const ult = limpias[limpias.length - 1];
      if (!ult || m.f - ult.f >= DOBLE_MARCA_MIN * 60000) limpias.push(m);
    });

    const turnos = [], inconsistencias = [];
    let i = 0;
    while (i < limpias.length) {
      const a = limpias[i], b = limpias[i + 1];
      if (a.tipo === 'salida') {
        inconsistencias.push({ fecha: isoDia(a.f), hora: isoHora(a.f), motivo: 'Salida sin entrada (falta marcar la entrada)' });
        i += 1; continue;
      }
      if (b && b.f - a.f <= MAX_TURNO_H * 3600000) {
        const t = { fecha: isoDia(a.f), entrada: isoHora(a.f), salida: isoHora(b.f), minutos: Math.round((b.f - a.f) / 60000) };
        if (b.tipo === 'entrada') t.aviso = 'El reloj registró la salida como "Entrada"';
        turnos.push(t);
        i += 2;
      } else {
        inconsistencias.push({ fecha: isoDia(a.f), hora: isoHora(a.f), motivo: a.tipo === 'entrada' ? 'Entrada sin salida (falta marcar la salida)' : 'Marcación sin pareja (falta entrada o salida)' });
        i += 1;
      }
    }
    return { turnos, inconsistencias };
  }

  // ------------------------------------------------------------------
  // Clasificación de horas
  //   ORD  ordinaria diurna (va incluida en el salario)
  //   RN   recargo nocturno            RDF  recargo dominical/festivo diurno
  //   RNDF nocturno dominical/festivo
  //   HED  extra diurna                HEN  extra nocturna
  //   HEDDF extra diurna dom/fest      HENDF extra nocturna dom/fest
  // ------------------------------------------------------------------
  const CONCEPTOS = {
    ORD:   { nombre: 'Horas ordinarias diurnas', corto: 'Ord.' },
    RN:    { nombre: 'Recargo nocturno', corto: 'RN' },
    RDF:   { nombre: 'Recargo dominical/festivo', corto: 'RDF' },
    RNDF:  { nombre: 'Recargo nocturno dominical/festivo', corto: 'RNDF' },
    HED:   { nombre: 'Hora extra diurna', corto: 'HED' },
    HEN:   { nombre: 'Hora extra nocturna', corto: 'HEN' },
    HEDDF: { nombre: 'Hora extra diurna dominical/festiva', corto: 'HEDDF' },
    HENDF: { nombre: 'Hora extra nocturna dominical/festiva', corto: 'HENDF' },
  };
  // Factor que se paga ADEMÁS del salario por cada hora del concepto
  function factorConcepto(c, p) {
    switch (c) {
      case 'ORD': return 0;
      case 'RN': return p.recargo_nocturno;
      case 'RDF': return p.recargo_dominical;
      case 'RNDF': return p.recargo_nocturno + p.recargo_dominical;
      case 'HED': return 1 + p.extra_diurna;
      case 'HEN': return 1 + p.extra_nocturna;
      case 'HEDDF': return 1 + p.extra_diurna + p.recargo_dominical;
      case 'HENDF': return 1 + p.extra_nocturna + p.recargo_dominical;
    }
    return 0;
  }
  // Horas mensuales para el valor de la hora: jornada semanal × 30/6
  const horasMes = (p) => p.jornada_semanal * 5;

  function clasificarTurnos(turnos, empleado, parametros) {
    const porDia = {};                 // fecha → { minutos por concepto, valor }
    const minutosPorFecha = {};        // minutos trabajados acumulados por día del turno
    const salario = +empleado.salario;
    const integral = empleado.tipo_salario === 'integral';
    const diasSemana = +empleado.dias_laborales_semana || 6;

    const horas = {}, valores = {};
    Object.keys(CONCEPTOS).forEach((c) => { horas[c] = 0; valores[c] = 0; });

    for (const t of turnos) {
      const p = parametroVigente(parametros, t.fecha);
      const limiteDia = (p.jornada_semanal / diasSemana) * 60;     // minutos ordinarios por día
      const dia = (porDia[t.fecha] = porDia[t.fecha] || { fecha: t.fecha, turnos: [], minutos: {}, valor: 0, festivo: null, dominical: false });
      dia.turnos.push(`${t.entrada.slice(11, 16)}–${t.salida.slice(11, 16)}`);
      if (t.aviso) (dia.avisos = dia.avisos || []).push(`${t.salida.slice(11, 16)}: ${t.aviso}`);
      dia.dominical = aFecha(t.fecha).getUTCDay() === 0;
      dia.festivo = nombreFestivo(t.fecha);

      let cursor = aFecha(t.entrada);
      for (let k = 0; k < t.minutos; k++, cursor = new Date(cursor.getTime() + 60000)) {
        const isoMin = isoDia(cursor);
        const pm = parametroVigente(parametros, isoMin);
        const minDelDia = cursor.getUTCHours() * 60 + cursor.getUTCMinutes();
        const nocturno = minDelDia >= pm._iniNoc || minDelDia < pm._finNoc;
        const domFest = esDominicalOFestivo(isoMin);
        const acumulado = (minutosPorFecha[t.fecha] = (minutosPorFecha[t.fecha] || 0) + 1);
        const extra = acumulado > limiteDia;
        let c;
        if (extra) c = nocturno ? (domFest ? 'HENDF' : 'HEN') : (domFest ? 'HEDDF' : 'HED');
        else c = nocturno ? (domFest ? 'RNDF' : 'RN') : (domFest ? 'RDF' : 'ORD');
        dia.minutos[c] = (dia.minutos[c] || 0) + 1;
        horas[c] += 1 / 60;
        if (!integral) {
          // el valor de la hora depende de la jornada vigente ese día (44 h → 220 h/mes, 42 h → 210 h/mes)
          const v = (salario / horasMes(pm) / 60) * factorConcepto(c, pm);
          dia.valor += v;
          valores[c] += v;
        }
      }
    }
    const dias = Object.values(porDia).sort((a, b) => a.fecha.localeCompare(b.fecha));
    for (const d of dias) {
      d.horas = Object.fromEntries(Object.entries(d.minutos).map(([c, m]) => [c, Math.round((m / 60) * 100) / 100]));
      d.valor = redondear(d.valor);
    }
    Object.keys(valores).forEach((c) => { valores[c] = redondear(valores[c]); horas[c] = Math.round(horas[c] * 100) / 100; });
    return { dias, horas, valores };
  }

  // ------------------------------------------------------------------
  // Días del periodo en base 30 (mes comercial, como se liquida en Colombia)
  // ------------------------------------------------------------------
  function dias360(inicioIso, finIso) {
    if (finIso < inicioIso) return 0;
    const a = aFecha(inicioIso), b = aFecha(finIso);
    const finDeMes = (d) => sumarDias(d, 1).getUTCDate() === 1;
    let d1 = Math.min(a.getUTCDate(), 30);
    let d2 = b.getUTCDate();
    if (finDeMes(b)) d2 = 30; else d2 = Math.min(d2, 30);
    return (b.getUTCFullYear() - a.getUTCFullYear()) * 360 + (b.getUTCMonth() - a.getUTCMonth()) * 30 + (d2 - d1) + 1;
  }

  // Fondo de Solidaridad Pensional según IBC mensual en SMMLV
  function tasaFSP(ibcMensual, smmlv) {
    const n = ibcMensual / smmlv;
    if (n < 4) return 0;
    if (n < 16) return 0.01;
    if (n < 17) return 0.012;
    if (n < 18) return 0.014;
    if (n < 19) return 0.016;
    if (n < 20) return 0.018;
    return 0.02;
  }
  const TARIFA_ARL = { 1: 0.00522, 2: 0.01044, 3: 0.02436, 4: 0.0435, 5: 0.0696 };

  // ------------------------------------------------------------------
  // Liquidación de un empleado en un periodo
  // ------------------------------------------------------------------
  function liquidarEmpleado({ empleado, empresa, marcaciones = [], novedades = [], parametros, inicio, fin }) {
    const p = parametroVigente(parametros, fin);
    const salario = +empleado.salario;
    const integral = empleado.tipo_salario === 'integral';

    // Días laborados dentro del periodo según ingreso y retiro
    const desde = empleado.fecha_ingreso > inicio ? empleado.fecha_ingreso : inicio;
    const hasta = empleado.fecha_retiro && empleado.fecha_retiro < fin ? empleado.fecha_retiro : fin;
    const diasContrato = Math.max(0, dias360(desde, hasta));

    const sumaNov = (tipo, campo) => novedades.filter((n) => n.tipo === tipo).reduce((s, n) => s + (+n[campo] || 0), 0);
    const diasIncapacidad = sumaNov('incapacidad', 'dias');
    const diasLicencia = sumaNov('licencia_no_remunerada', 'dias');
    const diasVacaciones = sumaNov('vacaciones', 'dias');
    const diasSalario = Math.max(0, diasContrato - diasIncapacidad - diasLicencia - diasVacaciones);

    // Se reciben marcaciones con un día de margen a cada lado para cerrar turnos
    // nocturnos; solo cuentan los turnos que EMPIEZAN dentro del periodo.
    const emp = emparejarMarcaciones(marcaciones);
    const enPeriodo = (f) => f >= desde && f <= hasta;
    const turnos = emp.turnos.filter((t) => enPeriodo(t.fecha));
    const inconsistencias = emp.inconsistencias.filter((x) => enPeriodo(x.fecha));
    const horas = clasificarTurnos(turnos, empleado, parametros);

    const salarioDia = salario / 30;
    const basico = redondear(salarioDia * diasSalario);
    const vacaciones = redondear(salarioDia * diasVacaciones);
    // Incapacidad de origen común: 66,67 % del salario, nunca menos de un SMMLV diario
    const incapacidad = redondear(Math.max(salarioDia * 0.6667, p.smmlv / 30) * diasIncapacidad);
    const tieneAuxilio = !integral && empleado.auxilio_transporte !== false && salario <= 2 * p.smmlv;
    const auxilio = tieneAuxilio ? redondear((p.auxilio_transporte / 30) * diasSalario) : 0;
    const recargos = Object.values(horas.valores).reduce((s, v) => s + v, 0);
    const bonifSalarial = sumaNov('bonificacion_salarial', 'valor');
    const bonifNoSalarial = sumaNov('bonificacion_no_salarial', 'valor');

    const devengos = [
      { concepto: `Salario básico (${diasSalario} días)`, valor: basico },
      ...Object.entries(horas.valores).filter(([, v]) => v > 0).map(([c, v]) => ({ concepto: `${CONCEPTOS[c].nombre} (${horas.horas[c]} h)`, valor: v })),
      vacaciones && { concepto: `Vacaciones (${diasVacaciones} días)`, valor: vacaciones },
      incapacidad && { concepto: `Incapacidad (${diasIncapacidad} días)`, valor: incapacidad },
      auxilio && { concepto: 'Auxilio de transporte', valor: auxilio },
      bonifSalarial && { concepto: 'Bonificación salarial', valor: bonifSalarial },
      bonifNoSalarial && { concepto: 'Bonificación no salarial', valor: bonifNoSalarial },
    ].filter(Boolean);
    const totalDevengado = devengos.reduce((s, d) => s + d.valor, 0);

    // Ingreso base de cotización (sin auxilio ni pagos no salariales)
    const salarial = basico + recargos + vacaciones + incapacidad + bonifSalarial;
    let ibc = integral ? salarial * 0.7 : salarial;
    const ibcMinimo = (p.smmlv / 30) * diasContrato;              // nunca por debajo del mínimo proporcional
    if (diasContrato > 0 && ibc < ibcMinimo) ibc = ibcMinimo;
    ibc = redondear(ibc);
    const ibcMensual = diasContrato > 0 ? (ibc / diasContrato) * 30 : 0;

    const fsp = redondear(ibc * tasaFSP(ibcMensual, p.smmlv));
    const deducciones = [
      { concepto: 'Salud (4 %)', valor: redondear(ibc * 0.04) },
      { concepto: 'Pensión (4 %)', valor: redondear(ibc * 0.04) },
      fsp && { concepto: 'Fondo de solidaridad pensional', valor: fsp },
      ...novedades.filter((n) => n.tipo === 'descuento' || n.tipo === 'prestamo')
        .map((n) => ({ concepto: (n.tipo === 'prestamo' ? 'Préstamo' : 'Descuento') + (n.descripcion ? ` · ${n.descripcion}` : ''), valor: +n.valor })),
    ].filter(Boolean);
    const totalDeducciones = deducciones.reduce((s, d) => s + d.valor, 0);

    // Aportes del empleador (Art. 114-1 E.T. para exonerados con < 10 SMMLV)
    const exonerado = empresa && empresa.exonerada_aportes !== false && salario < 10 * p.smmlv;
    const aportes = [
      { concepto: 'Salud empleador (8,5 %)', valor: exonerado ? 0 : redondear(ibc * 0.085) },
      { concepto: 'Pensión empleador (12 %)', valor: redondear(ibc * 0.12) },
      { concepto: `ARL riesgo ${empleado.arl_riesgo || 1}`, valor: redondear(ibc * TARIFA_ARL[empleado.arl_riesgo || 1]) },
      { concepto: 'Caja de compensación (4 %)', valor: redondear(ibc * 0.04) },
      { concepto: 'ICBF (3 %)', valor: exonerado ? 0 : redondear(ibc * 0.03) },
      { concepto: 'SENA (2 %)', valor: exonerado ? 0 : redondear(ibc * 0.02) },
    ];

    // Provisiones de prestaciones sociales
    const basePrestaciones = basico + recargos + vacaciones + incapacidad + bonifSalarial + auxilio;
    const baseVacaciones = basico + vacaciones + incapacidad;
    const provisiones = integral
      ? [{ concepto: 'Vacaciones (4,17 %)', valor: redondear(baseVacaciones * 0.0417) }]
      : [
          { concepto: 'Cesantías (8,33 %)', valor: redondear(basePrestaciones * 0.0833) },
          { concepto: 'Intereses de cesantías (1 %)', valor: redondear(basePrestaciones * 0.01) },
          { concepto: 'Prima de servicios (8,33 %)', valor: redondear(basePrestaciones * 0.0833) },
          { concepto: 'Vacaciones (4,17 %)', valor: redondear(baseVacaciones * 0.0417) },
        ];
    const totalAportes = aportes.reduce((s, a) => s + a.valor, 0);
    const totalProvisiones = provisiones.reduce((s, a) => s + a.valor, 0);

    return {
      empleado_id: empleado.id,
      documento: empleado.documento,
      nombre: `${empleado.nombres} ${empleado.apellidos || ''}`.trim(),
      cargo: empleado.cargo || '',
      salario,
      dias: diasContrato,
      horas: horas.horas,
      valores: horas.valores,
      detalleDias: horas.dias,
      inconsistencias,
      devengos, totalDevengado,
      deducciones, totalDeducciones,
      neto: totalDevengado - totalDeducciones,
      ibc, aportes, totalAportes, provisiones, totalProvisiones,
      costoTotal: totalDevengado + totalAportes + totalProvisiones,
    };
  }

  function liquidarPeriodo({ empresa, empleados, marcaciones, novedades = [], parametros, inicio, fin }) {
    const antes = isoDia(sumarDias(aFecha(inicio), -1));
    const despues = isoDia(sumarDias(aFecha(fin), 1));
    const activos = empleados.filter((e) => e.fecha_ingreso <= fin && (!e.fecha_retiro || e.fecha_retiro >= inicio));
    const resultados = activos.map((e) => {
      const propias = marcaciones.filter((m) => (m.empleado_id ? m.empleado_id === e.id : String(m.codigo_biometrico) === String(e.codigo_biometrico)));
      const rango = propias.filter((m) => m.fecha_hora.slice(0, 10) >= antes && m.fecha_hora.slice(0, 10) <= despues);
      return liquidarEmpleado({
        empleado: e, empresa, parametros, inicio, fin,
        marcaciones: rango,
        novedades: novedades.filter((n) => n.empleado_id === e.id && n.fecha >= inicio && n.fecha <= fin),
      });
    });
    const sumar = (k) => resultados.reduce((s, r) => s + r[k], 0);
    return {
      empresa: empresa ? empresa.nombre : '', inicio, fin, calculado_en: new Date().toISOString(),
      empleados: resultados,
      totales: {
        devengado: sumar('totalDevengado'), deducciones: sumar('totalDeducciones'), neto: sumar('neto'),
        aportes: sumar('totalAportes'), provisiones: sumar('totalProvisiones'), costo: sumar('costoTotal'),
      },
    };
  }

  const api = {
    CONCEPTOS, aFecha, isoDia, isoHora, sumarDias, dias360,
    domingoPascua, festivosColombia, nombreFestivo, esDominicalOFestivo,
    parametroVigente, leerArchivoBiometrico, leerFilasBiometrico, emparejarMarcaciones, clasificarTurnos,
    liquidarEmpleado, liquidarPeriodo, horasMes,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.JornalCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
