"use strict";

// Arma el catálogo estático de radares fijos de velocidad máxima.
// Fuente editable: data/radares-src.json
// Salida servida: public/static/radares/manifest.json + t/{iy}_{ix}.json
//
// Uso:
//   node scripts/armar-radares.js
// Si existe data/radares-overpass.json (export OSM), lo normaliza a radares-src.json y después genera baldosas.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "data", "radares-src.json");
const OVERPASS = path.join(ROOT, "data", "radares-overpass.json");
const OUT_DIR = path.join(ROOT, "public", "static", "radares");
const TILE_DIR = path.join(OUT_DIR, "t");
const TILE_DEG = 2;

function hoy() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + m + day;
}

function round5(n) {
    return Math.round(Number(n) * 1e5) / 1e5;
}

function vmaxDeTags(tags) {
    if (!tags) return 0;
    const raw = tags.maxspeed || tags["maxspeed:forward"] || tags["maxspeed:backward"] || "";
    const m = String(raw).match(/(\d{2,3})/);
    if (!m) return 0;
    const n = parseInt(m[1], 10);
    if (n < 20 || n > 140) return 0;
    return n;
}

function esSemaforo(tags) {
    if (!tags) return false;
    const tipo = String(tags["camera:type"] || "");
    const enf = String(tags.enforcement || "");
    if (/red.?light|traffic_signals/i.test(tipo)) return true;
    if (enf === "traffic_signals") return true;
    return false;
}

function tileKey(lat, lng) {
    const iy = Math.floor(lat / TILE_DEG);
    const ix = Math.floor(lng / TILE_DEG);
    return iy + "_" + ix;
}

function desdeOverpass(raw) {
    const els = (raw && raw.elements) || [];
    const seen = Object.create(null);
    const lista = [];
    els.forEach(function (e) {
        if (!e || e.type !== "node") return;
        const tags = e.tags || {};
        if (esSemaforo(tags)) return;
        const speed = tags.highway === "speed_camera" || tags.enforcement === "maxspeed";
        if (!speed) return;
        const vmax = vmaxDeTags(tags);
        if (!vmax) return;
        const lat = round5(e.lat);
        const lng = round5(e.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        const dup = lat.toFixed(5) + "," + lng.toFixed(5);
        if (seen[dup]) return;
        seen[dup] = 1;
        lista.push({
            id: "osm-" + e.id,
            lat: lat,
            lng: lng,
            vmax: vmax
        });
    });
    lista.sort(function (a, b) {
        return a.lat - b.lat || a.lng - b.lng;
    });
    return lista;
}

function desdeSrc(raw) {
    const lista = Array.isArray(raw) ? raw : (raw && raw.radares) || [];
    const seen = Object.create(null);
    const out = [];
    lista.forEach(function (r, i) {
        if (!r) return;
        const lat = round5(r.lat);
        const lng = round5(r.lng);
        const vmax = parseInt(r.vmax, 10);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        if (!vmax || vmax < 20 || vmax > 140) return;
        const dup = lat.toFixed(5) + "," + lng.toFixed(5);
        if (seen[dup]) return;
        seen[dup] = 1;
        out.push({
            id: String(r.id || ("r-" + i)),
            lat: lat,
            lng: lng,
            vmax: vmax
        });
    });
    return out;
}

function main() {
    let radares;
    let fuente = "manual";
    if (fs.existsSync(OVERPASS)) {
        const raw = JSON.parse(fs.readFileSync(OVERPASS, "utf8"));
        radares = desdeOverpass(raw);
        fuente = "OSM highway=speed_camera con maxspeed (fijos)";
        console.log("Normalicé Overpass:", radares.length, "radares de velocidad máxima");
    } else if (fs.existsSync(SRC)) {
        const raw = JSON.parse(fs.readFileSync(SRC, "utf8"));
        radares = desdeSrc(raw);
        fuente = (raw && raw.fuente) || "manual";
        console.log("Leí radares-src.json:", radares.length);
    } else {
        console.error("No hay data/radares-src.json ni data/radares-overpass.json");
        process.exit(1);
    }

    const v = hoy();
    const src = {
        v: v,
        tileDeg: TILE_DEG,
        fuente: fuente,
        nota: "Solo radares fijos de velocidad máxima. Editá este archivo y corré: node scripts/armar-radares.js",
        count: radares.length,
        radares: radares
    };
    fs.mkdirSync(path.dirname(SRC), { recursive: true });
    fs.writeFileSync(SRC, JSON.stringify(src, null, 2));

    fs.mkdirSync(OUT_DIR, { recursive: true });
    if (fs.existsSync(TILE_DIR)) {
        fs.readdirSync(TILE_DIR).forEach(function (f) {
            fs.unlinkSync(path.join(TILE_DIR, f));
        });
    }

    const compacto = radares.map(function (r) {
        return [r.id, r.lat, r.lng, r.vmax];
    });
    const usarBaldosas = radares.length > 4000;
    const manifest = {
        v: v,
        tileDeg: TILE_DEG,
        count: radares.length,
        modo: usarBaldosas ? "baldosas" : "unico"
    };

    if (usarBaldosas) {
        fs.mkdirSync(TILE_DIR, { recursive: true });
        const buckets = Object.create(null);
        radares.forEach(function (r) {
            const k = tileKey(r.lat, r.lng);
            if (!buckets[k]) buckets[k] = [];
            buckets[k].push([r.id, r.lat, r.lng, r.vmax]);
        });
        const tiles = Object.keys(buckets).sort();
        tiles.forEach(function (k) {
            fs.writeFileSync(path.join(TILE_DIR, k + ".json"), JSON.stringify({ v: v, p: buckets[k] }));
        });
        manifest.tiles = tiles;
        const cat = path.join(OUT_DIR, "catalogo.json");
        if (fs.existsSync(cat)) fs.unlinkSync(cat);
        console.log("Baldosas:", tiles.length, "v=" + v);
    } else {
        fs.writeFileSync(path.join(OUT_DIR, "catalogo.json"), JSON.stringify({ v: v, p: compacto }));
        try { fs.rmdirSync(TILE_DIR); } catch (e) {}
        console.log("Catálogo único:", radares.length, "puntos, v=" + v);
    }

    fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest));
}

main();
