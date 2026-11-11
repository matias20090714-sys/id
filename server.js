// ============================================================
//  CONSULTA POR NOMBRE
//  local: node server.js   ->  http://localhost:3000
//  nube: Render (usa la variable PORT)
// ============================================================

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";

if (existsSync(".env")) {
  for (const linea of readFileSync(".env", "utf8").split("\n")) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}

const DEMO = process.env.MODO_DEMO !== "0";
const PUERTO = Number(process.env.PORT || process.env.PUERTO) || 3000;
const CLAVE = process.env.CLAVE_ACCESO || "";

const sinTildes = (s) =>
  String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
const limpiarNombre = (s) => sinTildes(s).replace(/[^A-Z\s]/g, " ").replace(/\s+/g, " ").trim();
const soloDigitos = (s) => String(s || "").replace(/\D/g, "");
const soloAlfanum = (s) => String(s || "").toUpperCase().replace(/[^0-9K]/g, "");

function partirNombre(entrada) {
  const t = limpiarNombre(entrada).split(" ").filter(Boolean);
  if (t.length < 2) return null;
  if (t.length >= 4) return { nombres: t.slice(0, 2).join(" "), apellidos: t.slice(2, 4).join(" ") };
  if (t.length === 3) return { nombres: t[0], apellidos: t.slice(1, 3).join(" ") };
  return { nombres: t[0], apellidos: t[1] };
}

const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};
const rnd = (seed) => { let x = seed; return () => (x = (x * 1664525 + 1013904223) >>> 0) / 4294967296; };

const PAISES = {
  VE: { nombre: "Venezuela", min: 6, max: 9, checksum: null, buscable: true },
  EC: { nombre: "Ecuador", min: 10, max: 10, checksum: "ec", buscable: true },
  CL: { nombre: "Chile", min: 8, max: 9, checksum: "cl", buscable: true },
  CO: { nombre: "Colombia", min: 6, max: 10, checksum: null, buscable: true },
  PE: { nombre: "Perú", min: 8, max: 8, checksum: null, buscable: true },
  UY: { nombre: "Uruguay", min: 8, max: 8, checksum: "uy", buscable: false },
  AR: { nombre: "Argentina", min: 7, max: 8, checksum: null, buscable: false }
};

function checksumEc(c) {
  if (c.length !== 10) return "La cédula ecuatoriana tiene 10 dígitos";
  const prov = +c.slice(0, 2);
  if (!((prov >= 1 && prov <= 24) || prov === 30)) return "Código de provincia inválido";
  if (+c[2] > 5) return "Tercer dígito inválido";
  let s = 0;
  for (let i = 0; i < 9; i++) {
    let p = +c[i] * (i % 2 === 0 ? 2 : 1);
    if (p > 9) p -= 9;
    s += p;
  }
  if ((10 - (s % 10)) % 10 !== +c[9]) return "Dígito verificador incorrecto";
  return null;
}

function checksumCl(c) {
  if (c.length < 8 || c.length > 9) return "El RUT tiene 8 o 9 caracteres";
  const cuerpo = c.slice(0, -1);
  let s = 0, m = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) { s += +cuerpo[i] * m; m = m === 7 ? 2 : m + 1; }
  const r = 11 - (s % 11);
  const esp = r === 11 ? "0" : r === 10 ? "K" : String(r);
  if (esp !== c.slice(-1)) return "Dígito verificador incorrecto (corresponde " + esp + ")";
  return null;
}

function checksumUy(c) {
  if (c.length !== 8) return "La cédula uruguaya tiene 8 dígitos";
  const w = [2, 9, 8, 7, 6, 3, 4];
  let s = 0;
  for (let i = 0; i < 7; i++) s += +c[i] * w[i];
  let chk = 10 - (s % 10);
  if (chk === 10) chk = 0;
  if (chk !== +c[7]) return "Dígito verificador incorrecto";
  return null;
}

const CHECKS = { ec: checksumEc, cl: checksumCl, uy: checksumUy };

function validarDocumento(pais, doc) {
  const meta = PAISES[pais];
  if (!meta) return "País no soportado";
  if (!doc) return "Falta el documento";
  if (doc.length < meta.min || doc.length > meta.max)
    return "Formato inválido para " + meta.nombre + " (" + meta.min + "-" + meta.max + " caracteres)";
  const fn = CHECKS[meta.checksum];
  return fn ? fn(doc) : null;
}

