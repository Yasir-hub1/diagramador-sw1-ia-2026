const test = require('node:test');
const assert = require('node:assert/strict');
const { interpretModelPayload } = require('./operationPlan');
const { extractJsonObject, pickContractPayload, isDiagramEcho, isInputEcho } = require('./jsonText');
const { inspectImage, imageBufferFromBase64 } = require('./imageFile');
const { sketchToOperations, sketchFromNotes } = require('./imageSketch');
const { snapshotFromGraph, fingerprintOf } = require('../../public/diagram-snapshot');
const { buildArchitectRequest, interpretArchitectPayload } = require('./architectContract');
const { coerceOperation, interpretReply } = require('./adaptReply');
const { classifyIntent, shouldProposeChanges } = require('./intent');
const { formatHistoryForPrompt } = require('./roomChat');
const { buildTextPrompt } = require('./diagramAgent');
const settings = require('./settings');

function emptyDiagram() {
  return { classes: [], relations: [] };
}

test('prepares a class and the link that depends on it', () => {
  const result = interpretModelPayload(
    {
      message: 'Agrego Cliente y Pedido.',
      warnings: ['Revisa los nombres'],
      operations: [
        { op: 'class:add', className: 'Cliente', attributes: ['+ id: int'], methods: ['+ alta(): void'] },
        { op: 'class:add', className: 'Pedido', attributes: ['public numero: string'], methods: [] },
        {
          type: 'link:add',
          data: {
            className: 'Cliente',
            targetClassName: 'Pedido',
            relationType: 'asociación',
            sourceMultiplicity: '1',
            targetMultiplicity: '0 .. *',
          },
        },
      ],
    },
    emptyDiagram(),
    { maxOperations: 30 }
  );

  assert.equal(result.prepared.length, 3);
  assert.equal(result.prepared[1].data.attributes[0], '+ numero: string');
  assert.equal(result.prepared[2].data.sourceId, result.prepared[0].data.elementId);
  assert.equal(result.prepared[2].data.targetId, result.prepared[1].data.elementId);
  assert.equal(result.prepared[2].data.type, 'association');
  assert.equal(result.prepared[2].data.targetMultiplicity, '0..*');
  assert.equal(result.warnings[0], 'Revisa los nombres');
});

test('does not guess when two classes share a name', () => {
  const result = interpretModelPayload(
    {
      message: 'Borro Cliente',
      operations: [{ op: 'class:remove', className: 'Cliente' }],
    },
    {
      classes: [
        { id: 'a', name: 'Cliente', stereotype: 'none', attributes: [], methods: [], position: { x: 0, y: 0 } },
        { id: 'b', name: 'cliente', stereotype: 'none', attributes: [], methods: [], position: { x: 10, y: 10 } },
      ],
      relations: [],
    }
  );
  assert.equal(result.prepared, null);
  assert.match(result.reply, /más de una clase/);
});

test('rejects unknown operations, extra fields and too many steps', () => {
  const unknown = interpretModelPayload(
    { message: 'x', operations: [{ op: 'class:explode', className: 'A' }] },
    emptyDiagram()
  );
  assert.equal(unknown.prepared, null);

  const extra = interpretModelPayload(
    { message: 'x', operations: [{ op: 'class:remove', className: 'A', sql: 'drop table' }] },
    { classes: [{ id: 'a', name: 'A', stereotype: 'none', attributes: [], methods: [], position: { x: 0, y: 0 } }], relations: [] }
  );
  assert.equal(extra.prepared, null);
  assert.match(extra.reply, /no acepta/);

  const tooMany = interpretModelPayload(
    {
      message: 'x',
      operations: [
        { op: 'class:add', className: 'Uno' },
        { op: 'class:add', className: 'Dos' },
      ],
    },
    emptyDiagram(),
    { maxOperations: 1 }
  );
  assert.equal(tooMany.prepared, null);
});

