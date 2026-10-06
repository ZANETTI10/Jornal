# DESIGN.md · Jornal

Guía de diseño de Jornal. Todo cambio visual parte de aquí y `style.css` sigue el
mismo orden de secciones. Si algo no está en esta guía, se agrega aquí primero.

## 1. Para quién y para qué

Jornal lo usa la persona que liquida la nómina en una empresa colombiana y, en
Soporte TI, quien administra varias empresas. Entra, revisa el periodo, corrige
lo que el reloj biométrico dejó incompleto y paga. No es un experto en sistemas.

- **Una pantalla, una tarea.** Lo que no se usa cada quincena va en "Ajustes" o
  en "Ver más detalle".
- **Primero lo que hay que resolver.** Los avisos ("Para revisar") van antes que
  las gráficas.
- **Se usa con el dedo.** Todo control mide mínimo 44 px de alto.

## 2. Color

Tema oscuro. El acento es el azul verdoso de la luz del lector de huella: solo
se usa para lo que se puede tocar o para la cifra que manda en la pantalla.

| Token | Valor | Uso |
|---|---|---|
| `--papel` | `#0a0f16` | Fondo de la página y de los campos |
| `--superficie` | `#111823` | Barra, menú, paneles, tablas |
| `--superficie-2` | `#17202d` | Encabezado de tabla, fila bajo el cursor, botón normal |
| `--superficie-3` | `#1e2939` | Pistas de barras, chips, opción activa de un submenú |
| `--tinta` | `#e8eef6` | Texto principal |
| `--tinta-suave` | `#9babbf` | Etiquetas, notas, texto secundario |
| `--linea` / `--linea-suave` | `#222e3f` / `#1a2433` | Bordes de panel / separadores de fila |
| `--borde-control` | `#3a4a60` | Borde de campos y botones |
| `--sello` | `#3ecbdf` | Acento: botón principal, enlaces, barras de gráficas |
| `--sello-fuerte` | `#7fdfee` | Acento sobre fondo de acento suave (opción activa, cifra destacada) |
| `--sello-suave` | `#0f2c36` | Fondo de lo seleccionado |
| `--sello-tinta` | `#04181d` | Texto sobre el acento |
| `--ok` | `#62d69c` | Mejora, cerrado, correcto |
| `--aviso` / `--aviso-marca` | `#f3c264` / `#e5a52a` | Avisos; domingos y festivos |
| `--critico` | `#ff9389` | Errores, topes legales superados, eliminar |
| `--foco` | `#ffd166` | Contorno de foco del teclado |

Reglas:
- El color nunca es la única señal: un aviso lleva texto, un festivo lleva
  leyenda, una variación lleva flecha.
- Contraste mínimo 4,5:1 para texto. `--tinta-suave` sobre `--superficie` da 7:1.
- Ámbar y rojo son solo para estados. No se usan para decorar.

## 3. Tipografía

| Rol | Fuente | Tamaño / peso |
|---|---|---|
| Títulos, marca y cifras grandes | **Sora** (archivo propio `sora.woff2`) | 600 |
| Texto, tablas, campos y botones | Fuente del sistema | 400 / 600 |

- Título de periodo en el tablero: 1,45 rem. Título de vista (`h2`): 1,2 rem.
  Subtítulo (`h3`): 1,02 rem.
- Cifra principal: 1,6 rem. Texto: 16 px. Tabla: 0,92 rem. Etiqueta: 0,86 rem.
- Los números de tablas y totales usan cifras tabulares para que alineen.
- Sin mayúsculas sostenidas. Frases en tono normal: "Calcular nómina".

## 4. Espacio y forma

- Escala de espacio: 4 · 8 · 12 · 16 · 24 · 32 px (`--e1` a `--e6`).
- Separación entre bloques de una vista: 18 px.
- Radios: 6 px controles y chips (`--r-s`), 10 px paneles y tablas (`--r`),
  14 px ingreso y diálogos (`--r-l`).
- Los paneles se separan con borde de 1 px, sin sombra. Solo flotan (con sombra)
  el ingreso, los diálogos y el aviso inferior.

## 5. Estructura

```
Computador (más de 900 px)             Celular
┌──────────────────────────────────┐   ┌──────────────────┐
│ Marca │ Empresa ▾       Usuario  │   │ Marca    Usuario │
├───────┼──────────────────────────┤   │ Empresa ▾        │
│ Tabl. │ Controles del periodo    │   ├──────────────────┤
│ Asis. │ Cifras principales       │   │ Contenido        │
│ Empl. │ Para revisar             │   │ (tablas como     │
│ Nov.  │ Gráficas / tabla         │   │  tarjetas)       │
│ Nóm.  │                          │   ├──────────────────┤
│ Ajus. │                          │   │ ▣  ◷  ☺  ✚  ▭  ≡ │
└───────┴──────────────────────────┘   └──────────────────┘
```

- **Barra superior** fija: marca, selector de empresa y usuario.
- **Menú** a la izquierda en computador (216 px) y abajo en celular. Seis
  entradas con icono y nombre; "Ajustes" queda separada al final.
- **Contenido** con ancho máximo de 1280 px.
- En celular (menos de 720 px) las tablas se vuelven tarjetas: cada celda
  muestra el nombre de su columna.

## 6. Componentes

- **Botón principal** (`.btn-primario`): uno por pantalla, para la acción que
  hace avanzar ("Calcular nómina", "Guardar"). Los demás son `.btn` normales.
  Eliminar usa `.btn-peligro` y siempre pide confirmación.
- **Campos**: etiqueta arriba, siempre visible. Al enfocar, borde de acento.
- **Cifra** (`.cifra`): etiqueta, número y una línea de contexto. Solo una por
  fila es `.destacada` (lleva la línea de luz arriba).
- **Avisos** (`.alerta`): franja a la izquierda, texto que dice qué pasa y un
  botón que lleva a resolverlo.
- **Chips**: estado corto de una fila (Borrador, Cerrado, Manual).
- **Tablas**: encabezado gris, números a la derecha, fila resaltada al pasar.
- **Gráficas**: barras del acento; domingos y festivos en ámbar con leyenda.
- **Iconos**: trazo de 1,8 px, 20 px, color heredado del texto. Solo en el menú.

## 7. Movimiento

Transiciones de 120 ms en botones, campos y menú, únicamente como respuesta a
una acción. Nada se anima solo. Con "reducir movimiento" activo se apagan todas.

## 8. Accesibilidad

- Foco de teclado visible (contorno ámbar de 3 px) en todo lo interactivo.
- Enlace "Ir al contenido" al inicio.
- La sección activa del menú se marca con `aria-current="page"`.
- Los iconos son decorativos (`aria-hidden`); el nombre siempre está escrito.
- Al imprimir (desprendibles) se pasa a fondo blanco y se ocultan menús.

## 9. Textos

- Español de Colombia, trato de "tú", frases cortas.
- Los botones dicen lo que hacen: "Guardar marcaciones", no "Aceptar".
- Un error dice qué pasó y cómo arreglarlo.
- Una pantalla vacía explica el siguiente paso.
