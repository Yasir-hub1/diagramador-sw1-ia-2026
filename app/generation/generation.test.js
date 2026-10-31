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

test('writes PostgreSQL credentials from TRAZO into application.yml', () => {
  const backend = buildBackendModel(parseUmlModel(sampleSnapshot(), 'd1'), {
    database: 'postgresql',
    dbHost: '127.0.0.1',
    dbUser: 'postgres',
    dbPassword: 'clave-servidor',
    generatedDbName: 'trazo_generated',
  });
  const files = writeSpringFiles(backend, 'openapi: 3.0.3\n');
  const yml = files[Object.keys(files).find((name) => name.endsWith('application.yml'))];
  assert.match(yml, /jdbc:postgresql:\/\/127\.0\.0\.1:5432\/trazo_generated/);
  assert.match(yml, /username: 'postgres'/);
  assert.match(yml, /password: 'clave-servidor'/);
  assert.match(yml, /PostgreSQLDialect/);
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

test('keeps an explicit Integer when the name has no stronger hint', () => {
  const uml = parseUmlModel(
    {
      classes: [
        {
          id: 'c1',
          name: 'Curso',
          attributes: ['- id: Long', '+ cupo: Integer', '+ nivel: String'],
          methods: [],
        },
      ],
      relations: [],
    },
    'd1'
  );
  const curso = uml.classes.find((item) => item.name === 'Curso');
  const cupo = curso.attributes.find((item) => item.name === 'cupo');
  const nivel = curso.attributes.find((item) => item.name === 'nivel');
  assert.equal(cupo.type, 'Integer');
  assert.equal(nivel.type, 'Integer');
});

test('writes a MongoDB document entity instead of JPA', () => {
  const backend = buildBackendModel(parseUmlModel(sampleSnapshot(), 'd1'), { database: 'mongodb' });
  assert.equal(backend.configuration.database, 'mongodb');
  const files = writeSpringFiles(backend, 'openapi: 3.0.3\n');
  const usuario = files[Object.keys(files).find((name) => name.endsWith('/entity/Usuario.java'))];
  const pom = files[Object.keys(files).find((name) => name.endsWith('pom.xml'))];
  const yml = files[Object.keys(files).find((name) => name.endsWith('application.yml'))];
  assert.match(usuario, /@Document/);
  assert.doesNotMatch(usuario, /@Entity/);
  assert.match(pom, /spring-boot-starter-data-mongodb/);
  assert.match(yml, /mongodb:\/\/127\.0\.0\.1:27017\/trazo_generated/);
  assert.match(yml, /auto-index-creation: true/);
  const service = files[Object.keys(files).find((name) => name.endsWith('/service/UsuarioService.java'))];
  assert.match(service, /mongoSequenceService.next\("usuarios"\)/);
  assert.doesNotMatch(service, /setId\(null\)/);
  assert.ok(Object.keys(files).some((name) => name.endsWith('/support/MongoSequenceService.java')));
});

test('previews UML changes without generating a ZIP', () => {
  const { previewFromDiagram } = require('./previewUml');
  const preview = previewFromDiagram({
    id: 'd1',
    name: 'Sala',
    share_token: 'token',
    graph_data: {
      cells: [
        {
          id: 'c1',
          type: 'uml.Class',
          umlName: 'Curso',
          umlStereotype: 'none',
          umlAttributes: ['- id: Long', '+ cupo: Integer'],
          umlMethods: [],
          position: { x: 10, y: 10 },
        },
      ],
    },
  });
  assert.equal(preview.ok, true);
  assert.ok(preview.phone.entities.some((item) => item.name === 'Curso'));
  assert.ok(preview.preview.entities.some((item) => item.name === 'Curso'));
  assert.ok(preview.preview.entities[0].attributes.some((item) => item.startsWith('cupo:Integer')));
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

test('keeps Integer when declared and infers nivel from String', () => {
  const semantics = require('../../public/attribute-semantics');
  const inferred = semantics.refineAttributeLines('Administrador', ['+ nivel: String'], []);
  assert.ok(inferred.attributes.some((line) => /nivel: Integer/.test(line)));
  const kept = semantics.refineAttributeLines('Administrador', ['+ cupo: Integer'], []);
  assert.ok(kept.attributes.some((line) => /cupo: Integer/.test(line)));
});

test('reads JointJS class name when umlName is missing', () => {
  const { snapshotFromGraph } = require('../../public/diagram-snapshot');
  const snapshot = snapshotFromGraph({
    cells: [{ id: 'c1', type: 'uml.Class', name: '«abstract»\nAdministrador', umlAttributes: ['+ nivel: Integer'] }],
  });
  assert.equal(snapshot.classes[0].name, 'Administrador');
});

test('previews the live canvas graphJson instead of a stale saved diagram', () => {
  const { previewFromDiagram } = require('./previewUml');
  const preview = previewFromDiagram(
    {
      id: 'd1',
      name: 'Sala',
      share_token: 'token',
      graph_data: { cells: [] },
    },
    {
      graphJson: {
        cells: [
          {
            id: 'c1',
            type: 'uml.Class',
            umlName: 'Producto',
            umlStereotype: 'none',
            umlAttributes: ['- id: Long', '+ nombre: String'],
            umlMethods: [],
            position: { x: 0, y: 0 },
          },
        ],
      },
    }
  );
  assert.equal(preview.ok, true);
  assert.ok(preview.phone.entities.some((item) => item.name === 'Producto'));
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
