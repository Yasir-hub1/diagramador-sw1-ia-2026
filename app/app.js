// index.js
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const pool = require('./db');
const bcrypt = require('bcrypt');
const sessionMiddleware = require('./session');
const roomsRouter = require('./routes/rooms');
const voiceRouter = require('./routes/voice');
const attachSockets = require('./sockets');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Configurar EJS como motor de vistas
app.set('view engine', 'ejs');

// Servir archivos estáticos (CSS, imágenes, etc.)
app.use(express.static('public'));

// Middleware para manejar JSON y formularios
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sesión (compartida con Socket.IO, ver app/sockets.js)
app.use(sessionMiddleware);

// Flash one-shot para toasts en las vistas (errores de auth / DB)
app.use((req, res, next) => {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

function flashRedirect(req, res, path, type, message) {
  req.session.flash = { type, message };
  req.session.save(() => res.redirect(path));
}

// Ruta para mostrar la vista de registro
app.get('/register', (req, res) => {
  res.render('register');
});

// Ruta para manejar el registro de usuario
app.post('/register', async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim();
    const password = req.body.password || '';
    if (!name || !email || !password) {
      return flashRedirect(req, res, '/register', 'warning', 'Completa todos los campos para registrarte.');
    }
    if (password.length < 6) {
      return flashRedirect(req, res, '/register', 'warning', 'La contraseña debe tener al menos 6 caracteres.');
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (name, email, password) VALUES ($1, $2, $3)', [name, email, hashedPassword]);
    flashRedirect(req, res, '/login', 'success', 'Cuenta creada. Ya puedes iniciar sesión.');
  } catch (err) {
    console.error(err.message);
    const duplicate = err.code === '23505';
    flashRedirect(
      req,
      res,
      '/register',
      'error',
      duplicate ? 'Ese correo ya está registrado.' : 'No se pudo registrar. Intenta de nuevo.'
    );
  }
});

// Ruta para mostrar la vista de login
app.get('/login', (req, res) => {
  res.render('login');
});

// Ruta para manejar el inicio de sesión
app.post('/login', async (req, res) => {
  try {
    const email = (req.body.email || '').trim();
    const password = req.body.password || '';
    if (!email || !password) {
      return flashRedirect(req, res, '/login', 'warning', 'Ingresa correo y contraseña.');
    }
    const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (user.rows.length > 0) {
      const validPassword = await bcrypt.compare(password, user.rows[0].password);
      if (validPassword) {
        req.session.userId = user.rows[0].id;
        req.session.userName = user.rows[0].name;
        req.session.save(() => res.redirect('/diagrams'));
      } else {
        flashRedirect(req, res, '/login', 'error', 'Credenciales incorrectas.');
      }
    } else {
      flashRedirect(req, res, '/login', 'error', 'No encontramos una cuenta con ese correo.');
    }
  } catch (err) {
    console.error(err.message);
    flashRedirect(req, res, '/login', 'error', 'Error al iniciar sesión. Revisa la conexión con la base de datos.');
  }
});

// Ruta para cerrar sesión
app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// Rutas de diagramas / salas colaborativas
app.use('/', roomsRouter);

// Rutas de IA (transcripción de voz)
app.use('/', voiceRouter);

// Sockets de colaboración en tiempo real
attachSockets(io, sessionMiddleware);

// Servidor en el puerto 3001
const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
