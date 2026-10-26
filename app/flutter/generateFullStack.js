const { snapshotFromGraph } = require('../../public/diagram-snapshot');
const { parseUmlModel } = require('../generation/parseUml');
const { validateUmlModel } = require('../generation/validateUml');
const { buildBackendModel } = require('../generation/buildBackendModel');
const { validateBackendModel } = require('../generation/validateBackendModel');
const { buildOpenApiYaml } = require('../generation/buildOpenApi');
const { writeSpringFiles } = require('../generation/writeSpringProject');
const { packageProject } = require('../generation/zipProject');
const { emitGeneration } = require('../generation/bus');
const { LocalAiError } = require('../ai/errors');
const { buildFrontendModel } = require('./buildFrontendModel');
const { writeFlutterFiles } = require('./writeFlutterProject');
const { toClient } = require('./flutterJobs');

async function runFullStackGeneration(job, diagram, options) {
  try {
    job.step = 'ANALYZING_PROJECT';
    job.progress = 15;
    job.message = 'Leyendo UML';
    emitGeneration(job.shareToken, 'flutter:generation:progress', toClient(job));
    const uml = parseUmlModel(snapshotFromGraph(diagram.graph_data), diagram.id);
    const umlCheck = validateUmlModel(uml);
    if (!umlCheck.ok) throw new LocalAiError('rejected', umlCheck.errors[0]);
    const backend = buildBackendModel(uml, {
      name: String(diagram.name || 'trazo').replace(/[^\w.-]+/g, '-'),
      database: options.database,
    });
    if (!validateBackendModel(backend).ok) throw new LocalAiError('rejected', 'El modelo de backend no es válido.');
    const yaml = buildOpenApiYaml(backend);
    const frontend = buildFrontendModel(backend, { baseUrl: 'http://127.0.0.1:8081' });
    const spring = writeSpringFiles(backend, yaml);
    const flutter = writeFlutterFiles(frontend, yaml);
    const files = {};
    Object.entries(spring).forEach(([key, value]) => {
      files['backend/' + key.replace(/^[^/]+\//, '')] = value;
    });
    Object.entries(flutter).forEach(([key, value]) => {
      files['frontend/' + key] = value;
    });
    files['README.md'] =
      '# TRAZO Full Stack\n\n1. Arranca el backend (`cd backend && mvn spring-boot:run`).\n2. Arranca Flutter (`cd frontend && flutter create --org com.trazo . && flutter run --dart-define=API_BASE_URL=http://127.0.0.1:8081`).\n';
    const packed = await packageProject(files, job.id, {
      prefix: 'trazo-fullstack',
      zipName: 'trazo-fullstack.zip',
      marker: 'README.md',
    });
    job.zipPath = packed.zipPath;
    job.zipName = packed.zipName;
    job.cleanup = packed.cleanup;
    job.frontend = frontend;
    job.preview = {
      backendJobId: '',
      baseUrl: frontend.backend.baseUrl,
      screens: frontend.screens,
      entities: frontend.entities,
    };
    job.status = 'READY';
    job.step = 'READY';
    job.progress = 100;
    job.message = 'Full stack listo';
    emitGeneration(job.shareToken, 'flutter:generation:completed', toClient(job));
  } catch (error) {
    job.status = 'ERROR';
    job.step = 'ERROR';
    job.message = error.message || 'No se pudo generar el full stack.';
    emitGeneration(job.shareToken, 'flutter:generation:error', toClient(job));
  }
}

module.exports = { runFullStackGeneration };
