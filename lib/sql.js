"use strict";

const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const { execFile } = require("child_process");

let sql = null;
let pool = null;
let listo = false;
let modo = "";
let cfgCache = null;
let colaSqlcmd = Promise.resolve();

function tag(xml, nombre) {
    const m = String(xml || "").match(new RegExp("<" + nombre + ">([\\s\\S]*?)</" + nombre + ">", "i"));
    return m ? String(m[1] || "").trim() : "";
}

function parseServidor(servidor) {
    const s = String(servidor || "localhost").trim();
    const i = s.indexOf("\\");
    if (i > 0) {
        return { server: s.slice(0, i), instanceName: s.slice(i + 1) };
    }
    return { server: s, instanceName: "" };
}

function leerConfig() {
    const archivo = path.join(__dirname, "..", "conexion.config");
    const xml = fs.readFileSync(archivo, "utf8");
    return {
        servidor: tag(xml, "servidor") || "localhost",
        base: tag(xml, "base") || "001_v2v_gps",
        autenticacion: (tag(xml, "autenticacion") || "windows").toLowerCase(),
        usuario: tag(xml, "usuario"),
        clave: tag(xml, "clave")
    };
}

function servidorSqlcmd(cfg) {
    const parsed = parseServidor(cfg.servidor);
    if (!parsed.instanceName || /^caballo$/i.test(parsed.instanceName)) {
        return parsed.server || "localhost";
    }
    return parsed.server + "\\" + parsed.instanceName;
}

function opcionesBase(cfg, encrypt) {
    const parsed = parseServidor(cfg.servidor);
    const options = {
        encrypt: !!encrypt,
        trustServerCertificate: true,
        enableArithAbort: true,
        database: cfg.base
    };
    if (parsed.instanceName && !/^caballo$/i.test(parsed.instanceName)) {
        options.instanceName = parsed.instanceName;
    }
    return { server: parsed.server, options: options };
}

function cfgWindows(cfg) {
    const base = opcionesBase(cfg, false);
    return {
        server: base.server,
        database: cfg.base,
        driver: "msnodesqlv8",
        options: Object.assign({}, base.options, {
            trustedConnection: true,
            encrypt: false
        })
    };
}

function puertoTcpAbierto(host, port, ms) {
    return new Promise(function (resolve) {
        const socket = net.connect({ host: host, port: port });
        const timer = setTimeout(function () {
            socket.destroy();
            resolve(false);
        }, ms || 400);
        socket.on("connect", function () {
            clearTimeout(timer);
            socket.destroy();
            resolve(true);
        });
        socket.on("error", function () {
            clearTimeout(timer);
            resolve(false);
        });
    });
}

function cfgSqlLogin(cfg, encrypt) {
    const base = opcionesBase(cfg, encrypt);
    return {
        server: base.server,
        database: cfg.base,
        user: cfg.usuario,
        password: cfg.clave,
        connectionTimeout: 2500,
        requestTimeout: 15000,
        options: base.options
    };
}

function tipoMssql(t) {
    if (t === "int") return sql.Int;
    if (t === "float") return sql.Float;
    if (t === "datetime2") return sql.DateTime2;
    return sql.NVarChar(sql.MAX);
}

