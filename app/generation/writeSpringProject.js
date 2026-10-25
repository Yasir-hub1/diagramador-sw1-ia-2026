const { javaImport } = require('./types');
const { camel } = require('./buildBackendModel');

function pkgPath(packageName) {
  return 'src/main/java/' + packageName.replace(/\./g, '/');
}

function fieldJava(attribute) {
  const lines = [];
  if (attribute.primaryKey) {
    lines.push('    @Id');
    lines.push('    @GeneratedValue(strategy = GenerationType.IDENTITY)');
  }
  if (attribute.required && !attribute.primaryKey) {
    if (attribute.type === 'String') {
      lines.push(attribute.name.toLowerCase().includes('email') ? '    @Email' : '    @NotBlank');
    } else {
      lines.push('    @NotNull');
    }
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

function extraImports(attributes) {
  const imports = new Set(['jakarta.persistence.*', 'jakarta.validation.constraints.*']);
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

function entityFile(packageName, entity, relationships) {
  return [
    'package ' + packageName + '.entity;',
    '',
    extraImports(entity.attributes),
    '',
    '@Entity',
    '@Table(name = "' + entity.table + '")',
    'public class ' + entity.name + ' {',
    '',
    entity.attributes.map(fieldJava).join('\n\n'),
    relationFields(entity, relationships) ? '\n' + relationFields(entity, relationships) : '',
    '',
    entity.attributes.map(accessors).join('\n\n'),
    '}',
    '',
  ].join('\n');
}

function dtoField(attribute) {
  const lines = [];
  if (attribute.required && !attribute.primaryKey && attribute.type === 'String') {
    lines.push(attribute.name.toLowerCase().includes('email') ? '    @Email' : '    @NotBlank');
  } else if (attribute.required && !attribute.primaryKey) {
    lines.push('    @NotNull');
  }
  lines.push('    private ' + attribute.type + ' ' + attribute.name + ';');
  return lines.join('\n');
}

function dtoFile(packageName, entity, kind) {
  const typeName = entity.name + kind;
  const fields = entity.attributes.filter((item) => kind !== 'CreateRequest' || !item.primaryKey);
  const imports = new Set(['jakarta.validation.constraints.*']);
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

function repositoryFile(packageName, entity) {
  return [
    'package ' + packageName + '.repository;',
    '',
    'import ' + packageName + '.entity.' + entity.name + ';',
    'import org.springframework.data.jpa.repository.JpaRepository;',
    '',
    'public interface ' + entity.name + 'Repository extends JpaRepository<' + entity.name + ', Long> {',
    '}',
    '',
  ].join('\n');
}

function serviceFile(packageName, entity) {
  const repo = camel(entity.name) + 'Repository';
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
    '    private final ' + entity.name + 'Repository ' + repo + ';',
    '',
    '    public ' + entity.name + 'Service(' + entity.name + 'Repository ' + repo + ') {',
    '        this.' + repo + ' = ' + repo + ';',
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
    '        entity.setId(null);',
    '        return ' + repo + '.save(entity);',
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

function applicationFile(packageName) {
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

function applicationYml(database) {
  if (database === 'postgresql') {
    return [
      'server:',
      '  port: 8081',
      'spring:',
      '  datasource:',
      '    url: jdbc:postgresql://localhost:5432/trazo_generated',
      '    username: postgres',
      '    password: postgres',
      '  jpa:',
      '    hibernate:',
      '      ddl-auto: update',
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
  const dbDep =
    model.configuration.database === 'postgresql'
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
            <artifactId>spring-boot-starter-data-jpa</artifactId>
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
  const db = model.configuration.database === 'postgresql' ? 'PostgreSQL en localhost:5432/trazo_generated' : 'H2 en memoria';
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
    [root + 'src/main/resources/application.yml']: applicationYml(model.configuration.database),
    [base + '/Application.java']: applicationFile(model.project.packageName),
  };
  model.entities.forEach((entity) => {
    files[base + '/entity/' + entity.name + '.java'] = entityFile(model.project.packageName, entity, model.relationships);
    files[base + '/dto/' + entity.name + 'CreateRequest.java'] = dtoFile(model.project.packageName, entity, 'CreateRequest');
    files[base + '/dto/' + entity.name + 'Response.java'] = dtoFile(model.project.packageName, entity, 'Response');
    files[base + '/repository/' + entity.name + 'Repository.java'] = repositoryFile(model.project.packageName, entity);
    files[base + '/service/' + entity.name + 'Service.java'] = serviceFile(model.project.packageName, entity);
    files[base + '/controller/' + entity.name + 'Controller.java'] = controllerFile(model.project.packageName, entity);
  });
  return files;
}

module.exports = { writeSpringFiles };