test('completes an attribute or method when the type is missing', () => {
  const result = interpretModelPayload(
    {
      message: 'Agrego Persona.',
      operations: [{ op: 'class:add', className: 'Persona', attributes: ['edad'], methods: ['guardar'] }],
    },
    emptyDiagram()
  );
  assert.equal(result.prepared[0].data.attributes[0], '+ edad: Integer');
  assert.equal(result.prepared[0].data.methods[0], '+ guardar(): void');
  assert.match(result.typeNotes[0], /Integer/);
});

test('corrects phone numbers to String and lists to associations', () => {
  const result = interpretModelPayload(
    {
      message: 'Modelo de universidad.',
      operations: [
        {
          op: 'class:add',
          className: 'Person',
          attributes: ['- id: Long', '+ phoneNumber: Double'],
        },
        {
          op: 'class:add',
          className: 'Student',
          attributes: ['- id: Long', '+ studentNumber: Double'],
        },
        {
          op: 'class:add',
          className: 'Professor',
          attributes: ['- id: Long', '+ listOfStudents: String'],
        },
      ],
    },
    emptyDiagram()
  );
  const person = result.prepared.find((step) => step.data && step.data.name === 'Person');
  const professor = result.prepared.find((step) => step.data && step.data.name === 'Professor');
  const link = result.prepared.find((step) => step.event === 'link:add');
  assert.equal(person.data.attributes[1], '+ phoneNumber: String');
  assert.ok(professor.data.attributes.every((line) => !/listOfStudents/.test(line)));
  assert.equal(link.data.type, 'association');
  assert.match(result.typeNotes.join('\n'), /teléfono|telefono|String/i);
});

test('keeps valid operations and warns about the ones that fail', () => {
  const result = interpretModelPayload(
    {
      message: 'Creo Cliente y borro Fantasma.',
      operations: [
        { op: 'class:add', className: 'Cliente' },
        { op: 'class:remove', className: 'Fantasma' },
      ],
    },
    emptyDiagram()
  );
  assert.equal(result.prepared.length, 1);
  assert.match(result.warnings[0], /Fantasma/);
});

test('rejects an attribute that does not follow the UML format', () => {
  const result = interpretModelPayload(
    { message: 'x', operations: [{ op: 'class:add', className: 'Persona', attributes: ['+++'] }] },
    emptyDiagram()
  );
  assert.equal(result.prepared, null);
  assert.match(result.reply, /Formato UML/);
});

test('prefers JSON with operations over a copied diagram', () => {
  const payload = pickContractPayload(
    '{"classes":[],"relations":[]}',
    'voy a crear Cliente\n{"message":"ok","operations":[{"op":"class:add","className":"Cliente"}],"warnings":[]}'
  );
  assert.equal(payload.operations[0].className, 'Cliente');
  assert.equal(isDiagramEcho({ classes: [], relations: [] }), true);
  assert.equal(isDiagramEcho({ message: 'ok', operations: [] }), false);
  assert.equal(isDiagramEcho({ message: 'vi Cliente', classes: [{ name: 'Cliente' }], relationships: [] }), false);
});

test('reads classes from a markdown description of the image', () => {
  const sketch = sketchFromNotes(`
#### **Clase \`Person\`**
- **Atributos**:
  \`+ name : string\`
  \`+ age : int = 0\`
- **Métodos**:
  \`+ hasParkingPass() : bool\`
- Asociación con \`Address\`
#### **Clase \`Student\`**
- hereda de \`Person\`
  \`+ studentNumber : double\`
`);
  const result = sketchToOperations(sketch, emptyDiagram());
  const names = result.prepared.filter((step) => step.event === 'class:add').map((step) => step.data.name);
  assert.deepEqual(names, ['Person', 'Address', 'Student']);
  assert.equal(result.prepared.some((step) => step.event === 'link:add' && step.data.type === 'inheritance'), true);
});

