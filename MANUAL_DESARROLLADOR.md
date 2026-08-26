# Manual del desarrollador — RadioMap

Actualizar este archivo cada vez que cambien arranque, SQL, Redis, shards, puertos, cuentas o la fase de escala.

## Qué es

Radio de ruta (mapa + walkie). Frontend: HTML/CSS/JS (vanilla + Leaflet). Backend: Node (`server.js`) + Socket.IO. GPS en vivo **nunca** va a SQL: RAM + grilla, y si hay Redis se replica entre procesos. SQL guarda perfiles, grupos, miembros y encuentros.

## Arranque local

- Node **16** (la máquina actual: `v16.14.2`).
- En la raíz del repo: `npm install` y `node server.js` (o `npm start`).
- App: `http://127.0.0.1:3000`
- Salud: `http://127.0.0.1:3000/api/salud` → `{ ok, sql, redis, fase, shard, shards, enVivo }`
- Si el 3000 está ocupado, matar ese Node y volver a arrancar.
- Recarga dura: Ctrl+F5. Cache de assets: `?v=20260826b`.

## Railway (producción)

Railway **no tiene SQL Server**. Redis es opcional. El sitio **tiene que arrancar igual** (plan B: JSON en `data/`, un solo proceso).

El 502 del log `ENOENT: ... open '/app/conexion.config'` es el código **viejo**: leía `conexion.config` (está en `.gitignore`) **antes** de abrir el puerto y el proceso moría. Redis/SQL no llegaban a usarse. El código nuevo abre `0.0.0.0` + `$PORT` primero y, en Railway, **ni intenta** SQL ni Redis salvo que existan `SQL_SERVER` o `REDIS_URL`.

### 0. Hacer que el sitio responda (obligatorio)

1. Commit + **push** a la rama que Railway despliega (`main`). Sin push Railway sigue crasheando.
2. Esperá el deploy. En logs tiene que aparecer `Servidor V2V corriendo en 0.0.0.0:` + un número (el `$PORT` de Railway, no hace falta que sea 3000).
3. En el servicio web: **Settings → Networking**. El dominio `*.up.railway.app` no debe tener target port fijo en 3000. Dejá que Railway use `$PORT`.
4. Start command: `node server.js` (está en `railway.toml`).
5. Probá `https://v2vstreet-production.up.railway.app/api/salud`. Tiene que devolver JSON con `"ok":true`. Plan B: `"sql":false,"redis":false` y el mapa igual anda.

### 1. Redis en Railway (opcional; GPS entre varios procesos)

Railway **sí** tiene Redis. No hace falta para 1 réplica.

1. En el canvas del proyecto: **+ New → Database → Redis**.
2. Esperá a que el servicio Redis quede Running.
3. Abrí el servicio **de la app** (no el de Redis) → **Variables → New variable**.
4. Nombre: `REDIS_URL`
5. Valor (si el servicio se llama `Redis`): `${{Redis.REDIS_URL}}`  
   Si lo nombraste distinto, usá ese nombre: `${{NombreDelServicio.REDIS_URL}}`.
6. Railway redespliega solo. En `/api/salud` tiene que figurar `"redis":true`.

No copies a mano host/clave. La variable de referencia se actualiza sola.

### 2. SQL Server (grupos y perfiles persistentes)

Railway **no** ofrece SQL Server (solo Postgres/MySQL/Redis/Mongo). La notebook `001_v2v_gps` no es alcanzable desde internet.

Opciones:

**A — Por ahora nada (más simple)**  
No cargues SQL. La app usa `data/grupos.json`. En Railway el disco se borra en cada deploy: los grupos de prod se pueden perder. Sirve para probar el mapa.

**B — SQL remoto (Somee / Azure SQL)**  
1. Creá una base (ejemplo de nombre: `001_v2v_gps`) en Somee o Azure.
2. Ejecutá `database/01_schema.sql` contra esa base.
3. Creá login SQL (ejemplo): usuario `radiomap`, clave la que elijas.
4. En el firewall de ese SQL: permitir Azure/Somee + IPs de Railway, o `0.0.0.0/0` si es de prueba.
5. TCP 1433 abierto.
6. En el servicio web de Railway → Variables:

