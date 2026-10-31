const { javaImport } = require('./types');
const { camel } = require('./buildBackendModel');

function pkgPath(packageName) {
  return 'src/main/java/' + packageName.replace(/\./g, '/');
}

function usesMongo(configuration) {
  return configuration && configuration.database === 'mongodb';
}

function fieldJava(attribute, configuration) {
  const lines = [];
  if (attribute.primaryKey) {
    lines.push('    @Id');
    if (!usesMongo(configuration)) lines.push('    @GeneratedValue(strategy = GenerationType.IDENTITY)');
  }
  if (attribute.type === 'String' && attribute.name.toLowerCase().includes('email')) {
    lines.push('    @Email');
  }
  if (attribute.type === 'LocalDate') {
    lines.push('    @JsonFormat(pattern = "yyyy-MM-dd")');
  }
  if (attribute.type === 'LocalDateTime') {
    lines.push('    @JsonFormat(pattern = "yyyy-MM-dd\'T\'HH:mm:ss")');
  }
  lines.push('    private ' + attribute.type + ' ' + attribute.name + ';');
  return lines.join('\n');
}

function accessors(attribute) {
  const method = attribute.name.charAt(0).toUpperCase() + attribute.name.slice(1);
  return [
    '    public ' + attribute.type + ' get' + method + '() {',
    '        return ' + attribute.name + ';',
    '    }',
    '',
    '    public void set' + method + '(' + attribute.type + ' ' + attribute.name + ') {',
    '        this.' + attribute.name + ' = ' + attribute.name + ';',
    '    }',
  ].join('\n');
}

function extraImports(attributes, configuration) {
  const imports = new Set(['jakarta.validation.constraints.*', 'com.fasterxml.jackson.annotation.JsonFormat']);
  if (usesMongo(configuration)) imports.add('org.springframework.data.annotation.Id');
  else imports.add('jakarta.persistence.*');
  attributes.forEach((item) => {
    const extra = javaImport(item.type);
    if (extra) imports.add(extra);
  });
  return Array.from(imports)
    .sort()
    .map((item) => 'import ' + item + ';')
    .join('\n');
}

function relationFields(entity, relationships) {
  const lines = [];
  relationships.forEach((relation) => {
    if (relation.source === entity.name && (relation.type === 'ONE_TO_MANY' || relation.type === 'MANY_TO_MANY')) {
      const many = relation.type === 'MANY_TO_MANY';
      lines.push('    @' + (many ? 'ManyToMany' : 'OneToMany(mappedBy = "' + camel(entity.name) + '")'));
      lines.push('    private java.util.List<' + relation.target + '> ' + camel(relation.target) + 's = new java.util.ArrayList<>();');
    }
    if (relation.target === entity.name && (relation.type === 'ONE_TO_MANY' || relation.type === 'MANY_TO_ONE')) {
      lines.push('    @ManyToOne');
      lines.push('    @JoinColumn(name = "' + camel(relation.source) + '_id")');
      lines.push('    private ' + relation.source + ' ' + camel(relation.source) + ';');
    }
    if (relation.source === entity.name && relation.type === 'MANY_TO_ONE') {
      lines.push('    @ManyToOne');
      lines.push('    @JoinColumn(name = "' + camel(relation.target) + '_id")');
      lines.push('    private ' + relation.target + ' ' + camel(relation.target) + ';');
    }
  });
  return lines.join('\n');
}

function entityFile(packageName, entity, relationships, configuration) {
  const header = usesMongo(configuration)
    ? ['import org.springframework.data.mongodb.core.mapping.Document;', '', '@Document(collection = "' + entity.table + '")']
    : ['@Entity', '@Table(name = "' + entity.table + '")'];
  return [
    'package ' + packageName + '.entity;',
    '',
    extraImports(entity.attributes, configuration),
    header[0].startsWith('import') ? header.join('\n') : '\n' + header.join('\n'),
    'public class ' + entity.name + ' {',
    '',
    entity.attributes.map((item) => fieldJava(item, configuration)).join('\n\n'),
    !usesMongo(configuration) && relationFields(entity, relationships) ? '\n' + relationFields(entity, relationships) : '',
    '',
    entity.attributes.map(accessors).join('\n\n'),
    '}',
    '',
  ].join('\n');
}

