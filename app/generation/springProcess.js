const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const { LocalAiError } = require('../ai/errors');
const { reservePort, releasePort } = require('./ports');
const { inspectRuntime, resolveJavaHome } = require('./tools');

const LOG_LIMIT = 200;

function assertManagedDir(dir) {
  const resolved = path.resolve(dir);
  const tmp = path.resolve(os.tmpdir());
  if (!resolved.startsWith(tmp) || !resolved.includes('trazo-backend-')) {
    throw new LocalAiError('forbidden', 'El proyecto no es un backend generado por TRAZO.');
  }
}

function appendLog(job, chunk) {
  const lines = String(chunk).split(/\r?\n/).filter(Boolean);
  job.logs = (job.logs || []).concat(lines).slice(-LOG_LIMIT);
}

function runtimeOf(job) {
  return {
    status: job.runtimeStatus || 'stopped',
    port: job.port || null,
    baseUrl: job.port ? 'http://127.0.0.1:' + job.port : '',
    swaggerUrl: job.port ? 'http://127.0.0.1:' + job.port + '/swagger-ui.html' : '',
    tools: job.tools || null,
  };
}

async function waitForHttp(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const paths = ['/v3/api-docs', '/swagger-ui.html', '/'];
  while (Date.now() < deadline) {
    for (const route of paths) {
      try {
        await fetch('http://127.0.0.1:' + port + route, {
          signal: AbortSignal.timeout(1500),
        });
        return true;
      } catch {
        // keep waiting
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  return false;
}

function generatedDatasourceEnv(job) {
  if (job.backend && job.backend.configuration.database === 'mongodb') {
    const uri = process.env.GENERATED_MONGO_URI || 'mongodb://127.0.0.1:27017/trazo_generated';
    return {
      SPRING_DATA_MONGODB_URI: uri,
      SPRING_DATA_MONGODB_DATABASE: 'trazo_generated',
    };
  }
  if (!job.backend || job.backend.configuration.database !== 'postgresql') return {};
  const source = job.backend.configuration.datasource || {};
  const host = source.host || process.env.GENERATED_DB_HOST || '127.0.0.1';
  const port = source.port || process.env.DB_PORT || '5432';
  const name = source.name || process.env.GENERATED_DB_NAME || 'trazo_generated';
  return {
    SPRING_DATASOURCE_URL: 'jdbc:postgresql://' + host + ':' + port + '/' + name,
    SPRING_DATASOURCE_USERNAME: source.username || process.env.DB_USER || 'postgres',
    SPRING_DATASOURCE_PASSWORD: source.password || process.env.DB_PASSWORD || 'postgres',
  };
}

function stopProcess(job) {
  if (job.child && !job.child.killed) {
    job.child.kill('SIGTERM');
  }
  job.child = null;
  job.runtimeStatus = 'stopped';
  if (job.port) releasePort(job.port);
  job.port = null;
}

async function startProcess(job) {
  if (job.runtimeStatus === 'running' && job.port) return runtimeOf(job);
  if (job.child) return runtimeOf(job);
  if (!job.projectDir) throw new LocalAiError('rejected', 'Todavía no hay un proyecto para arrancar.');
  assertManagedDir(job.projectDir);

  const tools = inspectRuntime(job.projectDir);
  job.tools = tools;
  if (!tools.java.ok) throw new LocalAiError('rejected', tools.java.message);
  if (!tools.maven.ok) throw new LocalAiError('rejected', tools.maven.message);

  const port = await reservePort();
  job.port = port;
  job.runtimeStatus = 'starting';
  job.logs = job.logs || [];
  appendLog(job, tools.java.message);
  appendLog(job, tools.maven.message);
  appendLog(job, 'Arrancando el backend en el puerto ' + port);

  const child = spawn(
    tools.maven.command,
    ['-B', 'spring-boot:run', '-DskipTests', '-Dspring-boot.run.arguments=--server.port=' + port],
    {
      cwd: job.projectDir,
      env: { ...process.env, ...generatedDatasourceEnv(job), JAVA_HOME: resolveJavaHome() || process.env.JAVA_HOME },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }
  );
  job.child = child;
  child.stdout.on('data', (chunk) => appendLog(job, chunk));
  child.stderr.on('data', (chunk) => appendLog(job, chunk));
  child.on('error', (error) => {
    appendLog(job, error.message || 'Maven no se pudo lanzar');
    stopProcess(job);
  });
  child.on('exit', (code) => {
    appendLog(job, 'Proceso Maven terminó con código ' + String(code));
    if (job.child === child) stopProcess(job);
  });

  const up = await waitForHttp(port, 300000);
  if (!up) {
    const hint = (job.logs || []).slice(-8).join(' ');
    stopProcess(job);
    throw new LocalAiError(
      'timeout',
      hint.includes('JAVA_HOME') || hint.toLowerCase().includes('java')
        ? 'Maven arrancó, pero Java no compiló el proyecto. Revisa los logs.'
        : 'El backend no respondió a tiempo. Revisa los logs de Maven.'
    );
  }
  job.runtimeStatus = 'running';
  appendLog(job, 'API lista en http://127.0.0.1:' + port);
  return runtimeOf(job);
}

module.exports = { startProcess, stopProcess, runtimeOf, appendLog };
