const test = require('node:test');
const assert = require('node:assert/strict');
const { exportToXmi } = require('./exportXmi');
const { importFromXmi } = require('./importXmi');
const { addressReply } = require('../ai/createProposal');

function sampleGraph() {
  return {
    cells: [
      {
        id: 'person',
        type: 'uml.Class',
        umlName: 'Persona',
        umlStereotype: 'none',
        umlAttributes: ['- id: Long', '+ nivel: Integer'],
        umlMethods: [],
        position: { x: 40, y: 40 },
      },
      {
        id: 'student',
        type: 'uml.Class',
        umlName: 'Estudiante',
        umlStereotype: 'none',
        umlAttributes: ['- id: Long'],
        umlMethods: [],
        position: { x: 320, y: 40 },
      },
      {
        id: 'gen1',
        type: 'standard.Link',
        umlType: 'inheritance',
        source: { id: 'student' },
        target: { id: 'person' },
        labels: [],
      },
      {
        id: 'rel1',
        type: 'standard.Link',
        umlType: 'association',
        umlName: 'tutorDe',
        source: { id: 'person' },
        target: { id: 'student' },
        labels: [
          { attrs: { text: { text: '1' } } },
          { attrs: { text: { text: '0..*' } } },
        ],
      },
    ],
  };
}

test('exports nested generalization, primitive types and association names', () => {
  const xml = exportToXmi(sampleGraph(), 'Personas');
  assert.match(xml, /<generalization /);
  assert.match(xml, /uml\.xml#Integer/);
  assert.match(xml, /name="tutorDe"/);
  assert.doesNotMatch(xml, /xmi:type="uml:Generalization" xmi:id="gen1" general="person" specific="student"/);
});

test('imports nested generalization and association names back to the canvas model', () => {
  const imported = importFromXmi(exportToXmi(sampleGraph(), 'Personas'));
  const names = imported.cells.filter((cell) => cell.type === 'uml.Class').map((cell) => cell.umlName).sort();
  assert.deepEqual(names, ['Estudiante', 'Persona']);
  const inheritance = imported.cells.find((cell) => cell.umlType === 'inheritance');
  const association = imported.cells.find((cell) => cell.umlType === 'association');
  assert.ok(inheritance);
  assert.equal(association.umlName, 'tutorDe');
  const person = imported.cells.find((cell) => cell.umlName === 'Persona');
  assert.match(person.attributes.join(' '), /Integer/);
});

test('addresses the person who asked the AI', () => {
  assert.equal(addressReply('Ana', 'Revisé los tipos.'), 'Para Ana: Revisé los tipos.');
  assert.equal(addressReply('Ana', 'Para Ana: ya está.'), 'Para Ana: ya está.');
});