function dtoField(attribute) {
  const lines = [];
  if (attribute.type === 'String' && attribute.name.toLowerCase().includes('email')) {
    lines.push('    @Email');
  }
  if (attribute.type === 'LocalDate') lines.push('    @JsonFormat(pattern = "yyyy-MM-dd")');
  if (attribute.type === 'LocalDateTime') lines.push('    @JsonFormat(pattern = "yyyy-MM-dd\'T\'HH:mm:ss")');
  lines.push('    private ' + attribute.type + ' ' + attribute.name + ';');
  return lines.join('\n');
}

function dtoFile(packageName, entity, kind) {
  const typeName = entity.name + kind;
  const fields = entity.attributes.filter((item) => kind !== 'CreateRequest' || !item.primaryKey);
  const imports = new Set(['jakarta.validation.constraints.*', 'com.fasterxml.jackson.annotation.JsonFormat']);
  fields.forEach((item) => {
    const extra = javaImport(item.type);
    if (extra) imports.add(extra);
  });
  return [
    'package ' + packageName + '.dto;',
    '',
    Array.from(imports).sort().map((item) => 'import ' + item + ';').join('\n'),
    '',
    'public class ' + typeName + ' {',
    '',
    fields.map(dtoField).join('\n\n'),
    '',
    fields.map(accessors).join('\n\n'),
    '}',
    '',
  ].join('\n');
}

function mongoSequenceService(packageName) {
  return [
    'package ' + packageName + '.support;',
    '',
    'import org.springframework.data.annotation.Id;',
    'import org.springframework.data.mongodb.core.FindAndModifyOptions;',
    'import org.springframework.data.mongodb.core.MongoOperations;',
    'import org.springframework.data.mongodb.core.mapping.Document;',
    'import org.springframework.data.mongodb.core.query.Query;',
    'import org.springframework.data.mongodb.core.query.Update;',
    'import org.springframework.stereotype.Service;',
    '',
    'import static org.springframework.data.mongodb.core.query.Criteria.where;',
    '',
    '@Service',
    'public class MongoSequenceService {',
    '',
    '    @Document(collection = "trazo_sequences")',
    '    public static class Sequence {',
    '        @Id',
    '        private String id;',
    '        private long value;',
    '',
    '        public String getId() { return id; }',
    '        public void setId(String id) { this.id = id; }',
    '        public long getValue() { return value; }',
    '        public void setValue(long value) { this.value = value; }',
    '    }',
    '',
    '    private final MongoOperations mongo;',
    '',
    '    public MongoSequenceService(MongoOperations mongo) {',
    '        this.mongo = mongo;',
    '    }',
    '',
    '    public long next(String collection) {',
    '        Sequence next = mongo.findAndModify(',
    '            Query.query(where("_id").is(collection)),',
    '            new Update().inc("value", 1),',
    '            FindAndModifyOptions.options().returnNew(true).upsert(true),',
    '            Sequence.class',
    '        );',
    '        return next == null ? 1L : next.getValue();',
    '    }',
    '}',
    '',
  ].join('\n');
}

function repositoryFile(packageName, entity, configuration) {
  const base = usesMongo(configuration)
    ? 'org.springframework.data.mongodb.repository.MongoRepository'
    : 'org.springframework.data.jpa.repository.JpaRepository';
  return [
    'package ' + packageName + '.repository;',
    '',
    'import ' + packageName + '.entity.' + entity.name + ';',
    'import ' + base + ';',
    '',
    'public interface ' + entity.name + 'Repository extends ' + (usesMongo(configuration) ? 'MongoRepository' : 'JpaRepository') + '<' + entity.name + ', Long> {',
    '}',
    '',
  ].join('\n');
}

