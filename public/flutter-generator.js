$(document).ready(function () {
  const api = window.DiagramAPI;
  const socket = api && api.socket;
  const steps = [
    ["ANALYZING_PROJECT", "Leyendo el UML"],
    ["BUILDING_FRONTEND_MODEL", "Modelo de pantallas"],
    ["GENERATING_API_CLIENT", "Cliente Dio"],
    ["GENERATING_SCREENS", "Pantallas"],
    ["PACKAGING", "ZIP"],
    ["READY", "Listo"],
  ];

  let currentJobId = "";
  let preview = null;
  let route = { type: "home" };
  let landscape = false;

  function setStatus(text) {
    $("#flutterStatus").prop("hidden", !text).text(text || "");
  }

  function renderSteps(active) {
    const $list = $("#flutterSteps").prop("hidden", false).empty();
    steps.forEach(([code, label]) => {
      const $item = $("<li>").text(label);
      if (code === active) $item.addClass("is-current");
      if (code === "READY" && active === "READY") $item.addClass("is-done");
      $list.append($item);
    });
  }

  function entityByName(name) {
    return (preview.entities || []).find((item) => item.name === name);
  }

  function inputAttrs(item) {
    const attrs = { name: item.name, autocomplete: "off" };
    if (item.type === "Integer" || item.type === "Long") {
      attrs.type = "number";
      attrs.step = "1";
    } else if (item.type === "Double" || item.type === "Float") {
      attrs.type = "number";
      attrs.step = "any";
    } else if (item.type === "LocalDate") {
      attrs.type = "date";
    } else if (item.type === "Boolean") {
      attrs.type = "checkbox";
    } else {
      attrs.type = "text";
    }
    return attrs;
  }

  function goHome() {
    route = { type: "home" };
    drawPhone();
  }

  function drawHome() {
    const $list = $("<div>").addClass("phone-home");
    (preview.entities || []).forEach((entity) => {
      $list.append(
        $("<button type='button'>")
          .append($("<strong>").text(entity.name))
          .append($("<span>").text(entity.endpoint))
          .on("click", function () {
            route = { type: "list", entity: entity.name };
            drawPhone();
          })
      );
    });
    return $list;
  }

  async function proxy(method, path, body) {
    const jobId = preview && preview.backendJobId;
    if (!jobId) throw new Error("Arranca la API para ver los datos.");
    const response = await fetch("/api/backend/jobs/" + jobId + "/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ method: method, path: path, body: body || "" }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "La API no respondió.");
    if (payload.status >= 400) throw new Error(apiErrorMessage(payload));
    return payload;
  }

  function apiErrorMessage(payload) {
    try {
      const body = JSON.parse(payload.body || "{}");
      return body.error || body.message || "La API respondió " + payload.status;
    } catch (_error) {
      return payload.body || "La API respondió " + payload.status;
    }
  }

  async function drawList(entity) {
    const $wrap = $("<div>");
    $wrap.append(
      $("<div class='phone-bar'>")
        .append($("<button type='button'>").text("←").on("click", goHome))
        .append($("<span>").text(entity.name))
    );
    const $list = $("<div>").addClass("phone-list").text("Cargando…");
    $wrap.append($list);
    $wrap.append(
      $("<button type='button' class='phone-fab'>+</button>").on("click", function () {
        route = { type: "form", entity: entity.name };
        drawPhone();
      })
    );
    try {
      const result = await proxy("GET", entity.endpoint);
      const rows = JSON.parse(result.body || "[]");
      $list.empty();
      if (!Array.isArray(rows) || !rows.length) {
        $list.append($("<p class='phone-empty'>").text("Sin registros. Pulsa +"));
        return $wrap;
      }
      rows.forEach((row) => {
        $list.append(
          $("<button type='button'>")
            .append($("<strong>").text(row[entity.titleField] || row.id))
            .append($("<span>").text(entity.subtitleField ? row[entity.subtitleField] || "" : ""))
            .on("click", function () {
              route = { type: "detail", entity: entity.name, id: row.id };
              drawPhone();
            })
        );
      });
    } catch (error) {
      $list.empty().append($("<p class='phone-error'>").text(error.message));
    }
    return $wrap;
  }

  async function drawDetail(entity) {
    const $wrap = $("<div>");
    $wrap.append(
      $("<div class='phone-bar'>")
        .append(
          $("<button type='button'>").text("←").on("click", function () {
            route = { type: "list", entity: entity.name };
            drawPhone();
          })
        )
        .append($("<span>").text("Detalle"))
    );
    const $body = $("<div class='phone-list'>").text("Cargando…");
    $wrap.append($body);
    try {
      const result = await proxy("GET", entity.endpoint + "/" + route.id);
      const row = JSON.parse(result.body || "{}");
      $body.empty();
      entity.attributes.forEach((attr) => {
        $body.append(
          $("<div>")
            .addClass("phone-empty")
            .append($("<strong>").text(attr.name))
            .append($("<div>").text(row[attr.name] == null ? "" : String(row[attr.name])))
        );
      });
    } catch (error) {
      $body.empty().append($("<p class='phone-error'>").text(error.message));
    }
    return $wrap;
  }

  function drawForm(entity) {
    const $wrap = $("<div>");
    $wrap.append(
      $("<div class='phone-bar'>")
        .append(
          $("<button type='button'>").text("←").on("click", function () {
            route = { type: "list", entity: entity.name };
            drawPhone();
          })
        )
        .append($("<span>").text("Nuevo " + entity.name))
    );
    const $form = $("<form class='phone-form'>");
    entity.attributes
      .filter((item) => !item.primaryKey)
      .forEach((item) => {
        $form.append($("<label>").text(item.name + (item.type ? " (" + item.type + ")" : "")));
        $form.append($("<input>").attr(inputAttrs(item)));
      });
    $form.append($("<button type='submit' class='save'>").text("Guardar"));
    $form.on("submit", async function (evt) {
      evt.preventDefault();
      const values = {};
      entity.attributes
        .filter((item) => !item.primaryKey)
        .forEach((item) => {
          const $input = $form.find("[name='" + item.name + "']");
          values[item.name] = $input.attr("type") === "checkbox" ? ($input.prop("checked") ? "true" : "") : $input.val();
        });
      const payload = window.JsonFields
        ? window.JsonFields.payloadFromValues(entity.attributes, values)
        : { ok: true, body: values, errors: [] };
      if (!payload.ok) {
        window.Toast && window.Toast.error(payload.errors.join(" "));
        return;
      }
      try {
        await proxy("POST", entity.endpoint, JSON.stringify(payload.body));
        route = { type: "list", entity: entity.name };
        drawPhone();
      } catch (error) {
        window.Toast && window.Toast.error(error.message);
      }
    });
    return $wrap.append($form);
  }

  async function drawPhone() {
    const $app = $("#phoneApp").empty();
    if (!preview) {
      $app.append($("<p class='phone-empty'>").text("Genera para ver la app."));
      return;
    }
    if (route.type === "home") {
      $app.append(drawHome());
      return;
    }
    const entity = entityByName(route.entity);
    if (!entity) return goHome();
    if (route.type === "list") $app.append(await drawList(entity));
    if (route.type === "detail") $app.append(await drawDetail(entity));
    if (route.type === "form") $app.append(drawForm(entity));
  }

  function applyJob(job, options) {
    if (!job || (currentJobId && job.jobId !== currentJobId)) return;
    currentJobId = job.jobId;
    setStatus(job.message || "");
    renderSteps(job.step);
    const $warn = $("#flutterWarnings").empty();
    if (job.warnings && job.warnings.length) {
      job.warnings.forEach((line) => $warn.append($("<li>").text(line)));
      $warn.prop("hidden", false);
    } else $warn.prop("hidden", true);
    const running = job.status !== "READY" && job.status !== "ERROR";
    $("#backendStartBtn").prop("disabled", running);
    if (job.status === "READY" && job.preview) {
      preview = job.preview;
      $("#backendSteps, #flutterSteps").prop("hidden", true);
      $("#flutterDownload").attr("href", "/api/flutter/jobs/" + job.jobId + "/download").prop("hidden", false);
      $("#phoneLink").text(preview.baseUrl ? preview.baseUrl.replace("http://", "") : "API sin arrancar");
      goHome();
      if (options && options.toast && window.Toast) {
        window.Toast.success("Aplicativo listo. Arranca la API para probarlo.");
      }
    }
    if (job.status === "ERROR" && window.Toast) window.Toast.error(job.message || "No se pudo generar la app.");
  }

  let chainedBackendId = "";

  async function generateFlutter() {
    if (!api || !api.ROOM) return;
    $("#backendStartBtn").prop("disabled", true);
    $("#backendSteps, #backendWarnings, #backendStatus").prop("hidden", true);
    currentJobId = "";
    try {
      const response = await fetch("/api/flutter/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ shareToken: api.ROOM.shareToken }),
      });
      const job = await response.json();
      if (!response.ok) {
        $("#backendStartBtn").prop("disabled", false);
        setStatus(job.error || "No se pudo generar la app.");
        return;
      }
      applyJob(job);
    } catch (_error) {
      $("#backendStartBtn").prop("disabled", false);
      setStatus("No se pudo generar la app.");
    }
  }

  window.TrazoApp = {
    afterBackend: function (job) {
      if (!job || chainedBackendId === job.jobId) return;
      chainedBackendId = job.jobId;
      generateFlutter();
    },
  };

  $("#phoneDevice").on("change", function () {
    $("#phoneShell").attr("data-device", $(this).val());
  });

  $("#phoneRotate").on("click", function () {
    landscape = !landscape;
    $("#phoneShell").toggleClass("is-landscape", landscape);
  });

  if (socket) {
    socket.on("flutter:generation:started", applyJob);
    socket.on("flutter:generation:progress", applyJob);
    socket.on("flutter:generation:completed", function (job) {
      applyJob(job, { toast: true });
    });
    socket.on("flutter:generation:error", applyJob);
  }
});
