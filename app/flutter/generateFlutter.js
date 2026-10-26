const { snapshotFromGraph } = require('../../public/diagram-snapshot');
const { parseUmlModel } = require('../generation/parseUml');
const { validateUmlModel } = require('../generation/validateUml');
const { buildBackendModel } = require('../generation/buildBackendModel');
const { validateBackendModel } = require('../generation/validateBackendModel');
const { buildOpenApiYaml } = require('../generation/buildOpenApi');
const { lastReadyJob: lastBackendJob } = require('../generation/jobs');
const { packageProject } = require('../generation/zipProject');
const { emitGeneration } = require('../generation/bus');
const { LocalAiError } = require('../ai/errors');
const { buildFrontendModel } = require('./buildFrontendModel');
const { validateFrontendModel } = require('./validateFrontendModel');
const { writeFlutterFiles } = require('./writeFlutterProject');
const { lastReadyJob, toClient } = require('./flutterJobs');
const { inspectRuntime } = require('../generation/tools');

function fail(job, message) {
  job.status = 'ERROR';
  job.step = 'ERROR';
  job.message = message;
  job.errors = [message];
  emitGeneration(job.shareToken, 'flutter:generation:error', toClient(job));
  throw new LocalAiError('rejected', message);
}

function step(job, name, progress, message) {
  job.status = name;
  job.step = name;
  job.progress = progress;
  job.message = message;
  emitGeneration(job.shareToken, 'flutter:generation:progress', toClient(job));
}

function backendBaseUrl(shareToken) {
  const previous = lastBackendJob(shareToken);
  if (previous && previous.port) return 'http://127.0.0.1:' + previous.port;
  return 'http://127.0.0.1:8081';
}

async function runFlutterGeneration(job, diagram) {
  try {
    step(job, 'ANALYZING_PROJECT', 10, 'Leyendo el UML');
    const snapshot = snapshotFromGraph(diagram.graph_data);
    const uml = parseUmlModel(snapshot, diagram.id);
    const umlCheck = validateUmlModel(uml);
    job.warnings.push(...umlCheck.warnings);
    if (!umlCheck.ok) fail(job, umlCheck.errors[0]);

    step(job, 'BUILDING_FRONTEND_MODEL', 30, 'Armando pantallas y rutas');
    const previousBackend = lastBackendJob(job.shareToken);
    const backend =
      previousBackend && previousBackend.backend
        ? previousBackend.backend
        : buildBackendModel(uml, { name: String(diagram.name || 'trazo').replace(/[^\w.-]+/g, '-') });
    const backendCheck = validateBackendModel(backend);
    if (!backendCheck.ok) fail(job, backendCheck.errors[0]);

    const frontend = buildFrontendModel(backend, { baseUrl: backendBaseUrl(job.shareToken) });
    const frontCheck = validateFrontendModel(frontend);
    if (!frontCheck.ok) fail(job, frontCheck.errors[0]);

    const previous = lastReadyJob(job.shareToken, job.id);
    if (previous && previous.frontend) {
      const before = previous.frontend.entities.map((item) => item.name).join(',');
      const after = frontend.entities.map((item) => item.name).join(',');
      if (before !== after) job.warnings.push('El frontend cambió respecto a la última generación.');
    }

    step(job, 'GENERATING_API_CLIENT', 55, 'Escribiendo el cliente Dio desde OpenAPI');
    const yaml = previousBackend && previousBackend.openApiYaml ? previousBackend.openApiYaml : buildOpenApiYaml(backend);

    step(job, 'GENERATING_SCREENS', 75, 'Generando listados, detalle y formularios');
    const files = writeFlutterFiles(frontend, yaml);

    const tools = inspectRuntime();
    if (!tools.flutter || !tools.flutter.ok) {
      job.warnings.push('Flutter SDK no está en esta máquina. El ZIP se entrega para abrirlo en tu entorno.');
    }

    step(job, 'PACKAGING', 90, 'Empaquetando el ZIP');
    const packed = await packageProject(files, job.id, {
      prefix: 'trazo-flutter',
      zipName: 'trazo-flutter-project.zip',
      marker: 'pubspec.yaml',
    });
    job.zipPath = packed.zipPath;
    job.zipName = packed.zipName;
    job.cleanup = packed.cleanup;
    job.frontend = frontend;
    job.preview = {
      backendJobId: previousBackend ? previousBackend.id : '',
      baseUrl: frontend.backend.baseUrl,
      screens: frontend.screens,
      entities: frontend.entities,
    };
    job.status = 'READY';
    job.step = 'READY';
    job.progress = 100;
    job.message = 'Frontend Flutter listo';
    emitGeneration(job.shareToken, 'flutter:generation:completed', toClient(job));
    return job;
  } catch (error) {
    if (job.status !== 'ERROR') {
      job.status = 'ERROR';
      job.step = 'ERROR';
      job.message = error.message || 'No se pudo generar Flutter.';
      job.errors = [job.message];
      emitGeneration(job.shareToken, 'flutter:generation:error', toClient(job));
    }
    throw error;
  }
}

module.exports = { runFlutterGeneration };
