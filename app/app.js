// index.js
const express = require('express');
const pool = require('./db');
const bcrypt = require('bcrypt');
const app = express();

// Configurar EJS como motor de vistas
app.set('view engine', 'ejs');

// Servir archivos estáticos (CSS, imágenes, etc.)
app.use(express.static('public'));

// Middleware para manejar JSON y formularios
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
        res.redirect('/home'); // Redirigir a la vista principal si el login es exitoso
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

// Ruta de home (después de login exitoso)
app.get('/home', (req, res) => {
  res.render('home');
});

// Servidor en el puerto 3000
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
