// Huella estable del diagrama. La usan el navegador y el servidor para
// saber si el grafo cambió entre la propuesta de la IA y su confirmación.
(function (root) {
  function asTextList(value) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => String(item));
  }

  function roundedPosition(position) {
    const x = position && Number(position.x);
    const y = position && Number(position.y);
    return {
      x: Number.isFinite(x) ? Math.round(x) : 0,
      y: Number.isFinite(y) ? Math.round(y) : 0,
    };
  }

  function labelText(cell, index) {
    const labels = Array.isArray(cell.labels) ? cell.labels : [];
    const label = labels[index];
    const text = label && label.attrs && label.attrs.text && label.attrs.text.text;
    return typeof text === 'string' ? text : '';
  }

  function snapshotFromCells(cells) {
    const classes = [];
    const relations = [];
    (Array.isArray(cells) ? cells : []).forEach((cell) => {
      if (!cell || typeof cell !== 'object' || cell.id === undefined || cell.id === null) return;
      if (cell.type === 'uml.Class') {
        classes.push({
          id: String(cell.id),
          name: String(cell.umlName || ''),
          stereotype: cell.umlStereotype || 'none',
          attributes: asTextList(cell.umlAttributes),
          methods: asTextList(cell.umlMethods),
          position: roundedPosition(cell.position),
        });
        return;
      }
      if (cell.type === 'standard.Link' && cell.umlType && cell.source && cell.source.id && cell.target && cell.target.id) {
        relations.push({
          id: String(cell.id),
          type: String(cell.umlType),
          sourceId: String(cell.source.id),
          targetId: String(cell.target.id),
          sourceMultiplicity: labelText(cell, 0),
          targetMultiplicity: labelText(cell, 1),
        });
      }
    });

    const nameById = {};
    classes.forEach((item) => {
      nameById[item.id] = item.name;
    });
    relations.forEach((item) => {
      item.sourceName = nameById[item.sourceId] || '';
      item.targetName = nameById[item.targetId] || '';
    });
    return { classes, relations };
  }

  function snapshotFromGraph(graphData) {
    return snapshotFromCells(graphData && graphData.cells);
  }

  function fingerprintOf(snapshot) {
    const classes = (snapshot.classes || [])
      .map((item) => ({
        id: item.id,
        name: item.name,
        stereotype: item.stereotype || 'none',
        attributes: item.attributes || [],
        methods: item.methods || [],
        position: item.position || { x: 0, y: 0 },
      }))
      .sort((left, right) => String(left.id).localeCompare(String(right.id)));
    const relations = (snapshot.relations || [])
      .map((item) => ({
        id: item.id,
        type: item.type,
        sourceId: item.sourceId,
        targetId: item.targetId,
        sourceMultiplicity: item.sourceMultiplicity || '',
        targetMultiplicity: item.targetMultiplicity || '',
      }))
      .sort((left, right) => String(left.id).localeCompare(String(right.id)));
    return JSON.stringify({ classes, relations });
  }

  const api = { snapshotFromCells, snapshotFromGraph, fingerprintOf };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.DiagramSnapshot = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