const BANCOS_VE = {
  "0102": "Banco de Venezuela", "0105": "Mercantil", "0108": "BBVA Provincial",
  "0114": "Bancaribe", "0115": "Banco Exterior", "0128": "Banco Caroní",
  "0134": "Banesco", "0137": "Sofitasa", "0138": "Banco Plaza", "0146": "Bangente",
  "0151": "BFC Banco Fondo Común", "0156": "100% Banco", "0157": "DelSur",
  "0163": "Banco del Tesoro", "0166": "Banco Agrícola de Venezuela", "0168": "Bancrecer",
  "0169": "Mi Banco", "0171": "Banco Activo", "0172": "Bancamiga", "0174": "Banplus",
  "0175": "Banco Bicentenario", "0177": "Banfanb", "0191": "Banco Nacional de Crédito"
};

function validarCuentaVe(cuenta, cedula) {
  const c = soloDigitos(cuenta);
  if (c.length !== 20) return { ok: false, motivo: "La cuenta debe tener 20 dígitos" };
  const banco = BANCOS_VE[c.slice(0, 4)];
  if (!banco) return { ok: false, motivo: "Código de banco desconocido: " + c.slice(0, 4) };
  const w = [3, 2, 7, 6, 5, 4, 3, 2, 7, 6, 5, 4, 3, 2, 7, 6, 5, 4];
  let s = 0;
  for (let i = 0; i < 18; i++) s += +c[i] * w[i];
  let chk = 11 - (s % 11);
  if (chk === 11) chk = 0; else if (chk === 10) chk = 1;
  return { ok: chk === +c.slice(18), banco, agencia: c.slice(4, 8), numero: c.slice(8, 18), titular: cedula };
}

function pagoMovil(datos) {
  const { banco, telefono, cedula, monto } = datos;
  if (!BANCOS_VE[banco]) throw new Error("Código de banco inválido");
  const t = soloDigitos(telefono);
  if (t.length !== 11) throw new Error("El teléfono debe tener 11 dígitos");
  return { bancoDestino: banco, nombreBanco: BANCOS_VE[banco], telefono: t, cedula: soloDigitos(cedula), monto: Number(monto).toFixed(2) };
}

const cache = new Map();
const TTL = (Number(process.env.TTL_CACHE) || 86400) * 1000;
const cacheLeer = (k) => {
  const e = cache.get(k);
  return e && Date.now() - e.ts < TTL ? e.v : null;
};
const cacheGuardar = (k, v) => {
  cache.set(k, { ts: Date.now(), v });
  if (cache.size > 5000) cache.delete(cache.keys().next().value);
};

const NOM = {
  M: ["JOSE", "LUIS", "CARLOS", "PEDRO", "ANDRES", "MIGUEL", "JESUS", "RAFAEL", "DIEGO", "OSCAR"],
  F: ["MARIA", "ANA", "GABRIELA", "DANIELA", "ROSA", "CARMEN", "LUISA", "VALENTINA", "PAOLA", "ELENA"]
};
const APE = ["GONZALEZ", "RODRIGUEZ", "PEREZ", "HERNANDEZ", "GARCIA", "MARTINEZ", "LOPEZ", "SANCHEZ", "RAMIREZ", "TORRES", "FLORES", "RIVAS", "CASTILLO", "MENDOZA"];
const ESTADOS = [["MIRANDA", "SUCRE", "PETARE"], ["DISTRITO CAPITAL", "LIBERTADOR", "CATEDRAL"], ["ZULIA", "MARACAIBO", "BOLIVAR"], ["CARABOBO", "VALENCIA", "SAN JOSE"]];

function documentoDemo(pais, seed) {
  const r = rnd(seed);
  let d = String(Math.floor(10000000 + r() * 89999999));
  if (pais === "EC") {
    let s = 0;
    for (let i = 0; i < 9; i++) {
      let p = +d[i] * (i % 2 === 0 ? 2 : 1);
      if (p > 9) p -= 9;
      s += p;
    }
    d = "17" + d.slice(2, 9) + ((10 - (s % 10)) % 10);
  }
  if (pais === "CL") {
    let s = 0, m = 2;
    for (let i = d.length - 1; i >= 0; i--) { s += +d[i] * m; m = m === 7 ? 2 : m + 1; }
    const r2 = 11 - (s % 11);
    d = d + (r2 === 11 ? "0" : r2 === 10 ? "K" : String(r2));
  }
  return d;
}

