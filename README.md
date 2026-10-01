# Jornal

**Nómina y asistencia para empresas colombianas**, conectada al biométrico. Es un producto de Soporte TI.

Jornal lee las marcaciones del reloj biométrico, arma los turnos de cada empleado y separa las horas en ordinarias, recargos y extras según la norma vigente para cada día. Con eso liquida la nómina completa del periodo: devengos, deducciones, aportes del empleador y provisiones de prestaciones.

Es una app **independiente** de Helpdesk TI. Tiene su propio repositorio, su propio proyecto de Supabase y sus propios usuarios.

---

## Qué hace hoy

| Módulo | Qué incluye |
|---|---|
| **Empresas** | Varias empresas cliente en la misma app. Periodicidad quincenal o mensual. Exoneración de aportes del art. 114-1 E.T. |
| **Empleados** | Salario ordinario o integral, tipo de contrato, ingreso y retiro, riesgo ARL, EPS/AFP/CCF, código del biométrico y días laborales por semana. |
| **Asistencia** | Importa el reporte del reloj en Excel (`.xls`/`.xlsx`, como el *TransactionsReport* de ZKTeco), CSV/TXT o `attlog.dat`, sin duplicar marcaciones al reimportar. Usa la columna Entrada/Salida cuando el reloj la trae. Crea automáticamente los empleados nuevos que encuentre en el archivo. Permite marcaciones manuales para olvidos y señala las marcaciones sin pareja. |
| **Enlace por empresa** | Cada empresa tiene su enlace (`…/Jornal/?empresa=la-rufina`). La pantalla de ingreso muestra el nombre de la empresa y sus usuarios solo ven sus datos. Los accesos se administran desde Empresas → Accesos. |
| **Cálculo de horas** | Separa las horas en ordinarias, recargo nocturno (desde las 7 p. m.), dominical/festivo, nocturno dominical, extras diurnas y nocturnas, y extras dominicales. Soporta turnos que pasan la medianoche. |
| **Festivos** | Calcula automáticamente los festivos de Colombia (Ley Emiliani y Semana Santa) para cualquier año. |
| **Liquidación** | Salario por días (base 30), auxilio de transporte (hasta 2 SMMLV), recargos y extras, incapacidades, vacaciones, licencias, bonificaciones salariales y no salariales, préstamos y descuentos. |
| **Deducciones** | Salud 4 %, pensión 4 % y Fondo de Solidaridad Pensional según el IBC. |
| **Aportes del empleador** | Salud, pensión, ARL por riesgo, caja de compensación, ICBF y SENA, con exoneración 114-1. |
| **Provisiones** | Cesantías, intereses de cesantías, prima y vacaciones. Para salario integral, solo vacaciones. |
| **Salidas** | Desprendible de pago por empleado, detalle día a día y exportación a Excel (resumen, conceptos y día a día). |
| **Cierre de periodo** | Guarda una foto de la liquidación, para que cambios posteriores no alteren lo que ya se pagó. |
| **Parámetros legales con vigencia** | SMMLV, auxilio de transporte, jornada y recargos, cada uno con su fecha de inicio. Ya vienen cargados los cambios de 2026: dominical 90 % desde el 1-jul y jornada de 42 h desde el 15-jul. |

---

## Puesta en marcha

