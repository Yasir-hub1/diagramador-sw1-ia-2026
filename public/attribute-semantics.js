(function (root) {
  const KNOWN_JAVA = {
    String: true,
    Integer: true,
    Long: true,
    Double: true,
    Float: true,
    Boolean: true,
    LocalDate: true,
    LocalDateTime: true,
    UUID: true,
  };

  const UML_TO_JAVA = {
    string: 'String',
    str: 'String',
    integer: 'Integer',
    int: 'Integer',
    int32: 'Integer',
    long: 'Long',
    int64: 'Long',
    double: 'Double',
    float: 'Float',
    boolean: 'Boolean',
    bool: 'Boolean',
    date: 'LocalDate',
    localdate: 'LocalDate',
    datetime: 'LocalDateTime',
    localdatetime: 'LocalDateTime',
    timestamp: 'LocalDateTime',
    uuid: 'UUID',
  };

  function compact(value) {
    return String(value || '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  }

  function pascal(value) {
    const text = String(value || '').replace(/[^A-Za-z0-9]/g, '');
    if (!text) return '';
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function singularize(value) {
    const text = String(value || '');
    if (/ies$/i.test(text) && text.length > 4) return text.slice(0, -3) + 'y';
    if (/(ses|xes|zes|ches|shes)$/i.test(text)) return text.slice(0, -2);
    if (/s$/i.test(text) && !/ss$/i.test(text) && text.length > 3) return text.slice(0, -1);
    return text;
  }

  function normalizeJavaType(raw) {
    const text = String(raw || 'String').trim();
    const generic = text.match(/^(?:List|Set|Collection)<\s*([A-Z][A-Za-z0-9_]*)\s*>$/);
    if (generic) return text;
    const key = compact(text);
    if (UML_TO_JAVA[key]) return UML_TO_JAVA[key];
    if (KNOWN_JAVA[text]) return text;
    return 'String';
  }

  function includesAny(name, parts) {
    return parts.some((part) => name.includes(part));
  }

  function matchKnownClass(candidate, classNames) {
    const wanted = compact(candidate);
    if (!wanted) return '';
    return (classNames || []).find((item) => compact(item) === wanted) || '';
  }

  function collectionTarget(name, type, classNames) {
    const generic = String(type || '').match(/^(?:List|Set|Collection)<\s*([A-Z][A-Za-z0-9_]*)\s*>$/);
    if (generic) return matchKnownClass(generic[1], classNames) || generic[1];

    const raw = String(name || '');
    const stripped = raw.replace(/^(listOf|listaDe|setOf|arrayOf|lista|list|set)/i, '');
    const looksCollection = stripped !== raw || /^(students|profesores|professors|items|pedidos|productos|clientes)$/i.test(raw);
    if (!looksCollection) return '';
    const singular = singularize(stripped || raw);
    const matched = matchKnownClass(singular, classNames) || matchKnownClass(pascal(singular), classNames);
    if (matched) return matched;
    if (stripped !== raw) return pascal(singular);
    return '';
  }

  function inferScalar(name) {
    const key = compact(name);
    if (!key || key === 'id') return { type: 'Long', reason: 'La clave primaria de JPA es un Long id.' };

    if (includesAny(key, ['phone', 'telefono', 'tel', 'mobile', 'celular', 'whatsapp'])) {
      return {
        type: 'String',
        reason: 'Un teléfono no se opera como número: admite +, ceros a la izquierda y espacios.',
      };
    }
    if (includesAny(key, ['email', 'correo', 'mail'])) {
      return { type: 'String', reason: 'Un correo es texto con formato, no un valor numérico.' };
    }
    if (includesAny(key, ['password', 'token', 'username', 'url', 'uri', 'slug'])) {
      return { type: 'String', reason: 'Identificadores y secretos se persisten como texto.' };
    }
    if (
      includesAny(key, ['dni', 'passport', 'pasaporte', 'nit', 'rfc', 'curp', 'isbn', 'sku']) ||
      /(number|numero|código|codigo|code)$/.test(key) ||
      /(studentid|employeeid|legajo)$/.test(key)
    ) {
      return {
        type: 'String',
        reason: 'Códigos y matrículas se guardan como texto para no perder ceros ni formato.',
      };
    }
    if (includesAny(key, ['fecha', 'date', 'birthday', 'nacimiento', 'createdat', 'updatedat'])) {
      const dateTime = includesAny(key, ['datetime', 'timestamp', 'hora', 'createdat', 'updatedat']);
      return {
        type: dateTime ? 'LocalDateTime' : 'LocalDate',
        reason: dateTime
          ? 'Una marca de tiempo de negocio se modela como LocalDateTime.'
          : 'Una fecha de calendario se modela como LocalDate, no como número.',
      };
    }
    if (/^(is|has|puede|can)/.test(key) || includesAny(key, ['activo', 'active', 'enabled', 'disabled'])) {
      return { type: 'Boolean', reason: 'El nombre describe un sí/no: en JPA eso es Boolean.' };
    }
    if (includesAny(key, ['precio', 'price', 'monto', 'amount', 'saldo', 'costo', 'cost', 'total'])) {
      return { type: 'Double', reason: 'Importes y totales se modelan como Double para el backend.' };
    }
    if (includesAny(key, ['edad', 'age', 'cantidad', 'stock', 'count', 'anio', 'ano', 'year', 'nota', 'score'])) {
      return { type: 'Integer', reason: 'Edades, cantidades y años son enteros, no texto ni Double.' };
    }
    return {
      type: 'String',
      reason: 'Sin una pista semántica más fuerte, String es el tipo persistible por defecto.',
    };
  }

  function decideAttribute(name, declaredType, classNames) {
    const target = collectionTarget(name, declaredType, classNames);
    if (target) {
      return {
        kind: 'relation',
        name,
        target,
        note:
          '«' +
          name +
          '» no es una columna: es una asociación hacia «' +
          target +
          '». En Spring eso se persiste con JPA, no con String.',
      };
    }
    const inferred = inferScalar(name);
    const current = normalizeJavaType(declaredType);
    const changed = current !== inferred.type;
    return {
      kind: 'field',
      name,
      javaType: inferred.type,
      changed,
      note: changed
        ? '«' + name + '»: ' + inferred.type + ' — ' + inferred.reason + ' (venía como ' + current + ').'
        : '«' + name + '»: ' + inferred.type + ' — ' + inferred.reason,
      show: changed || inferred.type !== 'String' || /sin una pista/i.test(inferred.reason) === false,
    };
  }

  function splitAttributeLine(line) {
    const text = String(line || '').trim();
    const match = text.match(/^([+\-#~])\s*([A-Za-z_]\w*)\s*:\s*(.+)$/);
    if (!match) return null;
    return { visibility: match[1], name: match[2], type: match[3].trim() };
  }

  function formatAttribute(visibility, name, javaType) {
    return visibility + ' ' + name + ': ' + javaType;
  }

  function refineAttributeLines(className, lines, classNames) {
    const notes = [];
    const attributes = [];
    const relations = [];
    (lines || []).forEach((line) => {
      const parsed = splitAttributeLine(line);
      if (!parsed) {
        attributes.push(line);
        return;
      }
      const decision = decideAttribute(parsed.name, parsed.type, classNames);
      if (decision.kind === 'relation') {
        relations.push({ source: className, target: decision.target, attribute: parsed.name });
        notes.push(className + ': ' + decision.note);
        return;
      }
      attributes.push(
        decision.changed ? formatAttribute(parsed.visibility, parsed.name, decision.javaType) : line
      );
      if (decision.changed) notes.push(className + ': ' + decision.note);
    });
    return { attributes, relations, notes, changed: notes.length > 0 };
  }

  function relationExists(relationships, sourceName, targetName) {
    return (relationships || []).some((item) => {
      const source = item.sourceName || item.source;
      const target = item.targetName || item.target;
      return (
        (source === sourceName && target === targetName) ||
        (source === targetName && target === sourceName)
      );
    });
  }

  function applySemanticsToUml(uml) {
    const notes = [];
    const classNames = (uml.classes || []).map((item) => item.name);
    (uml.classes || []).forEach((cls) => {
      const kept = [];
      (cls.attributes || []).forEach((attribute) => {
        const decision = decideAttribute(attribute.name, attribute.type, classNames);
        if (decision.kind === 'relation') {
          notes.push(cls.name + ': ' + decision.note);
          if (!relationExists(uml.relationships, cls.name, decision.target)) {
            uml.relationships.push({
              type: 'association',
              sourceName: cls.name,
              targetName: decision.target,
              sourceMultiplicity: '1',
              targetMultiplicity: '0..*',
              kind: 'ONE_TO_MANY',
            });
          }
          return;
        }
        if (decision.changed) {
          notes.push(cls.name + ': ' + decision.note);
          kept.push({ ...attribute, type: decision.javaType });
        } else {
          kept.push(attribute);
        }
      });
      cls.attributes = kept;
    });
    return notes.slice(0, 12);
  }

  const api = {
    normalizeJavaType,
    decideAttribute,
    refineAttributeLines,
    applySemanticsToUml,
    collectionTarget,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.AttributeSemantics = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
