
**Documento técnico de implementación**  
**Proyecto:** `diagramador-sw1-ia-2026`  
**Objetivo:** sustituir la dependencia de OpenAI para las instrucciones de la IA por un modelo local ejecutado mediante Ollama, manteniendo la arquitectura actual de TRAZO: Node.js, Express, Socket.IO, JointJS y PostgreSQL. Añadir análisis de imágenes para proponer diagramas UML de clases y cambios colaborativos en una sala.

---

## 1. Objetivos y alcance

La implementación debe permitir que una persona en una sala de TRAZO pueda:

1. Escribir una instrucción en español y pedir cambios al diagrama.
2. Adjuntar una imagen PNG, JPEG o WebP de un diagrama UML o un boceto.
3. Solicitar que la IA identifique clases, atributos, métodos, relaciones y multiplicidades de la imagen.
4. Revisar la propuesta antes de aplicarla al lienzo.
5. Aplicar operaciones a través del flujo de mutaciones ya existente, para que JointJS, Socket.IO, validadores UML, bitácora y guardado PostgreSQL sigan siendo la fuente de verdad.
6. Usar el modelo local sin enviar instrucciones, imágenes ni diagramas a una API externa.
7. Mantener el funcionamiento colaborativo: las operaciones confirmadas por la IA se difunden a las demás personas conectadas a la sala.

### Fuera del alcance inicial

- Entrenar un modelo desde cero.
- Darle al modelo acceso directo a PostgreSQL, a la terminal o a funciones arbitrarias.
- Ejecutar código JavaScript generado por el modelo.
- Reemplazar JointJS, Socket.IO, el formato JSON del grafo, la autenticación o el repositorio actual.
- Prometer que todas las imágenes se convertirán perfectamente en UML editable: la IA debe poder indicar incertidumbre y solicitar revisión.

---

## 2. Modelo y runtime recomendados

### Primera opción

- **Runtime local:** Ollama.
- **Modelo inicial:** `qwen3-vl:4b`, siempre que el equipo tenga memoria suficiente y su rendimiento sea aceptable.
- **Alternativa de menor consumo:** `qwen3-vl:2b`, comparándolo con el mismo conjunto de pruebas.
- **Comunicación desde Node.js:** SDK `ollama` o API HTTP local.
- **Salida esperada:** JSON de operaciones TRAZO, no código fuente.

Los tamaños y etiquetas disponibles pueden cambiar. Verificar el modelo instalado con `ollama list` y `ollama show qwen3-vl:4b`. La etiqueta del modelo debe configurarse mediante una variable de entorno, no quedar repetida en muchos archivos.

### Comandos de comprobación

```bash
ollama --version
ollama list
ollama show qwen3-vl:4b
ollama ps
```

Si el modelo todavía no está descargado:

```bash
ollama pull qwen3-vl:4b
```

Para probarlo:

```bash
ollama run qwen3-vl:4b
```

El equipo necesita Internet para descargar inicialmente Ollama, el modelo y las dependencias. Después, el flujo de inferencia puede funcionar sin Internet si no se hacen solicitudes a servicios externos y todos los recursos de la interfaz están empaquetados localmente.

---

## 3. Arquitectura objetivo

```text
Navegador (room.ejs)
  ├── public/room.js (JointJS + estado del grafo)
  ├── public/ai-assistant.js (chat, adjunto, vista previa y confirmación)
  └── Socket.IO
          │
          ├── ai:command (instrucción de texto)
          └── POST autenticado para análisis de imagen
                         │
                         ▼
Node.js / Express
  ├── app/ai/diagramAgent.js
  │      ├── prompt especializado
  │      ├── contexto reducido del diagrama
  │      ├── llamada al modelo local
  │      └── parseo y validación de salida
  ├── app/openaiClient.js (retirar del flujo local o convertir en adaptador)
  ├── app/diagramMutations.js (validación y mutaciones existentes)
  ├── app/sockets.js (autorización, aplicación y difusión)
  └── app/repositories/diagramsRepository.js
                         │
                         ▼
                 Ollama local
              http://127.0.0.1:11434
                         │
                         ▼
                    Qwen3-VL
```

### Principio de integración

