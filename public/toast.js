/**
 * Toast system — annotation-style notices for validation, DB and network errors.
 * Usage: Toast.show('message', 'error' | 'success' | 'warning' | 'info', { duration })
 */
(function (global) {
  const ICONS = {
    error: "!",
    warning: "!",
    success: "✓",
    info: "i",
  };

  const DEFAULT_DURATION = {
    error: 5200,
    warning: 4200,
    success: 2800,
    info: 3200,
  };

  function ensureContainer() {
    let el = document.getElementById("toastContainer");
    if (!el) {
      el = document.createElement("div");
      el.id = "toastContainer";
      el.setAttribute("aria-live", "polite");
      el.setAttribute("aria-relevant", "additions");
      document.body.appendChild(el);
    }
    return el;
  }

  function show(message, type, options) {
    if (!message) return;
    const kind = type && ICONS[type] ? type : "info";
    const opts = options || {};
    const duration = opts.duration != null ? opts.duration : DEFAULT_DURATION[kind];
    const container = ensureContainer();

    const toast = document.createElement("div");
    toast.className = "toast toast--" + kind;
    toast.setAttribute("role", kind === "error" ? "alert" : "status");

    const icon = document.createElement("span");
    icon.className = "toast__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = ICONS[kind];

    const body = document.createElement("div");
    body.className = "toast__body";

    const text = document.createElement("p");
    text.className = "toast__text";
    text.textContent = String(message);
    body.appendChild(text);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "toast__close";
    close.setAttribute("aria-label", "Cerrar aviso");
    close.textContent = "×";

    toast.appendChild(icon);
    toast.appendChild(body);
    toast.appendChild(close);
    container.appendChild(toast);

    requestAnimationFrame(function () {
      toast.classList.add("is-visible");
    });

    let removed = false;
    function dismiss() {
      if (removed) return;
      removed = true;
      toast.classList.remove("is-visible");
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 220);
    }

    close.addEventListener("click", dismiss);
    const timer = setTimeout(dismiss, duration);
    toast.addEventListener("mouseenter", function () {
      clearTimeout(timer);
    });

    return { dismiss: dismiss };
  }

  function fromFlash(flash) {
    if (!flash || !flash.message) return;
    show(flash.message, flash.type || "info");
  }

  global.Toast = {
    show: show,
    error: function (m, o) {
      return show(m, "error", o);
    },
    success: function (m, o) {
      return show(m, "success", o);
    },
    warning: function (m, o) {
      return show(m, "warning", o);
    },
    info: function (m, o) {
      return show(m, "info", o);
    },
    fromFlash: fromFlash,
  };
})(window);
