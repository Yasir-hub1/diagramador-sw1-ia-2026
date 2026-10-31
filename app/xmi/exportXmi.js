// xmi/exportXmi.js
// Genera un documento XMI 2.1 (estándar UML) a partir del JSON interno
// del diagrama (el mismo que se persiste en diagrams.graph_data).
const validators = require('../../public/uml-validators');

function escapeXml(str) {
  return String(str || '').replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  }[c]));
}

function visibilityWord(symbol) {
  return { '+': 'public', '-': 'private', '#': 'protected', '~': 'package' }[symbol] || 'public';
}

function parseAttribute(line) {
  const match = line.match(validators.ATTRIBUTE_RE);
  if (!match) return null;
  return { visibility: visibilityWord(match[1]), name: match[2], type: match[3].trim() };
}

function parseMethod(line) {
  const match = line.match(validators.METHOD_RE);
  if (!match) return null;
  const params = match[3]
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const [name, type] = p.split(':').map((s) => s.trim());
      return { name, type: type || 'any' };
    });
  return { visibility: visibilityWord(match[1]), name: match[2], params, returnType: match[4].trim() };
}

const RELATION_XMI_TYPE = {
  association: 'uml:Association',
  aggregation: 'uml:Association',
  composition: 'uml:Association',
  inheritance: 'uml:Generalization',
  realization: 'uml:Realization',
  dependency: 'uml:Dependency',
};

function classDisplayId(id) {
  return escapeXml(id);
}

function primitiveHref(type) {
  const name = String(type || 'String');
  return 'http://schema.omg.org/spec/UML/2.1/uml.xml#' + escapeXml(name);
}

function linkName(link) {
  return String(link.umlName || link.name || '').trim();
}

function exportToXmi(graphData, diagramName) {
  const cells = (graphData && graphData.cells) || [];
  const classes = cells.filter((c) => c.type === 'uml.Class');
  const links = cells.filter((c) => c.type === 'standard.Link');
  const classById = {};
  classes.forEach((c) => (classById[c.id] = c));

  const generalizationsByChild = {};
  links.forEach((link) => {
    if ((link.umlType || 'association') !== 'inheritance') return;
    const childId = link.source && link.source.id;
    const parentId = link.target && link.target.id;
    if (!classById[childId] || !classById[parentId]) return;
    if (!generalizationsByChild[childId]) generalizationsByChild[childId] = [];
    generalizationsByChild[childId].push(link);
  });

  const classXml = classes
    .map((cls) => {
      const stereotype = cls.umlStereotype || 'none';
      const xmiType = stereotype === 'interface' ? 'uml:Interface' : 'uml:Class';
      const abstractAttr = stereotype === 'abstract' ? ' isAbstract="true"' : '';
      const attrs = (cls.umlAttributes || cls.attributes || [])
        .map(parseAttribute)
        .filter(Boolean)
        .map(
          (a) =>
            `      <ownedAttribute xmi:id="${classDisplayId(cls.id)}_attr_${escapeXml(a.name)}" name="${escapeXml(a.name)}" visibility="${a.visibility}">\n        <type xmi:type="uml:PrimitiveType" href="${primitiveHref(a.type)}"/>\n      </ownedAttribute>`
        )
        .join('\n');
      const methods = (cls.umlMethods || cls.methods || [])
        .map(parseMethod)
        .filter(Boolean)
        .map((m) => {
          const paramsXml = m.params
            .map((p) => `        <ownedParameter name="${escapeXml(p.name)}" direction="in" type="${escapeXml(p.type)}"/>`)
            .join('\n');
          return [
            `      <ownedOperation xmi:id="${classDisplayId(cls.id)}_op_${escapeXml(m.name)}" name="${escapeXml(m.name)}" visibility="${m.visibility}">`,
            paramsXml,
            `        <ownedParameter name="return" direction="return">\n          <type xmi:type="uml:PrimitiveType" href="${primitiveHref(m.returnType)}"/>\n        </ownedParameter>`,
            `      </ownedOperation>`,
          ]
            .filter(Boolean)
            .join('\n');
        })
        .join('\n');
      return [
        `    <packagedElement xmi:type="${xmiType}" xmi:id="${classDisplayId(cls.id)}" name="${escapeXml(cls.umlName || cls.name)}"${abstractAttr}>`,
        attrs,
        methods,
        (generalizationsByChild[cls.id] || [])
          .map(
            (link) =>
              `      <generalization xmi:type="uml:Generalization" xmi:id="${escapeXml(link.id)}" general="${classDisplayId(link.target.id)}"/>`
          )
          .join('\n'),
        `    </packagedElement>`,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  const relationXml = links
    .map((link) => {
      const type = link.umlType || 'association';
      const xmiType = RELATION_XMI_TYPE[type] || 'uml:Association';
      const sourceId = link.source && link.source.id;
      const targetId = link.target && link.target.id;
      if (!classById[sourceId] || !classById[targetId]) return '';

      const labels = link.labels || [];
      const sourceMultiplicity = labels[0] && labels[0].attrs && labels[0].attrs.text && labels[0].attrs.text.text;
      const targetMultiplicity = labels[1] && labels[1].attrs && labels[1].attrs.text && labels[1].attrs.text.text;

      if (xmiType === 'uml:Generalization') return '';
      if (xmiType === 'uml:Realization' || xmiType === 'uml:Dependency') {
        return `    <packagedElement xmi:type="${xmiType}" xmi:id="${escapeXml(link.id)}" client="${classDisplayId(sourceId)}" supplier="${classDisplayId(targetId)}"/>`;
      }

      const aggregationKind = type === 'composition' ? 'composite' : type === 'aggregation' ? 'shared' : 'none';
      return [
        `    <packagedElement xmi:type="uml:Association" xmi:id="${escapeXml(link.id)}" name="${escapeXml(linkName(link) || type)}">`,
        `      <ownedEnd xmi:id="${escapeXml(link.id)}_end1" type="${classDisplayId(sourceId)}" aggregation="none">`,
        sourceMultiplicity ? `        <lowerValue xmi:type="uml:LiteralString" value="${escapeXml(sourceMultiplicity)}"/>` : '',
        `      </ownedEnd>`,
        `      <ownedEnd xmi:id="${escapeXml(link.id)}_end2" type="${classDisplayId(targetId)}" aggregation="${aggregationKind}">`,
        targetMultiplicity ? `        <lowerValue xmi:type="uml:LiteralString" value="${escapeXml(targetMultiplicity)}"/>` : '',
        `      </ownedEnd>`,
        `    </packagedElement>`,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .filter(Boolean)
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<xmi:XMI xmi:version="2.1" xmlns:xmi="http://schema.omg.org/spec/XMI/2.1" xmlns:uml="http://schema.omg.org/spec/UML/2.1">',
    `  <uml:Model xmi:id="model_1" name="${escapeXml(diagramName || 'Diagrama')}">`,
    classXml,
    relationXml,
    '  </uml:Model>',
    '</xmi:XMI>',
    '',
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

module.exports = { exportToXmi };
