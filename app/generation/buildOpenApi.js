const { openApiSchema } = require('./types');

function yamlValue(value, indent) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (/[:#{}[\],&*?]|^\s|\s$/.test(value)) return JSON.stringify(value);
    return value;
  }
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return value
      .map((item) => '\n' + indent + '- ' + (typeof item === 'object' ? yamlDump(item, indent + '  ').trimStart() : yamlValue(item, indent)))
      .join('');
  }
  return '\n' + yamlDump(value, indent + '  ');
}

function yamlDump(object, indent) {
  return Object.entries(object)
    .map(([key, value]) => {
      if (value === undefined) return '';
      const rendered = yamlValue(value, indent);
      if (rendered.startsWith('\n')) return indent + key + ':' + rendered;
      return indent + key + ': ' + rendered;
    })
    .filter(Boolean)
    .join('\n');
}

function schemaForEntity(entity) {
  const required = entity.attributes.filter((item) => item.required && !item.primaryKey).map((item) => item.name);
  const properties = {};
  entity.attributes.forEach((item) => {
    properties[item.name] = openApiSchema(item.type);
  });
  const schema = { type: 'object', properties };
  if (required.length) schema.required = required;
  return schema;
}

function buildOpenApiDocument(model) {
  const paths = {};
  model.entities.forEach((entity) => {
    entity.endpoints.forEach((route) => {
      if (!paths[route.path]) paths[route.path] = {};
      const method = route.method.toLowerCase();
      const operation = {
        operationId: route.operationId,
        tags: [entity.name],
        responses: {
          '200': { description: 'OK' },
        },
      };
      if (route.path.includes('{id}')) {
        operation.parameters = [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', format: 'int64' } }];
      }
      if (route.method === 'POST' || route.method === 'PUT') {
        operation.requestBody = {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/' + entity.name } } },
        };
      }
      if (route.method === 'DELETE') operation.responses = { '204': { description: 'Eliminado' } };
      paths[route.path][method] = operation;
    });
  });

  const schemas = {};
  model.entities.forEach((entity) => {
    schemas[entity.name] = schemaForEntity(entity);
  });

  return {
    openapi: '3.0.3',
    info: {
      title: model.project.name,
      version: '1.0.0',
      description: 'API generada por TRAZO desde un diagrama UML de clases.',
    },
    servers: [{ url: 'http://localhost:8081' }],
    paths,
    components: { schemas },
  };
}

function buildOpenApiYaml(model) {
  return yamlDump(buildOpenApiDocument(model), '') + '\n';
}

module.exports = { buildOpenApiDocument, buildOpenApiYaml };
