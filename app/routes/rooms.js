// routes/rooms.js
const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const diagramsRepository = require('../repositories/diagramsRepository');
const { exportToXmi } = require('../xmi/exportXmi');
const { importFromXmi } = require('../xmi/importXmi');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const router = express.Router();

router.get('/diagrams', requireAuth, async (req, res) => {
  try {
    const diagrams = await diagramsRepository.findAccessibleByUser(req.session.userId);
    res.render('diagrams', { diagrams, userName: req.session.userName });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Error al cargar los diagramas');
  }
});

router.post('/diagrams', requireAuth, async (req, res) => {
  try {
    const name = (req.body.name || '').trim() || 'Diagrama sin título';
    const diagram = await diagramsRepository.create(name, req.session.userId);
    res.redirect('/room/' + diagram.share_token);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Error al crear el diagrama');
  }
});

router.post('/diagrams/import', requireAuth, upload.single('xmiFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No se recibió ningún archivo XMI');
  }
  try {
    const graphData = importFromXmi(req.file.buffer.toString('utf8'));
    const name = (req.body.name || '').trim() || req.file.originalname.replace(/\.[^.]+$/, '') || 'Diagrama importado';
    const diagram = await diagramsRepository.create(name, req.session.userId);
    await diagramsRepository.updateGraphData(diagram.id, graphData);
    res.redirect('/room/' + diagram.share_token);
  } catch (err) {
    console.error(err.message);
    res.status(400).send('No se pudo importar el archivo XMI: ' + err.message);
  }
});

router.get('/room/:token', requireAuth, async (req, res) => {
  try {
    const diagram = await diagramsRepository.findByToken(req.params.token);
    if (!diagram) {
      return res.status(404).send('Sala no encontrada');
    }
    await diagramsRepository.upsertCollaborator(diagram.id, req.session.userId);
    res.render('room', {
      diagramId: diagram.id,
      diagramName: diagram.name,
      shareToken: diagram.share_token,
      userId: req.session.userId,
      userName: req.session.userName,
      graphData: diagram.graph_data,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Error al abrir la sala');
  }
});

router.get('/room/:token/export.xmi', requireAuth, async (req, res) => {
  try {
    const diagram = await diagramsRepository.findByToken(req.params.token);
    if (!diagram) {
      return res.status(404).send('Sala no encontrada');
    }
    const xml = exportToXmi(diagram.graph_data, diagram.name);
    const filename = (diagram.name || 'diagrama').replace(/[^\w\-]+/g, '_') + '.xmi';
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(xml);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Error al exportar el diagrama');
  }
});

module.exports = router;
