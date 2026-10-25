const net = require('net');

const FIRST_PORT = 8081;
const LAST_PORT = 8181;
const reserved = new Set();

function isFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function reservePort() {
  for (let port = FIRST_PORT; port <= LAST_PORT; port++) {
    if (reserved.has(port)) continue;
    if (!(await isFree(port))) continue;
    reserved.add(port);
    return port;
  }
  throw new Error('No hay puertos libres entre 8081 y 8181.');
}

function releasePort(port) {
  reserved.delete(Number(port));
}

module.exports = { reservePort, releasePort, FIRST_PORT, LAST_PORT };
