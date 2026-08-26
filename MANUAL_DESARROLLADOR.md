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

## SQL Server (imprescindible para persistir)

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