La IA propone operaciones; el servidor las valida y las aplica. No se debe permitir que el modelo modifique directamente `graph_data`, la base de datos ni el grafo del navegador.

Para que la colaboración funcione, todas las operaciones aceptadas deben pasar por las mismas mutaciones y eventos existentes (`class:add`, `class:update`, `class:remove`, `link:add`, etc.). No se debe crear una vía paralela que solo cambie el lienzo de la persona que envió la instrucción.

---

## 4. Archivos existentes que deben cambiar

| Archivo | Ajuste |
|---|---|
| `app/openaiClient.js` | Sustituir el cliente externo por un adaptador Ollama o dejarlo fuera del flujo local. |
| `app/ai/diagramAgent.js` | Enviar instrucciones/imágenes a Ollama y convertir la respuesta a operaciones del formato existente. |
| `app/sockets.js` | Conservar `ai:command`; verificar autenticación, sala y permisos; aplicar las operaciones con el flujo existente. |
| `app/diagramMutations.js` | Reutilizar validaciones, persistencia de actividad y difusión actuales. No duplicar reglas. |
| `public/ai-assistant.js` | Añadir selector de imagen, vista previa, quitar adjunto, estados de carga/error y confirmación de propuesta. |
| `views/room.ejs` | Añadir el control de adjuntar imagen si el chat no lo tiene. Cargar scripts y recursos locales. |
| `app/app.js` | Montar la nueva ruta de imagen después de configurar sesión/autenticación y antes del manejador 404, según el orden actual. |
| `.env` | Añadir configuración de Ollama y desactivar el proveedor externo en modo local. |
| `package.json` | Añadir el SDK `ollama` y, si se usa multipart HTTP, `multer`. |

No se deben reemplazar archivos completos sin revisar primero su contenido actual. Las interfaces reales de `diagramAgent.js`, `sockets.js` y las mutaciones son el contrato que hay que conservar.

---

## 5. Variables de entorno

Agregar a `.env`:

```dotenv
# Proveedor local de IA
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3-vl:4b
AI_TIMEOUT_MS=120000
AI_MAX_IMAGE_BYTES=5242880
AI_MAX_OPERATIONS=30
```

Conservar las variables de PostgreSQL, sesión y demás configuración actual. `OPENAI_API_KEY` y `OPENAI_MODEL` pueden seguir existiendo temporalmente para una modalidad opcional, pero el flujo local no debe necesitarlas ni usarlas.

**Seguridad:** el servidor de Ollama debe escuchar solo en la interfaz local cuando se ejecuta en la misma computadora. No exponer el puerto `11434` a la red pública. Si TRAZO se ejecuta en un servidor compartido por varios usuarios, hay que decidir explícitamente dónde vive Ollama y cómo se controla el acceso; `127.0.0.1` del servidor no es el equipo de cada usuario.

---

## 6. Dependencias Node.js

Desde la raíz del proyecto:

```bash
npm install ollama multer
```

`multer` solo se necesita si la imagen se envía a Express como `multipart/form-data`. Si la imagen se envía por Socket.IO en Base64, no se necesita Multer, pero deben configurarse límites estrictos de tamaño y payload. **Recomendación:** usar una ruta HTTP autenticada para subir imágenes y mantener Socket.IO para las operaciones colaborativas.

No instalar paquetes de OpenAI para la ruta local. Si `openai` se utiliza en otro módulo, retirarlo solo después de comprobar que ya no tiene consumidores.

---

## 7. Cliente local de Ollama

Crear o adaptar `app/openaiClient.js` para que deje de hacer llamadas externas. Para evitar confusión, se recomienda renombrarlo a `app/ai/ollamaClient.js` y actualizar todos los imports. Si se conserva el nombre antiguo por compatibilidad, documentar que ahora es un adaptador local.

Ejemplo base de `app/ai/ollamaClient.js`:

```javascript
import ollama from "ollama";

const model = process.env.OLLAMA_MODEL || "qwen3-vl:4b";

export async function generateLocalResponse({
  system,
  prompt,
  imageBase64,
  timeoutMs = Number(process.env.AI_TIMEOUT_MS || 120000)
}) {
  const message = {
    role: "user",
    content: prompt
  };

  if (imageBase64) {
    message.images = [imageBase64];
  }

  const response = await ollama.chat({
    model,
    messages: [
      { role: "system", content: system },
      message
    ],
    stream: false,
    options: {
      temperature: 0.1
    }
  });

  return response.message?.content || "";
}
```

