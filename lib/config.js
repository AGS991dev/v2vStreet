"use strict";

const fs = require("fs");
const path = require("path");

function tag(xml, nombre) {
    const m = String(xml || "").match(new RegExp("<" + nombre + ">([\\s\\S]*?)</" + nombre + ">", "i"));
    return m ? String(m[1] || "").trim() : "";
}

function entero(valor, def) {
    const n = parseInt(valor, 10);
    return Number.isFinite(n) ? n : def;
}

function enNube() {
    return !!(process.env.RAILWAY_ENVIRONMENT ||
        process.env.RAILWAY_PROJECT_ID ||
        process.env.RAILWAY_PUBLIC_DOMAIN);
}

function esLoopback(valor) {
    const s = String(valor || "").toLowerCase();
    return !s || s === "localhost" || s.indexOf("127.0.0.1") >= 0 || s.indexOf("::1") >= 0;
}

function leerXml() {
    const archivo = path.join(__dirname, "..", "conexion.config");
    try {
        return fs.readFileSync(archivo, "utf8");
    } catch (err) {
        return "";
    }
}

function leer() {
    const xml = leerXml();
    const shards = Math.max(1, entero(tag(xml, "shards") || process.env.SHARDS, 1));
    const shardUrls = [];
    let i;
    for (i = 0; i < shards; i++) {
        shardUrls[i] = tag(xml, "shardUrl" + i) || process.env["SHARD_URL_" + i] ||
            ("http://127.0.0.1:" + (3000 + i));
    }
    let redis = process.env.REDIS_URL || tag(xml, "redis") || "";
    if (enNube() && esLoopback(redis)) redis = "";
    return {
        redis: redis,
        workers: Math.max(1, entero(tag(xml, "workers") || process.env.WORKERS, 1)),
        shard: Math.max(0, entero(tag(xml, "shard") || process.env.SHARD, 0)),
        shards: shards,
        shardCorteLat: Number(tag(xml, "shardCorteLat") || process.env.SHARD_CORTE_LAT || "-40"),
        shardUrls: shardUrls,
        servidor: process.env.SQL_SERVER || tag(xml, "servidor") || "localhost",
        base: process.env.SQL_DATABASE || tag(xml, "base") || "001_v2v_gps",
        autenticacion: (process.env.SQL_AUTH || tag(xml, "autenticacion") || "windows").toLowerCase(),
        usuario: process.env.SQL_USER || tag(xml, "usuario"),
        clave: process.env.SQL_PASSWORD || tag(xml, "clave")
    };
}

module.exports = {
    leer: leer,
    tag: tag,
    enNube: enNube,
    esLoopback: esLoopback
};