function candidatosDemo(pais, params) {
  const base = hash(pais + params.nombres + params.apellidos);
  return Array.from({ length: 6 }, (_, i) => {
    const r = rnd(base + i * 7919);
    const doc = documentoDemo(pais, base + i * 104729);
    return {
      documento: pais === "VE" ? "V-" + doc : doc,
      nombreCompleto: params.nombres + " " + params.apellidos,
      extra: (1958 + Math.floor(r() * 45)) + " · " + (pais === "VE" ? ESTADOS[Math.floor(r() * 4)][0] : "—"),
      fuente: "demo"
    };
  });
}

function fichaDemo(pais, doc) {
  const r = rnd(hash(pais + doc));
  const pick = (a) => a[Math.floor(r() * a.length)];
  const sexo = r() > 0.5 ? "M" : "F";
  const n1 = pick(NOM[sexo]);
  const n2 = r() > 0.45 ? pick(NOM[sexo]) : null;
  const a1 = pick(APE);
  const a2 = r() > 0.4 ? pick(APE) : null;
  const anio = 1960 + Math.floor(r() * 45);
  const est = pick(ESTADOS);
  const nombres = [n1, n2].filter(Boolean).join(" ");
  const apellidos = [a1, a2].filter(Boolean).join(" ");
  return {
    documento: pais === "VE" ? "V-" + doc : doc,
    nacionalidad: pais,
    nombres, apellidos, nombreCompleto: nombres + " " + apellidos,
    sexo: sexo === "M" ? "MASCULINO" : "FEMENINO",
    fechaNacimiento: "0" + (1 + Math.floor(r() * 9)) + "/" + "0" + (1 + Math.floor(r() * 9)) + "/" + anio,
    edad: 2026 - anio,
    lugarNacimiento: est[0] + ", " + est[1],
    direccion: pais === "VE" ? { estado: est[0], municipio: est[1], parroquia: est[2], centro: "U.E. " + pick(["Bolivar", "Miranda", "Sucre"]) } : null,
    rif: pais === "VE" ? "V-" + doc + "-" + (1 + Math.floor(r() * 9)) : null,
    fuente: "demo (simulado)"
  };
}