| Variable | Ejemplo |
|---|---|
| `SQL_SERVER` | `sql.ejemplo.somee.com` |
| `SQL_DATABASE` | `001_v2v_gps` |
| `SQL_AUTH` | `sql` |
| `SQL_USER` | `radiomap` |
| `SQL_PASSWORD` | *(la clave real, no la de la notebook)* |

7. Redeploy. `/api/salud` → `"sql":true`.

No uses `localhost` ni `LAPTOP-VGKP2TLH` en Railway.

## SQL Server local (imprescindible para persistir en la notebook)

| Dato | Valor |
|---|---|
| Instancia | Predeterminada `MSSQLSERVER` (no es `\Caballo`) |
| Servidor | `localhost` o `LAPTOP-VGKP2TLH` |
| Base | `001_v2v_gps` |
| SSMS | `LAPTOP-VGKP2TLH\Caballo` es el **usuario Windows**, no el nombre de instancia |
| Login SQL | `radiomap` |
| Clave SQL | `RmGps_2026_Local` |
| Esquema | `database/01_schema.sql` |

Config real (no se commitea): `conexion.config`. Copiar de `conexion.config.ejemplo`.

Hoy TCP/IP está **apagado**. Node no entra por 1433; persiste con `sqlcmd -S localhost -E` (misma sesión Windows que SSMS). El login `radiomap` sirve cuando habilites TCP.

```
sqlcmd -S localhost -E -d "001_v2v_gps" -i "database\01_schema.sql"
```

Si SQL no responde, la app igual arranca y usa `data/grupos.json` y `data/encuentros.json`.

## Cuentas de la app

No hay login de usuario final ni JWT. El id del vehículo lo inventa el cliente (`v…`) y se guarda en SQL como `dbo.usuarios`. Grupos: código 4–8 caracteres.

## Redis — fase 4 (varios Node)

Si Redis no está, la app **sigue** en un solo proceso. Valores de **ejemplo**:

| Dato | Ejemplo |
|---|---|
| URL | `redis://127.0.0.1:6379` |
| Usuario | (vacío) |
| Clave | (vacía) |
| Docker | `docker run --name radiomap-redis -p 6379:6379 -d redis:7` |

En `conexion.config`: `<redis>redis://127.0.0.1:6379</redis>`.

Para **dos procesos** (mismo Redis, misma notebook):

```
set PORT=3000
node server.js
set PORT=3001
node server.js
```

Delante, un nginx de ejemplo (no está instalado acá):

```
upstream radiomap { server 127.0.0.1:3000; server 127.0.0.1:3001; }
```

## Shards — fase 5 (geografía)

En esta notebook: `<shards>1</shards>` y `<shard>0</shard>` (todo el mapa en el puerto 3000).

Ejemplo **genérico** de 2 shards (no hace falta levantarlo ahora):

| Shard | Quién entra | URL ejemplo |
|---|---|---|
| 0 | lat ≥ **-40** (centro/norte AR) | `http://127.0.0.1:3000` |
| 1 | lat &lt; **-40** (sur) | `http://127.0.0.1:3001` |

Corte: `<shardCorteLat>-40</shardCorteLat>`. Si el cliente cae en otro shard, el server manda `shardRedirect` y el browser cambia de URL **una vez**.

Producción (ejemplo, no es un servidor real): `https://ba.radiomap.ejemplo` y `https://ush.radiomap.ejemplo`.

## Escala (no meter GPS en SQL)

| Fase | Estado | Qué hace |
|---|---|---|
| 0 | Hecha | Radio 3–10 km, ticks más lentos, grilla ~4 km, telemetría chica |
| SQL | Hecha | Perfiles/grupos/encuentros en `001_v2v_gps` |
| 1 | Hecha | Salas Socket.IO: walkie y avisos a la zona; `/api/salud` |
| 2 | Hecha | GPS por salas; tope 48 cercanos; freno si la celda está llena |
| 3 | Hecha | Un Node al máximo: no JSON si hay SQL; techo GPS/walkie; mapa liviano |
| 4 | Hecha | Redis opcional: adapter Socket.IO + réplica de vivos entre procesos |
| 5 | Hecha | Shards por latitud (ejemplo corte -40); redirect del cliente |

Plan cerrado. Redis y el segundo shard son optativos: sin ellos el modo local no se rompe.

## No hacer

- No commitear `conexion.config`.
- No escribir lat/lng de cada tick en SQL.
- No instalar `msnodesqlv8` en Node 16 sin Visual Studio C++.
