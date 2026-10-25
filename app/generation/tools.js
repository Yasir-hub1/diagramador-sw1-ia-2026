const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TRAZO_MAVEN = path.join(os.homedir(), '.trazo', 'apache-maven-3.9.9', 'bin', process.platform === 'win32' ? 'mvn.cmd' : 'mvn');

function run(command, args) {
  return spawnSync(command, args, { encoding: 'utf8', timeout: 8000 });
}

function readJavaVersion() {
  const result = run('java', ['-version']);
  if (result.error && result.error.code === 'ENOENT') {
    return { ok: false, version: 0, message: 'No hay Java en el PATH. En esta Mac: brew install openjdk@17' };
  }
  const text = String(result.stderr || result.stdout || '');
  const match = text.match(/version "(\d+)/);
  const version = match ? Number(match[1]) : 0;
  if (version && version < 17) {
    return {
      ok: false,
      version,
      message: 'Se encontró Java ' + version + '. El backend necesita Java 17 o superior.',
    };
  }
  if (!version) {
    return { ok: false, version: 0, message: 'No pude leer la versión de Java.' };
  }
  return { ok: true, version, message: 'Java ' + version };
}

function findMaven(projectDir) {
  const wrapper = path.join(projectDir || '', process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw');
  const candidates = [];
  if (projectDir && fs.existsSync(wrapper)) candidates.push(wrapper);
  candidates.push(process.platform === 'win32' ? 'mvn.cmd' : 'mvn');
  if (fs.existsSync(TRAZO_MAVEN)) candidates.push(TRAZO_MAVEN);

  for (const command of candidates) {
    const result = run(command, ['-v']);
    if (result.error && result.error.code === 'ENOENT') continue;
    if (result.status !== 0) continue;
    return { ok: true, command, message: String(result.stdout || '').split('\n')[0] || 'Maven' };
  }
  return {
    ok: false,
    command: '',
    message: 'Maven no está instalado. En esta Mac: brew install maven',
  };
}

function resolveJavaHome() {
  if (process.env.JAVA_HOME && fs.existsSync(process.env.JAVA_HOME)) return process.env.JAVA_HOME;
  const result = run('java', ['-XshowSettings:properties', '-version']);
  const match = String(result.stderr || '').match(/java\.home = (.+)/);
  return match ? match[1].trim() : '';
}

function inspectRuntime(projectDir) {
  const java = readJavaVersion();
  const maven = findMaven(projectDir);
  return { java, maven, ok: java.ok && maven.ok };
}

module.exports = { inspectRuntime, findMaven, readJavaVersion, resolveJavaHome };
