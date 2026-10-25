// middleware/auth.js
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    req.session.flash = { type: 'warning', message: 'Inicia sesión para continuar.' };
    return req.session.save(() => res.redirect('/login'));
  }
  next();
}

function requireApiAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Inicia sesión para usar la IA.' });
  }
  next();
}

module.exports = { requireAuth, requireApiAuth };
