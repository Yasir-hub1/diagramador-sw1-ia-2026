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

  // Expone el grafo/socket para que public/ai-assistant.js pueda leer el
  // estado actual del diagrama (contexto para la IA) y enviar comandos.
  window.DiagramAPI = { graph, socket, ROOM };

  // Evita reemitir al servidor cuando estamos aplicando un cambio remoto.
  let applyingRemote = false;

  function generateId(prefix) {
    return prefix + "_" + Math.random().toString(36).substr(2, 9);
  }

  // ---------- Color determinístico por usuario (mismo color en todos los clientes) ----------

  const USER_COLORS = ["#e74c3c", "#2980b9", "#8e44ad", "#16a085", "#d35400", "#c0392b", "#2c3e50", "#27ae60"];

  function colorForUser(userId) {
    const key = String(userId || "0");
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    }
    return USER_COLORS[hash % USER_COLORS.length];
  }

  // ---------- Toasts ----------

  function showToast(message) {
    const $toast = $("<div>").addClass("toast").text(message);
    $("#toastContainer").append($toast);
    requestAnimationFrame(() => $toast.addClass("visible"));
    setTimeout(() => {
      $toast.removeClass("visible");
      setTimeout(() => $toast.remove(), 250);
    }, 3200);
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
      const entry = activeEditingBadges[cell.id];
      if (entry) positionEditingBadge(entry.$badge, cell);
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

  let previousUserIds = null;

  function renderPresence(users) {
    const $list = $("#presenceList");
    $list.empty();
    users.forEach((u) => {
      const $dot = $("<span>").addClass("dot").css("background", colorForUser(u.userId));
      const $li = $("<li>").append($dot).append(document.createTextNode(u.userName));
      if (u.userId === ROOM.userId) {
        $li.append($("<span>").addClass("you-tag").text(" (tú)"));
      }
      $list.append($li);
    });

    if (previousUserIds !== null) {
      const currentIds = users.map((u) => u.userId);
      users.forEach((u) => {
        if (u.userId !== ROOM.userId && !previousUserIds.includes(u.userId)) {
          showToast(u.userName + " se unió a la sala");
        }
      });
      previousUserIds
        .filter((id) => id !== ROOM.userId && !currentIds.includes(id))
        .forEach(() => showToast("Un colaborador salió de la sala"));
      previousUserIds = currentIds;
    } else {
      previousUserIds = users.map((u) => u.userId);
    }
  }

  function showLastEditor(elementId, userName) {
    const cellView = paper.findViewByModel(elementId);
    if (!cellView) return;
    cellView.el.setAttribute("title", "Editado por última vez por " + userName);
  }

  // ---------- Indicador en vivo de "usuario editando/moviendo" ----------

  const activeEditingBadges = {}; // elementId -> { $badge, userId }

  function positionEditingBadge($badge, cell) {
    const pos = cell.position();
    $badge.css({ left: pos.x + "px", top: pos.y - 4 + "px" });
  }

  function showEditingBadge(elementId, userId, userName) {
    const cell = graph.getCell(elementId);
    if (!cell) return;
    const color = colorForUser(userId);

    // Resalta el borde de la clase con el color del usuario que la está tocando.
    cell.attr(".uml-class-name-rect/stroke", color);
    cell.attr(".uml-class-name-rect/stroke-width", 2.5);

    let entry = activeEditingBadges[elementId];
    if (!entry) {
      const $badge = $("<div>").addClass("editing-badge").appendTo("#diagram");
      entry = activeEditingBadges[elementId] = { $badge, userId };
    }
    entry.userId = userId;
    entry.$badge.css("background", color).text("✏️ " + userName);
    positionEditingBadge(entry.$badge, cell);
  }

  function hideEditingBadge(elementId) {
    const entry = activeEditingBadges[elementId];
    if (entry) {
      entry.$badge.remove();
      delete activeEditingBadges[elementId];
    }
    const cell = graph.getCell(elementId);
    if (cell) {
      cell.attr(".uml-class-name-rect/stroke", "#000000");
      cell.attr(".uml-class-name-rect/stroke-width", 1);
    }
  }

  paper.on("element:pointermove", (elementView) => {
    const entry = activeEditingBadges[elementView.model.id];
    if (entry && entry.userId === ROOM.userId) {
      positionEditingBadge(entry.$badge, elementView.model);
    }
  });

  // ---------- Estado de guardado ----------

  function setSaveStatus(text) {
    $("#saveStatus").text(text);
  }

  // ---------- Estado de conexión ----------

  function setConnectionStatus(connected) {
    $("#connectionStatus").toggleClass("offline", !connected);
    $("#connectionStatusText").text(connected ? "Conectado" : "Reconectando…");
  }

  // ---------- Socket: eventos entrantes ----------

  socket.on("connect", () => {
    setConnectionStatus(true);
    socket.emit("room:join", { shareToken: ROOM.shareToken });
  });

  socket.on("disconnect", () => setConnectionStatus(false));
  socket.io.on("reconnect_attempt", () => setConnectionStatus(false));

  socket.on("room:state", (data) => {
    renderPresence(data.users || []);
    Object.keys(data.lastEditors || {}).forEach((elementId) => {
      showLastEditor(elementId, data.lastEditors[elementId].userName);
    });
    Object.keys(data.activeEditors || {}).forEach((elementId) => {
      const editor = data.activeEditors[elementId];
      showEditingBadge(elementId, editor.userId, editor.userName);
    });
  });

  socket.on("presence:update", (data) => renderPresence(data.users || []));

  socket.on("activity:editor", (data) => showLastEditor(data.elementId, data.userName));

  socket.on("element:editing:started", (data) => showEditingBadge(data.elementId, data.userId, data.userName));
  socket.on("element:editing:ended", (data) => hideEditingBadge(data.elementId));

  socket.on("error:validation", (data) => {
    showToast("⚠ " + data.message);
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
    hideEditingBadge(data.elementId);
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
    setSaveStatus("Guardando…");
    socket.emit("graph:save", { graphJson: graph.toJSON() }, (res) => {
      setSaveStatus(res && res.ok ? "Guardado ✓" : "Error al guardar");
    });
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
    $("#" + id).find("input, textarea, select").first().trigger("focus");
  }
  function closeModal(id) {
    $("#" + id).removeClass("visible");
  }
  function currentlyOpenModal() {
    const $open = $(".modal-overlay.visible");
    return $open.length ? $open.attr("id") : null;
  }

  $(document).on("click", "[data-close]", function () {
    closeModal($(this).data("close"));
  });

  // Cerrar al hacer click fuera de la caja del modal
  $(".modal-overlay").on("click", function (evt) {
    if (evt.target === this) closeModal(this.id);
  });

  // Cerrar con ESC
  $(document).on("keydown", function (evt) {
    if (evt.key === "Escape") {
      const openId = currentlyOpenModal();
      if (openId) closeModal(openId);
    }
  });

  // Avisa a los demás que se dejó de editar el elemento (al guardar o cancelar el modal).
  function notifyEditingEndForClicked() {
    if (clickedElement) socket.emit("element:editing:end", { elementId: clickedElement.id });
  }
  $(document).on("click", "#modalClass [data-close], #modalClass .save, #modalAttributes [data-close], #modalAttributes .save, #modalMethods [data-close], #modalMethods .save", notifyEditingEndForClicked);

  // ---------- Modal: nombre / estereotipo de clase ----------

  $("#editName").on("click", function () {
    $("#contextMenu").hide();
    $("#classNameInput").val(clickedElement.get("umlName"));
    $("#classStereotypeInput").val(clickedElement.get("umlStereotype"));
    $("#classError").text("");
    socket.emit("element:editing:start", { elementId: clickedElement.id });
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
    socket.emit("element:editing:start", { elementId: clickedElement.id });
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
    socket.emit("element:editing:start", { elementId: clickedElement.id });
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

  // ---------- Notificar "moviendo" mientras se arrastra una clase ----------

  paper.on("element:pointerdown", function (elementView) {
    if (currentRelationType) return; // ese caso lo maneja el flujo de selección de relación
    socket.emit("element:editing:start", { elementId: elementView.model.id });
  });

  paper.on("element:pointerup", function (elementView) {
    const cell = elementView.model;
    if (!currentRelationType) {
      socket.emit("class:update", { elementId: cell.id, patch: { position: cell.position() } });
      socket.emit("element:editing:end", { elementId: cell.id });
    }
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
    $("#diagram").addClass("relation-mode");
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
      $("#diagram").removeClass("relation-mode");

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