test('flattens object members and inheritance from a sketch', () => {
  const result = sketchToOperations(
    {
      message: 'Vi Person y Student.',
      classes: [
        { name: 'Person', attributes: [{ name: 'age', type: 'int' }] },
        { name: 'Student', inheritance: 'Person', methods: [{ name: 'takeExamination', type: 'void' }] },
      ],
      relationships: [],
    },
    emptyDiagram()
  );
  assert.equal(result.prepared[0].data.attributes[0], '+ age: int');
  assert.equal(result.prepared[1].data.methods[0], '+ takeExamination(): void');
  assert.equal(result.prepared[2].event, 'link:add');
  assert.equal(result.prepared[2].data.type, 'inheritance');
});

test('turns a sketch from the image into TRAZO operations', () => {
  const result = sketchToOperations(
    {
      message: 'Vi Cliente y Pedido.',
      classes: [
        { name: 'Cliente', attributes: ['nombre'] },
        { name: 'Pedido', methods: ['confirmar'] },
      ],
      relationships: [
        { from: 'Cliente', to: 'Pedido', type: 'asociación', sourceMultiplicity: '1', targetMultiplicity: '*' },
      ],
      warnings: ['El tipo de Pedido no se leía'],
    },
    emptyDiagram()
  );
  assert.equal(result.prepared.length, 3);
  assert.equal(result.prepared[0].data.name, 'Cliente');
  assert.equal(result.prepared[2].data.type, 'association');
  assert.match(result.warnings[0], /Pedido/);
});

test('does not add a class that already exists in the room', () => {
  const result = sketchToOperations(
    { message: 'Vi Cliente.', classes: [{ name: 'Cliente' }], relationships: [] },
    {
      classes: [{ id: 'c1', name: 'Cliente', stereotype: 'none', attributes: [], methods: [], position: { x: 0, y: 0 } }],
      relations: [],
    }
  );
  assert.equal(result.prepared.length, 0);
  assert.match(result.warnings[0], /ya está/);
});

test('reads a data URL into image bytes', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const decoded = imageBufferFromBase64('data:image/png;base64,' + png.toString('base64'));
  assert.equal(decoded[0], 0x89);
});

test('picks the sketch object when thinking contains smaller JSON fragments', () => {
  const thinking = [
    'primero { "from": "Person", "to": "Address", "type": "association" }',
    'luego {"message":"Vi Person","classes":[{"name":"Person","attributes":["+ age: int = 0"]}],"relationships":[]}',
  ].join('\n');
  const payload = extractJsonObject(thinking);
  assert.equal(payload.classes[0].name, 'Person');
});

test('reads an attribute default like age: int = 0', () => {
  const result = sketchToOperations(
    {
      message: 'Vi Person.',
      classes: [{ name: 'Person', attributes: ['age: int = 0', 'hasParkingPass() : bool'] }],
      relationships: [],
    },
    emptyDiagram()
  );
  assert.equal(result.prepared[0].data.attributes[0], '+ age: int');
  assert.equal(result.prepared[0].data.methods[0], '+ hasParkingPass(): bool');
});

test('reads JSON wrapped in a fence or a think tag', () => {
  const payload = extractJsonObject('<think>voy a pensarlo</think>\n```json\n{"message":"ok","operations":[]}\n```');
  assert.deepEqual(payload, { message: 'ok', operations: [] });
});

test('fingerprint ignores cell order and rounds position', () => {
  const first = snapshotFromGraph({
    cells: [
      { id: 'b', type: 'uml.Class', umlName: 'B', umlStereotype: 'none', umlAttributes: [], umlMethods: [], position: { x: 10.2, y: 4 } },
      { id: 'a', type: 'uml.Class', umlName: 'A', umlStereotype: 'none', umlAttributes: ['+ id: int'], umlMethods: [], position: { x: 1, y: 2 } },
    ],
  });
  const second = snapshotFromGraph({
    cells: [
      { id: 'a', type: 'uml.Class', umlName: 'A', umlStereotype: 'none', umlAttributes: ['+ id: int'], umlMethods: [], position: { x: 1, y: 2 } },
      { id: 'b', type: 'uml.Class', umlName: 'B', umlStereotype: 'none', umlAttributes: [], umlMethods: [], position: { x: 10.4, y: 4.2 } },
    ],
  });
  assert.equal(fingerprintOf(first), fingerprintOf(second));
});

