const test = require('node:test');
const assert = require('node:assert/strict');
const { parseUmlModel, relationKind } = require('./parseUml');
const { validateUmlModel } = require('./validateUml');
const { buildBackendModel } = require('./buildBackendModel');
const { validateBackendModel } = require('./validateBackendModel');
const { buildOpenApiDocument, buildOpenApiYaml } = require('./buildOpenApi');
const { writeSpringFiles } = require('./writeSpringProject');
const { diffUml } = require('./diffUml');
const { proxyToGeneratedApi } = require('./apiProxy');
const { LocalAiError } = require('../ai/errors');
const { coerceField, payloadFromValues } = require('../../public/json-fields');

function sampleSnapshot() {
  return {
    classes: [
      {
        id: 'u1',
        name: 'Usuario',
        stereotype: 'none',
        attributes: ['- id: Long', '+ nombre: String', '+ email: String'],
        methods: [],
      },
      {
        id: 'o1',
        name: 'Pedido',
        stereotype: 'none',
        attributes: ['- id: Long', '+ total: Double'],
        methods: [],
      },
    ],
    relations: [
      {
        id: 'l1',
        type: 'association',
        sourceId: 'u1',
        targetId: 'o1',
        sourceName: 'Usuario',
        targetName: 'Pedido',
        sourceMultiplicity: '1',
        targetMultiplicity: '0..*',
      },
    ],
  };
}

test('maps 1 to many as ONE_TO_MANY', () => {
  assert.equal(relationKind('1', '0..*'), 'ONE_TO_MANY');
  assert.equal(relationKind('*', '*'), 'MANY_TO_MANY');
});

test('fixes phone and student numbers and turns student lists into relations', () => {
  const uml = parseUmlModel(
    {
      classes: [
        {
          id: 'p1',
          name: 'Person',
          attributes: ['- id: Long', '+ phoneNumber: Double'],
          methods: [],
        },
        {
          id: 's1',
          name: 'Student',
          attributes: ['- id: Long', '+ studentNumber: Double'],
          methods: [],
        },
        {
          id: 'r1',
          name: 'Professor',
          attributes: ['- id: Long', '+ listOfStudents: String'],
          methods: [],
        },
      ],
      relations: [],
    },
    'd1'
  );
  const person = uml.classes.find((item) => item.name === 'Person');
  const professor = uml.classes.find((item) => item.name === 'Professor');
  assert.equal(person.attributes.find((item) => item.name === 'phoneNumber').type, 'String');
  assert.equal(professor.attributes.some((item) => item.name === 'listOfStudents'), false);
  assert.ok(uml.relationships.some((item) => item.sourceName === 'Professor' && item.targetName === 'Student'));
  assert.ok(uml.typeNotes.some((line) => /phoneNumber/.test(line)));
});

test('adds Long id when a drawn class has no identifier', () => {
  const uml = parseUmlModel(
    {
      classes: [
        {
          id: 'p1',
          name: 'Producto',
          stereotype: 'none',
          attributes: ['+ nombre: String'],
          methods: [],
        },
      ],
      relations: [],
    },
    'd1'
  );
  assert.equal(uml.classes[0].idWasAdded, true);
  assert.equal(uml.classes[0].attributes[0].name, 'id');
  assert.equal(uml.classes[0].attributes[0].type, 'Long');
  assert.equal(uml.classes[0].attributes[0].primaryKey, true);
  assert.equal(uml.classes[0].attributes[1].name, 'nombre');
});

test('does not duplicate an existing id', () => {
  const uml = parseUmlModel(sampleSnapshot(), 'd1');
  assert.equal(uml.classes[0].attributes.filter((item) => item.primaryKey).length, 1);
});

test('parses TRAZO snapshot classes and attributes', () => {
  const uml = parseUmlModel(sampleSnapshot(), 'd1');
  assert.equal(uml.classes[0].attributes[1].name, 'nombre');
  assert.equal(uml.classes[0].attributes[1].type, 'String');
  assert.equal(uml.classes[0].attributes[0].primaryKey, true);
  assert.equal(uml.relationships[0].kind, 'ONE_TO_MANY');
});

