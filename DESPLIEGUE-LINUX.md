# Despliegue de TRAZO en Linux (como root)

Guía para dejar TRAZO en un servidor Ubuntu/Debian **usando siempre el usuario `root`**. Primero HTTP (sin SSL). Después HTTPS.

La app es Node.js (`app/app.js`), plantillas en `views/`, estáticos en `public/`. Escucha en el **puerto 3001**. PostgreSQL guarda usuarios, salas, el grafo UML y las sesiones. Java 17 + Maven sirven para **Generar backend**. Flutter es opcional para el ZIP del frontend. Socket.IO usa `/socket.io/`.

Sustituye en todo el documento:

| Marca | Ejemplo |
| --- | --- |
| `TU_DOMINIO` | `trazo.ejemplo.com` o la IP pública |
| `CLAVE_DB` | contraseña de PostgreSQL |
| `SECRETO_SESION` | cadena larga aleatoria |
| `/opt/trazo/app` | carpeta del código |

---

## 0. Qué instala este documento

| Pieza | Versión / rol |
| --- | --- |
| Ubuntu 22.04 LTS (o Debian 11/12) | Sistema |
| Node.js | 20 LTS |
| PostgreSQL | **12** |
| Nginx | Proxy a `127.0.0.1:3001` + WebSocket |
| OpenJDK | 17 |
| Apache Maven | 3.9.9 |
| systemd | Servicio `trazo` (User=root) |
| Certbot | Solo en la parte SSL |
| Flutter 3.x | Opcional |
| Ollama | Opcional (IA local) |

Trabaja como root:

```bash
whoami   # debe decir: root
```

---

## 1. Sistema y firewall

```bash
apt-get update
apt-get upgrade -y
apt-get install -y ca-certificates curl wget git unzip tar gnupg lsb-release \
  build-essential python3

# Si usas ufw:
apt-get install -y ufw
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 5432/tcp
ufw --force enable
```

Aún **no** abras el 443. Tampoco publiques el 3001. El **5432** sí queda abierto para entrar a Postgres desde fuera.

---

## 2. Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node -v    # v20.x
npm -v
```

---

## 3. PostgreSQL 12

En Ubuntu reciente el paquete por defecto ya no es la 12. Usa el repositorio de PostgreSQL:

```bash
install -d /usr/share/postgresql-common/pgdg
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  | gpg --dearmor -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg

. /etc/os-release
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list

apt-get update
apt-get install -y postgresql-12 postgresql-client-12
systemctl enable --now postgresql
psql --version   # psql (PostgreSQL) 12.x
```

### Usuario y base por defecto

No se crea otro usuario ni otra base. Se usa `postgres` / `postgres` y solo se cambia la clave.

```bash
sudo -u postgres psql <<'SQL'
ALTER USER postgres WITH PASSWORD 'CLAVE_DB';
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL
```

Para conectar **desde fuera** tienen que estar bien **tres** cosas: Postgres escuchando en todas las IPs, `pg_hba.conf` con CIDR válido (`0.0.0.0/0`, no `0.0.0.0`) y el puerto 5432 abierto en el firewall del servidor **y** del proveedor (DigitalOcean, AWS, etc.).

```bash
# 1) Escuchar en todas las interfaces (si no, solo responde en 127.0.0.1)
sed -i "s/^#listen_addresses.*/listen_addresses = '*'/" /etc/postgresql/12/main/postgresql.conf
sed -i "s/^listen_addresses.*/listen_addresses = '*'/" /etc/postgresql/12/main/postgresql.conf
grep listen_addresses /etc/postgresql/12/main/postgresql.conf
# debe verse: listen_addresses = '*'

# 2) Una sola regla remota, el mismo método que 127.0.0.1 (md5).
# No mezcles scram y md5: Postgres usa la primera que coincida.
# Borra a mano en nano las 4 líneas 0.0.0.0/0 y ::/0 y deja solo:
# host    all    all    0.0.0.0/0    md5
# host    all    all    ::/0         md5

# 3) Vuelve a fijar la clave (PG 12 suele guardar scram; si no coincide con pg_hba, falla)
# No pongas la clave en esta línea si tiene * ? $ ! — entra a psql y escríbela ahí (paso de abajo).