const BUSCADORES = {
  EC: [
    {
      nombre: "datacil",
      listo: () => !!process.env.DATACIL_KEY,
      peticion: (p) => ({
        url: (process.env.DATACIL_BASE || "https://api.datacil.com") + "/v1/ecuador/search/cedula-by-name?nombres=" +
             encodeURIComponent(p.nombres) + "&apellidos=" + encodeURIComponent(p.apellidos),
        headers: { Authorization: "Bearer " + process.env.DATACIL_KEY }
      }),
      map: (j) => (j.data || j.results || []).map((x) => ({
        documento: x.cedula || x.documento,
        nombreCompleto: x.nombre || [x.nombres, x.apellidos].filter(Boolean).join(" "),
        extra: x.fecha_nacimiento || null,
        fuente: "datacil"
      }))
    },
    {
      nombre: "consultas.ec",
      listo: () => !!process.env.CONSULTAS_EC_KEY,
      peticion: (p) => ({
        url: "https://consultas.ec/persona/buscar?apellidos=" + encodeURIComponent(p.apellidos) + "&nombres=" + encodeURIComponent(p.nombres),
        headers: { "X-Credits-Token": process.env.CONSULTAS_EC_KEY }
      }),
      map: (j) => (Array.isArray(j) ? j : j.resultados || j.data || []).map((x) => ({
        documento: x.cedula || x.documento,
        nombreCompleto: x.nombre || [x.nombres, x.apellidos].filter(Boolean).join(" "),
        extra: x.fecha_nacimiento || null,
        fuente: "consultas.ec"
      }))
    }
  ],
  CO: [
    {
      nombre: "croma",
      listo: () => !!process.env.CROMA_KEY,
      peticion: (p) => ({
        url: (process.env.CROMA_BASE || "https://api.croma.run") + "/co/registro-civil/birth-record/v1",
        metodo: "POST",
        headers: { Authorization: "Bearer " + process.env.CROMA_KEY, "Content-Type": "application/json" },
        cuerpo: {
          first_name: p.nombres.split(" ")[0],
          first_surname: p.apellidos.split(" ")[0],
          second_surname: p.apellidos.split(" ")[1] || undefined,
          sex: p.sexo || "M",
          birth_date: p.fechaNacimiento
        }
      }),
      map: (j) => (j.records || []).map((x) => ({
        documento: x.document_number,
        nombreCompleto: x.full_name,
        extra: x.registered_at,
        fuente: "croma"
      }))
    }
  ],
  PE: [
    {
      nombre: "scrall",
      listo: () => !!process.env.SCRALL_KEY,
      peticion: (p) => ({
        url: (process.env.SCRALL_BASE || "https://api.scrall.net") + "/v1/reniec/nombres",
        metodo: "POST",
        headers: { Authorization: "Bearer " + process.env.SCRALL_KEY, "Content-Type": "application/json" },
        cuerpo: { nombres: p.nombres, apellidoPaterno: p.apellidos.split(" ")[0], apellidoMaterno: p.apellidos.split(" ")[1] }
      }),
      map: (j) => (j.resultados || j.data || []).map((x) => ({
        documento: x.dni,
        nombreCompleto: [x.nombres, x.apellido_paterno, x.apellido_materno].filter(Boolean).join(" "),
        extra: x.fecha_nacimiento || null,
        fuente: "scrall"
      }))
    }
  ],
  CL: [
    {
      nombre: "apify-rutificador",
      listo: () => !!process.env.APIFY_TOKEN && !!process.env.APIFY_ACTOR,
      peticion: (p) => ({
        url: "https://api.apify.com/v2/acts/" + process.env.APIFY_ACTOR + "/run-sync-get-dataset-items?token=" + process.env.APIFY_TOKEN,
        metodo: "POST",
        headers: { "Content-Type": "application/json" },
        cuerpo: { nombre: p.nombres + " " + p.apellidos, maxItems: 10 }
      }),
      map: (j) => (Array.isArray(j) ? j : []).map((x) => ({
        documento: x.rut || x.RUT,
        nombreCompleto: x.nombre || x.nombreCompleto,
        extra: x.comuna || null,
        fuente: "apify"
      }))
    }
  ],
  VE: [
    {
      nombre: "armandodata (scraping)",
      listo: () => true,
      peticion: (p) => ({
        url: (process.env.ARMANDODATA_URL || "https://armandodata.com/Personas/Search?nombre={q}")
          .replace("{q}", encodeURIComponent(p.nombres + " " + p.apellidos)),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; consulta/2.0)", Accept: "text/html" },
        texto: true
      }),
      map: (html) => {
        const vistos = new Set();
        const salida = [];
        const re = /Detalles\?cedula=([VE]?\d+)[^>]*>([^<]{4,80})</g;
        let m;
        while ((m = re.exec(html)) && salida.length < 15) {
          if (vistos.has(m[1])) continue;
          vistos.add(m[1]);
          salida.push({
            documento: /^[VE]/.test(m[1]) ? m[1][0] + "-" + m[1].slice(1) : "V-" + m[1],
            nombreCompleto: m[2].replace(/\s+/g, " ").trim(),
            extra: null,
            fuente: "armandodata"
          });
        }
        return salida;
      }
    }
  ]
};

