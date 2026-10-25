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

const JAVA_TO_OPENAPI = {
  String: { type: 'string' },
  Integer: { type: 'integer', format: 'int32' },
  Long: { type: 'integer', format: 'int64' },
  Double: { type: 'number', format: 'double' },
  Float: { type: 'number', format: 'float' },
  Boolean: { type: 'boolean' },
  LocalDate: { type: 'string', format: 'date' },
  LocalDateTime: { type: 'string', format: 'date-time' },
  UUID: { type: 'string', format: 'uuid' },
};

const JAVA_IMPORTS = {
  LocalDate: 'java.time.LocalDate',
  LocalDateTime: 'java.time.LocalDateTime',
  UUID: 'java.util.UUID',
};

function mapJavaType(raw) {
  const text = String(raw || 'String').trim();
  const compact = text.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  if (UML_TO_JAVA[compact]) return UML_TO_JAVA[compact];
  if (JAVA_TO_OPENAPI[text]) return text;
  return 'String';
}

function openApiSchema(javaType) {
  return JAVA_TO_OPENAPI[javaType] || { type: 'string' };
}

function javaImport(javaType) {
  return JAVA_IMPORTS[javaType] || '';
}

module.exports = { mapJavaType, openApiSchema, javaImport };