function serviceFile(packageName, entity, configuration) {
  const repo = camel(entity.name) + 'Repository';
  const mongo = usesMongo(configuration);
  const fields = [
    '    private final ' + entity.name + 'Repository ' + repo + ';',
    mongo ? '    private final ' + packageName + '.support.MongoSequenceService mongoSequenceService;' : '',
  ].filter(Boolean);
  const ctorArgs = mongo
    ? entity.name + 'Repository ' + repo + ', ' + packageName + '.support.MongoSequenceService mongoSequenceService'
    : entity.name + 'Repository ' + repo;
  const ctorBody = mongo
    ? '        this.' + repo + ' = ' + repo + ';\n        this.mongoSequenceService = mongoSequenceService;'
    : '        this.' + repo + ' = ' + repo + ';';
  const createBody = mongo
    ? '        entity.setId(mongoSequenceService.next("' + entity.table + '"));\n        return ' + repo + '.save(entity);'
    : '        entity.setId(null);\n        return ' + repo + '.save(entity);';
  return [
    'package ' + packageName + '.service;',
    '',
    'import ' + packageName + '.entity.' + entity.name + ';',
    'import ' + packageName + '.repository.' + entity.name + 'Repository;',
    'import org.springframework.http.HttpStatus;',
    'import org.springframework.stereotype.Service;',
    'import org.springframework.web.server.ResponseStatusException;',
    '',
    'import java.util.List;',
    '',
    '@Service',
    'public class ' + entity.name + 'Service {',
    '',
    fields.join('\n'),
    '',
    '    public ' + entity.name + 'Service(' + ctorArgs + ') {',
    ctorBody,
    '    }',
    '',
    '    public List<' + entity.name + '> list() {',
    '        return ' + repo + '.findAll();',
    '    }',
    '',
    '    public ' + entity.name + ' find(Long id) {',
    '        return ' + repo + '.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));',
    '    }',
    '',
    '    public ' + entity.name + ' create(' + entity.name + ' entity) {',
    createBody,
    '    }',
    '',
    '    public ' + entity.name + ' update(Long id, ' + entity.name + ' incoming) {',
    '        ' + entity.name + ' current = find(id);',
    '        incoming.setId(current.getId());',
    '        return ' + repo + '.save(incoming);',
    '    }',
    '',
    '    public void delete(Long id) {',
    '        find(id);',
    '        ' + repo + '.deleteById(id);',
    '    }',
    '}',
    '',
  ].join('\n');
}

function controllerFile(packageName, entity) {
  const service = camel(entity.name) + 'Service';
  return [
    'package ' + packageName + '.controller;',
    '',
    'import ' + packageName + '.entity.' + entity.name + ';',
    'import ' + packageName + '.service.' + entity.name + 'Service;',
    'import jakarta.validation.Valid;',
    'import org.springframework.http.HttpStatus;',
    'import org.springframework.web.bind.annotation.*;',
    '',
    'import java.util.List;',
    '',
    '@RestController',
    '@RequestMapping("' + entity.endpoint + '")',
    'public class ' + entity.name + 'Controller {',
    '',
    '    private final ' + entity.name + 'Service ' + service + ';',
    '',
    '    public ' + entity.name + 'Controller(' + entity.name + 'Service ' + service + ') {',
    '        this.' + service + ' = ' + service + ';',
    '    }',
    '',
    '    @GetMapping',
    '    public List<' + entity.name + '> list() {',
    '        return ' + service + '.list();',
    '    }',
    '',
    '    @GetMapping("/{id}")',
    '    public ' + entity.name + ' find(@PathVariable Long id) {',
    '        return ' + service + '.find(id);',
    '    }',
    '',
    '    @PostMapping',
    '    @ResponseStatus(HttpStatus.CREATED)',
    '    public ' + entity.name + ' create(@Valid @RequestBody ' + entity.name + ' body) {',
    '        return ' + service + '.create(body);',
    '    }',
    '',
    '    @PutMapping("/{id}")',
    '    public ' + entity.name + ' update(@PathVariable Long id, @Valid @RequestBody ' + entity.name + ' body) {',
    '        return ' + service + '.update(id, body);',
    '    }',
    '',
    '    @DeleteMapping("/{id}")',
    '    @ResponseStatus(HttpStatus.NO_CONTENT)',
    '    public void delete(@PathVariable Long id) {',
    '        ' + service + '.delete(id);',
    '    }',
    '}',
    '',
  ].join('\n');
}

function apiErrorHandler(packageName) {
  return [
    'package ' + packageName + '.controller;',
    '',
    'import java.util.Map;',
    'import org.springframework.http.ResponseEntity;',
    'import org.springframework.http.converter.HttpMessageNotReadableException;',
    'import org.springframework.web.bind.MethodArgumentNotValidException;',
    'import org.springframework.web.bind.annotation.ExceptionHandler;',
    'import org.springframework.web.bind.annotation.RestControllerAdvice;',
    '',
    '@RestControllerAdvice',
    'public class ApiErrorHandler {',
    '    @ExceptionHandler(MethodArgumentNotValidException.class)',
    '    public ResponseEntity<Map<String, String>> validation(MethodArgumentNotValidException error) {',
    '        String detail = error.getBindingResult().getFieldErrors().stream()',
    '            .map(item -> item.getField() + ": " + item.getDefaultMessage())',
    '            .findFirst().orElse("Datos inválidos");',
    '        return ResponseEntity.badRequest().body(Map.of("error", detail));',
    '    }',
    '',
    '    @ExceptionHandler(HttpMessageNotReadableException.class)',
    '    public ResponseEntity<Map<String, String>> unreadable(HttpMessageNotReadableException error) {',
    '        return ResponseEntity.badRequest().body(Map.of("error", "El JSON no coincide con los tipos del backend. Revisa números, booleanos y fechas."));',
    '    }',
    '',
    '    @ExceptionHandler(org.springframework.dao.DataAccessException.class)',
    '    public ResponseEntity<Map<String, String>> data(org.springframework.dao.DataAccessException error) {',
    '        return ResponseEntity.status(503).body(Map.of("error", "No se pudo persistir. Si usas MongoDB, arranca mongod; la base y las colecciones se crean al primer POST."));',
    '    }',
    '}',
    '',
  ].join('\n');
}

