const { titleField, subtitleField } = require('./dartTypes');

function slugFor(entity) {
  return String(entity.endpoint || '')
    .replace(/^\/api\//, '')
    .replace(/^\//, '');
}

function buildFrontendModel(backend, options = {}) {
  const screens = [{ id: 'home', name: 'HomeScreen', route: '/', entity: '', type: 'home' }];
  backend.entities.forEach((entity) => {
    const slug = slugFor(entity);
    screens.push({
      id: slug + '-list',
      name: entity.name + 'ListScreen',
      route: '/' + slug,
      entity: entity.name,
      type: 'list',
      endpoint: entity.endpoint,
      titleField: titleField(entity),
      subtitleField: subtitleField(entity),
    });
    screens.push({
      id: slug + '-detail',
      name: entity.name + 'DetailScreen',
      route: '/' + slug + '/:id',
      entity: entity.name,
      type: 'detail',
      endpoint: entity.endpoint,
    });
    screens.push({
      id: slug + '-form',
      name: entity.name + 'FormScreen',
      route: '/' + slug + '/new',
      entity: entity.name,
      type: 'form',
      endpoint: entity.endpoint,
    });
  });

  return {
    appName: backend.project.name || 'TRAZO',
    apiVersion: '1.0.0',
    backend: {
      framework: 'spring-boot',
      baseUrl: options.baseUrl || 'http://127.0.0.1:8081',
    },
    entities: backend.entities.map((entity) => ({
      name: entity.name,
      endpoint: entity.endpoint,
      slug: slugFor(entity),
      titleField: titleField(entity),
      subtitleField: subtitleField(entity),
      attributes: entity.attributes.map((item) => ({
        name: item.name,
        type: item.type,
        required: Boolean(item.required),
        primaryKey: Boolean(item.primaryKey),
      })),
    })),
    relationships: backend.relationships || [],
    screens,
  };
}

module.exports = { buildFrontendModel, slugFor };
