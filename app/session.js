// session.js
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const pool = require('./db');

const sessionMiddleware = session({
  store: new pgSession({
    pool,
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || 'diagramador-uml-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 días
  },
});

module.exports = sessionMiddleware;
