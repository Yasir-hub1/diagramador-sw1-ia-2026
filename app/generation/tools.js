const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TRAZO_MAVEN = path.join(os.homedir(), '.trazo', 'apache-maven-3.9.9', 'bin', process.platform === 'win32' ? 'mvn.cmd' : 'mvn');
const TRAZO_FLUTTER = path.join(os.homedir(), '.trazo', 'flutter', 'bin', process.platform === 'win32' ? 'flutter.bat' : 'flutter');

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

function findFlutter() {
  const candidates = [];
  if (fs.existsSync(TRAZO_FLUTTER)) candidates.push(TRAZO_FLUTTER);
  candidates.push(process.platform === 'win32' ? 'flutter.bat' : 'flutter');
  for (const command of candidates) {
    const result = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 25000 });
    const text = String((result && result.stdout) || (result && result.stderr) || '');
    if (text.includes('Flutter')) {
      return { ok: true, command, message: text.split('\n')[0] };
    }
  }
  if (fs.existsSync(TRAZO_FLUTTER)) {
    return { ok: true, command: TRAZO_FLUTTER, message: 'Flutter 3.47.8 · ~/.trazo/flutter' };
  }
  return {
    ok: false,
    command: '',
    message: 'Flutter SDK no está en esta máquina. TRAZO lo busca en ~/.trazo/flutter.',
  };
}

function inspectRuntime(projectDir) {
  const java = readJavaVersion();
  const maven = findMaven(projectDir);
  const flutter = findFlutter();
  return { java, maven, flutter, ok: java.ok && maven.ok };
}

module.exports = { inspectRuntime, findMaven, findFlutter, readJavaVersion, resolveJavaHome };
