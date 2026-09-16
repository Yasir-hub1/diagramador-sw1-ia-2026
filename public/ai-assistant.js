$(document).ready(function () {
  // Se apoya en window.DiagramAPI, expuesto por room.js, para leer el grafo
  // actual (contexto para la IA) y reutilizar el mismo socket ya conectado.
  const api = window.DiagramAPI;
  const socket = api.socket;

  function openModal() {
    $("#modalAI").addClass("visible");
    $("#aiTextInput").trigger("focus");
  }

  $("#aiAssistantBtn").on("click", openModal);

  // ---------- Construir el contexto actual del diagrama para la IA ----------

  function buildContext() {
    const graph = api.graph;
    const classes = graph.getElements().map((el) => ({
      id: el.id,
      name: el.get("umlName"),
      stereotype: el.get("umlStereotype"),
      attributes: el.get("umlAttributes") || [],
      methods: el.get("umlMethods") || [],
    }));
    const nameById = {};
    classes.forEach((c) => (nameById[c.id] = c.name));

    const relations = graph.getLinks().map((link) => {
      const sourceId = link.get("source").id;
      const targetId = link.get("target").id;
      return {
        type: link.get("umlType"),
        sourceId,
        targetId,
        sourceName: nameById[sourceId],
        targetName: nameById[targetId],
      };
    });

    return { classes, relations };
  }

  // ---------- Historial de chat (solo en memoria del navegador) ----------

  function appendMessage(role, text) {
    const $msg = $("<div>").addClass("ai-msg " + role).text(text);
    $("#aiChatLog").append($msg);
    const log = document.getElementById("aiChatLog");
    log.scrollTop = log.scrollHeight;
  }

  // ---------- Enviar instrucción (texto o transcripción de voz) ----------

  let waitingForAi = false;

  function sendInstruction(text) {
    if (!text || !text.trim() || waitingForAi) return;
    appendMessage("user", text);
    waitingForAi = true;
    $("#aiSendBtn").prop("disabled", true).text("Pensando…");
    socket.emit("ai:command", { text, context: buildContext() });
  }

  socket.on("ai:result", (data) => {
    waitingForAi = false;
    $("#aiSendBtn").prop("disabled", false).text("Enviar");
    if (data.reply) appendMessage("assistant", data.reply);
    (data.skipped || []).forEach((reason) => appendMessage("system", "⚠ " + reason));
  });

  $("#aiSendBtn").on("click", function () {
    const text = $("#aiTextInput").val();
    $("#aiTextInput").val("");
    sendInstruction(text);
  });

  $("#aiTextInput").on("keydown", function (evt) {
    if (evt.key === "Enter") {
      evt.preventDefault();
      $("#aiSendBtn").trigger("click");
    }
  });

  // ---------- Voz: grabar con MediaRecorder y transcribir con OpenAI ----------

  let mediaRecorder = null;
  let audioChunks = [];
  let recordingStartedAt = 0;

  // Deja que el navegador elija el mejor formato que realmente sabe grabar
  // (Chrome/Firefox: webm/opus; Safari: mp4/aac). Forzar un tipo fijo aquí
  // causaba que el audio real (ej. mp4) se etiquetara como webm y OpenAI
  // no pudiera decodificarlo.
  function pickSupportedMimeType() {
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
    if (window.MediaRecorder && MediaRecorder.isTypeSupported) {
      for (const type of candidates) {
        if (MediaRecorder.isTypeSupported(type)) return type;
      }
    }
    return "";
  }

  function extensionForMimeType(mimeType) {
    if (!mimeType) return "webm";
    if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
    if (mimeType.includes("ogg")) return "ogg";
    if (mimeType.includes("wav")) return "wav";
    return "webm";
  }

  function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      appendMessage("system", "Tu navegador no soporta grabación de audio.");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        audioChunks = [];
        const preferredType = pickSupportedMimeType();
        mediaRecorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined);
        recordingStartedAt = Date.now();
        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) audioChunks.push(e.data);
        };
        mediaRecorder.onstop = () => {
          stream.getTracks().forEach((track) => track.stop());
          const durationMs = Date.now() - recordingStartedAt;
          if (durationMs < 400 || audioChunks.length === 0) {
            appendMessage("system", "La grabación fue muy corta, intenta mantener presionado el micrófono un poco más.");
            return;
          }
          const actualType = mediaRecorder.mimeType || preferredType || "audio/webm";
          const blob = new Blob(audioChunks, { type: actualType });
          transcribeAndSend(blob, actualType);
        };
        mediaRecorder.start();
        $("#aiMicBtn").addClass("recording");
      })
      .catch(() => appendMessage("system", "No se pudo acceder al micrófono."));
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    $("#aiMicBtn").removeClass("recording");
  }

  function transcribeAndSend(blob, mimeType) {
    appendMessage("system", "Transcribiendo audio…");
    const formData = new FormData();
    formData.append("audio", blob, "voice." + extensionForMimeType(mimeType));

    fetch("/api/voice/transcribe", { method: "POST", body: formData })
      .then((res) => res.json())
      .then((data) => {
        if (data.text) {
          sendInstruction(data.text);
        } else {
          appendMessage("system", "No se pudo transcribir el audio: " + (data.error || "error desconocido"));
        }
      })
      .catch(() => appendMessage("system", "Error al transcribir el audio."));
  }

  const $mic = $("#aiMicBtn");
  $mic.on("mousedown touchstart", function (evt) {
    evt.preventDefault();
    startRecording();
  });
  $mic.on("mouseup mouseleave touchend", function () {
    if ($mic.hasClass("recording")) stopRecording();
  });
});