test('keeps relation multiplicities in the snapshot', () => {
  const snapshot = snapshotFromGraph({
    cells: [
      { id: 'a', type: 'uml.Class', umlName: 'A', umlStereotype: 'none', umlAttributes: [], umlMethods: [], position: { x: 0, y: 0 } },
      { id: 'b', type: 'uml.Class', umlName: 'B', umlStereotype: 'interface', umlAttributes: [], umlMethods: [], position: { x: 20, y: 0 } },
      {
        id: 'l',
        type: 'standard.Link',
        umlType: 'association',
        source: { id: 'a' },
        target: { id: 'b' },
        labels: [{ attrs: { text: { text: '1' } } }, { attrs: { text: { text: '*' } } }],
      },
    ],
  });
  assert.equal(snapshot.relations[0].sourceName, 'A');
  assert.equal(snapshot.relations[0].targetMultiplicity, '*');
});

test('accepts PNG, JPEG and WebP, and rejects other bytes', () => {
  const png = Buffer.alloc(24);
  png[0] = 0x89;
  png.write('PNG', 1, 'ascii');
  png.writeUInt32BE(32, 16);
  png.writeUInt32BE(16, 20);
  assert.equal(inspectImage(png).mediaType, 'image/png');

  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x20,
    0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  assert.equal(inspectImage(jpeg).mediaType, 'image/jpeg');

  const webp = Buffer.alloc(30);
  webp.write('RIFF', 0);
  webp.write('WEBP', 8);
  webp.write('VP8X', 12);
  webp.writeUIntLE(63, 24, 3);
  webp.writeUIntLE(31, 27, 3);
  assert.equal(inspectImage(webp).mediaType, 'image/webp');

  const gif = Buffer.from('GIF89a');
  assert.equal(inspectImage(gif).ok, false);

  png.writeUInt32BE(9000, 16);
  assert.equal(inspectImage(png).ok, false);
});

test('sends the current TRAZO diagram as an architect JSON envelope', () => {
  const snapshot = {
    classes: [
      {
        id: 'c1',
        name: 'Cliente',
        stereotype: 'none',
        attributes: ['- nombre: String'],
        methods: ['+ comprar(): void'],
        position: { x: 80, y: 40 },
      },
    ],
    relations: [],
  };
  const request = buildArchitectRequest({ text: 'Agrega Pedido', snapshot });
  assert.equal(request.envelope.task, 'modify');
  assert.equal(request.envelope.diagram_type, 'class');
  assert.equal(request.envelope.current_diagram.nodes[0].id, 'c1');
  assert.equal(request.envelope.current_diagram.nodes[0].label, 'Cliente');
  assert.equal(request.envelope.current_diagram.nodes[0].attributes[0].name, 'nombre');
  assert.equal(request.envelope.constraints.language, 'es');
});

