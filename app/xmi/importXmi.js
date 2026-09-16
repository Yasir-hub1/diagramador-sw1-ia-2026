// xmi/importXmi.js
// Convierte un documento XMI 2.1 (con las convenciones que produce
// exportXmi.js) de vuelta a la forma interna de celdas que el cliente
// consume directamente en graph.fromJSON(...). No depende de joint.js en
// el servidor: se construye a mano el mismo shape que produce
// public/room.js al crear clases/relaciones.
const { XMLParser } = require('fast-xml-parser');

const VISIBILITY_SYMBOL = { public: '+', private: '-', protected: '#', package: '~' };

const CLASS_ATTRS = {
  '.uml-class-name-rect': { fill: '#FFFFE0', stroke: '#000000', 'stroke-width': 1, rx: 0, ry: 0 },
  '.uml-class-attrs-rect': { fill: '#FFFFE0', stroke: '#000000', 'stroke-width': 1, rx: 0, ry: 0 },
  '.uml-class-methods-rect': { fill: '#FFFFE0', stroke: '#000000', 'stroke-width': 1, rx: 0, ry: 0 },
  '.uml-class-name-text': {
    'font-family': 'Arial', 'font-size': 14, 'font-weight': 'bold',
    fill: '#000000', 'text-anchor': 'middle', 'ref-x': 0.5, 'ref-y': 0.5, 'y-alignment': 'middle',
  },
  '.uml-class-attrs-text': { 'font-family': 'Arial', 'font-size': 12, fill: '#000000', 'text-anchor': 'start', 'ref-x': 10, 'ref-y': 5 },
  '.uml-class-methods-text': { 'font-family': 'Arial', 'font-size': 12, fill: '#000000', 'text-anchor': 'start', 'ref-x': 10, 'ref-y': 5 },
};

const LINK_STYLES = {
  association: { line: { stroke: '#000000', strokeWidth: 2, targetMarker: { type: 'none' } } },
  dependency: { line: { strokeDasharray: '5 5', targetMarker: { type: 'path', d: 'M 10 -5 0 0 10 5 Z', fill: 'white', stroke: 'black' } } },
  aggregation: { line: { sourceMarker: { type: 'path', d: 'M 10 0 L 5 -5 L 0 0 L 5 5 Z', fill: 'white' } } },
  composition: { line: { sourceMarker: { type: 'path', d: 'M 10 0 L 5 -5 L 0 0 L 5 5 Z', fill: 'black' } } },
  inheritance: { line: { targetMarker: { type: 'path', d: 'M 10 -5 0 0 10 5 Z', fill: 'white' } } },
  realization: { line: { strokeDasharray: '5 5', targetMarker: { type: 'path', d: 'M 10 -5 0 0 10 5 Z', fill: 'white' } } },
};

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function classDisplayName(name, stereotype) {
  const tag = { interface: '«interface»', abstract: '«abstract»', none: '' }[stereotype] || '';
  return tag ? tag + '\n' + name : name;
}

function generateId(prefix) {
  return prefix + '_' + Math.random().toString(36).substr(2, 9);
}

function buildAttributeLine(ownedAttribute) {
  const visibility = VISIBILITY_SYMBOL[ownedAttribute['@_visibility']] || '+';
  const name = ownedAttribute['@_name'];
  const type = ownedAttribute['@_type'] || 'string';
  if (!name) return null;
  return `${visibility} ${name}: ${type}`;
}

function buildMethodLine(ownedOperation) {
  const visibility = VISIBILITY_SYMBOL[ownedOperation['@_visibility']] || '+';
  const name = ownedOperation['@_name'];
  if (!name) return null;
  const params = asArray(ownedOperation.ownedParameter).filter((p) => p['@_direction'] !== 'return');
  const returnParam = asArray(ownedOperation.ownedParameter).find((p) => p['@_direction'] === 'return');
  const paramsStr = params.map((p) => `${p['@_name']}: ${p['@_type'] || 'any'}`).join(', ');
  const returnType = (returnParam && returnParam['@_type']) || 'void';
  return `${visibility} ${name}(${paramsStr}): ${returnType}`;
}