Esta función es un punto de partida. Verificar la opción de timeout admitida por la versión concreta del SDK antes de implementarla; si no la expone directamente, imponer el límite desde el cliente HTTP o desde el controlador. No registrar el contenido Base64 ni imágenes completas en los logs.

---

## 8. Contrato de operaciones para TRAZO

La IA debe responder en JSON estricto, limitado a operaciones que TRAZO ya sabe aplicar. No inventar nombres de eventos ni estructuras nuevas sin adaptar primero `applyAiOperation`.

Antes de programar el contrato, revisar en `app/sockets.js` el formato exacto que espera `applyAiOperation` y en `app/diagramMutations.js` las firmas de las mutaciones. El esquema siguiente es conceptual y debe ajustarse a esas firmas reales:

```json
{
  "message": "Propongo agregar dos clases y una relación.",
  "operations": [
    {
      "type": "class:add",
      "data": {
        "umlName": "Cliente",
        "umlStereotype": "",
        "umlAttributes": ["+ id: int", "+ nombre: string"],
        "umlMethods": ["+ registrarse(): void"],
        "position": { "x": 120, "y": 120 }
      }
    },
    {
      "type": "class:add",
      "data": {
        "umlName": "Pedido",
        "umlStereotype": "",
        "umlAttributes": ["+ numero: string"],
        "umlMethods": ["+ confirmar(): void"],
        "position": { "x": 420, "y": 120 }
      }
    }
  ],
  "warnings": []
}
```

Este JSON es un ejemplo ilustrativo, no una garantía de que sea el formato que acepta actualmente el servidor. Adaptar `type` y `data` al contrato real de `diagramAgent.js` y `applyAiOperation`.

### Reglas de validación

- Aceptar solo tipos de operación conocidos.
- Limitar la cantidad total de operaciones por solicitud.
- Validar tipos, longitudes, arrays y posiciones numéricas finitas.
- Rechazar propiedades inesperadas.
- No confiar en IDs o nombres generados por el modelo sin resolverlos contra el grafo actual.
- Para `class:update` o `class:remove`, exigir que el objetivo exista y que la referencia sea inequívoca.
- Para `link:add`, comprobar que ambos extremos existen y que el tipo de relación está permitido.
- Validar atributos, métodos, estereotipos y multiplicidades con las reglas UML existentes.
- Si hay nombres duplicados o ambigüedad, devolver una pregunta o advertencia en lugar de adivinar.
- Rechazar respuestas truncadas, JSON inválido o más operaciones que el límite.
- Nunca ejecutar funciones, SQL, shell ni código arbitrario producido por el modelo.

---

## 9. Ajustes de `app/ai/diagramAgent.js`

El agente debe cumplir cuatro tareas:

1. Construir un contexto breve del diagrama actual.
2. Enviar instrucción e imagen opcional a Ollama.
3. Solicitar salida JSON con el contrato de operaciones de TRAZO.
4. Parsear, validar y devolver una propuesta; no modificar directamente PostgreSQL ni el grafo.

### Contexto recomendado

No enviar datos de cuentas, cookies, contraseñas, tokens de sesión ni toda la base de datos. Para un diagrama, incluir solo lo necesario:

```json
{
  "classes": [
    {
      "id": "id-real-de-la-celda",
      "name": "Cliente",
      "stereotype": "",
      "attributes": ["+ id: int"],
      "methods": ["+ registrarse(): void"],
      "position": { "x": 100, "y": 100 }
    }
  ],
  "relationships": [
    {
      "id": "id-real-del-vinculo",
      "type": "association",
      "source": "id-real-de-la-celda",
      "target": "id-real-de-otra-celda",
      "sourceMultiplicity": "1",
      "targetMultiplicity": "0..*"
    }
  ]
}
```

Los nombres de campos son ilustrativos. Adaptarlos al JSON real de JointJS almacenado en `graph_data.cells`.

### Prompt de sistema sugerido