function literal(p) {
    const v = p.v;
    if (v === null || v === undefined) return "NULL";
    if (p.t === "int") return String(parseInt(v, 10) || 0);
    if (p.t === "float") {
        const n = Number(v);
        return Number.isFinite(n) ? String(n) : "NULL";
    }
    if (p.t === "datetime2") {
        const d = v instanceof Date ? v : new Date(v);
        if (isNaN(d.getTime())) return "NULL";
        return "'" + d.toISOString().slice(0, 23).replace("T", " ") + "'";
    }
    return "N'" + String(v).replace(/'/g, "''") + "'";
}

function bind(texto, params) {
    const list = (params || []).slice().sort(function (a, b) {
        return String(b.n).length - String(a.n).length;
    });
    let out = texto;
    list.forEach(function (p) {
        out = out.replace(new RegExp("@" + p.n + "\\b", "g"), literal(p));
    });
    return out;
}

function parseJsonSqlcmd(stdout) {
    const text = String(stdout || "").replace(/\u0000/g, "").trim();
    const startArr = text.indexOf("[");
    const startObj = text.indexOf("{");
    if (startArr < 0 && startObj < 0) return [];
    const start = startArr >= 0 && (startObj < 0 || startArr <= startObj) ? startArr : startObj;
    const endArr = text.lastIndexOf("]");
    const endObj = text.lastIndexOf("}");
    const end = Math.max(endArr, endObj);
    if (end < start) return [];
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [parsed];
}

function runSqlcmd(sqlText) {
    const cfg = cfgCache || leerConfig();
    const tmp = path.join(os.tmpdir(), "radiomap-" + Date.now() + "-" + Math.random().toString(16).slice(2) + ".sql");
    fs.writeFileSync(tmp, "\uFEFFSET NOCOUNT ON;\n" + sqlText, { encoding: "utf16le" });
    return new Promise(function (resolve, reject) {
        execFile(
            "sqlcmd",
            ["-S", servidorSqlcmd(cfg), "-E", "-d", cfg.base, "-b", "-y", "0", "-i", tmp],
            { encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
            function (err, stdout, stderr) {
                try {
                    fs.unlinkSync(tmp);
                } catch (e) {
                    /* ignore */
                }
                if (err) {
                    reject(new Error((stderr || stdout || err.message || "sqlcmd").toString().trim()));
                    return;
                }
                resolve(stdout || "");
            }
        );
    });
}

function sqlcmdEnCola(sqlText) {
    const trabajo = colaSqlcmd.then(function () {
        return runSqlcmd(sqlText);
    });
    colaSqlcmd = trabajo.then(function () {}, function () {});
    return trabajo;
}

async function conectarMssql(cfg) {
    const parsed = parseServidor(cfg.servidor);
    const host = parsed.server || "127.0.0.1";
    const hayTcp = await puertoTcpAbierto(host === "localhost" ? "127.0.0.1" : host, 1433, 400);
    if (!hayTcp) return false;
    sql = require("mssql");
    async function silent(fn) {
        try {
            return await fn();
        } catch (err) {
            return false;
        }
    }
    if (cfg.autenticacion !== "sql" || !cfg.usuario) {
        let native = null;
        try {
            native = require("mssql/msnodesqlv8");
        } catch (err) {
            native = null;
        }
        if (native) {
            const okWin = await silent(async function () {
                pool = await new native.ConnectionPool(cfgWindows(cfg)).connect();
                sql = native;
                return true;
            });
            if (okWin) return true;
        }
    }
    if (cfg.usuario && cfg.clave) {
        const okSql = await silent(async function () {
            pool = await new sql.ConnectionPool(cfgSqlLogin(cfg, true)).connect();
            return true;
        });
        if (okSql) return true;
        const okSqlPlain = await silent(async function () {
            pool = await new sql.ConnectionPool(cfgSqlLogin(cfg, false)).connect();
            return true;
        });
        if (okSqlPlain) return true;
    }
    pool = null;
    return false;
}

async function conectarSqlcmd(cfg) {
    try {
        await runSqlcmd("SELECT 1 AS ok FOR JSON PATH;");
        return true;
    } catch (err) {
        console.error("SQL Server (sqlcmd):", err && err.message ? err.message : err);
        return false;
    }
}

async function conectar() {
    cfgCache = leerConfig();
    if (await conectarMssql(cfgCache)) {
        modo = "mssql";
        listo = true;
        return true;
    }
    if (await conectarSqlcmd(cfgCache)) {
        modo = "sqlcmd";
        listo = true;
        console.log("SQL Server vía sqlcmd (TCP/IP no está activo; SSMS sigue igual)");
        return true;
    }
    listo = false;
    modo = "";
    pool = null;
    return false;
}

function activo() {
    return !!(listo && (pool || modo === "sqlcmd"));
}

async function query(texto, params) {
    if (!activo()) return null;
    if (modo === "mssql" && pool) {
        const req = pool.request();
        (params || []).forEach(function (p) {
            req.input(p.n, tipoMssql(p.t), p.v);
        });
        return req.query(texto);
    }
    const sqlText = bind(texto, params);
    const esSelect = /^\s*SELECT\b/i.test(texto);
    if (esSelect) {
        const stdout = await sqlcmdEnCola(sqlText.replace(/;\s*$/, "") + " FOR JSON PATH, INCLUDE_NULL_VALUES;");
        return { recordset: parseJsonSqlcmd(stdout) };
    }
    await sqlcmdEnCola(sqlText);
    return { recordset: [] };
}

async function upsertUsuario(v) {
    if (!v || !v.id) return;
    await query(
        "MERGE dbo.usuarios AS t " +
        "USING (SELECT @id AS id) AS s ON t.id = s.id " +
        "WHEN MATCHED THEN UPDATE SET nombre=@nombre, vehiculo=@vehiculo, iconoX=@iconoX, iconoY=@iconoY, " +
        "placa=COALESCE(NULLIF(@placa,''), t.placa), seguro=COALESCE(NULLIF(@seguro,''), t.seguro), " +
        "contacto=COALESCE(NULLIF(@contacto,''), t.contacto), visto=SYSUTCDATETIME() " +
        "WHEN NOT MATCHED THEN INSERT (id, nombre, vehiculo, iconoX, iconoY, placa, seguro, contacto) " +
        "VALUES (@id, @nombre, @vehiculo, @iconoX, @iconoY, NULLIF(@placa,''), NULLIF(@seguro,''), NULLIF(@contacto,''));",
        [
            { n: "id", t: "nvarchar", v: String(v.id).slice(0, 64) },
            { n: "nombre", t: "nvarchar", v: String(v.nombre || "").slice(0, 40) },
            { n: "vehiculo", t: "nvarchar", v: String(v.vehiculo || "").slice(0, 40) },
            { n: "iconoX", t: "int", v: Number(v.iconoX) || 0 },
            { n: "iconoY", t: "int", v: Number(v.iconoY) || 0 },
            { n: "placa", t: "nvarchar", v: String(v.placa || "").slice(0, 20) },
            { n: "seguro", t: "nvarchar", v: String(v.seguro || "").slice(0, 40) },
            { n: "contacto", t: "nvarchar", v: String(v.contacto || "").slice(0, 40) }
        ]
    );
}

async function upsertGrupo(codigo, nombre) {
    if (!codigo) return;
    await query(
        "MERGE dbo.grupos AS t USING (SELECT @codigo AS codigo) AS s ON t.codigo = s.codigo " +
        "WHEN MATCHED THEN UPDATE SET nombre=CASE WHEN LEN(@nombre)>0 THEN @nombre ELSE t.nombre END " +
        "WHEN NOT MATCHED THEN INSERT (codigo, nombre) VALUES (@codigo, CASE WHEN LEN(@nombre)>0 THEN @nombre ELSE @codigo END);",
        [
            { n: "codigo", t: "nvarchar", v: String(codigo).slice(0, 8) },
            { n: "nombre", t: "nvarchar", v: String(nombre || ("Grupo " + codigo)).slice(0, 32) }
        ]
    );
}

async function upsertMiembro(codigo, vehiculo) {
    if (!codigo || !vehiculo || !vehiculo.id) return;
    await upsertUsuario(vehiculo);
    await upsertGrupo(codigo, vehiculo.grupoNombre || "");
    await query(
        "MERGE dbo.grupo_miembros AS t " +
        "USING (SELECT @codigo AS codigo, @usuarioId AS usuarioId) AS s " +
        "ON t.codigo = s.codigo AND t.usuarioId = s.usuarioId " +
        "WHEN MATCHED THEN UPDATE SET nombre=@nombre, entra=SYSUTCDATETIME() " +
        "WHEN NOT MATCHED THEN INSERT (codigo, usuarioId, nombre) VALUES (@codigo, @usuarioId, @nombre);",
        [
            { n: "codigo", t: "nvarchar", v: String(codigo).slice(0, 8) },
            { n: "usuarioId", t: "nvarchar", v: String(vehiculo.id).slice(0, 64) },
            { n: "nombre", t: "nvarchar", v: String(vehiculo.nombre || "").slice(0, 40) }
        ]
    );
}

async function borrarMiembro(codigo, id) {
    if (!codigo || !id) return;
    await query(
        "DELETE FROM dbo.grupo_miembros WHERE codigo=@codigo AND usuarioId=@usuarioId",
        [
            { n: "codigo", t: "nvarchar", v: String(codigo).slice(0, 8) },
            { n: "usuarioId", t: "nvarchar", v: String(id).slice(0, 64) }
        ]
    );
}

async function upsertEncuentro(e) {
    if (!e || !e.id) return;
    const ts = new Date(Number(e.ts) || Date.now());
    await query(
        "MERGE dbo.encuentros AS t USING (SELECT @id AS id) AS s ON t.id = s.id " +
        "WHEN MATCHED THEN UPDATE SET lat=@lat, lng=@lng, nombre=@nombre, horario=@horario, descripcion=@descripcion, " +
        "de=@de, grupo=@grupo, alcance=@alcance, para=@para, ts=@ts " +
        "WHEN NOT MATCHED THEN INSERT (id, lat, lng, nombre, horario, descripcion, de, grupo, alcance, para, ts) " +
        "VALUES (@id, @lat, @lng, @nombre, @horario, @descripcion, @de, @grupo, @alcance, @para, @ts);",
        [
            { n: "id", t: "nvarchar", v: String(e.id).slice(0, 40) },
            { n: "lat", t: "float", v: Number(e.lat) },
            { n: "lng", t: "float", v: Number(e.lng) },
            { n: "nombre", t: "nvarchar", v: String(e.nombre || "").slice(0, 80) },
            { n: "horario", t: "nvarchar", v: String(e.horario || "").slice(0, 40) },
            { n: "descripcion", t: "nvarchar", v: String(e.descripcion || "").slice(0, 240) },
            { n: "de", t: "nvarchar", v: String(e.de || "").slice(0, 64) },
            { n: "grupo", t: "nvarchar", v: String(e.grupo || "").slice(0, 8) || null },
            { n: "alcance", t: "nvarchar", v: String(e.alcance || "global").slice(0, 16) },
            { n: "para", t: "nvarchar", v: String(e.para || "").slice(0, 64) || null },
            { n: "ts", t: "datetime2", v: ts }
        ]
    );
}

async function borrarEncuentro(id) {
    if (!id) return;
    await query(
        "DELETE FROM dbo.encuentros WHERE id=@id",
        [{ n: "id", t: "nvarchar", v: String(id).slice(0, 40) }]
    );
}

async function leerGrupos() {
    const r = await query(
        "SELECT g.codigo, g.nombre, m.usuarioId, m.nombre AS miembroNombre, m.entra " +
        "FROM dbo.grupos g LEFT JOIN dbo.grupo_miembros m ON m.codigo = g.codigo"
    );
    const out = {};
    if (!r || !r.recordset) return out;
    r.recordset.forEach(function (row) {
        const codigo = String(row.codigo || "").toUpperCase();
        if (!codigo) return;
        if (!out[codigo]) out[codigo] = { nombre: String(row.nombre || ""), miembros: {} };
        if (row.usuarioId) {
            out[codigo].miembros[String(row.usuarioId)] = {
                nombre: String(row.miembroNombre || ""),
                ts: row.entra ? new Date(row.entra).getTime() : 0
            };
        }
    });
    return out;
}

async function leerEncuentros() {
    const r = await query(
        "SELECT id, lat, lng, nombre, horario, descripcion, de, grupo, alcance, para, ts FROM dbo.encuentros"
    );
    if (!r || !r.recordset) return [];
    return r.recordset.map(function (row) {
        return {
            id: String(row.id || ""),
            lat: Number(row.lat),
            lng: Number(row.lng),
            nombre: String(row.nombre || ""),
            horario: String(row.horario || ""),
            descripcion: String(row.descripcion || ""),
            de: String(row.de || ""),
            grupo: String(row.grupo || ""),
            alcance: String(row.alcance || ""),
            para: String(row.para || ""),
            ts: row.ts ? new Date(row.ts).getTime() : Date.now()
        };
    });
}

async function leerFicha(id) {
    const r = await query(
        "SELECT id, placa, seguro, contacto FROM dbo.usuarios WHERE id=@id",
        [{ n: "id", t: "nvarchar", v: String(id || "").slice(0, 64) }]
    );
    if (!r || !r.recordset || !r.recordset[0]) return null;
    const row = r.recordset[0];
    return {
        id: String(row.id),
        placa: String(row.placa || ""),
        seguro: String(row.seguro || ""),
        contacto: String(row.contacto || "")
    };
}

module.exports = {
    conectar: conectar,
    activo: activo,
    upsertUsuario: upsertUsuario,
    upsertGrupo: upsertGrupo,
    upsertMiembro: upsertMiembro,
    borrarMiembro: borrarMiembro,
    upsertEncuentro: upsertEncuentro,
    borrarEncuentro: borrarEncuentro,
    leerGrupos: leerGrupos,
    leerEncuentros: leerEncuentros,
    leerFicha: leerFicha
};
