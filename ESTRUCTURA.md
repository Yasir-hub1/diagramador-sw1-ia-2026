# TRAZO — estructura y funcionamiento

Aplicación web para dibujar diagramas de clases UML en salas compartidas. El servidor es Node.js con Express. El navegador dibuja el lienzo con JointJS y se sincroniza por Socket.IO. Los diagramas se guardan en PostgreSQL.

Arranque: `npm run dev` ejecuta `node app/app.js` y escucha en el puerto **3001**.

## Estructura de carpetas

```
diagramador-sw1-ia-2026/
├── app/                          Backend
│   ├── app.js                    Servidor HTTP, rutas de cuenta y montaje del resto
│   ├── db.js                     Pool de PostgreSQL (variables DB_* de .env)
│   ├── session.js                Sesión en cookie, guardada en la tabla session
│   ├── sockets.js                Colaboración en tiempo real y comandos de la IA
│   ├── diagramMutations.js       Validar, difundir y registrar cada cambio
│   ├── openaiClient.js           Cliente de OpenAI
│   ├── ai/
│   │   └── diagramAgent.js       Traduce una instrucción a operaciones UML
│   ├── middleware/
│   │   └── auth.js               Exige sesión para salas y voz
│   ├── repositories/
│   │   └── diagramsRepository.js Consultas de diagramas, colaboradores y actividad
│   ├── routes/
│   │   ├── rooms.js              Listar, crear, abrir, importar y exportar
│   │   └── voice.js              Transcripción de audio (Whisper)
│   └── xmi/
│       ├── exportXmi.js          JSON del diagrama → XMI 2.1
│       └── importXmi.js          XMI 2.1 → JSON del diagrama
├── public/                       Frontend estático (lo sirve Express)
│   ├── room.js                   Lienzo, clases, relaciones y sincronización
│   ├── ai-assistant.js           Chat y micrófono del asistente
│   ├── uml-validators.js         Reglas UML usadas en navegador y servidor
│   ├── toast.js                  Avisos de éxito y error
│   └── css/
│       ├── styles.css            Entrar, crear cuenta y lista de salas
│       └── room.css              Sala y lienzo
├── views/                        Plantillas EJS
│   ├── login.ejs
│   ├── register.ejs
│   ├── diagrams.ejs              Salas de la cuenta
│   ├── room.ejs                  Sala del diagrama
│   └── partials/
│       └── auth-stage.ejs        Panel visual de entrar y registrarse
├── database.sql                  Tablas users, diagrams, diagram_collaborators, diagram_activity
├── package.json
└── .env                          Credenciales de base y OpenAI (no se versiona el uso)
```

`express-ejs-layouts` está en `package.json`, pero `app.js` no lo usa. Cada vista es un HTML completo.

## Qué hace el frontend y qué hace el backend

| Pieza | Dónde vive | Responsabilidad |
| --- | --- | --- |
| Pantallas | `views/` + `public/css/` | HTML de cuenta, lista de salas y sala. El servidor las rellena con EJS. |
| Lienzo | `public/room.js` + JointJS (CDN) | Dibuja clases y vínculos, arrastre, menú contextual y modales. |
| Validación UML | `public/uml-validators.js` | El navegador valida antes de enviar. El servidor vuelve a validar en `diagramMutations.js` con el mismo archivo. |
| Tiempo real | Socket.IO en el navegador y `app/sockets.js` | Presencia, cambios de otros usuarios y “alguien está editando”. |
| Persistencia | `app/repositories/` + PostgreSQL | Dueño, enlace de la sala, JSON del grafo, colaboradores y bitácora. |
| Cuenta | `app/app.js` | Registro, login y logout. La contraseña se guarda con bcrypt. |
| XMI | `app/xmi/` | Importar un archivo a una sala nueva y descargar el diagrama actual. |
| IA | `public/ai-assistant.js`, `app/ai/diagramAgent.js`, `app/routes/voice.js` | Texto o voz → operaciones sobre el diagrama. |

El navegador no escribe en la base. El servidor no dibuja: entrega el JSON y deja que JointJS lo pinte.

## Base de datos

Definida en `database.sql`.

- **users.** Nombre, correo único y contraseña hasheada.
- **diagrams.** Nombre, `owner_id`, `share_token` (UUID del enlace) y `graph_data` (JSONB). El grafo es el documento de JointJS: `{ "cells": [ ... ] }`. Cada clase y cada vínculo es una celda, con posición, atributos visuales y datos UML (`umlName`, `umlStereotype`, `umlAttributes`, `umlMethods`, `umlType`).
- **diagram_collaborators.** Quién entró a la sala y cuándo se le vio por última vez. Quien no es dueño igual ve la sala en su lista después de abrir el enlace.
- **diagram_activity.** Bitácora de quién cambió qué elemento. Sirve para el título “editado por última vez por…”.
- **session.** La crea `connect-pg-simple` al arrancar. No está en `database.sql`.

Variables de entorno que usa el servidor: `DB_USER`, `DB_HOST`, `DB_NAME`, `DB_PASSWORD`, `DB_PORT`, `SESSION_SECRET`, `OPENAI_API_KEY`, `OPENAI_MODEL` y `NODE_ENV`.