```text
Eres el asistente UML local de TRAZO. Tu tarea es proponer operaciones
para un editor colaborativo de diagramas de clases UML.

Usa únicamente las operaciones permitidas en el contrato que recibes.
Devuelve exclusivamente un objeto JSON válido con message, operations y warnings.
No incluyas Markdown ni bloques de código.

No inventes clases, atributos, métodos ni relaciones que no estén presentes
en la instrucción, el contexto o la imagen. Si un texto de la imagen es ilegible,
indícalo en warnings. Si una instrucción es ambigua, no hagas cambios
arriesgados: devuelve una pregunta en message y operations vacío.

Respeta las reglas UML y el formato de atributos, métodos, estereotipos
y multiplicidades que define TRAZO. No propongas operaciones fuera del contrato.
La aplicación validará todas las operaciones antes de ejecutarlas.
```

No depender únicamente del prompt para la seguridad: la validación de servidor es obligatoria.

---

## 10. Añadir carga de imágenes

### Formatos iniciales

- PNG
- JPEG/JPG
- WebP

Límite inicial sugerido: 5 MB por archivo. Se puede cambiar con `AI_MAX_IMAGE_BYTES`.

### Ruta HTTP recomendada

Añadir una ruta, por ejemplo `POST /api/ai/image`, que:

1. Exija una sesión válida con el middleware de autenticación actual.
2. Compruebe que la persona tiene acceso a la sala indicada.
3. Reciba un campo `image` con `multipart/form-data`.
4. Valide MIME real y contenido del archivo, no solo el nombre ni el MIME declarado.
5. Limite bytes, dimensiones y tiempo de procesamiento.
6. Obtenga el diagrama actual desde el repositorio del servidor, no desde datos confiados ciegamente al navegador.
7. Pase imagen, instrucción y contexto al agente local.
8. Devuelva una propuesta estructurada sin aplicar cambios todavía.
9. No guarde la imagen de forma permanente salvo que exista una función explícita para ello.
10. No registre la imagen ni su Base64 en la bitácora.

La ruta debe usar la misma sesión y política de acceso que las rutas de salas. No basta con recibir un `share_token`: comprobar en el servidor que el usuario tiene permiso para actuar en esa sala.

### Flujo del usuario

```text
Adjuntar imagen
     ↓
Vista previa + instrucción
     ↓
POST autenticado /api/ai/image
     ↓
Ollama / Qwen3-VL
     ↓
Propuesta JSON
     ↓
Validación de esquema y reglas UML
     ↓
Vista previa de cambios
     ↓
[Aplicar] o [Cancelar]
     ↓
Mutaciones actuales + Socket.IO
     ↓
Los demás participantes reciben los cambios
     ↓
Guardado actual del grafo en PostgreSQL
```

### Vista previa de imagen en `public/ai-assistant.js`

- Mostrar nombre, tamaño y miniatura.
- Permitir quitar o reemplazar la imagen.
- Deshabilitar el botón durante el análisis.
- Mostrar estados: “Preparando imagen”, “Analizando”, “Revisando propuesta”, “Aplicando”.
- Mostrar advertencias de texto ilegible o relaciones dudosas.
- No aplicar automáticamente la propuesta obtenida de una imagen.
- Revocar URLs de vista previa creadas con `URL.createObjectURL` al retirar el archivo o destruir el componente.
- No usar Base64 para la vista previa si basta con una URL local temporal.

---

## 11. Aplicación colaborativa de las operaciones

Mantener el camino de mutaciones actual. La IA no debe insertar celdas directamente en el navegador y omitir el servidor.

### Para texto

El flujo puede continuar usando `ai:command`, pero el servidor debe verificar:

- Sesión y usuario.
- Que el socket pertenezca a la sala indicada.
- Que el usuario tenga permiso para editar.
- Que la instrucción no supere el límite de longitud.
- Que exista un diagrama actual y que el contexto corresponda a esa sala.

### Para imágenes

La ruta HTTP puede devolver la propuesta al cliente. Cuando la persona pulsa **Aplicar**, el cliente envía la confirmación al servidor. El servidor vuelve a validar la propuesta y aplica cada operación a través de `applyAiOperation` y las mutaciones existentes.