ufw allow 5432/tcp
ufw reload
systemctl restart postgresql
```

En el servidor, esto tiene que mostrar `0.0.0.0:5432` o `*:5432`. Si ves `127.0.0.1:5432`, **sigue sin escuchar fuera**:

```bash
ss -lntp | grep 5432
systemctl status postgresql --no-pager
# si no arranca: journalctl -u postgresql -n 40 --no-pager
# casi siempre es una línea mal escrita en pg_hba.conf
```

Local y remoto:

```bash
PGPASSWORD='CLAVE_DB' psql -h 127.0.0.1 -U postgres -d postgres -c 'SELECT 1;'
# Desde tu PC (host = IP pública del VPS, no localhost):
# PGPASSWORD='CLAVE_DB' psql -h IP_DEL_SERVIDOR -U postgres -d postgres
```

Cuando `psql` abra el prompt `postgres=#`, escribe (cambia la clave) y luego `\q`:

```sql
ALTER USER postgres WITH PASSWORD 'CLAVE_DB';
```

En DBeaver: host = IP pública, port `5432`, database `postgres`, user `postgres`, SSL **off**.

Si el servidor responde `FATAL: password authentication failed`, la red ya está bien: **la clave guardada no es la que escribes**. Casi siempre bash comió el `*` al hacer `ALTER USER` en una sola línea. Repite el `ALTER` en el prompt de `psql`, no en `psql -c "..."`.

Si `ss` muestra `*:5432` y la conexión ni llega (timeout), el corte es el firewall de la nube, no el `pg_hba`.

---

## 4. Java 17 y Maven 3.9.9

El generador Spring necesita **Java 17 o más**. Maven lo busca en el `PATH` o en `/root/.trazo/apache-maven-3.9.9`.

```bash
apt-get install -y openjdk-17-jdk
java -version
# openjdk version "17..."

update-alternatives --set java /usr/lib/jvm/java-17-openjdk-amd64/bin/java
# En ARM: java-17-openjdk-arm64

export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
echo 'export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64' >> /root/.bashrc
echo 'export PATH="$JAVA_HOME/bin:$PATH"' >> /root/.bashrc
```

Maven embebido (igual que en desarrollo):

```bash
mkdir -p /root/.trazo
cd /tmp
curl -fsSL https://archive.apache.org/dist/maven/maven-3/3.9.9/binaries/apache-maven-3.9.9-bin.tar.gz -o maven.tgz
tar -xzf maven.tgz -C /root/.trazo
ln -sfn /root/.trazo/apache-maven-3.9.9/bin/mvn /usr/local/bin/mvn
mvn -v
```

---

## 5. Código de TRAZO

```bash
mkdir -p /opt/trazo
cd /opt/trazo

# Opción A: clonar
git clone https://TU_REPO/diagramador-sw1-ia-2026.git app

# Opción B: copiar desde tu máquina
# rsync -a --exclude node_modules --exclude .git ./ root@TU_SERVIDOR:/opt/trazo/app/

cd /opt/trazo/app
npm install --omit=dev
```

`npm run dev` usa nodemon y **no** va en producción. El proceso es:

```bash
node app/app.js
```

Hay que lanzarlo con **cwd** `/opt/trazo/app` para que Express encuentre `views/` y `public/`.

### Tablas

```bash
cd /opt/trazo/app
PGPASSWORD='CLAVE_DB' psql -h 127.0.0.1 -U postgres -d postgres -f database.sql
```

La tabla `session` la crea `connect-pg-simple` al primer arranque. No está en `database.sql`.

---

## 6. Archivo `.env` (fase HTTP, sin SSL)

```bash
nano /opt/trazo/app/.env
```

```env
DB_USER=postgres
DB_HOST=127.0.0.1
DB_NAME=postgres
DB_PASSWORD=CLAVE_DB
DB_PORT=5432
# El Spring generado usa este usuario/clave contra 127.0.0.1/trazo_generated
# CREATE DATABASE trazo_generated;  (como postgres)

SESSION_SECRET=SECRETO_SESION

# Importante en HTTP: no pongas production.
# Con NODE_ENV=production la cookie de sesión lleva Secure y el login
# no funciona si entras por http://
NODE_ENV=development

# IA (elige una línea)
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

# Si usas modelo local en el mismo servidor:
# AI_PROVIDER=ollama
# OLLAMA_BASE_URL=http://127.0.0.1:11434
# OLLAMA_MODEL=qwen3-vl:4b

JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
```

Permisos:

```bash
chmod 600 /opt/trazo/diagramador/.env
```

Genera el secreto:

```bash
openssl rand -hex 32
```
9c76ac76c15f8ae531f898d5b4cc6c49a8019289420e2cffc58d4c4910199661
---

## 7. systemd (proceso como root)

