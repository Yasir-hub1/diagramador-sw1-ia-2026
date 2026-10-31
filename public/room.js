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

  // ---------- Lienzo responsive ----------

  function resizePaperToViewport() {
    const el = document.getElementById("diagram");
    if (!el || !graph.getCells().length) return;
    const pad = 400;
    let maxX = Math.max(el.clientWidth, 1);
    let maxY = Math.max(el.clientHeight, 1);
    graph.getElements().forEach((cell) => {
      const pos = cell.position();
      const size = cell.size();
      maxX = Math.max(maxX, pos.x + size.width + pad);
      maxY = Math.max(maxY, pos.y + size.height + pad);
    });
    paper.setDimensions(Math.max(maxX, 1200), Math.max(maxY, 900));
  }

  resizePaperToViewport();
  $(window).on("resize", _.debounce(resizePaperToViewport, 150));

  // ---------- Toolbar móvil ----------

  function setToolbarOpen(open) {
    $("body").toggleClass("toolbar-open", open);
    $("#toolbarBackdrop").toggleClass("is-open", open).prop("hidden", !open);
    $("#toolbarToggle").attr("aria-expanded", open ? "true" : "false");
    $("#toolbarToggle").attr("aria-label", open ? "Cerrar herramientas" : "Abrir herramientas");
  }

  $("#toolbarToggle").on("click", function () {
    setToolbarOpen(!$("body").hasClass("toolbar-open"));
  });
  $("#toolbarBackdrop").on("click", function () {
    setToolbarOpen(false);
  });
  $("#roomToolbar").on("click", "button, a.tool-link", function () {
    if (window.matchMedia("(max-width: 900px)").matches) {
      setToolbarOpen(false);
    }
  });

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

  function showToast(message, type) {
    if (window.Toast && typeof window.Toast.show === "function") {
      window.Toast.show(message, type || "info");
      return;
    }
    const $toast = $("<div>").addClass("toast toast--" + (type || "info") + " is-visible").text(message);
    $("#toastContainer").append($toast);
    setTimeout(() => $toast.remove(), 3200);
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

  const CLASS_STROKE = "#1b4332";
  const CLASS_STROKE_WIDTH = 1.5;
  const CLASS_SOURCE_STROKE = "#a33d1e";
  const CLASS_TARGET_STROKE = "#1f6f8f";

  function classAttrs() {
    return {
      ".uml-class-name-rect": { fill: "#1b4332", stroke: CLASS_STROKE, "stroke-width": CLASS_STROKE_WIDTH, rx: 0, ry: 0 },
      ".uml-class-attrs-rect": { fill: "#f4f7f5", stroke: CLASS_STROKE, "stroke-width": CLASS_STROKE_WIDTH, rx: 0, ry: 0 },
      ".uml-class-methods-rect": { fill: "#ffffff", stroke: CLASS_STROKE, "stroke-width": CLASS_STROKE_WIDTH, rx: 0, ry: 0 },
      ".uml-class-name-text": {
        "font-family": "Figtree, sans-serif", "font-size": 15, "font-weight": "700",
        fill: "#f4f7f5", "text-anchor": "middle", "ref-x": 0.5, "ref-y": 0.5, "y-alignment": "middle",
      },
      ".uml-class-attrs-text": {
        "font-family": "JetBrains Mono, monospace", "font-size": 12, fill: "#13211c",
        "text-anchor": "start", "ref-x": 12, "ref-y": 6,
      },
      ".uml-class-methods-text": {
        "font-family": "JetBrains Mono, monospace", "font-size": 12, fill: "#13211c",
        "text-anchor": "start", "ref-x": 12, "ref-y": 6,
      },
    };
  }

  function paintClassElement(cell) {
    if (!cell || !cell.isElement || !cell.isElement()) return;
    if (!cell.attr(".uml-class-name-rect")) return;
    cell.attr(classAttrs());
    const name = cell.get("umlName");
    const stereotype = cell.get("umlStereotype") || "none";
    if (name) {
      const display = classDisplayName(name, stereotype);
      cell.set("name", display);
      cell.attr(".uml-class-name-text/text", display);
    }
    const attributes = cell.get("umlAttributes");
    if (Array.isArray(attributes)) {
      cell.set("attributes", attributes);
      cell.attr(".uml-class-attrs-text/text", attributes.join("\n"));
    }
    const methods = cell.get("umlMethods");
    if (Array.isArray(methods)) {
      cell.set("methods", methods);
      cell.attr(".uml-class-methods-text/text", methods.join("\n"));
    }
  }

  function restoreClassStroke(cell) {
    if (!cell) return;
    cell.attr(".uml-class-name-rect/stroke", CLASS_STROKE);
    cell.attr(".uml-class-name-rect/stroke-width", CLASS_STROKE_WIDTH);
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
      attrs: classAttrs(),
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
      const display = classDisplayName(name, stereotype);
      cell.set("name", display);
      cell.attr(".uml-class-name-text/text", display);
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
    association: { line: { stroke: CLASS_STROKE, strokeWidth: 1.75, targetMarker: { type: "none" } } },
    dependency: {
      line: { stroke: CLASS_STROKE, strokeWidth: 1.75, strokeDasharray: "5 5", targetMarker: { type: "path", d: "M 10 -5 0 0 10 5 Z", fill: "#ffffff", stroke: CLASS_STROKE } },
    },
    aggregation: {
      line: { stroke: CLASS_STROKE, strokeWidth: 1.75, sourceMarker: { type: "path", d: "M 10 0 L 5 -5 L 0 0 L 5 5 Z", fill: "#ffffff", stroke: CLASS_STROKE } },
    },
    composition: {
      line: { stroke: CLASS_STROKE, strokeWidth: 1.75, sourceMarker: { type: "path", d: "M 10 0 L 5 -5 L 0 0 L 5 5 Z", fill: CLASS_STROKE, stroke: CLASS_STROKE } },
    },
    inheritance: {
      line: { stroke: CLASS_STROKE, strokeWidth: 2, targetMarker: { type: "path", d: "M 20 -10 0 0 20 10 Z", fill: "#ffffff", stroke: CLASS_STROKE } },
    },
    realization: {
      line: { stroke: CLASS_STROKE, strokeWidth: 1.75, strokeDasharray: "5 5", targetMarker: { type: "path", d: "M 10 -5 0 0 10 5 Z", fill: "#ffffff", stroke: CLASS_STROKE } },
    },
  };

  function multiplicityLabel(text, distance) {
    return {
      position: { distance: distance, offset: 16 },
      attrs: { text: { text: text, "font-size": 12, "font-family": "JetBrains Mono, monospace", fill: "#13211c" } },
    };
  }

  function associationNameLabel(text) {
    return {
      position: 0.5,
      attrs: { text: { text: text, "font-size": 11, "font-family": "Figtree, sans-serif", fill: "#1b4332" } },
    };
  }

  function restyleLink(link) {
    const type = link.get("umlType") || "association";
    link.attr(LINK_STYLES[type] || LINK_STYLES.association);
    if (type === "inheritance" || type === "realization") {
      link.labels([]);
      link.removeAttr("line/sourceMarker");
    } else if (link.get("umlName")) {
      link.label(2, associationNameLabel(link.get("umlName")));
    }
  }

  function createLinkElement({ linkId, type, sourceId, targetId, sourceMultiplicity, targetMultiplicity, umlName }) {
    const link = new joint.shapes.standard.Link({
      id: linkId,
      source: { id: sourceId },
      target: { id: targetId },
      attrs: LINK_STYLES[type] || LINK_STYLES.association,
    });
    link.set("umlType", type);
    if (type !== "inheritance" && type !== "realization") {
      if (sourceMultiplicity) link.label(0, multiplicityLabel(sourceMultiplicity, 0.18));
      if (targetMultiplicity) link.label(1, multiplicityLabel(targetMultiplicity, 0.82));
      if (umlName) {
        link.set("umlName", umlName);
        link.label(2, associationNameLabel(umlName));
      }
    }
    graph.addCell(link);
    return link;
  }

  function applyLinkPatch(link, patch) {
    const type = link.get("umlType");
    if (type === "inheritance" || type === "realization") return;
    if (patch.sourceMultiplicity !== undefined) {
      link.label(0, multiplicityLabel(patch.sourceMultiplicity, 0.18));
    }
    if (patch.targetMultiplicity !== undefined) {
      link.label(1, multiplicityLabel(patch.targetMultiplicity, 0.82));
    }
    if (patch.umlName !== undefined) {
      link.set("umlName", patch.umlName);
      link.label(2, associationNameLabel(patch.umlName));
    }
  }

  let graphRevision = Number(ROOM.initialGraph && ROOM.initialGraph.revision) || 0;

  function loadGraphJson(data) {
    const incoming = data && Array.isArray(data.cells) ? data : { cells: [] };
    graphRevision = Number(incoming.revision) || 0;
    applyingRemote = true;
    graph.fromJSON({ cells: incoming.cells });
    graph.getElements().forEach(paintClassElement);
    graph.getLinks().forEach(restyleLink);
    applyingRemote = false;
    resizePaperToViewport();
    return true;
  }

  function syncGraphFromServer(data, force) {
    if (!data || !Array.isArray(data.cells)) return false;
    if (!data.cells.length && graph.getCells().length && !data.allowEmpty) return false;
    const incomingRevision = Number(data.revision) || 0;
    if (!force && incomingRevision && incomingRevision <= graphRevision) return false;
    return loadGraphJson(data);
  }

  loadGraphJson(ROOM.initialGraph || { cells: [] });

  // ---------- Presencia y actividad ----------

  let previousUserIds = null;

  function renderPresence(users) {
    const $list = $("#presenceList");
    const $panel = $(".presence-panel");
    $list.empty();
    users.forEach((u) => {
      const $dot = $("<span>").addClass("dot").css("background", colorForUser(u.userId));
      const $li = $("<li>").append($dot).append(document.createTextNode(u.userName));
      if (u.userId === ROOM.userId) {
        $li.append($("<span>").addClass("you-tag").text(" (tú)"));
      }
      $list.append($li);
    });
    $("#presenceCount").text(String(users.length));
    $panel.toggleClass("is-empty", users.length === 0);

    if (previousUserIds !== null) {
      const currentIds = users.map((u) => u.userId);
      users.forEach((u) => {
        if (u.userId !== ROOM.userId && !previousUserIds.includes(u.userId)) {
          showToast(u.userName + " se unió a la sala", "info");
        }
      });
      previousUserIds
        .filter((id) => id !== ROOM.userId && !currentIds.includes(id))
        .forEach(() => showToast("Un colaborador salió de la sala", "info"));
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
    restoreClassStroke(cell);
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

  let disconnectNotified = false;
  socket.on("disconnect", () => {
    setConnectionStatus(false);
    if (!disconnectNotified) {
      disconnectNotified = true;
      showToast("Conexión perdida. Reconectando…", "warning");
    }
  });
  socket.io.on("reconnect_attempt", () => setConnectionStatus(false));

  let connectErrorNotified = false;
  socket.on("connect_error", () => {
    setConnectionStatus(false);
    if (!connectErrorNotified) {
      connectErrorNotified = true;
      showToast("No se pudo conectar al servidor.", "error");
    }
  });

  socket.on("connect", () => {
    const wasOffline = disconnectNotified || connectErrorNotified;
    disconnectNotified = false;
    connectErrorNotified = false;
    setConnectionStatus(true);
    socket.emit("room:join", { shareToken: ROOM.shareToken });
    if (wasOffline) showToast("Conexión restaurada", "success");
  });

  socket.on("room:state", (data) => {
    syncGraphFromServer(data.graphJson, true);
    renderPresence(data.users || []);
    Object.keys(data.lastEditors || {}).forEach((elementId) => {
      showLastEditor(elementId, data.lastEditors[elementId].userName);
    });
    Object.keys(data.activeEditors || {}).forEach((elementId) => {
      const editor = data.activeEditors[elementId];
      showEditingBadge(elementId, editor.userId, editor.userName);
    });
  });

  socket.on("graph:sync", (data) => {
    syncGraphFromServer(data && data.graphJson);
  });

  socket.on("presence:update", (data) => renderPresence(data.users || []));

  socket.on("activity:editor", (data) => showLastEditor(data.elementId, data.userName));

  socket.on("element:editing:started", (data) => showEditingBadge(data.elementId, data.userId, data.userName));
  socket.on("element:editing:ended", (data) => hideEditingBadge(data.elementId));

  socket.on("error:validation", (data) => {
    showToast(data.message || "Operación no válida", "error");
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

  let allowEmptySave = false;

  function graphPayload() {
    const graphJson = graph.toJSON();
    graphJson.revision = graphRevision;
    (graphJson.cells || []).forEach((cell) => {
      if (cell.type !== "uml.Class" || !cell.umlName) return;
      cell.name = classDisplayName(cell.umlName, cell.umlStereotype || "none");
      cell.attributes = cell.umlAttributes || cell.attributes || [];
      cell.methods = cell.umlMethods || cell.methods || [];
    });
    if (allowEmptySave) graphJson.allowEmpty = true;
    return graphJson;
  }

  const scheduleSave = _.debounce(() => {
    setSaveStatus("Guardando…");
    socket.emit("graph:save", { graphJson: graphPayload() }, (res) => {
      if (res && res.ok) {
        if (typeof res.revision === "number") graphRevision = res.revision;
        setSaveStatus("Guardado");
      } else if (res && res.rejected) {
        setSaveStatus("Sala actualizada");
      } else {
        setSaveStatus("Error al guardar");
        showToast(res && res.message ? res.message : "No se pudo guardar el diagrama en la base de datos.", "error");
      }
    });
  }, 1500);

  function flushSave() {
    scheduleSave.cancel();
    setSaveStatus("Guardando…");
    return new Promise((resolve) => {
      socket.emit("graph:save", { graphJson: graphPayload() }, (res) => {
        if (res && res.ok) {
          if (typeof res.revision === "number") graphRevision = res.revision;
          setSaveStatus("Guardado");
        } else if (res && res.rejected) {
          setSaveStatus("Sala actualizada");
          resolve({ ok: true, rejected: true });
          return;
        } else {
          setSaveStatus("Error al guardar");
        }
        resolve(res || { ok: false, message: "No se pudo guardar el diagrama." });
      });
    });
  }

  window.DiagramAPI.flushSave = flushSave;
  window.DiagramAPI.graphPayload = graphPayload;

  graph.on("add remove change", () => {
    if (applyingRemote) return;
    scheduleSave();
    resizePaperToViewport();
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
    if (id === "modalAI") {
      $("#modalAI").prop("hidden", true);
      $("body").removeClass("ai-open");
    }
  }
  function currentlyOpenModal() {
    if ($("#modalAI").hasClass("visible")) return "modalAI";
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
      showToast("El nombre de la clase no puede estar vacío.", "warning");
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
      const msg = 'Formato inválido: "' + invalid[0] + '". Usa: + nombre: tipo';
      $("#attributesError").text(msg);
      showToast(msg, "warning");
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
      const msg = 'Formato inválido: "' + invalid[0] + '". Usa: + nombre(params): tipoRetorno';
      $("#methodsError").text(msg);
      showToast(msg, "warning");
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

  function openShareModal() {
    const link = window.location.origin + "/room/" + ROOM.shareToken;
    $("#shareLinkInput").val(link);
    $("#shareCopyFeedback").text("");
    openModal("modalShare");
  }

  $("#shareRoomBtn, #shareRoomBtnMobile").on("click", openShareModal);

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

    function onCopied(ok) {
      if (ok) {
        $("#shareCopyFeedback").text("Enlace copiado");
        showToast("Enlace de la sala copiado", "success");
      } else {
        $("#shareCopyFeedback").text("No se pudo copiar, selecciónalo manualmente.");
        showToast("No se pudo copiar el enlace", "warning");
      }
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText($input.val()).then(
        () => onCopied(true),
        () => onCopied(fallbackCopy())
      );
    } else {
      onCopied(fallbackCopy());
    }
  });

  // ---------- Agregar clase ----------

  $("#addUserClass").on("click", function () {
    const elementId = generateId("class");
    const data = {
      elementId,
      name: "Clase",
      stereotype: "none",
      attributes: ["- id: Long"],
      methods: [],
      position: { x: 100, y: 50 },
    };
    createClassElement(data);
    socket.emit("class:add", data);
  });

  function hasIdAttribute(lines) {
    return (lines || []).some((line) => {
      const text = String(line || "").trim();
      return /^[+\-#~]\s*id\s*:/i.test(text) || /^id\s*:/i.test(text);
    });
  }

  function ensureClassIdsOnCanvas() {
    let added = 0;
    graph.getElements().forEach((cell) => {
      if (cell.get("umlStereotype") === "interface") return;
      const lines = (cell.get("umlAttributes") || []).slice();
      const loose = lines.findIndex((line) => /^id\s*:/i.test(String(line).trim()) && !/^[+\-#~]/.test(String(line).trim()));
      if (loose >= 0) {
        const type = String(lines[loose].split(":")[1] || "Long").trim() || "Long";
        lines[loose] = "- id: " + type;
        applyClassPatch(cell, { attributes: lines });
        socket.emit("class:update", { elementId: cell.id, patch: { attributes: lines } });
        added += 1;
        return;
      }
      if (hasIdAttribute(lines)) return;
      lines.unshift("- id: Long");
      applyClassPatch(cell, { attributes: lines });
      socket.emit("class:update", { elementId: cell.id, patch: { attributes: lines } });
      added += 1;
    });
    return added;
  }

  window.DiagramAPI.ensureClassIdsOnCanvas = ensureClassIdsOnCanvas;

  function applyAttributeSemanticsOnCanvas() {
    const semantics = window.AttributeSemantics;
    if (!semantics) return { notes: [], changed: 0 };
    const notes = [];
    const classNames = graph.getElements().map((cell) => cell.get("umlName")).filter(Boolean);
    const byName = {};
    graph.getElements().forEach((cell) => {
      if (cell.get("umlName")) byName[String(cell.get("umlName"))] = cell;
    });
    graph.getElements().forEach((cell) => {
      const name = cell.get("umlName");
      if (!name || cell.get("umlStereotype") === "interface") return;
      const refined = semantics.refineAttributeLines(name, cell.get("umlAttributes") || [], classNames);
      if (refined.attributes.join("\n") !== (cell.get("umlAttributes") || []).join("\n")) {
        applyClassPatch(cell, { attributes: refined.attributes });
        socket.emit("class:update", { elementId: cell.id, patch: { attributes: refined.attributes } });
      }
      notes.push.apply(notes, refined.notes);
      refined.relations.forEach((relation) => {
        const target = byName[relation.target];
        if (!target) return;
        const exists = graph.getLinks().some((link) => {
          const source = link.getSourceElement();
          const dest = link.getTargetElement();
          return source && dest && (
            (source.id === cell.id && dest.id === target.id) ||
            (source.id === target.id && dest.id === cell.id)
          );
        });
        if (exists) return;
        const data = {
          linkId: generateId("link"),
          type: "association",
          sourceId: cell.id,
          targetId: target.id,
          sourceMultiplicity: "1",
          targetMultiplicity: "0..*",
        };
        createLinkElement(data);
        socket.emit("link:add", data);
      });
    });
    return { notes: notes, changed: notes.length };
  }

  window.DiagramAPI.applyAttributeSemanticsOnCanvas = applyAttributeSemanticsOnCanvas;

  $("#clearBoardBtn").on("click", function () {
    if (!graph.getCells().length) {
      showToast("La pizarra ya está vacía", "info");
      return;
    }
    if (!confirm("¿Vaciar la pizarra? Se borrarán todas las clases y los vínculos.")) return;
    allowEmptySave = true;
    const links = graph.getLinks().slice();
    const classes = graph.getElements().slice();
    links.forEach((link) => {
      const linkId = link.id;
      link.remove();
      socket.emit("link:remove", { linkId });
    });
    classes.forEach((cell) => {
      const elementId = cell.id;
      hideEditingBadge(elementId);
      cell.remove();
      socket.emit("class:remove", { elementId });
    });
    flushSave();
    showToast("Pizarra vacía", "success");
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
    restoreClassStroke(selectedSource);
    restoreClassStroke(selectedTarget);
  }

  function updateSelectionInfo() {
    if (!currentRelationType) {
      $("#selectionInfo").text("Elige un vínculo y luego marca el origen y el destino.");
    } else if (!selectedSource) {
      $("#selectionInfo").text("Marca la clase de origen.");
    } else {
      $("#selectionInfo").text("Marca la clase de destino.");
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
      selectedSource.attr(".uml-class-name-rect/stroke", CLASS_SOURCE_STROKE);
      selectedSource.attr(".uml-class-name-rect/stroke-width", 3);
    } else if (!selectedTarget && cellView.model !== selectedSource) {
      selectedTarget = cellView.model;
      selectedTarget.attr(".uml-class-name-rect/stroke", CLASS_TARGET_STROKE);
      selectedTarget.attr(".uml-class-name-rect/stroke-width", 3);

      const linkId = generateId("link");
      const data = { linkId, type: currentRelationType, sourceId: selectedSource.id, targetId: selectedTarget.id };
      pendingLink = createLinkElement(data);
      socket.emit("link:add", data);

      const createdType = currentRelationType;
      resetClassBorders();
      selectedSource = null;
      selectedTarget = null;
      currentRelationType = null;
      $("#diagram").removeClass("relation-mode");

      if (createdType === "inheritance" || createdType === "realization") {
        pendingLink = null;
      } else {
        $("#associationNameInput").val("");
        $("#sourceMultiplicityInput").val("");
        $("#targetMultiplicityInput").val("");
        $("#multiplicityError").text("");
        openModal("modalMultiplicity");
      }
    }
    updateSelectionInfo();
  });

  $("#multiplicitySaveBtn").on("click", function () {
    const source = $("#sourceMultiplicityInput").val().trim();
    const target = $("#targetMultiplicityInput").val().trim();
    if (source && !V.validateMultiplicity(source)) {
      $("#multiplicityError").text("Multiplicidad de origen inválida.");
      showToast("Multiplicidad de origen inválida.", "warning");
      return;
    }
    if (target && !V.validateMultiplicity(target)) {
      $("#multiplicityError").text("Multiplicidad de destino inválida.");
      showToast("Multiplicidad de destino inválida.", "warning");
      return;
    }
    const patch = {
      sourceMultiplicity: source,
      targetMultiplicity: target,
      umlName: $("#associationNameInput").val().trim(),
    };
    if (pendingLink) {
      applyLinkPatch(pendingLink, patch);
      socket.emit("link:update", { linkId: pendingLink.id, patch });
      pendingLink = null;
    }
    closeModal("modalMultiplicity");
  });

  $("#xmiImportBtn").on("click", function () {
    $("#xmiFile").trigger("click");
  });
  $("#xmiFile").on("change", function () {
    if (this.files && this.files[0]) $("#xmiImportForm").trigger("submit");
  });

  $("#addAssociation").on("click", () => addRelationship("association"));
  $("#addDependency").on("click", () => addRelationship("dependency"));
  $("#addAggregation").on("click", () => addRelationship("aggregation"));
  $("#addComposition").on("click", () => addRelationship("composition"));
  $("#addInheritance").on("click", () => addRelationship("inheritance"));
  $("#addRealization").on("click", () => addRelationship("realization"));

  // Editar cardinalidad de una relación ya existente
  paper.on("link:pointerclick", (linkView) => {
    const type = linkView.model.get("umlType");
    if (type === "inheritance" || type === "realization") return;
    pendingLink = linkView.model;
    $("#associationNameInput").val(pendingLink.get("umlName") || "");
    $("#sourceMultiplicityInput").val("");
    $("#targetMultiplicityInput").val("");
    $("#multiplicityError").text("");
    openModal("modalMultiplicity");
  });

  updateSelectionInfo();
});
