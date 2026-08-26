"use strict";

const cfgMod = require("./config");

let pub = null;
let sub = null;
let listo = false;
let cfg = null;
let hooks = {};
const ORIGEN = process.pid + "-" + Math.random().toString(16).slice(2);
const CANAL = "rm:vivos";

function shardDe(lat, conf) {
    const n = (conf && conf.shards) || 1;
    const corte = (conf && conf.shardCorteLat) || -40;
    if (n <= 1) return 0;
    if (n === 2) return Number(lat) >= corte ? 0 : 1;
    const band = Math.floor((Number(lat) + 90) / (180 / n));
    return Math.max(0, Math.min(n - 1, band));
}

function hintShard(lat, lng) {
    if (!cfg || cfg.shards <= 1) return null;
    const dest = shardDe(lat, cfg);
    if (dest === cfg.shard) return null;
    const url = cfg.shardUrls && cfg.shardUrls[dest];
    if (!url) return null;
    return { shard: dest, url: url, lat: lat, lng: lng };
}

function activo() {
    return listo;
}

function info() {
    return {
        redis: listo,
        shard: cfg ? cfg.shard : 0,
        shards: cfg ? cfg.shards : 1,
        workers: cfg ? cfg.workers : 1,
        redisUrl: cfg && cfg.redis ? cfg.redis : ""
    };
}

function onMensaje(texto) {
    let msg;
    try {
        msg = JSON.parse(texto);
    } catch (err) {
        return;
    }
    if (!msg || msg.origen === ORIGEN) return;
    if (msg.tipo === "upsert" && hooks.onUpsert) hooks.onUpsert(msg.payload);
    if (msg.tipo === "borrar" && hooks.onBorrar) hooks.onBorrar(msg.payload);
}

function publicar(tipo, payload) {
    if (!listo || !pub) return;
    pub.publish(CANAL, JSON.stringify({
        tipo: tipo,
        payload: payload,
        origen: ORIGEN
    })).catch(function () {});
}

async function conectar(io, extras) {
    cfg = cfgMod.leer();
    hooks = extras || {};
    if (cfgMod.enNube() && !process.env.REDIS_URL) {
        console.log("Plan B: sin Redis (no hace falta para 1 réplica).");
        return false;
    }
    if (!cfg.redis) {
        console.log("Redis no configurado; un solo proceso.");
        return false;
    }
    let redis;
    try {
        redis = require("redis");
    } catch (err) {
        console.log("Falta el paquete redis.");
        return false;
    }
    try {
        pub = redis.createClient({
            url: cfg.redis,
            socket: {
                connectTimeout: 800,
                reconnectStrategy: function () { return false; }
            }
        });
        sub = pub.duplicate();
        pub.on("error", function () {});
        sub.on("error", function () {});
        const tope = new Promise(function (_, reject) {
            setTimeout(function () { reject(new Error("timeout Redis")); }, 1200);
        });
        await Promise.race([pub.connect(), tope]);
        await Promise.race([sub.connect(), new Promise(function (_, reject) {
            setTimeout(function () { reject(new Error("timeout Redis sub")); }, 1200);
        })]);
        const { createAdapter } = require("@socket.io/redis-adapter");
        io.adapter(createAdapter(pub, sub));
        await sub.subscribe(CANAL, onMensaje);
        listo = true;
        console.log("Redis conectado:", cfg.redis);
        return true;
    } catch (err) {
        listo = false;
        pub = null;
        sub = null;
        console.log("Redis no disponible (" + (err && err.message ? err.message : err) + "). Se sigue en un proceso.");
        return false;
    }
}

module.exports = {
    conectar: conectar,
    activo: activo,
    info: info,
    publicar: publicar,
    hintShard: hintShard,
    shardDe: shardDe
};