```bash
cat > /etc/systemd/system/trazo.service <<'EOF'
[Unit]
Description=TRAZO diagramador UML
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=/opt/trazo/diagramador
Environment=NODE_ENV=development
EnvironmentFile=/opt/trazo/diagramador/.env
Environment=JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
Environment=PATH=/usr/lib/jvm/java-17-openjdk-amd64/bin:/root/.trazo/apache-maven-3.9.9/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin
ExecStart=/usr/bin/node app/app.js
Restart=on-failure
RestartSec=5
TimeoutStartSec=30

# La IA y Maven pueden tardar
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now trazo
systemctl status trazo --no-pager
journalctl -u trazo -n 50 --no-pager
```

Debe verse: `Servidor corriendo en el puerto 3001`.

Prueba local:

```bash
curl -sI http://127.0.0.1:3001/login
```

---

## 8. Nginx sin SSL (HTTP)

```bash
apt-get install -y nginx
```

```bash
cat > /etc/nginx/sites-available/trazo <<'EOF'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

upstream trazo_node {
    server 127.0.0.1:3001;
    keepalive 32;
}

server {
    listen 80;
    listen [::]:80;
    server_name diagramador.chambi.shop;

    client_max_body_size 12m;

    # Voz e IA pueden tardar más que el proxy por defecto
    proxy_connect_timeout 10s;
    proxy_send_timeout    180s;
    proxy_read_timeout    180s;

    location / {
        proxy_pass http://trazo_node;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        $connection_upgrade;
        proxy_buffering off;
    }

    location /socket.io/ {
        proxy_pass http://trazo_node;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        $connection_upgrade;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_buffering off;
    }
}
EOF

ln -sfn /etc/nginx/sites-available/trazo /etc/nginx/sites-enabled/trazo
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx
```

Abre `http://TU_DOMINIO/register`, crea una cuenta, entra a una sala y comprueba que el lienzo colabora (Socket.IO). Si el chat o el cursor de otros no se mueve, el bloque `/socket.io/` no está haciendo upgrade.

### Comprobar

```bash
curl -sI http://TU_DOMINIO/login
ss -lntp | grep -E '3001|80|5432'
```

---

## 9. Fase HTTP lista: checklist

- [ ] `systemctl is-active trazo` → `active`
- [ ] Login y registro funcionan por `http://`
- [ ] Se crea una sala y el diagrama se guarda al recargar
- [ ] Dos pestañas ven el mismo cambio
- [ ] **Generar backend** (Java + Maven en el PATH del servicio)
- [ ] IA de texto (si hay clave u Ollama)

No pongas `NODE_ENV=production` todavía.

---

## 10. SSL (después de que HTTP funcione)

Necesitas un **nombre DNS** que apunte a la IP del servidor. Let's Encrypt no firma una IP suelta.

### 10.1 Confiar en Nginx (obligatorio)

Con HTTPS, Express debe creer `X-Forwarded-Proto`. En `app/app.js`, **justo después** de `const app = express();`:

```js
app.set('trust proxy', 1);
```

Si no lo pones, con `NODE_ENV=production` la cookie `Secure` no se envía bien y **no podrás iniciar sesión**.

```bash
# vuelve a desplegar el archivo y:
systemctl restart trazo
```

### 10.2 Certificado

```bash
ufw allow 443/tcp
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d diagramador.chambi.shop
```

Certbot reescribe el `server` de Nginx: escucha 443 con el certificado y deja un 80 que redirige a HTTPS.

Renovación:

```bash
systemctl enable --now certbot.timer
certbot renew --dry-run
```

### 10.3 Sitio Nginx final (si lo quieres fijo)

Tras Certbot puedes dejar el sitio así. Ajusta las rutas de los `.pem` si Certbot usó otro nombre:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

upstream trazo_node {
    server 127.0.0.1:3001;
    keepalive 32;
}

server {
    listen 80;
    listen [::]:80;
    server_name TU_DOMINIO;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name TU_DOMINIO;

    ssl_certificate     /etc/letsencrypt/live/TU_DOMINIO/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/TU_DOMINIO/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    client_max_body_size 12m;
    proxy_connect_timeout 10s;
    proxy_send_timeout    180s;
    proxy_read_timeout    180s;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    location / {
        proxy_pass http://trazo_node;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        $connection_upgrade;
        proxy_buffering off;
    }

    location /socket.io/ {
        proxy_pass http://trazo_node;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        $connection_upgrade;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_buffering off;
    }
}
```

```bash
nginx -t && systemctl reload nginx
```

### 10.4 Pasar la app a production

En `/opt/trazo/app/.env`:

```env
NODE_ENV=production
```

En `/etc/systemd/system/trazo.service` cambia:

```
Environment=NODE_ENV=production
```

```bash
systemctl daemon-reload
systemctl restart trazo
```

Entra por `https://TU_DOMINIO/login`. La cookie ya es `Secure`.

