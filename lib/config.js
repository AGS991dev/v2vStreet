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

function leer() {
    const archivo = path.join(__dirname, "..", "conexion.config");
    const xml = fs.readFileSync(archivo, "utf8");
    const shards = Math.max(1, entero(tag(xml, "shards"), 1));
    const shardUrls = [];
    let i;
    for (i = 0; i < shards; i++) {
        shardUrls[i] = tag(xml, "shardUrl" + i) || ("http://127.0.0.1:" + (3000 + i));
    }
    return {
        redis: tag(xml, "redis") || process.env.REDIS_URL || "",
        workers: Math.max(1, entero(tag(xml, "workers") || process.env.WORKERS, 1)),
        shard: Math.max(0, entero(tag(xml, "shard") || process.env.SHARD, 0)),
        shards: shards,
        shardCorteLat: Number(tag(xml, "shardCorteLat") || "-40"),
        shardUrls: shardUrls
    };
}

module.exports = { leer: leer, tag: tag };
