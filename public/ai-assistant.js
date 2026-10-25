$(document).ready(function () {
  const api = window.DiagramAPI;
  const socket = api.socket;
  const snapshotApi = window.DiagramSnapshot;
  const allowedImageTypes = ["image/png", "image/jpeg", "image/webp"];

  let generation = 0;
  let waitingForAi = false;
  let pendingProposalId = null;
  let attachedFile = null;
  let previewUrl = null;

  function openModal() {
    $("#modalAI").addClass("visible");
    $("#aiTextInput").trigger("focus");
  }

  $("#aiAssistantBtn").on("click", openModal);

  function appendMessage(role, text, extraClass) {
    const $msg = $("<div>").addClass("ai-msg " + role).text(text);
    if (extraClass) $msg.addClass(extraClass);
    $("#aiChatLog").append($msg);
    const log = document.getElementById("aiChatLog");
    log.scrollTop = log.scrollHeight;
  }

  function setStatus(text) {
    const $status = $("#aiStatus");
    if (!text) {
      $status.prop("hidden", true).text("");
      return;
    }
    $status.prop("hidden", false).text(text);
  }

  function setBusy(isBusy) {
    waitingForAi = isBusy;
    $("#aiSendBtn, #aiTextInput, #aiMicBtn, #aiImageInput, #aiAttachmentRemove").prop("disabled", isBusy);
    $("#aiImageLabel").toggleClass("is-disabled", isBusy);
    $("#modalAI").attr("aria-busy", isBusy ? "true" : "false");
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function revokePreview() {
    if (!previewUrl) return;
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }

  function clearAttachment() {
    attachedFile = null;
    revokePreview();
    $("#aiAttachment").prop("hidden", true);
    $("#aiAttachmentPreview").attr("src", "");
    $("#aiAttachmentName, #aiAttachmentSize").text("");
  }

  function fileLooksLikeImage(file) {
    if (allowedImageTypes.indexOf(file.type) !== -1) return true;
    return /\.(png|jpe?g|webp)$/i.test(file.name || "");
  }

  function setAttachment(file) {
    const maxBytes = Number(api.ROOM.aiMaxImageBytes) || 5242880;
    if (!fileLooksLikeImage(file)) {
      appendMessage("system", "La imagen debe ser PNG, JPEG o WebP.");
      if (window.Toast) window.Toast.warning("La imagen debe ser PNG, JPEG o WebP.");
      return;
    }
    if (file.size > maxBytes) {
      appendMessage("system", "La imagen supera el tamaño permitido.");
      if (window.Toast) window.Toast.warning("La imagen supera el tamaño permitido.");
      return;
    }
    revokePreview();
    attachedFile = file;
    previewUrl = URL.createObjectURL(file);
    $("#aiAttachmentPreview").attr("src", previewUrl);
    $("#aiAttachmentName").text(file.name || "diagrama");
    $("#aiAttachmentSize").text(formatBytes(file.size));
    $("#aiAttachment").prop("hidden", false);
  }

  function hideProposal() {
    pendingProposalId = null;
    $("#aiProposal").prop("hidden", true);
    $("#aiProposalTypesBlock").prop("hidden", true);
    $("#aiProposalOps, #aiProposalWarnings, #aiProposalTypes").empty();
    $("#aiProposalMessage").text("");
  }

  function cancelPendingProposal() {
    if (!pendingProposalId) return;
    socket.emit("ai:cancel", { proposalId: pendingProposalId });
    hideProposal();
  }

  function showProposal(proposal) {
    pendingProposalId = proposal.proposalId;
    $("#aiProposalMessage").text(proposal.message || "");
    const $ops = $("#aiProposalOps").empty();
    (proposal.preview || []).forEach((line) => {
      $ops.append($("<li>").text(line));
    });
    const typeNotes = proposal.typeNotes || [];
    const $types = $("#aiProposalTypes").empty();
    typeNotes.forEach((line) => $types.append($("<li>").text(line)));
    $("#aiProposalTypesBlock").prop("hidden", typeNotes.length === 0);
    const warnings = proposal.warnings || [];
    const $warnings = $("#aiProposalWarnings").empty();
    warnings.forEach((line) => $warnings.append($("<li>").text(line)));
    $("#aiProposalWarningBlock").prop("hidden", warnings.length === 0);
    $("#aiProposal").prop("hidden", false);
    $("#aiProposalApply").trigger("focus");
  }

  function currentFingerprint() {
    return snapshotApi.fingerprintOf(snapshotApi.snapshotFromGraph(api.graph.toJSON()));
  }

  function flushDiagram() {
    if (!api.flushSave) {
      return Promise.resolve({ ok: false, message: "No se pudo guardar el diagrama antes de consultar la IA." });
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({ ok: false, message: "No se pudo guardar el diagrama antes de consultar la IA." });
      }, 8000);
      api.flushSave().then((result) => {
        clearTimeout(timer);
        resolve(result || { ok: false, message: "No se pudo guardar el diagrama." });
      });
    });
  }

  function finishWait() {
    setBusy(false);
    setStatus("");
    $("#aiSendBtn").text("Enviar");
    $("#aiProposalApply, #aiProposalCancel").prop("disabled", false);
  }

  function showFailure(message) {
    finishWait();
    appendMessage("system", message);
    if (window.Toast) window.Toast.error(message);
  }

  function beginRequest() {
    cancelPendingProposal();
    generation += 1;
    setBusy(true);
    $("#aiSendBtn").text("Pensando…");
    return generation;
  }

  async function saveCurrentDiagram(ticket) {
    setStatus("Guardando el diagrama");
    const saved = await flushDiagram();
    if (ticket !== generation) return null;
    return saved;
  }

  async function submitText(text, ticket) {
    const saved = await saveCurrentDiagram(ticket);
    if (!saved || ticket !== generation) return;
    if (!saved.ok) {
      $("#aiTextInput").val(text);
      showFailure(saved.message || "No se pudo guardar el diagrama.");
      return;
    }
    appendMessage("user", text);
    setStatus("Pensando");
    socket.emit("ai:command", { text, generation: ticket });
  }

  async function submitImage(text, file, ticket) {
    const saved = await saveCurrentDiagram(ticket);
    if (!saved || ticket !== generation) return;
    if (!saved.ok) {
      if (text) $("#aiTextInput").val(text);
      showFailure(saved.message || "No se pudo guardar el diagrama.");
      return;
    }
    appendMessage("user", text ? text + "\n" + (file.name || "imagen") : file.name || "imagen");
    setStatus("Leyendo la imagen");
    const formData = new FormData();
    formData.append("image", file, file.name || "diagrama.png");
    formData.append("shareToken", api.ROOM.shareToken);
    formData.append("instruction", text);
    try {
      const response = await fetch("/api/ai/image", { method: "POST", body: formData });
      const data = await response.json().catch(() => null);
      if (ticket !== generation) return;
      if (!response.ok) {
        showFailure((data && data.error) || "No se pudo analizar la imagen.");
        return;
      }
      deliverResult(data, ticket);
    } catch (error) {
      if (ticket !== generation) return;
      showFailure("No se pudo analizar la imagen.");
    }
  }

  function deliverResult(data, ticket) {
    if (ticket !== generation) return;
    finishWait();
    if (data.proposal) {
      appendMessage("assistant", data.proposal.message || data.reply || "Hay una propuesta lista para aplicar.");
      setStatus("Revisa y aplica");
      showProposal(data.proposal);
      return;
    }
    if (data.reply) {
      appendMessage("assistant", data.reply, data.needsClarification ? "is-question" : "");
    }
    (data.warnings || []).forEach((warning) => appendMessage("system", warning));
  }

  socket.on("ai:proposal", (data) => deliverResult({ proposal: data, reply: data.message }, data.generation));

  socket.on("ai:result", (data) => {
    if (data.generation !== generation) return;
    finishWait();
    hideProposal();
    if (data.reply) {
      appendMessage("assistant", data.reply, data.needsClarification ? "is-question" : "");
    }
    (data.warnings || []).forEach((warning) => appendMessage("system", warning));
    (data.skipped || []).forEach((reason) => {
      appendMessage("system", reason);
      if (window.Toast) window.Toast.warning(reason);
    });
    if (data.appliedCount > 0) {
      clearAttachment();
      if (!data.skipped || data.skipped.length === 0) {
        if (window.Toast) window.Toast.success("Cambios aplicados en la sala.");
      }
      if (api.flushSave) api.flushSave();
    }
  });

  async function submitInstruction() {
    const text = $("#aiTextInput").val().trim();
    const file = attachedFile;
    if ((!text && !file) || waitingForAi) return;
    $("#aiTextInput").val("");
    const ticket = beginRequest();
    if (file) await submitImage(text, file, ticket);
    else await submitText(text, ticket);
  }

  $("#aiSendBtn").on("click", submitInstruction);

  $("#aiTextInput").on("keydown", function (evt) {
    if (evt.key === "Enter") {
      evt.preventDefault();
      submitInstruction();
    }
  });

  $("#aiImageInput").on("change", function () {
    const file = this.files && this.files[0];
    this.value = "";
    if (file) setAttachment(file);
  });

  $("#aiAttachmentRemove").on("click", clearAttachment);

  $("#aiProposalCancel").on("click", function () {
    cancelPendingProposal();
    setStatus("");
    appendMessage("system", "Propuesta cancelada.");
  });

  $("#aiProposalApply").on("click", async function () {
    if (!pendingProposalId || waitingForAi) return;
    const proposalId = pendingProposalId;
    const ticket = generation;
    hideProposal();
    setBusy(true);
    $("#aiProposalApply, #aiProposalCancel").prop("disabled", true);
    const saved = await saveCurrentDiagram(ticket);
    if (ticket !== generation) return;
    if (!saved || !saved.ok) {
      showFailure((saved && saved.message) || "No se pudo guardar el diagrama.");
      return;
    }
    setStatus("Aplicando");
    socket.emit("ai:apply", {
      proposalId,
      fingerprint: currentFingerprint(),
      generation: ticket,
    });
  });

  let mediaRecorder = null;
  let audioChunks = [];
  let recordingStartedAt = 0;
  let holdToTalk = false;
  let recordingTicket = 0;

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

  function discardStream(stream) {
    if (!stream) return;
    stream.getTracks().forEach((track) => track.stop());
  }

  function startRecording() {
    if (waitingForAi || holdToTalk) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      appendMessage("system", "Tu navegador no soporta grabación de audio.");
      if (window.Toast) window.Toast.warning("Tu navegador no soporta grabación de audio.");
      return;
    }
    holdToTalk = true;
    const ticket = ++recordingTicket;
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        if (!holdToTalk || ticket !== recordingTicket) {
          discardStream(stream);
          return;
        }
        audioChunks = [];
        const preferredType = pickSupportedMimeType();
        mediaRecorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined);
        recordingStartedAt = Date.now();
        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) audioChunks.push(e.data);
        };
        mediaRecorder.onstop = () => {
          discardStream(stream);
          const recorder = mediaRecorder;
          mediaRecorder = null;
          const durationMs = Date.now() - recordingStartedAt;
          if (durationMs < 400 || audioChunks.length === 0) {
            const msg = "La grabación fue muy corta. Mantén presionado el micrófono y dicta.";
            appendMessage("system", msg);
            if (window.Toast) window.Toast.warning(msg);
            return;
          }
          const actualType = (recorder && recorder.mimeType) || preferredType || "audio/webm";
          transcribeAndSend(new Blob(audioChunks, { type: actualType }), actualType);
        };
        mediaRecorder.start(200);
        $("#aiMicBtn").addClass("recording");
      })
      .catch(() => {
        holdToTalk = false;
        appendMessage("system", "No se pudo acceder al micrófono. Permite el acceso en el navegador e inténtalo de nuevo.");
        if (window.Toast) window.Toast.error("No se pudo acceder al micrófono.");
      });
  }

  function stopRecording() {
    holdToTalk = false;
    recordingTicket += 1;
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
    $("#aiMicBtn").removeClass("recording");
  }

  function transcribeAndSend(blob, mimeType) {
    appendMessage("system", "Transcribiendo audio…");
    const formData = new FormData();
    formData.append("audio", blob, "voice." + extensionForMimeType(mimeType));
    fetch("/api/voice/transcribe", { method: "POST", body: formData, credentials: "same-origin" })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ data }) => {
        const text = data && typeof data.text === "string" ? data.text.trim() : "";
        if (text) {
          $("#aiTextInput").val(text);
          submitInstruction();
          return;
        }
        const msg = (data && data.error) || "No se pudo transcribir el audio.";
        appendMessage("system", msg);
        if (window.Toast) window.Toast.error(msg);
      })
      .catch(() => {
        appendMessage("system", "No se pudo transcribir el audio.");
        if (window.Toast) window.Toast.error("No se pudo transcribir el audio.");
      });
  }

  const $mic = $("#aiMicBtn");
  $mic.on("pointerdown", function (evt) {
    if (evt.button !== undefined && evt.button !== 0) return;
    evt.preventDefault();
    if (this.setPointerCapture) this.setPointerCapture(evt.pointerId);
    startRecording();
  });
  $mic.on("pointerup pointercancel", function (evt) {
    if (this.releasePointerCapture && this.hasPointerCapture && this.hasPointerCapture(evt.pointerId)) {
      this.releasePointerCapture(evt.pointerId);
    }
    stopRecording();
  });

  $(window).on("pagehide", revokePreview);
});