## Cómo se usa un diagrama

### Cuenta

1. `GET /register` y `POST /register` crean el usuario.
2. `GET /login` y `POST /login` comparan la contraseña y guardan `userId` y `userName` en la sesión.
3. `GET /logout` destruye la sesión.
4. Sin sesión, `/diagrams` y `/room/...` redirigen a `/login`.

### Lista de salas

`GET /diagrams` llama a `findAccessibleByUser`: diagramas de los que la persona es dueña, más aquellos en los que ya figura como colaboradora. La vista muestra el enlace `/room/<share_token>`.

- **Crear sala.** `POST /diagrams` con el nombre. Inserta una fila con grafo vacío y redirige a la sala.
- **Importar XMI.** `POST /diagrams/import` recibe un `.xmi` o `.xml` (máximo 5 MB, en memoria). `importFromXmi` arma las celdas y se crea una sala ya con ese grafo.

### Entrar a la sala

`GET /room/:token` busca el diagrama por el UUID. Si existe, registra o actualiza al colaborador y renderiza `room.ejs` con el nombre, el token, el usuario y `graph_data`.

En el navegador, `room.js`:

1. Crea el grafo y el papel de JointJS dentro de `#diagram`.
2. Si `graph_data` trae celdas, las carga y les aplica el estilo actual de TRAZO (cabecera verde, cuerpo claro).
3. Abre el socket y emite `room:join` con el token.

El servidor responde `room:state` con la lista de conectados, quién editó cada elemento por última vez y quién lo está tocando ahora. La presencia vive en memoria (`presenceByRoom`), no en la base. Al desconectarse, esa persona sale de la lista.

### Editar

El cliente aplica el cambio en su lienzo y avisa al servidor. El servidor valida, anota la actividad y reenvía el evento al resto de la sala. Quien originó el cambio con un botón no lo recibe de vuelta (`excludeSocket`), porque ya lo dibujó. La IA sí se lo envía también al autor, porque el modelo no dibujó nada en local.

Eventos:

| Evento | Efecto |
| --- | --- |
| `class:add` | Nueva clase |
| `class:update` | Nombre, estereotipo, atributos, métodos o posición |
| `class:remove` | Borra la clase |
| `link:add` | Asociación, dependencia, agregación, composición, herencia o realización |
| `link:update` | Multiplicidad de origen o destino |
| `link:remove` | Borra el vínculo |
| `element:editing:start` / `end` | Borde de color y etiqueta de quién está moviendo o editando |
| `graph:save` | Guarda el JSON completo del lienzo |

El guardado del grafo no es inmediato. `room.js` espera 1,5 s después del último cambio local y entonces emite `graph:save`. Eso actualiza `diagrams.graph_data` y `updated_at`. Los eventos de socket no reescriben el JSON celda por celda: dejan la difusión y la bitácora; la foto completa la manda el cliente.

Atributos y métodos tienen que cumplir el formato UML (`+ nombre: tipo`, `+ guardar(): void`). La multiplicidad acepta formas como `1`, `0..1`, `*` o `1..*`. Estereotipos: ninguno, `interface` o `abstract`.

### Compartir y exportar

Cualquier usuario registrado que abra `/room/<token>` entra a la misma sala. No hay permisos de solo lectura: quien entra puede editar.

`GET /room/:token/export.xmi` lee `graph_data` y devuelve un XMI 2.1 (asociaciones, generalizaciones, realizaciones, dependencias, atributos y operaciones).

### Asistente

En la sala, “Pedirle a la IA” abre el chat. El texto, o el audio transcrito, sale con el contexto actual: nombres de clases, atributos, métodos y relaciones.

- La voz va por `POST /api/voice/transcribe` (Whisper, idioma español).
- El texto va por el socket `ai:command`.
- `diagramAgent.js` pide al modelo una lista de operaciones (`class:add`, `class:update`, etc.).
- `applyAiOperation` en `sockets.js` traduce nombres de clase a ids y usa las mismas mutaciones que los botones.
- El cliente recibe `ai:result` (respuesta y lo que no se pudo aplicar) y, por los eventos normales, las celdas nuevas.

## Recorrido de una sala

```
Navegador                         Servidor                         PostgreSQL
    |                                |                                  |
    |  GET /room/:token              |                                  |
    |------------------------------->|  findByToken + colaborador       |
    |                                |--------------------------------->|
    |  HTML + graph_data             |                                  |
    |<-------------------------------|                                  |
    |  JointJS pinta las celdas      |                                  |
    |  socket room:join              |                                  |
    |------------------------------->|  presencia en memoria            |
    |  room:state                    |                                  |
    |<-------------------------------|                                  |
    |  el usuario crea una clase     |                                  |
    |  socket class:add              |                                  |
    |------------------------------->|  valida, bitácora, broadcast     |
    |                                |--------------------------------->|
    |  (otros clientes) class:added  |                                  |
    |  debounce graph:save           |                                  |
    |------------------------------->|  UPDATE diagrams.graph_data      |
    |                                |--------------------------------->|
```