---

## 11. Opcional: Flutter (ZIP del frontend)

El generador busca `/root/.trazo/flutter/bin/flutter`.

```bash
cd /tmp
curl -fsSL https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_3.38.3-stable.tar.xz -o flutter.tar.xz
# Usa la URL stable actual de https://docs.flutter.dev/install/archive
tar -xJf flutter.tar.xz -C /root/.trazo
# Si el tar crea /root/.trazo/flutter-... mueve a /root/.trazo/flutter
export PATH="/root/.trazo/flutter/bin:$PATH"
flutter precache --web
/root/.trazo/flutter/bin/flutter --version
```

Añade esa ruta al `PATH=` del unit `trazo.service` y `systemctl daemon-reload && systemctl restart trazo`.

---

## 12. Opcional: Ollama (IA local)

```bash
curl -fsSL https://ollama.com/install.sh | sh
systemctl enable --now ollama
ollama pull qwen3-vl:4b
```

En `.env`: `AI_PROVIDER=ollama`. La voz (Whisper) sigue necesitando `OPENAI_API_KEY` si usas el micrófono.

---

## 13. Actualizar la app

```bash
cd /opt/trazo/app
git pull
npm install --omit=dev
# si cambió database.sql, aplica solo lo nuevo; no relances el CREATE TABLE a ciegas
systemctl restart trazo
journalctl -u trazo -n 30 --no-pager
```

---

## 14. Copias de seguridad

```bash
# Base
install -d /root/backups/trazo
PGPASSWORD='CLAVE_DB' pg_dump -h 127.0.0.1 -U postgres -d postgres -Fc -f /root/backups/trazo/trazo_$(date +%F).dump

# Restaurar
# PGPASSWORD='CLAVE_DB' pg_restore -h 127.0.0.1 -U postgres -d postgres --clean --if-exists /root/backups/trazo/ARCHIVO.dump
```

Cron diario (root):

```bash
echo '0 3 * * * PGPASSWORD=CLAVE_DB pg_dump -h 127.0.0.1 -U postgres -d postgres -Fc -f /root/backups/trazo/trazo_$(date +\%F).dump' \
  > /etc/cron.d/trazo-backup
chmod 600 /etc/cron.d/trazo-backup
```

Guarda también `/opt/trazo/app/.env` fuera del servidor.

---

## 15. Fallos frecuentes

| Síntoma | Causa probable |
| --- | --- |
| `Cannot find module` / vistas en blanco | `WorkingDirectory` no es `/opt/trazo/app` |
| Login no se queda en HTTP | Pusiste `NODE_ENV=production` sin HTTPS |
| Login no se queda en HTTPS | Falta `app.set('trust proxy', 1)` |
| Sala no colabora | Nginx sin `Upgrade` en `/socket.io/` |
| 413 al subir imagen o audio | `client_max_body_size` < 12m |
| IA o Maven “timeout” | `proxy_read_timeout` corto |
| `mvn not found` / Java 11 | PATH y `JAVA_HOME` del unit |
| `password authentication failed` | Llegas al 5432, pero la clave no coincide. Resetea con `sudo -u postgres psql` y un `ALTER USER` escrito a mano. Evita `*` `?` `$` en bash. |
| No conecta desde fuera | `listen_addresses = '*'`, `ufw allow 5432` y línea `host all all 0.0.0.0/0 md5` |
| Puerto 3001 accesible desde internet | Cierra 3001 en el firewall; solo Nginx |

---

## 16. Puertos que deben quedar

| Puerto | Quién escucha | Público |
| --- | --- | --- |
| 22 | SSH | Sí (restringe por IP si puedes) |
| 80 | Nginx | Sí (fase 1; luego redirige a 443) |
| 443 | Nginx | Solo fase SSL |
| 3001 | `node app/app.js` | No (solo 127.0.0.1) |
| 5432 | PostgreSQL 12 (usuario `postgres`) | Sí |
| 8081–8181 | Spring generado | No (TRAZO los proxifica) |
| 11434 | Ollama | No |

La app no abre 80/443 ella sola. Nginx es la puerta. Node permanece en 3001.