test('rejects an empty diagram', () => {
  const check = validateUmlModel({ classes: [], relationships: [] });
  assert.equal(check.ok, false);
});

test('builds CRUD endpoints and OpenAPI paths from UML', () => {
  const uml = parseUmlModel(sampleSnapshot(), 'd1');
  assert.equal(validateUmlModel(uml).ok, true);
  const backend = buildBackendModel(uml, { database: 'h2' });
  assert.equal(validateBackendModel(backend).ok, true);
  const users = backend.entities.find((item) => item.name === 'Usuario');
  assert.equal(users.endpoint, '/api/usuarios');
  assert.equal(users.endpoints.length, 5);
  const doc = buildOpenApiDocument(backend);
  assert.ok(doc.paths['/api/health'].get);
  assert.ok(doc.paths['/api/usuarios'].get);
  assert.ok(doc.paths['/api/usuarios/{id}'].put);
  assert.ok(doc.components.schemas.Usuario.properties.email);
  const yaml = buildOpenApiYaml(backend);
  assert.match(yaml, /openapi: 3.0.3/);
});

test('writes Spring controller and entity files', () => {
  const backend = buildBackendModel(parseUmlModel(sampleSnapshot(), 'd1'), { database: 'h2' });
  const files = writeSpringFiles(backend, 'openapi: 3.0.3\n');
  const names = Object.keys(files);
  assert.ok(names.some((name) => name.endsWith('/entity/Usuario.java')));
  assert.ok(names.some((name) => name.endsWith('/controller/PedidoController.java')));
  assert.ok(names.some((name) => name.endsWith('pom.xml')));
  assert.match(files[names.find((name) => name.endsWith('UsuarioController.java'))], /@RequestMapping\("\/api\/usuarios"\)/);
  const usuario = files[names.find((name) => name.endsWith('/entity/Usuario.java'))];
  assert.doesNotMatch(usuario, /@NotBlank/);
  assert.doesNotMatch(usuario, /@NotNull/);
  assert.match(files[names.find((name) => name.endsWith('ApiErrorHandler.java'))], /HttpMessageNotReadableException/);
});

test('coerces form text to Spring JSON types and omits blanks', () => {
  assert.equal(coerceField('Integer', '21').value, 21);
  assert.equal(coerceField('Boolean', 'true').value, true);
  assert.equal(coerceField('Integer', '').omit, true);
  assert.equal(coerceField('Double', 'x').error.includes('número'), true);
  const payload = payloadFromValues(
    [
      { name: 'id', type: 'Long', primaryKey: true },
      { name: 'nombre', type: 'String' },
      { name: 'edad', type: 'Integer' },
      { name: 'activo', type: 'Boolean' },
    ],
    { nombre: 'Ana', edad: '', activo: 'si' }
  );
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.body, { nombre: 'Ana', activo: true });
});

test('diffs added classes and attributes against the previous UML', () => {
  const previous = parseUmlModel(sampleSnapshot(), 'd1');
  const current = parseUmlModel(sampleSnapshot(), 'd1');
  current.classes.push({
    id: 'c1',
    name: 'Categoria',
    stereotype: 'none',
    attributes: [{ name: 'nombre', type: 'String' }],
    methods: [],
  });
  current.classes[0].attributes.push({ name: 'telefono', type: 'String' });
  const changes = diffUml(previous, current);
  assert.ok(changes.some((item) => item.type === 'ADD_CLASS' && item.entity === 'Categoria'));
  assert.ok(changes.some((item) => item.type === 'ADD_ATTRIBUTE' && item.entity === 'Usuario'));
});

test('proxy rejects requests when the generated API is not running', async () => {
  await assert.rejects(
    () => proxyToGeneratedApi({ runtimeStatus: 'stopped' }, { method: 'GET', path: '/api/usuarios' }),
    (error) => error instanceof LocalAiError
  );
  await assert.rejects(
    () => proxyToGeneratedApi({ runtimeStatus: 'running', port: 8081 }, { method: 'GET', path: 'http://evil.test' }),
    (error) => error instanceof LocalAiError
  );
});