test('maps architect add_node and add_edge onto TRAZO class and link events', () => {
  const result = interpretArchitectPayload(
    {
      version: '1.0',
      status: 'ok',
      intent: 'create',
      diagram_type: 'class',
      operations: [
        {
          op: 'add_node',
          node: {
            id: 'tmp_1',
            type: 'class',
            label: 'Cliente',
            attributes: [{ visibility: '-', name: 'nombre', type: 'String' }],
            methods: [],
          },
        },
        {
          op: 'add_node',
          node: {
            id: 'tmp_2',
            type: 'class',
            label: 'Pedido',
            attributes: [{ visibility: '-', name: 'fecha', type: 'Date' }],
            methods: [],
          },
        },
        {
          op: 'add_node',
          node: {
            id: 'tmp_3',
            type: 'class',
            label: 'Producto',
            attributes: [{ visibility: '-', name: 'precio', type: 'Decimal' }],
            methods: [],
          },
        },
        {
          op: 'add_edge',
          edge: {
            id: 'tmp_e1',
            type: 'association',
            source: 'tmp_1',
            target: 'tmp_2',
            label: 'realiza',
            sourceMultiplicity: '1',
            targetMultiplicity: '0..*',
          },
        },
        {
          op: 'add_edge',
          edge: {
            id: 'tmp_e2',
            type: 'aggregation',
            source: 'tmp_2',
            target: 'tmp_3',
            label: 'contiene',
            sourceMultiplicity: '1',
            targetMultiplicity: '1..*',
          },
        },
      ],
      explanation: 'Creé Cliente, Pedido y Producto con sus relaciones y multiplicidades.',
      warnings: ['Asumí atributos mínimos; puedes pedir más detalle.'],
      clarification_question: null,
    },
    emptyDiagram()
  );

  assert.equal(result.prepared.length, 5);
  assert.equal(result.prepared[0].event, 'class:add');
  assert.equal(result.prepared[0].data.name, 'Cliente');
  assert.equal(result.prepared[0].data.attributes[0], '- nombre: String');
  assert.equal(result.prepared[3].event, 'link:add');
  assert.equal(result.prepared[3].data.type, 'association');
  assert.equal(result.prepared[3].data.targetMultiplicity, '0..*');
  assert.equal(result.prepared[4].data.type, 'aggregation');
  assert.equal(result.reply, 'Creé Cliente, Pedido y Producto con sus relaciones y multiplicidades.');
});

test('maps generalization to inheritance and asks when the architect needs a datum', () => {
  const snapshot = {
    classes: [
      { id: 'p1', name: 'Persona', stereotype: 'none', attributes: [], methods: [], position: { x: 0, y: 0 } },
      { id: 's1', name: 'Estudiante', stereotype: 'none', attributes: [], methods: [], position: { x: 20, y: 0 } },
    ],
    relations: [],
  };
  const inheritance = interpretArchitectPayload(
    {
      version: '1.0',
      status: 'ok',
      intent: 'modify',
      diagram_type: 'class',
      operations: [
        {
          op: 'add_edge',
          edge: { id: 'tmp_e1', type: 'generalization', source: 's1', target: 'p1', label: '', sourceMultiplicity: '', targetMultiplicity: '' },
        },
      ],
      explanation: 'Estudiante hereda de Persona.',
      warnings: [],
      clarification_question: null,
    },
    snapshot
  );
  assert.equal(inheritance.prepared[0].event, 'link:add');
  assert.equal(inheritance.prepared[0].data.type, 'inheritance');

  const question = interpretArchitectPayload(
    {
      version: '1.0',
      status: 'needs_clarification',
      intent: 'create',
      diagram_type: 'class',
      operations: [],
      explanation: '',
      warnings: [],
      clarification_question: '¿El pedido pertenece a un cliente o a una tienda?',
    },
    emptyDiagram()
  );
  assert.equal(question.prepared.length, 0);
  assert.equal(question.needsClarification, true);
  assert.match(question.reply, /cliente o a una tienda/);
});

test('updates and removes existing TRAZO cells from architect ids', () => {
  const snapshot = {
    classes: [
      { id: 'c1', name: 'Cliente', stereotype: 'none', attributes: ['- nombre: String'], methods: [], position: { x: 0, y: 0 } },
      { id: 'p1', name: 'Pedido', stereotype: 'none', attributes: [], methods: [], position: { x: 10, y: 0 } },
    ],
    relations: [
      {
        id: 'l1',
        type: 'association',
        sourceId: 'c1',
        targetId: 'p1',
        sourceName: 'Cliente',
        targetName: 'Pedido',
        sourceMultiplicity: '1',
        targetMultiplicity: '*',
      },
    ],
  };
  const renamed = interpretArchitectPayload(
    {
      version: '1.0',
      status: 'ok',
      intent: 'modify',
      diagram_type: 'class',
      operations: [{ op: 'update_node', id: 'c1', changes: { label: 'Usuario' } }],
      explanation: 'Renombré Cliente a Usuario.',
      warnings: [],
      clarification_question: null,
    },
    snapshot
  );
  assert.equal(renamed.prepared[0].event, 'class:update');
  assert.equal(renamed.prepared[0].data.patch.name, 'Usuario');

  const removed = interpretArchitectPayload(
    {
      version: '1.0',
      status: 'ok',
      intent: 'modify',
      diagram_type: 'class',
      operations: [{ op: 'remove_edge', id: 'l1' }],
      explanation: 'Quité la asociación.',
      warnings: [],
      clarification_question: null,
    },
    snapshot
  );
  assert.equal(removed.prepared[0].event, 'link:remove');
});

