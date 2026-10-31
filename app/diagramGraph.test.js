const test = require('node:test');
const assert = require('node:assert/strict');
const {
  asGraph,
  addClassCell,
  updateClassCell,
  removeCell,
  addLinkCell,
  updateLinkCell,
} = require('./diagramGraph');

test('persists a class rename so a later join sees it', () => {
  const graph = addClassCell(asGraph({ cells: [] }), {
    elementId: 'c1',
    name: 'Person',
    stereotype: 'none',
    attributes: ['- id: Long'],
    methods: [],
  });
  updateClassCell(graph, { elementId: 'c1', patch: { name: 'Persona' } });
  const cell = graph.cells.find((item) => item.id === 'c1');
  assert.equal(cell.umlName, 'Persona');
  assert.match(cell.name, /Persona/);
});

test('adds and names an association without dropping the rest of the graph', () => {
  let graph = addClassCell(asGraph({ cells: [] }), { elementId: 'a', name: 'A', attributes: [], methods: [] });
  graph = addClassCell(graph, { elementId: 'b', name: 'B', attributes: [], methods: [] });
  graph = addLinkCell(graph, {
    linkId: 'l1',
    type: 'inheritance',
    sourceId: 'b',
    targetId: 'a',
  });
  graph = addLinkCell(graph, {
    linkId: 'l2',
    type: 'association',
    sourceId: 'a',
    targetId: 'b',
    sourceMultiplicity: '1',
    targetMultiplicity: '0..*',
    umlName: 'tutorDe',
  });
  updateLinkCell(graph, { linkId: 'l2', patch: { umlName: 'inscritoEn' } });
  assert.equal(graph.cells.length, 4);
  assert.equal(graph.cells.find((item) => item.id === 'l2').umlName, 'inscritoEn');
  assert.equal(graph.cells.find((item) => item.id === 'l1').umlType, 'inheritance');
});

test('refuses to update a class that is not in the persisted graph', () => {
  const graph = addClassCell(asGraph({ cells: [] }), { elementId: 'c1', name: 'Persona', attributes: [], methods: [] });
  assert.throws(() => updateClassCell(graph, { elementId: 'missing', patch: { name: 'Curso' } }));
});

test('removing a class also drops its links', () => {
  let graph = addClassCell(asGraph({ cells: [] }), { elementId: 'a', name: 'A', attributes: [], methods: [] });
  graph = addClassCell(graph, { elementId: 'b', name: 'B', attributes: [], methods: [] });
  graph = addLinkCell(graph, { linkId: 'l1', type: 'association', sourceId: 'a', targetId: 'b' });
  removeCell(graph, 'a');
  assert.equal(graph.cells.length, 1);
  assert.equal(graph.cells[0].id, 'b');
});
