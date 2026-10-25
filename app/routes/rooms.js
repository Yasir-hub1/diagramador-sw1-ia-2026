// routes/rooms.js
const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const diagramsRepository = require('../repositories/diagramsRepository');
const { exportToXmi } = require('../xmi/exportXmi');
const { importFromXmi } = require('../xmi/importXmi');
const { maxImageBytes } = require('../ai/imageFile');
const { diagramProvider } = require('../ai/settings');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const router = express.Router();

function flashRedirect(req, res, path, type, message) {
  req.session.flash = { type, message };
  req.session.save(() => res.redirect(path));
}

router.get('/diagrams', requireAuth, async (req, res) => {
  try {
    const diagrams = await diagramsRepository.findAccessibleByUser(req.session.userId);
    res.render('diagrams', { diagrams, userName: req.session.userName });
  } catch (err) {
    console.error(err.message);
    res.status(500).render('diagrams', {
      diagrams: [],
      userName: req.session.userName,
      flash: { type: 'error', message: 'No se pudieron cargar los diagramas. Revisa la conexión con la base de datos.' },
    });
  }
});

router.post('/diagrams', requireAuth, async (req, res) => {
  try {
    const name = (req.body.name || '').trim() || 'Diagrama sin título';
    const diagram = await diagramsRepository.create(name, req.session.userId);
    req.session.flash = { type: 'success', message: 'Sala creada.' };
    req.session.save(() => res.redirect('/room/' + diagram.share_token));
  } catch (err) {
    console.error(err.message);
    flashRedirect(req, res, '/diagrams', 'error', 'No se pudo crear el diagrama.');
  }
});

router.post('/diagrams/import', requireAuth, upload.single('xmiFile'), async (req, res) => {
  if (!req.file) {
    return flashRedirect(req, res, '/diagrams', 'warning', 'Selecciona un archivo XMI para importar.');
  }
  try {
    const graphData = importFromXmi(req.file.buffer.toString('utf8'));
    const name = (req.body.name || '').trim() || req.file.originalname.replace(/\.[^.]+$/, '') || 'Diagrama importado';
    const diagram = await diagramsRepository.create(name, req.session.userId);
    await diagramsRepository.updateGraphData(diagram.id, graphData);
    req.session.flash = { type: 'success', message: 'XMI importado correctamente.' };
    req.session.save(() => res.redirect('/room/' + diagram.share_token));
  } catch (err) {
    console.error(err.message);
    flashRedirect(req, res, '/diagrams', 'error', 'No se pudo importar el XMI: ' + err.message);
  }
});

router.get('/room/:token', requireAuth, async (req, res) => {
  try {
    const diagram = await diagramsRepository.findByToken(req.params.token);
    if (!diagram) {
      return flashRedirect(req, res, '/diagrams', 'error', 'Sala no encontrada.');
    }
    await diagramsRepository.upsertCollaborator(diagram.id, req.session.userId);
    res.render('room', {
      diagramId: diagram.id,
      diagramName: diagram.name,
      shareToken: diagram.share_token,
      userId: req.session.userId,
      userName: req.session.userName,
      graphData: diagram.graph_data,
      aiMaxImageBytes: maxImageBytes(),
      aiProvider: diagramProvider(),
    });
  } catch (err) {
    console.error(err.message);
    flashRedirect(req, res, '/diagrams', 'error', 'No se pudo abrir la sala. Revisa la conexión con la base de datos.');
  }
});

router.get('/room/:token/export.xmi', requireAuth, async (req, res) => {
  try {
    const diagram = await diagramsRepository.findByToken(req.params.token);
    if (!diagram) {
      return flashRedirect(req, res, '/diagrams', 'error', 'Sala no encontrada.');
    }
    const xml = exportToXmi(diagram.graph_data, diagram.name);
    const filename = (diagram.name || 'diagrama').replace(/[^\w\-]+/g, '_') + '.xmi';
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(xml);
  } catch (err) {
    console.error(err.message);
    flashRedirect(req, res, '/diagrams', 'error', 'No se pudo exportar el diagrama.');
  }
});

module.exports = router;
