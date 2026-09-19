// middleware/auth.js
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    req.session.flash = { type: 'warning', message: 'Inicia sesión para continuar.' };
    return req.session.save(() => res.redirect('/login'));
  }
  next();
}

module.exports = { requireAuth };
