const { snapshotFromGraph } = require('../../public/diagram-snapshot');
const { parseUmlModel } = require('./parseUml');
const { validateUmlModel } = require('./validateUml');
const { buildBackendModel } = require('./buildBackendModel');
const { validateBackendModel } = require('./validateBackendModel');
const { buildOpenApiDocument, buildOpenApiYaml } = require('./buildOpenApi');
const { validateOpenApi } = require('./validateOpenApi');
const { writeSpringFiles } = require('./writeSpringProject');
const { packageProject } = require('./zipProject');
const { analyzeUml } = require('./analyzeUml');
const { lastReadyJob, toClient } = require('./jobs');
const { diffUml } = require('./diffUml');
const { emitGeneration } = require('./bus');
const { LocalAiError } = require('../ai/errors');

function fail(job, message) {
  job.status = 'ERROR';
  job.step = 'ERROR';
  job.message = message;
  job.errors = [message, ...job.errors].slice(0, 8);
  emitGeneration(job.shareToken, 'generation:error', toClient(job));
  throw new LocalAiError('rejected', message);
}

function step(job, name, progress, message) {
  job.status = name;
  job.step = name;
  job.progress = progress;
  job.message = message;
  emitGeneration(job.shareToken, 'generation:progress', toClient(job));
}

async function runGeneration(job, diagram, options) {
  try {
    step(job, 'PARSING_UML', 10, 'Leyendo el diagrama');
    const snapshot = snapshotFromGraph(diagram.graph_data);
    const uml = parseUmlModel(snapshot, diagram.id);

    step(job, 'VALIDATING_UML', 25, 'Validando el UML');
    const umlCheck = validateUmlModel(uml);
    job.warnings.push(...umlCheck.warnings);
    if (!umlCheck.ok) fail(job, umlCheck.errors[0]);
    const previous = lastReadyJob(job.shareToken, job.id);
    job.uml = uml;
    job.changes = diffUml(previous && previous.uml, uml);
    if (job.changes.length) {
      job.warnings.push('El UML cambió respecto a la última generación (' + job.changes.length + ').');
    }

    job.typeNotes = uml.typeNotes || [];
    if (options.useAi) {
      step(job, 'ANALYZING_AI', 40, 'Revisando tipos y relaciones');
      analyzeUml(uml);
    }

    step(job, 'BUILDING_BACKEND_MODEL', 55, 'Armando el modelo de backend');
    const backend = buildBackendModel(uml, {
      name: String(diagram.name || 'trazo-generated-api').replace(/[^\w.-]+/g, '-'),
      database: options.database,
    });
    const backendCheck = validateBackendModel(backend);
    job.warnings.push(...backendCheck.warnings);
    if (!backendCheck.ok) fail(job, backendCheck.errors[0]);

    step(job, 'GENERATING_OPENAPI', 70, 'Escribiendo OpenAPI');
    const document = buildOpenApiDocument(backend);
    const yaml = buildOpenApiYaml(backend);
    const openApiCheck = validateOpenApi(document);
    if (!openApiCheck.ok) fail(job, openApiCheck.errors[0]);

    step(job, 'GENERATING_SPRING', 85, 'Generando el proyecto Spring Boot');
    const files = writeSpringFiles(backend, yaml);
    const packed = await packageProject(files, job.id);
    job.zipPath = packed.zipPath;
    job.zipName = packed.zipName;
    job.projectDir = packed.projectDir;
    job.cleanup = packed.cleanup;
    job.backend = backend;
    job.openApiYaml = yaml;
    job.preview = {
      entities: backend.entities.map((entity) => ({
        name: entity.name,
        endpoint: entity.endpoint,
        attributes: entity.attributes.map((item) => item.name),
      })),
      relationships: backend.relationships,
      database: backend.configuration.database,
    };
    job.warnings = job.warnings.filter(Boolean).slice(0, 12);
    job.status = 'READY';
    job.step = 'READY';
    job.progress = 100;
    job.message = 'Backend listo para descargar';
    emitGeneration(job.shareToken, 'generation:completed', toClient(job));
    return job;
  } catch (error) {
    if (job.status !== 'ERROR') {
      job.status = 'ERROR';
      job.step = 'ERROR';
      job.message = error.message || 'No se pudo generar el backend.';
      job.errors = [job.message];
      emitGeneration(job.shareToken, 'generation:error', toClient(job));
    }
    throw error;
  }
}

module.exports = { runGeneration };