function healthController(packageName) {
  return [
    'package ' + packageName + '.controller;',
    '',
    'import java.util.Map;',
    'import org.springframework.web.bind.annotation.GetMapping;',
    'import org.springframework.web.bind.annotation.RestController;',
    '',
    '@RestController',
    'public class HealthController {',
    '    @GetMapping("/api/health")',
    '    public Map<String, String> health() {',
    '        return Map.of("status", "UP");',
    '    }',
    '}',
    '',
  ].join('\n');
}

function applicationFile(packageName, configuration) {
  if (usesMongo(configuration)) {
    return [
      'package ' + packageName + ';',
      '',
      'import org.springframework.boot.SpringApplication;',
      'import org.springframework.boot.autoconfigure.SpringBootApplication;',
      'import org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration;',
      'import org.springframework.boot.autoconfigure.orm.jpa.HibernateJpaAutoConfiguration;',
      'import org.springframework.data.mongodb.repository.config.EnableMongoRepositories;',
      '',
      '@SpringBootApplication(exclude = {DataSourceAutoConfiguration.class, HibernateJpaAutoConfiguration.class})',
      '@EnableMongoRepositories',
      'public class Application {',
      '    public static void main(String[] args) {',
      '        SpringApplication.run(Application.class, args);',
      '    }',
      '}',
      '',
    ].join('\n');
  }
  return [
    'package ' + packageName + ';',
    '',
    'import org.springframework.boot.SpringApplication;',
    'import org.springframework.boot.autoconfigure.SpringBootApplication;',
    '',
    '@SpringBootApplication',
    'public class Application {',
    '    public static void main(String[] args) {',
    '        SpringApplication.run(Application.class, args);',
    '    }',
    '}',
    '',
  ].join('\n');
}

