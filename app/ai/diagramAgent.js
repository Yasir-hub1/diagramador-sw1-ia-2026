// ai/diagramAgent.js
const openai = require('../openaiClient');
const validators = require('../../public/uml-validators');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const TOOL = {
  type: 'function',
  function: {
    name: 'apply_diagram_operations',
    description: 'Aplica una lista de cambios al diagrama UML de clases actual.',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Respuesta breve en español para mostrar al usuario, resumiendo qué se hizo (o por qué no se pudo hacer nada).',
        },
        operations: {
          type: 'array',
          description: 'Lista de operaciones a aplicar, en el orden en que deben ejecutarse.',
          items: {
            type: 'object',
            properties: {
              op: {
                type: 'string',
                enum: ['class:add', 'class:update', 'class:remove', 'link:add', 'link:update', 'link:remove'],
              },
              className: {
                type: 'string',
                description: 'Nombre de la clase a crear, o de la clase existente a modificar/eliminar/usar como origen de una relación.',
              },
              newClassName: { type: 'string', description: 'Nuevo nombre si se renombra la clase (solo class:update).' },
              stereotype: { type: 'string', enum: ['none', 'interface', 'abstract'] },
              attributes: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'Lista COMPLETA resultante de atributos de la clase, formato UML "visibilidad nombre: tipo" (ej: "+ nombre: string"). No es un delta: si la clase ya tenía atributos y se agrega uno nuevo, incluye también los anteriores que deban conservarse.',
              },
              methods: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'Lista COMPLETA resultante de métodos, formato UML "visibilidad nombre(params): tipoRetorno" (ej: "+ guardar(id: number): void"). No es un delta.',
              },
              relationType: {
                type: 'string',
                enum: ['association', 'dependency', 'aggregation', 'composition', 'inheritance', 'realization'],
              },
              targetClassName: { type: 'string', description: 'Clase destino de la relación (para link:add/update/remove).' },
              sourceMultiplicity: { type: 'string', description: 'Multiplicidad en el origen, ej: 1, 0..1, *, 0..*, 1..*' },
              targetMultiplicity: { type: 'string', description: 'Multiplicidad en el destino.' },
            },
            required: ['op'],
          },
        },
      },
      required: ['message', 'operations'],
    },
  },
};

function buildSystemPrompt(context) {
  const classes = (context && context.classes) || [];
  const relations = (context && context.relations) || [];
  return [
    'Eres el asistente de un diagramador colaborativo de clases UML 2.5.',
    'El usuario te da instrucciones en español (por voz o chat) para crear, editar o eliminar clases, atributos, métodos y relaciones.',
    'Reglas de formato UML que DEBES respetar en los atributos y métodos que generes:',
    '- Atributo: "visibilidad nombre: tipo", visibilidad es uno de + - # ~ (público, privado, protegido, paquete). Ej: "+ nombre: string".',
    '- Método: "visibilidad nombre(params): tipoRetorno". Ej: "+ calcularTotal(): number".',
    '- Estereotipos de clase válidos: none, interface, abstract.',
    '- Tipos de relación válidos: association, dependency, aggregation, composition, inheritance, realization.',
    '- Multiplicidad válida: 1, 0..1, *, 0..*, 1..*, o n..m (números).',
    'Cuando actualices atributos o métodos de una clase existente, siempre entrega la lista COMPLETA resultante (no solo lo nuevo), conservando lo que no se pidió cambiar.',
    'Para editar o eliminar una relación existente (link:update/link:remove), incluye siempre className, targetClassName y relationType exactamente como aparecen en el contexto, para poder identificarla.',
    'Refiere siempre a las clases por su nombre exacto tal como aparecen en el contexto (nunca inventes IDs).',
    'Genera ÚNICAMENTE las operaciones necesarias para cumplir lo que el usuario pidió explícitamente, ni una más. No agregues relaciones, atributos, métodos ni clases adicionales que no se hayan solicitado.',
    'Si una operación necesita datos que no tienes (por ejemplo una relación sin clase destino), NO la incluyas en "operations"; en su lugar explica en "message" qué información falta.',
    'Si el usuario pide algo ambiguo o imposible con el contexto dado, explica brevemente en "message" qué no se pudo hacer y deja "operations" vacío o parcial.',
    '',
    'Estado actual del diagrama (contexto):',
    'Clases: ' + JSON.stringify(classes.map((c) => ({ name: c.name, stereotype: c.stereotype, attributes: c.attributes, methods: c.methods }))),
    'Relaciones: ' + JSON.stringify(relations.map((r) => ({ type: r.type, from: r.sourceName, to: r.targetName }))),
    '',
    'Siempre debes responder llamando a la función apply_diagram_operations.',
  ].join('\n');
}

function sanitizeOperation(rawOp) {
  const op = { ...rawOp };
  if (op.attributes) {
    op.attributes = op.attributes.map((a) => String(a).trim()).filter((a) => validators.validateAttribute(a));
  }
  if (op.methods) {
    op.methods = op.methods.map((m) => String(m).trim()).filter((m) => validators.validateMethod(m));
  }
  if (op.sourceMultiplicity && !validators.validateMultiplicity(op.sourceMultiplicity)) delete op.sourceMultiplicity;
  if (op.targetMultiplicity && !validators.validateMultiplicity(op.targetMultiplicity)) delete op.targetMultiplicity;
  if (op.stereotype && !validators.validateStereotype(op.stereotype)) delete op.stereotype;
  if (op.relationType && !validators.validateRelationType(op.relationType)) delete op.relationType;
  return op;
}

function isCompleteOperation(op) {
  if (!op || !op.op) return false;
  if ((op.op === 'class:add' || op.op === 'class:update' || op.op === 'class:remove') && !op.className) return false;
  if (op.op === 'link:add' || op.op === 'link:update' || op.op === 'link:remove') {
    if (!op.className || !op.targetClassName || !op.relationType) return false;
  }
  return true;
}

async function runDiagramAgent(text, context) {
  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: buildSystemPrompt(context) },
      { role: 'user', content: text },
    ],
    tools: [TOOL],
    tool_choice: { type: 'function', function: { name: 'apply_diagram_operations' } },
  });

  const message = completion.choices[0].message;
  const toolCall = message.tool_calls && message.tool_calls[0];
  if (!toolCall) {
    return { reply: message.content || 'No entendí la instrucción.', operations: [] };
  }

  let args;
  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch (err) {
    return { reply: 'La IA devolvió una respuesta con formato inválido.', operations: [] };
  }

  const operations = (args.operations || []).map(sanitizeOperation).filter(isCompleteOperation);
  return { reply: args.message || '', operations };
}

module.exports = { runDiagramAgent };
