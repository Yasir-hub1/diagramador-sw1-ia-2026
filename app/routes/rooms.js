// routes/rooms.js
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const diagramsRepository = require('../repositories/diagramsRepository');

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

module.exports = router;
