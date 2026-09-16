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

// Ruta para mostrar la vista de registro
app.get('/register', (req, res) => {
  res.render('register');
});

// Ruta para manejar el registro de usuario
app.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10); // Hash de la contraseña
    await pool.query('INSERT INTO users (name, email, password) VALUES ($1, $2, $3)', [name, email, hashedPassword]);
    res.redirect('/login'); // Redirigir al login después del registro exitoso
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Error al registrar el usuario');
  }
});

// Ruta para mostrar la vista de login
app.get('/login', (req, res) => {
  res.render('login');
});

// Ruta para manejar el inicio de sesión
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (user.rows.length > 0) {
      const validPassword = await bcrypt.compare(password, user.rows[0].password);
      if (validPassword) {
        req.session.userId = user.rows[0].id;
        req.session.userName = user.rows[0].name;
        req.session.save(() => res.redirect('/diagrams'));
      } else {
        res.status(401).send('Credenciales incorrectas');
      }
    } else {
      res.status(401).send('Usuario no encontrado');
    }
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Error al iniciar sesión');
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
