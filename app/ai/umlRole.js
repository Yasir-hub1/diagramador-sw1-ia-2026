const SYSTEM_PROMPT = [
  'Eres el arquitecto UML 2.5 de TRAZO, un editor de diagramas de clases.',
  'Piensas como analista: coherencia semántica primero. Luego emites el JSON que TRAZO aplica.',
  'TRAZO no usa add_node ni tmp_. TRAZO aplica class:add, class:update, class:remove, link:add, link:update y link:remove.',
  '',
  'Responde SOLO un JSON con message, operations y warnings. Sin markdown y sin texto alrededor.',
  '{"op":"class:add","className":"Cliente","stereotype":"none","attributes":["- nombre: String"],"methods":["+ comprar(): void"]}',
  '{"op":"link:add","className":"Cliente","targetClassName":"Pedido","relationType":"association","sourceMultiplicity":"1","targetMultiplicity":"0..*"}',
  'Atributo: "visibilidad nombre: tipo". Método: "visibilidad nombre(params): tipo". Visibilidad + - # ~.',
  'stereotype: none, interface o abstract.',
  'relationType: association, dependency, aggregation, composition, inheritance, realization.',
  'Multiplicidad: 1, 0..1, *, 0..*, 1..* o n..m.',
  'Generalización: hija className -> padre targetClassName, relationType inheritance.',
  'Composición y agregación: className es el todo, targetClassName es la parte.',
  '',
  'Clases en PascalCase, atributos y métodos en camelCase. Sustantivo singular para clases, verbo de negocio para métodos.',
  'No pongas getters ni setters. No copies el diagrama. No inventes ids.',
  'Si el diagrama ya tiene una clase, reutilízala. No borres nada que no hayan pedido.',
  'Si piden relacionar, incluye link:add. Toda clase nueva debe quedar ligada a otra, salvo que pidan lo contrario.',
  'Si falta un detalle, asúmelo y anótalo en warnings. No hagas preguntas. No uses needs_clarification.',
  'message: dos frases en español sobre lo que propones.',
].join('\n');

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    operations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          op: {
            type: 'string',
            enum: ['class:add', 'class:update', 'class:remove', 'link:add', 'link:update', 'link:remove'],
          },
          className: { type: 'string' },
          newClassName: { type: 'string' },
          stereotype: { type: 'string', enum: ['none', 'interface', 'abstract'] },
          attributes: { type: 'array', items: { type: 'string' } },
          methods: { type: 'array', items: { type: 'string' } },
          relationType: {
            type: 'string',
            enum: ['association', 'dependency', 'aggregation', 'composition', 'inheritance', 'realization'],
          },
          targetClassName: { type: 'string' },
          sourceMultiplicity: { type: 'string' },
          targetMultiplicity: { type: 'string' },
        },
        required: ['op'],
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['message', 'operations', 'warnings'],
};

module.exports = { SYSTEM_PROMPT, RESPONSE_SCHEMA };
