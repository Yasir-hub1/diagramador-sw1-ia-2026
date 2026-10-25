$(document).ready(function () {
  const api = window.DiagramAPI;
  const socket = api && api.socket;
  const steps = [
    ["PARSING_UML", "Leyendo el diagrama"],
    ["VALIDATING_UML", "Validando UML"],
    ["ANALYZING_AI", "Revisión de la IA"],
    ["BUILDING_BACKEND_MODEL", "Modelo de backend"],
    ["GENERATING_OPENAPI", "OpenAPI"],
    ["GENERATING_SPRING", "Proyecto Spring"],
    ["READY", "ZIP listo"],
  ];

  let currentJobId = "";
  let pollTimer = 0;

  function setStatus(text) {
    const $status = $("#backendStatus");
    if (!text) {
      $status.prop("hidden", true).text("");
      return;
    }
    $status.prop("hidden", false).text(text);
  }

  function renderSteps(active) {
    const $list = $("#backendSteps").prop("hidden", false).empty();
    steps.forEach(([code, label]) => {
      const $item = $("<li>").text(label);
      if (code === active) $item.addClass("is-current");
      if (code === "READY" && active === "READY") $item.addClass("is-done");
      $list.append($item);
    });
  }

  function renderTypeNotes(notes) {
    const $box = $("#backendTypes");
    const $list = $("#backendTypeList").empty();
    if (!notes || !notes.length) {
      $box.prop("hidden", true);
      return;
    }
    notes.forEach((line) => $list.append($("<li>").text(line)));
    $box.prop("hidden", false);
  }

  function renderWarnings(warnings) {
    const $list = $("#backendWarnings").empty();
    if (!warnings || !warnings.length) {
      $list.prop("hidden", true);
      return;
    }
    warnings.forEach((line) => $list.append($("<li>").text(line)));
    $list.prop("hidden", false);
  }

  function renderChanges(changes) {
    const $box = $("#backendChanges");
    const $list = $("#backendChangeList").empty();
    if (!changes || !changes.length) {
      $box.prop("hidden", true);
      return;
    }
    changes.forEach((item) => {
      const label = item.entity
        ? item.type + " " + item.entity + (item.attribute ? "." + item.attribute : "")
        : item.type + " " + (item.source || "") + " → " + (item.target || "");
      $list.append($("<li>").text(label));
    });
    $box.prop("hidden", false);
  }

  function renderLogs(logs) {
    const $logs = $("#backendLogs");
    if (!logs || !logs.length) {
      $logs.prop("hidden", true).text("");
      return;
    }
    $logs.prop("hidden", false).text(logs.slice(-40).join("\n"));
  }

  function fillPaths(preview) {
    const first = preview && preview.entities && preview.entities[0];
    if (first && !$("#backendPath").val()) $("#backendPath").val(first.endpoint);
  }

  function renderRuntime(job) {
    const runtime = job.runtime || {};
    const ready = job.status === "READY";
    const starting = runtime.status === "starting";
    const running = runtime.status === "running";
    $("#backendRunBtn").prop("hidden", !ready || running).prop("disabled", starting);
    $("#backendStopBtn").prop("hidden", !running && !starting);
    if (running && runtime.swaggerUrl) {
      $("#backendSwagger").attr("href", runtime.swaggerUrl).prop("hidden", false);
      $("#backendTester").prop("hidden", false);
    } else {
      $("#backendSwagger").prop("hidden", true);
      $("#backendTester").prop("hidden", !running);
    }
    renderLogs(job.logs);
    if (starting || running) startPolling();
    else stopPolling();
  }

  function renderPreview(job) {
    const preview = job.preview;
    if (!preview) {
      $("#backendPreview").prop("hidden", true);
      return;
    }
    const $entities = $("#backendEntities").empty();
    (preview.entities || []).forEach((entity) => {
      $entities.append($("<li>").text(entity.name + " → " + entity.endpoint));
    });
    $("#backendPreview").prop("hidden", false);
    const $download = $("#backendDownload");
    if (job.downloadReady) {
      $download.attr("href", "/api/backend/jobs/" + job.jobId + "/download").prop("hidden", false);
    } else {
      $download.prop("hidden", true);
    }
    fillPaths(preview);
    renderRuntime(job);
  }

  function applyJob(job, options) {
    if (!job || (currentJobId && job.jobId !== currentJobId)) return;
    currentJobId = job.jobId;
    setStatus(job.message || "");
    renderSteps(job.step);
    renderWarnings(job.warnings);
    renderTypeNotes(job.typeNotes);
    renderChanges(job.changes);
    renderPreview(job);
    const running = job.status !== "READY" && job.status !== "ERROR";
    $("#backendStartBtn").prop("disabled", running);
    if (job.status === "ERROR" && window.Toast) {
      window.Toast.error(job.message || "No se pudo generar el backend.");
    }
    if (options && options.toastReady && job.status === "READY" && window.Toast) {
      window.Toast.success("Backend listo. Descarga el ZIP o arranca la API.");
    }
  }

  function startPolling() {
    if (pollTimer || !currentJobId) return;
    pollTimer = window.setInterval(async function () {
      if (!currentJobId) return;
      try {
        const response = await fetch("/api/backend/jobs/" + currentJobId, { credentials: "same-origin" });
        if (response.ok) applyJob(await response.json());
      } catch (_error) {}
    }, 2500);
  }

  function stopPolling() {
    if (!pollTimer) return;
    window.clearInterval(pollTimer);
    pollTimer = 0;
  }

  async function loadTools() {
    try {
      const response = await fetch("/api/backend/tools", { credentials: "same-origin" });
      if (!response.ok) return;
      const tools = await response.json();
      const lines = [];
      if (tools.java) lines.push(tools.java.message);
      if (tools.maven) lines.push(tools.maven.message);
      $("#backendTools").prop("hidden", lines.length === 0).text(lines.join(" · "));
    } catch (_error) {}
  }

  $("#backendGenerateBtn").on("click", function () {
    $("#modalBackend").addClass("visible");
    loadTools();
  });

  $("#backendForm").on("submit", async function (evt) {
    evt.preventDefault();
    if (!api || !api.flushSave) return;
    $("#backendStartBtn").prop("disabled", true);
    setStatus("Revisando identificadores");
    if (api.ensureClassIdsOnCanvas) {
      const added = api.ensureClassIdsOnCanvas();
      if (added) setStatus("Se añadió id a " + added + " clase(s)");
    }
    if (api.applyAttributeSemanticsOnCanvas) {
      const semantic = api.applyAttributeSemanticsOnCanvas();
      if (semantic && semantic.changed) setStatus("Ajusté tipos y listas para el backend");
    }
    setStatus("Guardando el diagrama");
    const saved = await api.flushSave();
    if (!saved || !saved.ok) {
      $("#backendStartBtn").prop("disabled", false);
      setStatus(saved && saved.message ? saved.message : "No se pudo guardar el diagrama.");
      return;
    }
    currentJobId = "";
    $("#backendPreview, #backendSteps, #backendWarnings, #backendChanges, #backendTypes, #backendTester").prop("hidden", true);
    try {
      const response = await fetch("/api/backend/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          shareToken: api.ROOM.shareToken,
          database: $("#backendDatabase").val(),
          useAi: $("#backendUseAi").prop("checked"),
        }),
      });
      const job = await response.json();
      if (!response.ok) {
        $("#backendStartBtn").prop("disabled", false);
        setStatus(job.error || "No se pudo empezar la generación.");
        return;
      }
      applyJob(job);
    } catch (_error) {
      $("#backendStartBtn").prop("disabled", false);
      setStatus("No se pudo empezar la generación.");
    }
  });

  $("#backendRunBtn").on("click", async function () {
    if (!currentJobId) return;
    $(this).prop("disabled", true);
    setStatus("Arrancando Maven");
    try {
      const response = await fetch("/api/backend/jobs/" + currentJobId + "/start", {
        method: "POST",
        credentials: "same-origin",
      });
      const job = await response.json();
      if (!response.ok) {
        setStatus(job.error || "No se pudo arrancar Maven.");
        $(this).prop("disabled", false);
        return;
      }
      applyJob(job);
    } catch (_error) {
      setStatus("No se pudo arrancar Maven.");
      $(this).prop("disabled", false);
    }
  });

  $("#backendStopBtn").on("click", async function () {
    if (!currentJobId) return;
    const response = await fetch("/api/backend/jobs/" + currentJobId + "/stop", {
      method: "POST",
      credentials: "same-origin",
    });
    if (response.ok) applyJob(await response.json());
  });

  $("#backendSendBtn").on("click", async function () {
    if (!currentJobId) return;
    const $out = $("#backendResponse").prop("hidden", false).text("Enviando…");
    try {
      const response = await fetch("/api/backend/jobs/" + currentJobId + "/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          method: $("#backendMethod").val(),
          path: $("#backendPath").val(),
          body: $("#backendBody").val(),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        $out.text(payload.error || "La petición no se pudo enviar.");
        return;
      }
      $out.text(payload.status + " " + (payload.contentType || "") + "\n\n" + (payload.body || ""));
    } catch (_error) {
      $out.text("La petición no se pudo enviar.");
    }
  });

  if (socket) {
    socket.on("generation:started", applyJob);
    socket.on("generation:progress", applyJob);
    socket.on("generation:completed", function (job) {
      applyJob(job, { toastReady: true });
    });
    socket.on("generation:error", applyJob);
    socket.on("generation:runtime", applyJob);
  }
});
