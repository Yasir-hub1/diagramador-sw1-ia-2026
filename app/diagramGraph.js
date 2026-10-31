const diagramsRepository = require('./repositories/diagramsRepository');

const writesByDiagram = new Map();

function parseGraph(graphData) {
  if (!graphData) return { cells: [], revision: 0 };
  if (typeof graphData === 'string') {
    try {
      return parseGraph(JSON.parse(graphData));
    } catch (_error) {
      return { cells: [], revision: 0 };
    }
  }
  const cells = Array.isArray(graphData.cells) ? graphData.cells.map((cell) => ({ ...cell })) : [];
  return { cells, revision: Number(graphData.revision) || 0 };
}

function classDisplayName(name, stereotype) {
  const tag = { interface: '«interface»', abstract: '«abstract»' }[stereotype] || '';
  return tag ? tag + '\n' + name : name;
}

function enqueueWrite(diagramId, work) {
  const previous = writesByDiagram.get(diagramId) || Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  writesByDiagram.set(diagramId, next);
  return next;
}

function findCell(graph, id) {
  const wanted = String(id);
  return graph.cells.find((cell) => cell && String(cell.id) === wanted);
}

function addClassCell(graph, data) {
  if (findCell(graph, data.elementId)) return graph;
  const stereotype = data.stereotype || 'none';
  graph.cells.push({
    id: data.elementId,
    type: 'uml.Class',
    position: data.position || { x: 100, y: 50 },
    size: { width: 250, height: 150 },
    name: classDisplayName(data.name, stereotype),
    attributes: data.attributes || [],
    methods: data.methods || [],
    umlName: data.name,
    umlStereotype: stereotype,
    umlAttributes: data.attributes || [],
    umlMethods: data.methods || [],
  });
  return graph;
}

function updateClassCell(graph, data) {
  const cell = findCell(graph, data.elementId);
  if (!cell) {
    const error = new Error('No está esa clase en el diagrama persistido.');
    error.code = 'CELL_NOT_FOUND';
    throw error;
  }
  const patch = data.patch || {};
  if (patch.name !== undefined || patch.stereotype !== undefined) {
    const name = patch.name !== undefined ? patch.name : cell.umlName;
    const stereotype = patch.stereotype !== undefined ? patch.stereotype : cell.umlStereotype;
    cell.umlName = name;
    cell.umlStereotype = stereotype;
    cell.name = classDisplayName(name, stereotype);
  }
  if (patch.attributes !== undefined) {
    cell.attributes = patch.attributes;
    cell.umlAttributes = patch.attributes;
  }
  if (patch.methods !== undefined) {
    cell.methods = patch.methods;
    cell.umlMethods = patch.methods;
  }
  if (patch.position !== undefined) cell.position = patch.position;
  return graph;
}

function removeCell(graph, id) {
  const before = graph.cells.length;
  graph.cells = graph.cells.filter((cell) => String(cell.id) !== String(id));
  graph.cells = graph.cells.filter((cell) => {
    if (cell.type !== 'standard.Link') return true;
    const sourceId = cell.source && cell.source.id;
    const targetId = cell.target && cell.target.id;
    return String(sourceId) !== String(id) && String(targetId) !== String(id);
  });
  if (graph.cells.length === before) {
    const error = new Error('No está esa celda en el diagrama persistido.');
    error.code = 'CELL_NOT_FOUND';
    throw error;
  }
  return graph;
}

function addLinkCell(graph, data) {
  if (findCell(graph, data.linkId)) return graph;
  const labels = [];
  if (data.sourceMultiplicity) {
    labels[0] = { position: { distance: 0.18, offset: 16 }, attrs: { text: { text: data.sourceMultiplicity } } };
  }
  if (data.targetMultiplicity) {
    labels[1] = { position: { distance: 0.82, offset: 16 }, attrs: { text: { text: data.targetMultiplicity } } };
  }
  if (data.umlName) {
    labels[2] = { position: 0.5, attrs: { text: { text: data.umlName } } };
  }
  graph.cells.push({
    id: data.linkId,
    type: 'standard.Link',
    source: { id: data.sourceId },
    target: { id: data.targetId },
    labels: labels.filter(Boolean),
    umlType: data.type,
    umlName: data.umlName || '',
  });
  return graph;
}

function updateLinkCell(graph, data) {
  const cell = findCell(graph, data.linkId);
  if (!cell) {
    const error = new Error('No está esa relación en el diagrama persistido.');
    error.code = 'CELL_NOT_FOUND';
    throw error;
  }
  const patch = data.patch || {};
  if (!Array.isArray(cell.labels)) cell.labels = [];
  if (patch.sourceMultiplicity !== undefined) {
    cell.labels[0] = { position: { distance: 0.18, offset: 16 }, attrs: { text: { text: patch.sourceMultiplicity } } };
  }
  if (patch.targetMultiplicity !== undefined) {
    cell.labels[1] = { position: { distance: 0.82, offset: 16 }, attrs: { text: { text: patch.targetMultiplicity } } };
  }
  if (patch.umlName !== undefined) {
    cell.umlName = patch.umlName;
    cell.labels[2] = { position: 0.5, attrs: { text: { text: patch.umlName } } };
  }
  return graph;
}

function bumpRevision(graph) {
  graph.revision = (Number(graph.revision) || 0) + 1;
  return graph;
}

async function replaceGraph(diagramId, graphJson) {
  if (!diagramId) return { ok: false, rejected: true, graphJson: null };
  return enqueueWrite(diagramId, async () => {
    const diagram = await diagramsRepository.findById(diagramId);
    if (!diagram) return { ok: false, rejected: true, graphJson: null };
    const stored = parseGraph(diagram.graph_data);
    const incoming = parseGraph(graphJson);
    if (incoming.revision < stored.revision) {
      return { ok: false, rejected: true, graphJson: stored };
    }
    incoming.revision = stored.revision;
    await diagramsRepository.updateGraphData(diagramId, incoming);
    return { ok: true, graphJson: incoming };
  });
}

async function persistMutation(diagramId, mutate) {
  if (!diagramId) {
    const error = new Error('La sala no tiene diagrama persistible.');
    error.code = 'NO_DIAGRAM';
    throw error;
  }
  return enqueueWrite(diagramId, async () => {
    const diagram = await diagramsRepository.findById(diagramId);
    if (!diagram) {
      const error = new Error('No se encontró el diagrama.');
      error.code = 'NO_DIAGRAM';
      throw error;
    }
    const next = bumpRevision(mutate(parseGraph(diagram.graph_data)));
    await diagramsRepository.updateGraphData(diagramId, next);
    return next;
  });
}

module.exports = {
  parseGraph,
  asGraph: parseGraph,
  addClassCell,
  updateClassCell,
  removeCell,
  addLinkCell,
  updateLinkCell,
  persistMutation,
  replaceGraph,
};