test('ignores an echoed input envelope and keeps the architect JSON', () => {
  const echoed = { task: 'create', current_diagram: { nodes: [], edges: [] }, user_request: 'Cliente' };
  assert.equal(isInputEcho(echoed), true);
  const payload = pickContractPayload(JSON.stringify(echoed), '{"version":"1.0","status":"ok","operations":[],"explanation":"Nada que cambiar."}');
  assert.equal(payload.status, 'ok');
  assert.equal(payload.explanation, 'Nada que cambiar.');
});

test('coerces class-shaped operations into TRAZO class:add', () => {
  const mapped = coerceOperation({
    type: 'class',
    name: 'Categoria',
    attributes: [{ name: 'nombre', type: 'String' }],
    methods: [{ name: 'activar', returnType: 'void' }],
  });
  assert.equal(mapped.op, 'class:add');
  assert.equal(mapped.className, 'Categoria');
  assert.match(mapped.attributes[0], /nombre/);
});

test('interprets a TRAZO reply with Categoria, Producto and Factura', () => {
  const result = interpretReply(
    {
      message: 'Creé Categoria, Producto y Factura.',
      operations: [
        { op: 'class:add', className: 'Categoria', attributes: ['id: int', 'nombre: String'], methods: ['+ activar(): void'] },
        { op: 'class:add', className: 'Producto', attributes: ['nombre: String', 'precio: Decimal'], methods: ['+ publicar(): void'] },
        { op: 'class:add', className: 'Factura', attributes: ['fecha: Date', 'total: Decimal'], methods: ['+ calcularTotal(): Decimal'] },
        {
          op: 'link:add',
          className: 'Categoria',
          targetClassName: 'Producto',
          relationType: 'association',
          sourceMultiplicity: '1',
          targetMultiplicity: '0..*',
        },
        {
          op: 'link:add',
          className: 'Factura',
          targetClassName: 'Producto',
          relationType: 'aggregation',
          sourceMultiplicity: '1',
          targetMultiplicity: '1..*',
        },
      ],
      warnings: [],
    },
    emptyDiagram()
  );
  assert.equal(result.prepared.length, 5);
  assert.equal(result.prepared[0].data.name, 'Categoria');
  assert.equal(result.prepared[3].data.type, 'association');
  assert.equal(result.prepared[4].data.type, 'aggregation');
});

function withAiEnv(vars, run) {
  const keys = ['OPENAI_API_KEY', 'AI_PROVIDER', 'OPENAI_MODEL'];
  const previous = {};
  keys.forEach((key) => {
    previous[key] = process.env[key];
  });
  try {
    keys.forEach((key) => {
      if (vars[key] === undefined) delete process.env[key];
      else process.env[key] = vars[key];
    });
    run();
  } finally {
    keys.forEach((key) => {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    });
  }
}

test('uses OpenAI for diagrams when the key is present', () => {
  withAiEnv({ OPENAI_API_KEY: 'sk-test' }, () => {
    assert.equal(settings.diagramProvider(), 'openai');
    assert.equal(settings.usesOpenAiDiagrams(), true);
  });
});

test('uses Ollama for diagrams when the key is missing', () => {
  withAiEnv({}, () => {
    assert.equal(settings.diagramProvider(), 'ollama');
    assert.equal(settings.usesOpenAiDiagrams(), false);
  });
});