function importFromXmi(xmlString) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const doc = parser.parse(xmlString);
  const model = doc['xmi:XMI'] && doc['xmi:XMI']['uml:Model'];
  if (!model) throw new Error('El archivo no tiene un uml:Model válido');

  const elements = asArray(model.packagedElement);
  const cells = [];
  const idMap = {}; // xmi:id original -> id interno (por si hay colisiones de formato)

  let x = 80;
  let y = 60;

  elements.forEach((el) => {
    const xmiType = el['@_xmi:type'];
    if (xmiType === 'uml:Class' || xmiType === 'uml:Interface') {
      const originalId = el['@_xmi:id'];
      const elementId = generateId('class');
      idMap[originalId] = elementId;

      const stereotype = xmiType === 'uml:Interface' ? 'interface' : el['@_isAbstract'] === 'true' ? 'abstract' : 'none';
      const name = el['@_name'] || 'Clase';
      const attributes = asArray(el.ownedAttribute).map(buildAttributeLine).filter(Boolean);
      const methods = asArray(el.ownedOperation).map(buildMethodLine).filter(Boolean);

      cells.push({
        id: elementId,
        type: 'uml.Class',
        position: { x, y },
        size: { width: 250, height: 150 },
        name: classDisplayName(name, stereotype),
        attributes,
        methods,
        umlName: name,
        umlStereotype: stereotype,
        umlAttributes: attributes,
        umlMethods: methods,
        attrs: CLASS_ATTRS,
      });

      x += 280;
      if (x > 1400) {
        x = 80;
        y += 220;
      }
    }
  });

  elements.forEach((el) => {
    const xmiType = el['@_xmi:type'];
    let type = null;
    let sourceOriginalId = null;
    let targetOriginalId = null;
    let sourceMultiplicity;
    let targetMultiplicity;

    if (xmiType === 'uml:Generalization') {
      type = 'inheritance';
      sourceOriginalId = el['@_specific'];
      targetOriginalId = el['@_general'];
    } else if (xmiType === 'uml:Realization') {
      type = 'realization';
      sourceOriginalId = el['@_client'];
      targetOriginalId = el['@_supplier'];
    } else if (xmiType === 'uml:Dependency') {
      type = 'dependency';
      sourceOriginalId = el['@_client'];
      targetOriginalId = el['@_supplier'];
    } else if (xmiType === 'uml:Association') {
      const ends = asArray(el.ownedEnd);
      if (ends.length >= 2) {
        sourceOriginalId = ends[0]['@_type'];
        targetOriginalId = ends[1]['@_type'];
        const aggregation = ends[1]['@_aggregation'];
        type = aggregation === 'composite' ? 'composition' : aggregation === 'shared' ? 'aggregation' : 'association';
        sourceMultiplicity = ends[0].lowerValue && ends[0].lowerValue['@_value'];
        targetMultiplicity = ends[1].lowerValue && ends[1].lowerValue['@_value'];
      }
    }

    if (!type) return;
    const sourceId = idMap[sourceOriginalId];
    const targetId = idMap[targetOriginalId];
    if (!sourceId || !targetId) return;

    const linkId = generateId('link');
    const labels = [];
    if (sourceMultiplicity) labels[0] = { position: 0.1, attrs: { text: { text: sourceMultiplicity, 'font-size': 12, 'font-family': 'Arial' } } };
    if (targetMultiplicity) labels[1] = { position: 0.9, attrs: { text: { text: targetMultiplicity, 'font-size': 12, 'font-family': 'Arial' } } };

    cells.push({
      id: linkId,
      type: 'standard.Link',
      source: { id: sourceId },
      target: { id: targetId },
      attrs: LINK_STYLES[type] || LINK_STYLES.association,
      labels: labels.filter(Boolean),
      umlType: type,
    });
  });

  return { cells };
}

module.exports = { importFromXmi };