async function buscar(pais, params) {
  const cadena = (BUSCADORES[pais] || []).filter((b) => b.listo());
  if (!cadena.length) return { ok: false, detalle: "No hay buscador configurado para " + pais };
  const errores = [];
  for (const b of cadena) {
    try {
      const pet = b.peticion(params);
      const r = await fetch(pet.url, {
        method: pet.metodo || "GET",
        headers: pet.headers,
        body: pet.cuerpo ? JSON.stringify(pet.cuerpo) : undefined,
        signal: AbortSignal.timeout(20000)
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const crudo = pet.texto ? await r.text() : await r.json();
      const lista = b.map(crudo).filter((x) => x.documento);
      if (lista.length) return { ok: true, candidatos: lista, fuente: b.nombre };
      errores.push(b.nombre + ": 0 resultados");
    } catch (e) {
      errores.push(b.nombre + ": " + e.message);
    }
  }
  return { ok: false, detalle: errores.join(" | ") };
}

const PROVEEDORES = {
  VE: [
    {
      nombre: "verifik",
      listo: () => !!process.env.VERIFIK_TOKEN,
      url: (doc) => "https://api.verifik.co/v2/ve/cedula?documentNumber=" + doc,
      headers: () => ({ Authorization: "Bearer " + process.env.VERIFIK_TOKEN, Accept: "application/json" }),
      map: (j, doc) => {
        const d = j.data || {};
        return {
          documento: "V-" + doc, nacionalidad: "V",
          nombres: d.firstName || null, apellidos: d.lastName || null,
          nombreCompleto: d.fullName || null,
          fechaNacimiento: d.birthDate || null, sexo: d.gender || null,
          direccion: null, fuente: "verifik"
        };
      }
    },
    {
      nombre: "cedula.com.ve",
      listo: () => !!(process.env.CEDULAVE_APP_ID && process.env.CEDULAVE_TOKEN),
      url: (doc) => "https://api.cedula.com.ve/api/v1?app_id=" + process.env.CEDULAVE_APP_ID +
                    "&token=" + process.env.CEDULAVE_TOKEN + "&nacionalidad=V&cedula=" + doc,
      headers: () => ({ Accept: "application/json" }),
      map: (j, doc) => {
        if (j.error) throw new Error(j.error_str || "error del proveedor");
        const d = j.data || {};
        const nombres = [d.primer_nombre, d.segundo_nombre].filter(Boolean).join(" ");
        const apellidos = [d.primer_apellido, d.segundo_apellido].filter(Boolean).join(" ");
        return {
          documento: "V-" + doc, nacionalidad: "V",
          nombres, apellidos, nombreCompleto: (nombres + " " + apellidos).trim(),
          rif: d.rif || null,
          direccion: d.cne ? { estado: d.cne.estado, municipio: d.cne.municipio, parroquia: d.cne.parroquia, centro: d.cne.centro_electoral } : null,
          fuente: "cedula.com.ve"
        };
      }
    }
  ],
  EC: [
    {
      nombre: "whoecuador",
      listo: () => !!process.env.WHOECUADOR_KEY,
      url: (doc) => "https://api.whoecuador.com/v2/cedula/" + doc,
      headers: () => ({ Authorization: "Bearer " + process.env.WHOECUADOR_KEY }),
      map: (j, doc) => ({
        documento: doc, nacionalidad: "EC",
        nombres: j.nombres || null, apellidos: j.apellidos || null,
        nombreCompleto: [j.nombres, j.apellidos].filter(Boolean).join(" ") || null,
        fechaNacimiento: j.fecha_nacimiento || null, estado: j.estado || null,
        direccion: null, fuente: "whoecuador"
      })
    },
    {
      nombre: "ecuadorapi",
      listo: () => !!process.env.ECUADORAPI_KEY,
      url: (doc) => "https://api.ecuadorapi.com/api/v1/cedulas/" + doc,
      headers: () => ({ Authorization: "Bearer " + process.env.ECUADORAPI_KEY, Accept: "application/json" }),
      map: (j, doc) => {
        const d = j.data || {};
        const partes = String(d.full_name || "").trim().split(/\s+/);
        return {
          documento: doc, nacionalidad: "EC",
          nombres: partes.slice(2).join(" ") || null,
          apellidos: partes.slice(0, 2).join(" ") || null,
          nombreCompleto: d.full_name || null,
          fechaNacimiento: d.birth_date || null, edad: d.age ?? null,
          lugarNacimiento: d.birth_place || null, direccion: null, fuente: "ecuadorapi"
        };
      }
    }
  ],
  CO: [
    {
      nombre: "croma-estado-vital",
      listo: () => !!process.env.CROMA_KEY,
      url: () => (process.env.CROMA_BASE || "https://api.croma.run") + "/co/registraduria/vital-status/v1",
      metodo: "POST",
      headers: () => ({ Authorization: "Bearer " + process.env.CROMA_KEY, "Content-Type": "application/json" }),
      cuerpo: (doc) => ({ document_number: doc }),
      map: (j, doc) => ({
        documento: doc, nacionalidad: "CO", nombreCompleto: null,
        estadoVital: j.status || null, encontrado: j.found, direccion: null, fuente: "croma"
      })
    }
  ]
};

async function pedirFicha(pais, doc) {
  const cadena = (PROVEEDORES[pais] || []).filter((p) => p.listo());
  if (!cadena.length) return { ok: false, detalle: "Sin proveedor de ficha para " + pais };
  const errores = [];
  for (const p of cadena) {
    try {
      const r = await fetch(p.url(doc), {
        method: p.metodo || "GET",
        headers: p.headers(),
        body: p.cuerpo ? JSON.stringify(p.cuerpo(doc)) : undefined,
        signal: AbortSignal.timeout(15000)
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return { ok: true, datos: p.map(await r.json(), doc) };
    } catch (e) {
      errores.push(p.nombre + ": " + e.message);
    }
  }
  return { ok: false, detalle: errores.join(" | ") };
}

function autorizado(req, url) {
  if (!CLAVE) return true;
  return url.searchParams.get("k") === CLAVE
      || (req.headers.cookie || "").includes("k=" + CLAVE)
      || (req.headers.authorization || "") === "Bearer " + CLAVE;
}

const golpes = new Map();
function limitar(req) {
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim()
          || req.socket.remoteAddress || "?";
  const ahora = Date.now();
  const r = golpes.get(ip) || { n: 0, t: ahora };
  if (ahora - r.t > 60000) { r.n = 0; r.t = ahora; }
  r.n++;
  golpes.set(ip, r);
  if (golpes.size > 10000) golpes.clear();
  return r.n <= 60;
}

const enviar = (res, code, cuerpo) => {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(cuerpo, null, 2));
};

const leerCuerpo = async (req) => {
  let c = "";
  for await (const t of req) c += t;
  return JSON.parse(c || "{}");
};

const NEGADO = `<!doctype html><meta charset="utf-8">
<body style="font-family:system-ui;background:#0e1116;color:#e6e9ef;padding:40px">
<h2>Falta la clave</h2><p>Agrega <b>?k=TU_CLAVE</b> al final de la URL.</p></body>`;

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");

  try {
    if (!autorizado(req, url)) {
      res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(NEGADO);
    }

    if (url.pathname === "/health") return enviar(res, 200, { ok: true, modo: DEMO ? "demo" : "real" });

    if (url.pathname === "/api/paises") {
      return enviar(res, 200, Object.entries(PAISES).map(([k, v]) => ({ codigo: k, nombre: v.nombre, buscable: v.buscable })));
    }

    if (url.pathname === "/api/buscar") {
      if (!limitar(req)) return enviar(res, 429, { error: "Espera un minuto" });
      const pais = (url.searchParams.get("pais") || "").toUpperCase();
      if (!PAISES[pais]) return enviar(res, 400, { error: "País no soportado" });

      const params = partirNombre(url.searchParams.get("nombre"));
      if (!params) return enviar(res, 422, { error: "Escribe al menos un nombre y un apellido" });
      if (url.searchParams.get("sexo")) params.sexo = url.searchParams.get("sexo").toUpperCase();
      if (url.searchParams.get("fechaNacimiento")) params.fechaNacimiento = url.searchParams.get("fechaNacimiento");

      const llave = "b:" + pais + ":" + params.nombres + "|" + params.apellidos + "|" + (params.sexo || "") + "|" + (params.fechaNacimiento || "");
      const guardado = cacheLeer(llave);
      if (guardado) return enviar(res, 200, Object.assign({}, guardado, { cache: true }));

      const r = DEMO
        ? { ok: true, candidatos: candidatosDemo(pais, params), fuente: "demo" }
        : await buscar(pais, params);
      if (!r.ok) return enviar(res, 502, { error: r.detalle });

      const salida = { pais, normalizado: params, candidatos: r.candidatos, fuente: r.fuente, modo: DEMO ? "demo" : "real" };
      cacheGuardar(llave, salida);
      return enviar(res, 200, Object.assign({}, salida, { cache: false }));
    }

    if (url.pathname === "/api/ficha") {
      if (!limitar(req)) return enviar(res, 429, { error: "Espera un minuto" });
      const pais = (url.searchParams.get("pais") || "").toUpperCase();
      const doc = soloAlfanum(url.searchParams.get("doc"));
      if (!PAISES[pais]) return enviar(res, 400, { error: "País no soportado" });
      const err = validarDocumento(pais, doc);
      if (err) return enviar(res, 422, { error: err });

      const llave = "f:" + pais + ":" + doc;
      const guardado = cacheLeer(llave);
      if (guardado) return enviar(res, 200, Object.assign({}, guardado, { cache: true }));

      let persona;
      if (DEMO) persona = fichaDemo(pais, doc);
      else {
        const r = await pedirFicha(pais, doc);
        if (!r.ok) return enviar(res, 502, { error: r.detalle });
        persona = r.datos;
      }

      const salida = {
        validacion: { pais, documento: doc, valido: true },
        persona,
        bancario: { nota: pais === "VE" ? "La cédula no trae cuentas. Usa el validador." : "Requiere proveedor bancario." }
      };
      cacheGuardar(llave, salida);
      return enviar(res, 200, Object.assign({}, salida, { cache: false }));
    }

    if (url.pathname === "/api/bancos") return enviar(res, 200, BANCOS_VE);

    if (url.pathname === "/api/banco/validar" && req.method === "POST") {
      const { cuenta, cedula } = await leerCuerpo(req);
      return enviar(res, 200, validarCuentaVe(cuenta, cedula));
    }

    if (url.pathname === "/api/banco/pago-movil" && req.method === "POST") {
      return enviar(res, 200, pagoMovil(await leerCuerpo(req)));
    }

    const cabeceras = { "Content-Type": "text/html; charset=utf-8" };
    if (CLAVE && url.searchParams.get("k") === CLAVE) {
      cabeceras["Set-Cookie"] = "k=" + CLAVE + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800";
    }
    res.writeHead(200, cabeceras);
    return res.end(HTML);
  } catch (e) {
    return enviar(res, 500, { error: e.message });
  }
}).listen(PUERTO, "0.0.0.0", () => {
  console.log("");
  console.log("  http://localhost:" + PUERTO);
  console.log("  Modo: " + (DEMO ? "DEMO" : "REAL"));
  console.log("  Clave: " + (CLAVE ? "activada" : "sin clave"));
  console.log("");
});

const HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Consulta por nombre</title>
<style>
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#0e1116;color:#e6e9ef}
.wrap{max-width:820px;margin:0 auto;padding:26px}
h1{font-size:20px;margin:0 0 6px}
.sub{font-size:13px;color:#8b94a3;margin:0 0 18px}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
select,input,button{font:inherit;font-size:14px;border-radius:9px;border:1px solid #262d38;padding:10px 12px;background:#161b23;color:#e6e9ef;outline:none}
select{flex:0 0 170px}input{flex:1 1 200px}
button{background:#3d7dff;border-color:#3d7dff;color:#fff;font-weight:600;cursor:pointer;padding:10px 18px}
.msg{font-size:12.5px;margin-top:10px;min-height:16px}
.bad{color:#ff6b6b}.ok{color:#48d18a}
.cand{border:1px solid #232a35;border-radius:10px;padding:12px 14px;margin-top:8px;background:#131820;cursor:pointer;display:flex;justify-content:space-between;gap:12px}
.cand:hover{border-color:#3d7dff}
.cand b{font-size:14px}.cand span{font-size:12px;color:#8b94a3}
.card{border:1px solid #232a35;border-radius:12px;overflow:hidden;background:#131820;margin-top:16px}
.hd{padding:14px 16px;background:#18202b;border-bottom:1px solid #232a35}
.nm{font-size:17px;font-weight:700}.meta{font-size:12px;color:#8b94a3;margin-top:3px}
.sec{padding:14px 16px;border-bottom:1px solid #1c232d}.sec:last-child{border:0}
.st{font-size:10.5px;text-transform:uppercase;letter-spacing:1.1px;color:#5f6a7d;margin-bottom:8px;font-weight:700}
dl{display:grid;grid-template-columns:150px 1fr;gap:6px 12px;font-size:13.5px;margin:0}
dt{color:#8b94a3}dd{margin:0;word-break:break-word}
pre{background:#0a0d12;border:1px solid #1c232d;border-radius:9px;padding:12px;font-size:11.5px;overflow-x:auto;color:#9fd6b8}
.none{font-size:13px;color:#6b7488;font-style:italic}
</style></head><body>
<div class="wrap">
<h1>Buscar por nombre</h1>
<p class="sub">Nombre y apellidos. Devuelve varios candidatos; elige uno para cargar la ficha.</p>
<div class="row"><select id="pais"></select><input id="nombre" placeholder="Nombres y apellidos" autocomplete="off"><button id="buscar">Buscar</button></div>
<div class="row"><select id="sexo"><option value="">Sexo (opcional)</option><option value="M">Masculino</option><option value="F">Femenino</option></select><input id="fnac" type="date"></div>
<div id="msg" class="msg"></div><div id="lista"></div><div id="ficha"></div>
</div>
<script>
var $=function(s){return document.querySelector(s)};
var msg=$("#msg"),lista=$("#lista"),ficha=$("#ficha");
function decir(t,c){msg.className="msg "+(c||"");msg.textContent=t}
fetch("/api/paises").then(function(r){return r.json()}).then(function(ps){
  $("#pais").innerHTML=ps.map(function(p){
    return '<option value="'+p.codigo+'"'+(p.buscable?"":" disabled")+'>'+p.nombre+(p.buscable?"":" (solo doc)")+'</option>'
  }).join("")
});
$("#buscar").onclick=function(){
  var pais=$("#pais").value,nombre=$("#nombre").value.trim();
  if(!nombre)return decir("Escribe nombre y apellidos","bad");
  lista.innerHTML="";ficha.innerHTML="";decir("Buscando...");
  var q="pais="+pais+"&nombre="+encodeURIComponent(nombre);
  if($("#sexo").value)q+="&sexo="+$("#sexo").value;
  if($("#fnac").value)q+="&fechaNacimiento="+$("#fnac").value;
  fetch("/api/buscar?"+q).then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}})}).then(function(x){
    if(!x.ok)return decir(x.j.error||"Error","bad");
    decir(x.j.candidatos.length+" coincidencias · "+x.j.fuente,"ok");
    lista.innerHTML=x.j.candidatos.map(function(c,i){
      return '<div class="cand" data-i="'+i+'"><b>'+(c.nombreCompleto||"—")+'</b><span>'+c.documento+'</span></div>'
    }).join("");
    var els=lista.querySelectorAll(".cand");
    for(var i=0;i<els.length;i++){(function(el){
      el.onclick=function(){cargar(pais,x.j.candidatos[+el.dataset.i].documento)}
    })(els[i])}
  })
};
function cargar(pais,doc){
  ficha.innerHTML="";decir("Cargando "+doc+"...");
  var limpio=String(doc).replace(/^[A-Z]-/,"");
  fetch("/api/ficha?pais="+pais+"&doc="+limpio).then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}})}).then(function(x){
    if(!x.ok)return decir(x.j.error||"Error","bad");
    decir("Ficha cargada","ok");
    var p=x.j.persona,d=p.direccion;
    var h='<div class="card"><div class="hd"><div class="nm">'+(p.nombreCompleto||"—")+'</div><div class="meta">'+p.documento+' · '+(p.fuente||"")+'</div></div>';
    h+='<div class="sec"><div class="st">Identidad</div><dl><dt>Documento</dt><dd>'+p.documento+'</dd><dt>Nombres</dt><dd>'+(p.nombres||"—")+'</dd><dt>Apellidos</dt><dd>'+(p.apellidos||"—")+'</dd><dt>Sexo</dt><dd>'+(p.sexo||"—")+'</dd><dt>Nacimiento</dt><dd>'+(p.fechaNacimiento||"—")+'</dd><dt>Lugar</dt><dd>'+(p.lugarNacimiento||"—")+'</dd>'+(p.rif?'<dt>RIF</dt><dd>'+p.rif+'</dd>':'')+'</dl></div>';
    h+='<div class="sec"><div class="st">Residencia / electoral</div>'+(d?'<dl><dt>Estado</dt><dd>'+d.estado+'</dd><dt>Municipio</dt><dd>'+d.municipio+'</dd><dt>Parroquia</dt><dd>'+d.parroquia+'</dd></dl>':'<div class="none">Sin dirección.</div>')+'</div>';
    h+='<div class="sec"><div class="st">Bancario</div><div class="none">'+x.j.bancario.nota+'</div>'+(pais==="VE"?'<div class="row" style="margin-top:8px"><input id="cta" maxlength="20" placeholder="20 dígitos de la cuenta"><button id="vcta">Validar</button></div><div id="rc" class="msg"></div>':'')+'</div>';
    h+='<div class="sec"><details><summary style="font-size:12px;color:#8b94a3;cursor:pointer">JSON crudo</summary><pre>'+JSON.stringify(x.j,null,2)+'</pre></details></div></div>';
    ficha.innerHTML=h;
    var b=$("#vcta");
    if(b)b.onclick=function(){
      fetch("/api/banco/validar",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({cuenta:$("#cta").value,cedula:p.documento})})
      .then(function(r){return r.json()}).then(function(jj){
        $("#rc").className="msg "+(jj.ok?"ok":"bad");
        $("#rc").textContent=jj.ok?"Válida · "+jj.banco+" · agencia "+jj.agencia:jj.motivo
      })
    }
  })
}
</script></body></html>`;