test('AI_PROVIDER can force Ollama even if a key exists', () => {
  withAiEnv({ OPENAI_API_KEY: 'sk-test', AI_PROVIDER: 'ollama' }, () => {
    assert.equal(settings.diagramProvider(), 'ollama');
  });
});

test('rejects OpenAI diagrams when the provider is forced and the key is missing', () => {
  withAiEnv({ AI_PROVIDER: 'openai' }, () => {
    assert.equal(settings.diagramProvider(), 'openai');
    assert.throws(() => settings.assertDiagramProvider(), /OPENAI_API_KEY/);
  });
});

test('classifies UML review, questions and modifications', () => {
  assert.equal(classifyIntent('revisa los tipos del diagrama'), 'review');
  assert.equal(classifyIntent('qué relación hay entre Cliente y Pedido?'), 'question');
  assert.equal(classifyIntent('agrega Producto y relaciónalo con Pedido'), 'modify');
  assert.equal(classifyIntent('', { hasImage: true }), 'sketch');
  assert.equal(shouldProposeChanges('question', 'qué clases hay'), false);
  assert.equal(shouldProposeChanges('modify', 'crea Cliente'), true);
});

test('keeps the room conversation in the prompt and does not patch on a question', () => {
  const history = formatHistoryForPrompt([
    { role: 'user', authorName: 'Ana', text: 'revisa tipos' },
    { role: 'assistant', text: 'phoneNumber debería ser String' },
  ]);
  const packed = buildTextPrompt('cámbialo', { classes: [], relations: [] }, { history, intent: 'modify' });
  assert.match(packed.prompt, /Ana: revisa tipos/);
  assert.match(packed.prompt, /intent=modify/);
  const review = interpretReply(
    {
      message: 'Cliente no tiene id persistible.',
      operations: [{ op: 'class:add', className: 'Fantasma' }],
      warnings: [],
    },
    emptyDiagram(),
    { intent: 'question', text: 'qué le falta a Cliente?' }
  );
  assert.equal(review.prepared.length, 0);
  assert.match(review.reply, /id persistible/);
});

test('keeps named associations and drops unsolicited extra links', () => {
  const snapshot = {
    classes: [
      { id: 'c1', name: 'Cliente', stereotype: 'none', attributes: [], methods: [], position: { x: 0, y: 0 } },
      { id: 'p1', name: 'Pedido', stereotype: 'none', attributes: [], methods: [], position: { x: 20, y: 0 } },
      { id: 'u1', name: 'Usuario', stereotype: 'none', attributes: [], methods: [], position: { x: 40, y: 0 } },
      { id: 'a1', name: 'Administrador', stereotype: 'none', attributes: ['+ nivel: String'], methods: [], position: { x: 60, y: 0 } },
    ],
    relations: [],
  };
  const result = interpretModelPayload(
    {
      message: 'Actualicé nivel y nombré pertenece.',
      operations: [
        { op: 'class:update', className: 'Administrador', attributes: ['+ nivel: Integer'] },
        {
          op: 'link:add',
          className: 'Cliente',
          targetClassName: 'Pedido',
          relationType: 'association',
          name: 'pertenece',
        },
        { op: 'link:add', className: 'Pedido', targetClassName: 'Usuario', relationType: 'association' },
        { op: 'class:update', className: 'Administrador', position: { x: 400, y: 80 } },
      ],
    },
    snapshot,
    { text: 'cambia nivel a Integer y nombra la relacion pertenece entre Cliente y Pedido' }
  );
  const links = result.prepared.filter((step) => step.event === 'link:add');
  assert.equal(links.length, 1);
  assert.equal(links[0].data.umlName, 'pertenece');
  const update = result.prepared.find((step) => step.event === 'class:update');
  assert.ok(update.data.patch.attributes.some((line) => /nivel: Integer/.test(line)));
  assert.equal(update.data.patch.position, undefined);
});
