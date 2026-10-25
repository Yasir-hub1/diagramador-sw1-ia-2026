const fs = require('fs');
const path = require('path');
const os = require('os');

async function createZipArchive() {
  const loaded = await import('archiver');
  if (typeof loaded.ZipArchive === 'function') {
    return new loaded.ZipArchive({ zlib: { level: 9 } });
  }
  const createArchive = loaded.default || loaded;
  if (typeof createArchive === 'function') {
    return createArchive('zip', { zlib: { level: 9 } });
  }
  throw new Error('No se pudo cargar archiver para empaquetar el ZIP.');
}

function writeFiles(files, rootDir) {
  Object.entries(files).forEach(([relative, content]) => {
    const full = path.join(rootDir, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  });
}

function findMavenRoot(rootDir) {
  if (fs.existsSync(path.join(rootDir, 'pom.xml'))) return rootDir;
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(rootDir, entry.name);
    if (fs.existsSync(path.join(candidate, 'pom.xml'))) return candidate;
  }
  return rootDir;
}

async function zipDirectory(sourceDir, zipPath) {
  const archive = await createZipArchive();
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    output.on('close', () => resolve(zipPath));
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

async function packageProject(files, jobId) {
  const rootDir = path.join(os.tmpdir(), 'trazo-backend-' + jobId);
  const zipPath = rootDir + '.zip';
  fs.rmSync(rootDir, { recursive: true, force: true });
  writeFiles(files, rootDir);
  await zipDirectory(rootDir, zipPath);
  return {
    rootDir,
    projectDir: findMavenRoot(rootDir),
    zipPath,
    zipName: 'trazo-backend-project.zip',
    cleanup() {
      fs.rmSync(rootDir, { recursive: true, force: true });
      fs.rmSync(zipPath, { force: true });
    },
  };
}

module.exports = { packageProject };
