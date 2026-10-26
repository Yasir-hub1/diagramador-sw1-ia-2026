function camel(name) {
  const text = String(name || '').trim();
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function pluralize(name) {
  const base = camel(name);
  if (/[^aeiou]y$/i.test(name)) return base.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/i.test(name)) return base + 'es';
  return base + 's';
}

function ensureIdentifier(entity) {
  const hasId = entity.attributes.some((item) => item.primaryKey);
  if (hasId) return entity;
  return {
    ...entity,
    attributes: [{ name: 'id', type: 'Long', required: true, primaryKey: true, visibility: '-' }, ...entity.attributes],
  };
}

function crudFlags() {
  return { list: true, find: true, create: true, update: true, delete: true };
}

function endpointsFor(entity) {
  const path = entity.endpoint;
  const idPath = path + '/{id}';
  const flags = entity.crud;
  const routes = [];
  if (flags.list) routes.push({ method: 'GET', path, operationId: 'list' + entity.name, crud: 'list' });
  if (flags.create) routes.push({ method: 'POST', path, operationId: 'create' + entity.name, crud: 'create' });
  if (flags.find) routes.push({ method: 'GET', path: idPath, operationId: 'get' + entity.name, crud: 'find' });
  if (flags.update) routes.push({ method: 'PUT', path: idPath, operationId: 'update' + entity.name, crud: 'update' });
  if (flags.delete) routes.push({ method: 'DELETE', path: idPath, operationId: 'delete' + entity.name, crud: 'delete' });
  return routes;
}

function resolveDatasource(options = {}) {
  return {
    host: options.dbHost || process.env.GENERATED_DB_HOST || '127.0.0.1',
    port: String(options.dbPort || process.env.DB_PORT || '5432'),
    name: options.generatedDbName || process.env.GENERATED_DB_NAME || 'trazo_generated',
    username: options.dbUser || process.env.DB_USER || 'postgres',
    password: options.dbPassword || process.env.DB_PASSWORD || 'postgres',
  };
}

function persistableRelation(relation) {
  return relation.type === 'association' || relation.type === 'aggregation' || relation.type === 'composition';
}

function buildBackendModel(uml, options = {}) {
  const persistable = uml.classes
    .filter((item) => item.stereotype !== 'interface')
    .map((item) => {
      const entity = ensureIdentifier({
        name: item.name,
        table: pluralize(item.name),
        endpoint: '/api/' + pluralize(item.name),
        attributes: item.attributes,
        crud: crudFlags(),
        pagination: true,
        validation: true,
      });
      return entity;
    });

  const relationships = uml.relationships.filter(persistableRelation).map((item) => ({
    type: item.kind,
    source: item.sourceName,
    target: item.targetName,
    umlType: item.type,
    sourceMultiplicity: item.sourceMultiplicity,
    targetMultiplicity: item.targetMultiplicity,
  }));

  const entities = persistable.map((entity) => ({
    ...entity,
    endpoints: endpointsFor(entity),
  }));

  return {
    project: {
      name: options.name || 'trazo-generated-api',
      groupId: 'com.trazo',
      artifactId: 'trazo-generated-api',
      packageName: 'com.trazo.generated',
    },
    entities,
    relationships,
    configuration: {
      springBootVersion: '3.3.5',
      javaVersion: '17',
      database: options.database === 'postgresql' ? 'postgresql' : 'h2',
      datasource: resolveDatasource(options),
    },
  };
}

module.exports = { buildBackendModel, pluralize, camel, resolveDatasource };
