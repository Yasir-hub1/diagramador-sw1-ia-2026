const { snapshotFromGraph, fingerprintOf } = require('../../public/diagram-snapshot');
const { parseUmlModel } = require('./parseUml');
const { validateUmlModel } = require('./validateUml');
const { buildBackendModel } = require('./buildBackendModel');
const { lastReadyJob, lastRunningJob } = require('./jobs');
const { diffUml } = require('./diffUml');
const { buildFrontendModel } = require('../flutter/buildFrontendModel');

function previewFromDiagram(diagram, options = {}) {
  const snapshot = snapshotFromGraph(options.graphJson || (diagram && diagram.graph_data));
  const uml = parseUmlModel(snapshot, diagram && diagram.id);
  const umlCheck = validateUmlModel(uml);
  const previous = lastReadyJob(diagram && diagram.share_token);
  const running = lastRunningJob(diagram && diagram.share_token);
  const backend = umlCheck.ok
    ? buildBackendModel(uml, {
        name: String((diagram && diagram.name) || 'trazo').replace(/[^\w.-]+/g, '-'),
        database: options.database,
      })
    : null;
  const phone = backend
    ? buildFrontendModel(backend, {
        baseUrl: running && running.port ? 'http://127.0.0.1:' + running.port : '',
      })
    : null;
  return {
    ok: umlCheck.ok,
    errors: umlCheck.errors || [],
    warnings: umlCheck.warnings || [],
    typeNotes: uml.typeNotes || [],
    changes: diffUml(previous && previous.uml, uml),
    fingerprint: fingerprintOf(snapshot),
    preview: backend
      ? {
          entities: backend.entities.map((entity) => ({
            name: entity.name,
            endpoint: entity.endpoint,
            attributes: entity.attributes.map((item) => item.name + ':' + item.type),
          })),
          relationships: backend.relationships,
          database: backend.configuration.database,
        }
      : null,
    phone: phone
      ? {
          ...phone,
          backendJobId: running ? running.id : '',
          baseUrl: running && running.port ? 'http://127.0.0.1:' + running.port : '',
        }
      : null,
  };
}

module.exports = { previewFromDiagram };
