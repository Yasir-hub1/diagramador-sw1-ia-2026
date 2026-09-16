$(document).ready(function () {
  const V = window.UMLValidators;
  const ROOM = window.ROOM;
  const socket = io();

  const graph = new joint.dia.Graph();
  const paper = new joint.dia.Paper({
    el: $("#diagram"),
    model: graph,
    width: 2000,
    height: 1500,
    gridSize: 10,
    interactive: true,
  });

  // Evita reemitir al servidor cuando estamos aplicando un cambio remoto.
  let applyingRemote = false;

  function generateId(prefix) {
    return prefix + "_" + Math.random().toString(36).substr(2, 9);
  }

  const STEREOTYPE_LABEL = {
    interface: "«interface»",
    abstract: "«abstract»",
    none: "",
  };

  function classDisplayName(name, stereotype) {
    const tag = STEREOTYPE_LABEL[stereotype] || "";
    return tag ? tag + "\n" + name : name;
  }

  // ---------- Creación de elementos (sin emitir al servidor) ----------

  function createClassElement({ elementId, name, stereotype, attributes, methods, position }) {
    const umlClass = new joint.shapes.uml.Class({
      id: elementId,
      position: position || { x: 100, y: 50 },
      size: { width: 250, height: 150 },
      name: classDisplayName(name, stereotype || "none"),
      attributes: attributes || [],
      methods: methods || [],
      attrs: {
        ".uml-class-name-rect": { fill: "#FFFFE0", stroke: "#000000", "stroke-width": 1, rx: 0, ry: 0 },
        ".uml-class-attrs-rect": { fill: "#FFFFE0", stroke: "#000000", "stroke-width": 1, rx: 0, ry: 0 },
        ".uml-class-methods-rect": { fill: "#FFFFE0", stroke: "#000000", "stroke-width": 1, rx: 0, ry: 0 },
        ".uml-class-name-text": {
          "font-family": "Arial", "font-size": 14, "font-weight": "bold",
          fill: "#000000", "text-anchor": "middle", "ref-x": 0.5, "ref-y": 0.5, "y-alignment": "middle",
        },
        ".uml-class-attrs-text": {
          "font-family": "Arial", "font-size": 12, fill: "#000000",
          "text-anchor": "start", "ref-x": 10, "ref-y": 5,
        },
        ".uml-class-methods-text": {
          "font-family": "Arial", "font-size": 12, fill: "#000000",
          "text-anchor": "start", "ref-x": 10, "ref-y": 5,
        },
      },
    });
    umlClass.set("umlName", name);
    umlClass.set("umlStereotype", stereotype || "none");
    umlClass.set("umlAttributes", attributes || []);
    umlClass.set("umlMethods", methods || []);
    graph.addCell(umlClass);
    return umlClass;
  }

  function applyClassPatch(cell, patch) {
    if (patch.name !== undefined || patch.stereotype !== undefined) {
      const name = patch.name !== undefined ? patch.name : cell.get("umlName");
      const stereotype = patch.stereotype !== undefined ? patch.stereotype : cell.get("umlStereotype");
      cell.attr(".uml-class-name-text/text", classDisplayName(name, stereotype));
      cell.set("umlName", name);
      cell.set("umlStereotype", stereotype);
    }
    if (patch.attributes !== undefined) {
      cell.attr(".uml-class-attrs-text/text", patch.attributes.join("\n"));
      cell.set("attributes", patch.attributes);
      cell.set("umlAttributes", patch.attributes);
    }
    if (patch.methods !== undefined) {
      cell.attr(".uml-class-methods-text/text", patch.methods.join("\n"));
      cell.set("methods", patch.methods);
      cell.set("umlMethods", patch.methods);
    }
    if (patch.position !== undefined) {
      cell.position(patch.position.x, patch.position.y);
    }
  }

  const LINK_STYLES = {
    association: { line: { stroke: "#000000", strokeWidth: 2, targetMarker: { type: "none" } } },
    dependency: {
      line: { strokeDasharray: "5 5", targetMarker: { type: "path", d: "M 10 -5 0 0 10 5 Z", fill: "white", stroke: "black" } },
    },
    aggregation: {
      line: { sourceMarker: { type: "path", d: "M 10 0 L 5 -5 L 0 0 L 5 5 Z", fill: "white" } },
    },
    composition: {
      line: { sourceMarker: { type: "path", d: "M 10 0 L 5 -5 L 0 0 L 5 5 Z", fill: "black" } },
    },
    inheritance: {
      line: { targetMarker: { type: "path", d: "M 10 -5 0 0 10 5 Z", fill: "white" } },
    },
    realization: {
      line: { strokeDasharray: "5 5", targetMarker: { type: "path", d: "M 10 -5 0 0 10 5 Z", fill: "white" } },
    },
  };

  function createLinkElement({ linkId, type, sourceId, targetId, sourceMultiplicity, targetMultiplicity }) {
    const link = new joint.shapes.standard.Link({
      id: linkId,
      source: { id: sourceId },
      target: { id: targetId },
      attrs: LINK_STYLES[type] || LINK_STYLES.association,
    });
    link.set("umlType", type);
    if (sourceMultiplicity) {
      link.label(0, { position: 0.1, attrs: { text: { text: sourceMultiplicity, "font-size": 12, "font-family": "Arial" } } });
    }
    if (targetMultiplicity) {
      link.label(1, { position: 0.9, attrs: { text: { text: targetMultiplicity, "font-size": 12, "font-family": "Arial" } } });
    }
    graph.addCell(link);
    return link;
  }

  function applyLinkPatch(link, patch) {
    if (patch.sourceMultiplicity !== undefined) {
      link.label(0, { position: 0.1, attrs: { text: { text: patch.sourceMultiplicity, "font-size": 12, "font-family": "Arial" } } });
    }
    if (patch.targetMultiplicity !== undefined) {
      link.label(1, { position: 0.9, attrs: { text: { text: patch.targetMultiplicity, "font-size": 12, "font-family": "Arial" } } });
    }
  }

  // ---------- Carga inicial del grafo ----------

  if (ROOM.initialGraph && Array.isArray(ROOM.initialGraph.cells) && ROOM.initialGraph.cells.length) {
    applyingRemote = true;
    graph.fromJSON(ROOM.initialGraph);
    applyingRemote = false;
  }

  // ---------- Presencia y actividad ----------

  function renderPresence(users) {
    const $list = $("#presenceList");
    $list.empty();
    users.forEach((u) => $list.append($("<li>").text(u.userName)));
  }

  function showLastEditor(elementId, userName) {
    const cellView = paper.findViewByModel(elementId);
    if (!cellView) return;
    cellView.el.setAttribute("title", "Editado por " + userName);
  }

  // ---------- Socket: eventos entrantes ----------

  socket.on("connect", () => {
    socket.emit("room:join", { shareToken: ROOM.shareToken });
  });

  socket.on("room:state", (data) => {
    renderPresence(data.users || []);
    Object.keys(data.lastEditors || {}).forEach((elementId) => {
      showLastEditor(elementId, data.lastEditors[elementId].userName);
    });
  });

  socket.on("presence:update", (data) => renderPresence(data.users || []));

  socket.on("activity:editor", (data) => showLastEditor(data.elementId, data.userName));

  socket.on("error:validation", (data) => {
    alert("Error: " + data.message);
  });

  socket.on("class:added", (data) => {
    applyingRemote = true;
    if (!graph.getCell(data.elementId)) {
      createClassElement(data);
    }
    applyingRemote = false;
  });

  socket.on("class:updated", (data) => {
    const cell = graph.getCell(data.elementId);
    if (!cell) return;
    applyingRemote = true;
    applyClassPatch(cell, data.patch || {});
    applyingRemote = false;
  });

  socket.on("class:removed", (data) => {
    const cell = graph.getCell(data.elementId);
    if (cell) {
      applyingRemote = true;
      cell.remove();
      applyingRemote = false;
    }
  });

  socket.on("link:added", (data) => {
    applyingRemote = true;
    if (!graph.getCell(data.linkId)) {
      createLinkElement(data);
    }
    applyingRemote = false;
  });

  socket.on("link:updated", (data) => {
    const link = graph.getCell(data.linkId);
    if (!link) return;
    applyingRemote = true;
    applyLinkPatch(link, data.patch || {});
    applyingRemote = false;
  });

  socket.on("link:removed", (data) => {
    const link = graph.getCell(data.linkId);
    if (link) {
      applyingRemote = true;
      link.remove();
      applyingRemote = false;
    }
  });

  // ---------- Autosave con debounce ----------

  const scheduleSave = _.debounce(() => {
    socket.emit("graph:save", { graphJson: graph.toJSON() });
  }, 1500);

  graph.on("add remove change", () => {
    if (applyingRemote) return;
    scheduleSave();
  });

  // ---------- Menú contextual ----------

  let clickedElement = null;

  paper.on("element:contextmenu", function (elementView, evt) {
    evt.preventDefault();
    clickedElement = elementView.model;
    $("#contextMenu").css({ top: evt.pageY + "px", left: evt.pageX + "px" }).show();
  });

  $(document).on("click", function () {
    $("#contextMenu").hide();
  });

  // ---------- Modales genéricos ----------

  function openModal(id) {
    $("#" + id).addClass("visible");
  }
  function closeModal(id) {
    $("#" + id).removeClass("visible");
  }
  $(document).on("click", "[data-close]", function () {
    closeModal($(this).data("close"));
  });

  // ---------- Modal: nombre / estereotipo de clase ----------

  $("#editName").on("click", function () {
    $("#contextMenu").hide();
    $("#classNameInput").val(clickedElement.get("umlName"));
    $("#classStereotypeInput").val(clickedElement.get("umlStereotype"));
    $("#classError").text("");
    openModal("modalClass");
  });

  $("#classSaveBtn").on("click", function () {
    const name = $("#classNameInput").val().trim();
    const stereotype = $("#classStereotypeInput").val();
    if (!name) {
      $("#classError").text("El nombre no puede estar vacío.");
      return;
    }
    const patch = { name, stereotype };
    applyClassPatch(clickedElement, patch);
    socket.emit("class:update", { elementId: clickedElement.id, patch });
    closeModal("modalClass");
  });

  // ---------- Modal: atributos ----------

  $("#editAttributes").on("click", function () {
    $("#contextMenu").hide();
    $("#attributesInput").val((clickedElement.get("umlAttributes") || []).join("\n"));
    $("#attributesError").text("");
    openModal("modalAttributes");
  });

  $("#attributesSaveBtn").on("click", function () {
    const lines = $("#attributesInput").val().split("\n").map((l) => l.trim()).filter(Boolean);
    const invalid = lines.filter((l) => !V.validateAttribute(l));
    if (invalid.length) {
      $("#attributesError").text('Formato inválido: "' + invalid[0] + '". Usa: + nombre: tipo');
      return;
    }
    applyClassPatch(clickedElement, { attributes: lines });
    socket.emit("class:update", { elementId: clickedElement.id, patch: { attributes: lines } });
    closeModal("modalAttributes");
  });

  // ---------- Modal: métodos ----------

  $("#editMethods").on("click", function () {
    $("#contextMenu").hide();
    $("#methodsInput").val((clickedElement.get("umlMethods") || []).join("\n"));
    $("#methodsError").text("");
    openModal("modalMethods");
  });

  $("#methodsSaveBtn").on("click", function () {
    const lines = $("#methodsInput").val().split("\n").map((l) => l.trim()).filter(Boolean);
    const invalid = lines.filter((l) => !V.validateMethod(l));
    if (invalid.length) {
      $("#methodsError").text('Formato inválido: "' + invalid[0] + '". Usa: + nombre(params): tipoRetorno');
      return;
    }
    applyClassPatch(clickedElement, { methods: lines });
    socket.emit("class:update", { elementId: clickedElement.id, patch: { methods: lines } });
    closeModal("modalMethods");
  });

  // ---------- Eliminar clase ----------

  $("#deleteClass").on("click", function () {
    if (confirm("¿Estás seguro de que deseas eliminar esta clase?")) {
      const elementId = clickedElement.id;
      clickedElement.remove();
      socket.emit("class:remove", { elementId });
      $("#contextMenu").hide();
    }
  });

  // ---------- Compartir sala ----------

  $("#shareRoomBtn").on("click", function () {
    const link = window.location.origin + "/room/" + ROOM.shareToken;
    $("#shareLinkInput").val(link);
    $("#shareCopyFeedback").text("");
    openModal("modalShare");
  });

  $("#copyShareLinkBtn").on("click", function () {
    const $input = $("#shareLinkInput");
    $input.select();
    $input[0].setSelectionRange(0, 99999);

    function fallbackCopy() {
      try {
        document.execCommand("copy");
        return true;
      } catch (e) {
        return false;
      }
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText($input.val()).then(
        () => $("#shareCopyFeedback").text("¡Enlace copiado!"),
        () => $("#shareCopyFeedback").text(fallbackCopy() ? "¡Enlace copiado!" : "No se pudo copiar, selecciónalo manualmente.")
      );
    } else {
      $("#shareCopyFeedback").text(fallbackCopy() ? "¡Enlace copiado!" : "No se pudo copiar, selecciónalo manualmente.");
    }
  });

  // ---------- Agregar clase ----------

  $("#addUserClass").on("click", function () {
    const elementId = generateId("class");
    const data = { elementId, name: "Clase", stereotype: "none", attributes: [], methods: [], position: { x: 100, y: 50 } };
    createClassElement(data);
    socket.emit("class:add", data);
  });

  // ---------- Sincronizar posición al soltar el arrastre ----------

  paper.on("element:pointerup", function (elementView) {
    const cell = elementView.model;
    socket.emit("class:update", { elementId: cell.id, patch: { position: cell.position() } });
  });

  // ---------- Relaciones ----------

  let selectedSource = null;
  let selectedTarget = null;
  let currentRelationType = null;
  let pendingLink = null;

  function resetClassBorders() {
    if (selectedSource) selectedSource.attr(".uml-class-name-rect/stroke", "#000000");
    if (selectedTarget) selectedTarget.attr(".uml-class-name-rect/stroke", "#000000");
  }

  function updateSelectionInfo() {
    if (!currentRelationType) {
      $("#selectionInfo").text("Selecciona el tipo de relación y luego el origen y destino.");
    } else if (!selectedSource) {
      $("#selectionInfo").text("Selecciona la clase de origen.");
    } else {
      $("#selectionInfo").text("Selecciona la clase de destino.");
    }
  }

  function addRelationship(type) {
    currentRelationType = type;
    selectedSource = null;
    selectedTarget = null;
    resetClassBorders();
    updateSelectionInfo();
  }

  paper.on("element:pointerdown", (cellView) => {
    if (!currentRelationType) return;
    if (!selectedSource) {
      selectedSource = cellView.model;
      selectedSource.attr(".uml-class-name-rect/stroke", "#FF0000");
    } else if (!selectedTarget && cellView.model !== selectedSource) {
      selectedTarget = cellView.model;
      selectedTarget.attr(".uml-class-name-rect/stroke", "#0000FF");

      const linkId = generateId("link");
      const data = { linkId, type: currentRelationType, sourceId: selectedSource.id, targetId: selectedTarget.id };
      pendingLink = createLinkElement(data);
      socket.emit("link:add", data);

      resetClassBorders();
      selectedSource = null;
      selectedTarget = null;
      currentRelationType = null;

      $("#sourceMultiplicityInput").val("");
      $("#targetMultiplicityInput").val("");
      $("#multiplicityError").text("");
      openModal("modalMultiplicity");
    }
    updateSelectionInfo();
  });

  $("#multiplicitySaveBtn").on("click", function () {
    const source = $("#sourceMultiplicityInput").val().trim();
    const target = $("#targetMultiplicityInput").val().trim();
    if (source && !V.validateMultiplicity(source)) {
      $("#multiplicityError").text("Multiplicidad de origen inválida.");
      return;
    }
    if (target && !V.validateMultiplicity(target)) {
      $("#multiplicityError").text("Multiplicidad de destino inválida.");
      return;
    }
    const patch = { sourceMultiplicity: source, targetMultiplicity: target };
    if (pendingLink) {
      applyLinkPatch(pendingLink, patch);
      socket.emit("link:update", { linkId: pendingLink.id, patch });
      pendingLink = null;
    }
    closeModal("modalMultiplicity");
  });

  $("#addAssociation").on("click", () => addRelationship("association"));
  $("#addDependency").on("click", () => addRelationship("dependency"));
  $("#addAggregation").on("click", () => addRelationship("aggregation"));
  $("#addComposition").on("click", () => addRelationship("composition"));
  $("#addInheritance").on("click", () => addRelationship("inheritance"));
  $("#addRealization").on("click", () => addRelationship("realization"));

  // Editar cardinalidad de una relación ya existente
  paper.on("link:pointerclick", (linkView) => {
    pendingLink = linkView.model;
    $("#sourceMultiplicityInput").val("");
    $("#targetMultiplicityInput").val("");
    $("#multiplicityError").text("");
    openModal("modalMultiplicity");
  });

  updateSelectionInfo();
});