No aceptar ciegamente del navegador una lista de operaciones que nunca se validó en el servidor. Para mayor seguridad, se puede guardar temporalmente la propuesta en memoria del servidor con un identificador de un solo uso, asociado a usuario, sala y vencimiento; el cliente confirma ese identificador. Si se mantiene la propuesta solo en el cliente, el servidor debe volver a validar cada operación y sus permisos de principio a fin.

### Colisiones en una sala compartida

Mientras la IA analiza una imagen, otra persona puede modificar el diagrama. Para evitar aplicar una propuesta sobre un estado obsoleto:

- Asociar la propuesta a una versión o huella del grafo actual.
- Al confirmar, comprobar si el grafo cambió.
- Si cambió, volver a validar las referencias y pedir reanálisis cuando sea necesario.
- Evitar aplicar parcialmente una propuesta sin informar al usuario.
- Registrar cada cambio mediante el sistema actual de bitácora.

---

## 12. Integración con el archivo `app/sockets.js`

Revisar el manejador actual de `ai:command` y conservar su protocolo externo cuando sea posible.

Cambios esperados:

1. Llamar al agente local, no a OpenAI.
2. Entregar contexto reducido y actualizado del diagrama.
3. Validar el resultado con un esquema estricto.
4. Aplicar cada operación mediante el flujo actual.
5. Emitir los eventos que ya entiende `public/room.js`.
6. Enviar `ai:result` al usuario que pidió el cambio con resumen, advertencias y operaciones aplicadas/no aplicadas.
7. Asegurar que el autor reciba también las mutaciones generadas por IA, como ocurre actualmente.
8. Controlar errores del runtime: modelo no descargado, Ollama detenido, memoria insuficiente, timeout, respuesta inválida o petición cancelada.

No reemplazar `class:add`, `class:update`, `class:remove`, `link:add`, `link:update`, `link:remove` ni `graph:save` por eventos nuevos si los actuales cubren el caso.

---

## 13. Voz y funcionamiento sin Internet

Actualmente `app/routes/voice.js` usa Whisper remoto. Aunque el modelo de diagramas sea local, la voz seguirá dependiendo de Internet mientras la transcripción use una API externa.

Para un modo realmente offline hay dos etapas:

**Etapa A:** implementar primero texto e imagen con Ollama. Mantener la voz existente como opción separada y señalar que requiere conexión.

**Etapa B:** añadir transcripción local con `whisper.cpp` u otra solución compatible con el sistema operativo. Descargar previamente un modelo de reconocimiento de voz en español y conectarlo a `app/routes/voice.js`. Probar la licencia, tamaño, latencia y consumo en los equipos objetivo.

No enviar audio al modelo visual Qwen3-VL esperando que sustituya automáticamente al endpoint de transcripción. El reconocimiento de voz y la interpretación del diagrama son tareas distintas.

---

## 14. Configuración de recursos y diagnóstico

Comprobar que Ollama responde:

```bash
curl http://127.0.0.1:11434/api/tags
```

Comprobar la API de TRAZO cuando el servidor esté iniciado:

```bash
curl http://127.0.0.1:3001/api/health
```

El segundo comando solo funcionará si TRAZO ya expone esa ruta; no añadirla sin revisar el sistema de rutas actual.

Ver modelos y consumo:

```bash
ollama list
ollama ps
```

Verificar que el modo local no llama a OpenAI:

```bash
grep -RInE 'api\.openai\.com|OPENAI_API_KEY|new OpenAI|openai' app public
```

Este comando solo encuentra coincidencias; revisar cada resultado antes de eliminar o cambiar código porque podría haber referencias legítimas o comentarios.

Para reducir consumo:
- Usar `qwen3-vl:2b` si el 4B es demasiado lento o pesado.
- Evitar mandar todo el grafo y todo el historial en cada petición.
- Enviar solo clases y relaciones relevantes.
- Limitar las operaciones por respuesta.
- No mantener varias inferencias pesadas simultáneas sin una cola.
- No descargar/cargar el modelo en cada mensaje si Ollama puede mantenerlo cargado durante el uso.
- Medir RAM y latencia en el hardware mínimo previsto.

---

## 15. Pruebas de aceptación

No considerar terminada la implementación hasta que pasen estas pruebas:

### IA local

