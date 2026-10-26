(function (root) {
  function isBlank(value) {
    return value === undefined || value === null || String(value).trim() === '';
  }

  function coerceField(javaType, raw) {
    if (isBlank(raw)) return { omit: true };
    const text = String(raw).trim();
    if (javaType === 'Boolean') {
      if (/^(true|1|si|sí|yes)$/i.test(text)) return { value: true };
      if (/^(false|0|no)$/i.test(text)) return { value: false };
      return { error: 'Usa true o false.' };
    }
    if (javaType === 'Integer' || javaType === 'Long') {
      if (!/^-?\d+$/.test(text)) return { error: 'Debe ser un entero.' };
      return { value: Number(text) };
    }
    if (javaType === 'Double' || javaType === 'Float') {
      const number = Number(text.replace(',', '.'));
      if (!Number.isFinite(number)) return { error: 'Debe ser un número.' };
      return { value: number };
    }
    if (javaType === 'LocalDate' && !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return { error: 'Usa fecha AAAA-MM-DD.' };
    }
    return { value: text };
  }

  function payloadFromValues(attributes, values) {
    const body = {};
    const errors = [];
    (attributes || [])
      .filter((item) => !item.primaryKey)
      .forEach((item) => {
        const result = coerceField(item.type, values[item.name]);
        if (result.error) errors.push(item.name + ': ' + result.error);
        else if (!result.omit) body[item.name] = result.value;
      });
    return { ok: errors.length === 0, body, errors };
  }

  const api = { coerceField, payloadFromValues };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JsonFields = api;
})(typeof window !== 'undefined' ? window : globalThis);