function yamlQuote(value) {
  return "'" + String(value ?? '').replace(/'/g, "''") + "'";
}

function applicationYml(configuration) {
  if (usesMongo(configuration)) {
    return [
      'server:',
      '  port: 8081',
      'spring:',
      '  data:',
      '    mongodb:',
      '      uri: mongodb://127.0.0.1:27017/trazo_generated',
      '      database: trazo_generated',
      '      auto-index-creation: true',
      '  jackson:',
      '    deserialization:',
      '      fail-on-unknown-properties: false',
      'springdoc:',
      '  swagger-ui:',
      '    path: /swagger-ui.html',
      '',
    ].join('\n');
  }
  if (configuration.database === 'postgresql') {
    const db = configuration.datasource || {};
    const host = db.host || '127.0.0.1';
    const port = db.port || '5432';
    const name = db.name || 'trazo_generated';
    return [
      'server:',
      '  port: 8081',
      'spring:',
      '  datasource:',
      '    url: jdbc:postgresql://' + host + ':' + port + '/' + name,
      '    username: ' + yamlQuote(db.username || 'postgres'),
      '    password: ' + yamlQuote(db.password || 'postgres'),
      '  jpa:',
      '    database-platform: org.hibernate.dialect.PostgreSQLDialect',
      '    hibernate:',
      '      ddl-auto: update',
      '  jackson:',
      '    deserialization:',
      '      fail-on-unknown-properties: false',
      'springdoc:',
      '  swagger-ui:',
      '    path: /swagger-ui.html',
      '',
    ].join('\n');
  }
  return [
    'server:',
    '  port: 8081',
    'spring:',
    '  jackson:',
    '    deserialization:',
    '      fail-on-unknown-properties: false',
    '  datasource:',
    '    url: jdbc:h2:mem:trazo;DB_CLOSE_DELAY=-1',
    '    driver-class-name: org.h2.Driver',
    '    username: sa',
    '    password:',
    '  jpa:',
    '    hibernate:',
    '      ddl-auto: update',
    '  h2:',
    '    console:',
    '      enabled: true',
    'springdoc:',
    '  swagger-ui:',
    '    path: /swagger-ui.html',
    '',
  ].join('\n');
}

function pomXml(model) {
  const dataStarter = usesMongo(model.configuration)
    ? 'spring-boot-starter-data-mongodb'
    : 'spring-boot-starter-data-jpa';
  const dbDep = usesMongo(model.configuration)
    ? ''
    : model.configuration.database === 'postgresql'
      ? `        <dependency>
            <groupId>org.postgresql</groupId>
            <artifactId>postgresql</artifactId>
            <scope>runtime</scope>
        </dependency>`
      : `        <dependency>
            <groupId>com.h2database</groupId>
            <artifactId>h2</artifactId>
            <scope>runtime</scope>
        </dependency>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>${model.configuration.springBootVersion}</version>
        <relativePath/>
    </parent>
    <groupId>${model.project.groupId}</groupId>
    <artifactId>${model.project.artifactId}</artifactId>
    <version>1.0.0</version>
    <name>${model.project.name}</name>
    <properties>
        <java.version>${model.configuration.javaVersion}</java.version>
    </properties>
    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-validation</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>${dataStarter}</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springdoc</groupId>
            <artifactId>springdoc-openapi-starter-webmvc-ui</artifactId>
            <version>2.6.0</version>
        </dependency>
${dbDep}
    </dependencies>
    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
            </plugin>
        </plugins>
    </build>
</project>
`;
}

function readme(model) {
  const source = model.configuration.datasource || {};
  const db =
    model.configuration.database === 'postgresql'
      ? 'PostgreSQL en ' + (source.host || '127.0.0.1') + ':' + (source.port || '5432') + '/' + (source.name || 'trazo_generated')
      : usesMongo(model.configuration)
        ? 'MongoDB en 127.0.0.1:27017. La base `trazo_generated` y cada colección se crean solas al primer POST.'
        : 'H2 en memoria';
  return [
    '# TRAZO Generated Backend',
    '',
    'Backend generado desde un diagrama UML de TRAZO. El contrato está en `openapi.yaml`.',
    '',
    '## Requisitos',
    '',
    '- Java ' + model.configuration.javaVersion + ' o superior',
    '- Maven 3.9+ (`brew install maven` en macOS)',
    '',
    '## Base de datos',
    '',
    db,
    '',
    '## Ejecutar',
    '',
    '```bash',
    'mvn spring-boot:run',
    '```',
    '',
    'API: http://localhost:8081',
    '',
    'Swagger: http://localhost:8081/swagger-ui.html',
    '',
    '## Entidades',
    '',
    model.entities.map((entity) => '- `' + entity.name + '` → `' + entity.endpoint + '`').join('\n'),
    '',
  ].join('\n');
}

function writeSpringFiles(model, openApiYaml) {
  const root = model.project.artifactId + '/';
  const base = root + pkgPath(model.project.packageName);
  const files = {
    [root + 'pom.xml']: pomXml(model),
    [root + 'openapi.yaml']: openApiYaml,
    [root + 'README.md']: readme(model),
    [root + 'src/main/resources/application.yml']: applicationYml(model.configuration),
    [base + '/Application.java']: applicationFile(model.project.packageName, model.configuration),
    [base + '/controller/HealthController.java']: healthController(model.project.packageName),
    [base + '/controller/ApiErrorHandler.java']: apiErrorHandler(model.project.packageName),
  };
  if (usesMongo(model.configuration)) {
    files[base + '/support/MongoSequenceService.java'] = mongoSequenceService(model.project.packageName);
  }
  model.entities.forEach((entity) => {
    files[base + '/entity/' + entity.name + '.java'] = entityFile(model.project.packageName, entity, model.relationships, model.configuration);
    files[base + '/dto/' + entity.name + 'CreateRequest.java'] = dtoFile(model.project.packageName, entity, 'CreateRequest');
    files[base + '/dto/' + entity.name + 'Response.java'] = dtoFile(model.project.packageName, entity, 'Response');
    files[base + '/repository/' + entity.name + 'Repository.java'] = repositoryFile(model.project.packageName, entity, model.configuration);
    files[base + '/service/' + entity.name + 'Service.java'] = serviceFile(model.project.packageName, entity, model.configuration);
    files[base + '/controller/' + entity.name + 'Controller.java'] = controllerFile(model.project.packageName, entity);
  });
  return files;
}

module.exports = { writeSpringFiles };