### 1. Crear el proyecto en Supabase (uno nuevo, solo para Jornal)
1. Entra a [supabase.com](https://supabase.com) y crea un proyecto nuevo (**New project**) llamado `jornal`.
2. Abre **SQL Editor → New query**, pega todo el contenido de `schema.sql` y dale **Run**.
3. En **Project Settings → API**, copia el **Project URL** y la llave **anon public**.

### 2. Configurar la app
Abre `config.js` y pega los dos valores:
```js
window.JORNAL_CONFIG = {
  SUPABASE_URL: 'https://xxxxxxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOi...',
};
```
Si `config.js` queda vacío, la app abre en **modo demo**, con datos de ejemplo en memoria.

### 3. Crear usuarios
La app no tiene registro público.
1. En Supabase, ve a **Authentication → Users → Add user** y crea tu usuario con correo y contraseña.
2. La primera vez, ve a **Table Editor → usuarios_perfil** y cambia tu `rol` de `cliente` a `admin`.

| Rol | Quién | Qué ve |
|---|---|---|
| `admin` | Soporte TI | Todas las empresas; cambia parámetros legales y reabre periodos cerrados |
| `tecnico` | Equipo de Soporte TI | Todas las empresas, sin tocar parámetros legales |
| `cliente` | Usuario de una empresa | Solo las empresas asignadas en `usuarios_empresas` |

Todo usuario nuevo nace como `cliente` sin empresas, así que no ve nada hasta que lo asignes.

### 4. Publicar en GitHub Pages
1. Sube todos los archivos a la rama `main` del repositorio `ZANETTI10/Jornal`.
2. En **Settings → Pages**, en **Source**, elige *Deploy from a branch*, luego `main` y `/ (root)`, y guarda.
3. En un par de minutos la app queda en `https://zanetti10.github.io/Jornal/`.

> **Sobre la llave anon:** puede estar en un repositorio público. No da acceso por sí sola, porque todas las tablas tienen Row Level Security y solo los usuarios autenticados pueden leer o escribir. Lo que **nunca** se debe publicar es la llave `service_role`.

---

## Flujo de trabajo con un cliente

1. **Empresas → Agregar empresa.**
2. **Empleados → Agregar empleado.** Pon el **código del biométrico**: es el número con el que el empleado está enrolado en el reloj.
3. Saca el archivo del reloj. En ZKTeco se hace con USB → *Descargar registros de asistencia* → `attlog.dat`, o desde el software ZKTime/ZKBioTime exportando un CSV.
4. **Asistencia → Importar del biométrico** y revisa los turnos. Las marcaciones "sin pareja" se corrigen con una marcación manual.
5. **Novedades:** incapacidades, bonos, préstamos, vacaciones.
6. **Liquidación →** elige el mes y la quincena → **Calcular nómina**. Revisa el desprendible de cada empleado, exporta a Excel y cierra el periodo.

En `ejemplos/attlog_ejemplo.dat` hay un archivo de prueba con el formato de ZKTeco.

---

## Estructura

```
index.html        pantalla y pestañas
style.css         estilos (modo claro y oscuro)
config.js         llaves de Supabase (vacío = modo demo)
calculo.js        motor de nómina: festivos, turnos, recargos, liquidación
datos.js          conexión a Supabase / datos de demostración
app.js            lógica de la interfaz
schema.sql        tablas, seguridad y parámetros legales 2026
ejemplos/         archivo de biométrico de prueba
```

El motor (`calculo.js`) no depende de la interfaz. Se puede probar en Node:
```bash
node -e "const C=require('./calculo.js'); console.log(C.festivosColombia(2027))"
```

---

## Supuestos del cálculo (revisar con el contador de cada cliente)

- **Horas extra por día:** son las que pasan de *jornada semanal ÷ días laborales*. Con 42 h y 6 días, el límite es 7 h por día; con 5 días, 8,4 h. El tope semanal todavía no se valida aparte.
- **Recargo dominical:** se paga sobre toda hora trabajada en domingo o festivo. El descanso compensatorio todavía no se maneja.
- **Valor de la hora:** *salario ÷ (jornada semanal × 5)*, es decir 210 h/mes con jornada de 42 h.
- **Emparejamiento de marcaciones:** se alternan entrada y salida. Si un turno pasa de 14 h, se marca para revisar en lugar de pagarse. Las dobles marcaciones con menos de 3 minutos de diferencia se ignoran.
- **Incapacidad de origen común:** se paga al 66,67 %, sin bajar del SMMLV diario. No distingue entre días a cargo del empleador y días a cargo de la EPS.
- **Aún no incluye:** retención en la fuente, aprendices SENA (cuota y aportes especiales), licencias de maternidad/paternidad, liquidación de contrato al retiro, archivo plano PILA ni nómina electrónica DIAN.

## Siguientes pasos

1. **Nómina electrónica DIAN**, integrada por API con un proveedor tecnológico habilitado.
2. **Archivo plano PILA**, para cargar en el operador de pagos.
3. **Recepción automática del biométrico** (protocolo push/ADMS de ZKTeco) mediante una Edge Function de Supabase, para no tener que sacar el archivo con USB.
4. **Acceso para clientes:** que cada empresa vea solo su nómina y sus desprendibles.
5. **Liquidación de contrato** y **retención en la fuente**.