- [ ] Ollama responde en la máquina.
- [ ] TRAZO funciona sin `OPENAI_API_KEY`.
- [ ] La instrucción de texto devuelve una propuesta válida.
- [ ] Un modelo ausente o Ollama detenido produce un mensaje claro.
- [ ] No se envían instrucciones, imágenes ni grafos a proveedores externos en modo local.

### Imagen

- [ ] Acepta PNG, JPEG y WebP.
- [ ] Rechaza formatos no permitidos y archivos que superan el límite.
- [ ] Analiza una imagen de diagrama UML legible.
- [ ] Indica dudas cuando el texto o las relaciones no son legibles.
- [ ] No modifica el diagrama hasta que el usuario confirma.
- [ ] No almacena ni registra la imagen de forma involuntaria.

### Integridad UML

- [ ] Los atributos y métodos respetan el formato actual.
- [ ] Las multiplicidades se validan con `uml-validators.js`.
- [ ] Las relaciones apuntan a celdas existentes.
- [ ] Los nombres ambiguos no actualizan ni eliminan clases incorrectas.
- [ ] JSON inválido, operaciones desconocidas y exceso de operaciones se rechazan.

### Colaboración y persistencia

- [ ] Las operaciones de IA pasan por las mutaciones actuales.
- [ ] El autor ve los cambios que pidió.
- [ ] Las otras personas de la sala reciben los eventos.
- [ ] El guardado diferido sigue actualizando `graph_data`.
- [ ] La bitácora registra correctamente quién solicitó/aplicó los cambios según el diseño actual.
- [ ] La confirmación detecta o maneja un grafo que cambió mientras se analizaba la imagen.
- [ ] Importación y exportación XMI continúan funcionando.

### Seguridad

- [ ] Las rutas de IA exigen sesión.
- [ ] El servidor verifica el acceso a la sala.
- [ ] La IA no ejecuta SQL, shell ni JavaScript arbitrario.
- [ ] El puerto de Ollama no queda expuesto públicamente por defecto.
- [ ] Los logs no contienen contraseñas, cookies, imágenes Base64 ni claves secretas.

---

## 16. Plan de implementación recomendado

### Fase 1 — Sustituir el proveedor de texto
1. Instalar el SDK `ollama`.
2. Crear `app/ai/ollamaClient.js`.
3. Adaptar `diagramAgent.js` conservando su contrato de operaciones.
4. Probar las instrucciones de texto actuales.
5. Comprobar que se siguen usando las mutaciones y eventos actuales.

### Fase 2 — Validar salida estructurada
1. Formalizar el esquema de operaciones real.
2. Validar con Zod o el validador que ya tenga el proyecto.
3. Rechazar IDs ambiguos, relaciones inválidas y respuestas truncadas.
4. Añadir límites de tiempo y de cantidad de operaciones.

### Fase 3 — Análisis de imágenes
1. Añadir la ruta multipart autenticada.
2. Configurar límites de archivo y validar contenido.
3. Añadir adjunto y vista previa al chat.
4. Hacer que el agente interprete la imagen y produzca una propuesta.
5. Mostrar advertencias y exigir confirmación.

### Fase 4 — Colaboración segura
1. Confirmar propuestas en el servidor.
2. Revalidar la versión actual del grafo.
3. Ejecutar operaciones mediante `applyAiOperation`.
4. Comprobar eventos, bitácora y guardado en PostgreSQL.

### Fase 5 — Voz offline y empaquetado
1. Elegir un motor de transcripción local.
2. Descargar y probar el modelo de voz en español.
3. Documentar cómo instalar y arrancar Ollama.
4. Preparar diagnóstico de errores y selección de modelo.
5. Probar la aplicación sin Internet con todos los recursos frontend locales.

---

## 17. Criterio de finalización

La integración estará lista cuando una persona pueda abrir una sala TRAZO, escribir una orden o adjuntar una imagen de UML, recibir una propuesta estructurada, revisarla y confirmarla; el servidor validará los cambios, las demás personas verán las mismas mutaciones en tiempo real y el grafo se guardará en PostgreSQL usando el mecanismo actual.

**Regla central:** conservar la arquitectura existente y cambiar el proveedor de inferencia; no reconstruir el editor ni crear un segundo sistema de sincronización.
