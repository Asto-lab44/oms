// Tiny JSON-file persistence layer. Real, durable storage without native deps —
// good enough for the OMS service and trivially swappable for Postgres later.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "db.json");

const SEED = {
  orders: [
    { id: "CMD-5012", refSage: "CO-2026-0204", title: "Climatisation salle serveurs", client: "Mairie de Vincennes", contact: "S. Petit", amount: 18400, items: 12, deliveryDate: "2026-06-22", owner: "Karim Ben Salah", status: "a_valider", projectId: null },
    { id: "CMD-5011", refSage: "CO-2026-0203", title: "Pompe à chaleur — gymnase", client: "Ville de Montreuil", contact: "L. Garnier", amount: 42600, items: 8, deliveryDate: "2026-07-04", owner: "Léa Marchand", status: "a_valider", projectId: null },
    { id: "CMD-5010", refSage: "CO-2026-0201", title: "Rideau d'air chaud entrée magasin", client: "Groupe Delpha", contact: "M. Roy", amount: 7300, items: 4, deliveryDate: "2026-07-10", owner: null, status: "a_valider", projectId: null },
    { id: "CMD-5009", refSage: "CO-2026-0198", title: "Maintenance préventive CTA", client: "Clinique du Parc", contact: "É. Dubois", amount: 5400, items: 6, deliveryDate: "2026-06-28", owner: "Tom Verdier", status: "a_valider", projectId: null },
  ],
  projects: [
    { id: "PRJ-1042", ref: "DEV-2026-0118", title: "Climatisation salle serveurs (étude)", client: "Mairie de Vincennes", contact: "S. Petit", amount: 18400, stage: "en_preparation", due: "2026-06-22", owner: "Karim Ben Salah", items: 12, orderId: null },
    { id: "PRJ-1039", ref: "DEV-2026-0109", title: "Remplacement chaudière collective", client: "Syndic Foch", contact: "C. Aubry", amount: 27300, stage: "pret_a_livrer", due: "2026-06-18", owner: "Tom Verdier", items: 15, orderId: null },
    { id: "PRJ-1037", ref: "DEV-2026-0098", title: "Réseau gaines + diffuseurs étage 2", client: "Clinique du Parc", contact: "É. Dubois", amount: 31200, stage: "installe", due: "2026-06-05", owner: "Léa Marchand", items: 22, orderId: null },
    { id: "PRJ-1036", ref: "DEV-2026-0091", title: "Entretien annuel CTA toiture", client: "Centre commercial Rivoli", contact: "B. Fontaine", amount: 6400, stage: "clos", due: "2026-05-28", owner: "Tom Verdier", items: 3, orderId: null },
  ],
};

let cache = null;

function ensureLoaded() {
  if (cache) return cache;
  try {
    if (fs.existsSync(DATA_FILE)) {
      cache = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      return cache;
    }
  } catch (e) {
    console.error("[db] failed to read, reseeding:", e.message);
  }
  cache = structuredClone(SEED);
  flush();
  return cache;
}

function flush() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2));
}

export const db = {
  get(collection) {
    return ensureLoaded()[collection] || [];
  },
  set(collection, rows) {
    ensureLoaded()[collection] = rows;
    flush();
    return rows;
  },
  insert(collection, row) {
    const rows = db.get(collection);
    rows.unshift(row);
    db.set(collection, rows);
    return row;
  },
  update(collection, id, patch) {
    const rows = db.get(collection).map((r) => (r.id === id ? { ...r, ...patch } : r));
    db.set(collection, rows);
    return rows.find((r) => r.id === id) || null;
  },
  find(collection, id) {
    return db.get(collection).find((r) => r.id === id) || null;
  },
};
