// SQLite database layer (Node built-in node:sqlite). Single real relational DB
// backing the two existing tiles (Projets & Livrables, Commandes) AND the Sage
// Gestion Commerciale module (devis/commande/BL/facture/avoir + référentiels).

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "oms.db");
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

// ───── Schema ─────
db.exec(`
  -- ===== Tile 1: Projets & Livrables =====
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    ref TEXT, title TEXT NOT NULL, client TEXT NOT NULL, contact TEXT,
    amount REAL DEFAULT 0, stage TEXT DEFAULT 'recu', due TEXT, owner TEXT,
    items INTEGER DEFAULT 1, order_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ===== Tile 2: Commandes =====
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    ref_sage TEXT, title TEXT NOT NULL, client TEXT NOT NULL, contact TEXT,
    amount REAL DEFAULT 0, items INTEGER DEFAULT 1, delivery_date TEXT, owner TEXT,
    status TEXT DEFAULT 'a_valider', project_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ===== Sage — administration / référentiels =====
  CREATE TABLE IF NOT EXISTS company (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT, address TEXT, zip TEXT, city TEXT,
    siret TEXT, vat_number TEXT, phone TEXT, email TEXT, iban TEXT
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, email TEXT, role TEXT DEFAULT 'commercial', active INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS vat_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL, rate REAL NOT NULL, is_default INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS payment_methods (
    id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS payment_terms (
    id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, days INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS doc_sequences (
    doc_type TEXT PRIMARY KEY, prefix TEXT NOT NULL, next_number INTEGER DEFAULT 1, padding INTEGER DEFAULT 5
  );
  CREATE TABLE IF NOT EXISTS article_families (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT UNIQUE, label TEXT NOT NULL, description TEXT, unit TEXT DEFAULT 'u',
    price_ht REAL DEFAULT 0, vat_rate REAL DEFAULT 20, family_id INTEGER, stock REAL DEFAULT 0, active INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE, name TEXT NOT NULL, contact TEXT, email TEXT, phone TEXT,
    address TEXT, zip TEXT, city TEXT, vat_number TEXT,
    payment_term_id INTEGER, payment_method_id INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ===== Sage — documents =====
  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,                  -- devis | commande | bl | facture | avoir
    number TEXT NOT NULL,
    customer_id INTEGER,
    customer_name TEXT,
    date TEXT,
    due_date TEXT,
    status TEXT,
    parent_id INTEGER,
    payment_term_id INTEGER,
    payment_method_id INTEGER,
    notes TEXT,
    total_ht REAL DEFAULT 0,
    total_vat REAL DEFAULT 0,
    total_ttc REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS document_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    article_id INTEGER,
    ref TEXT,
    designation TEXT NOT NULL,
    qty REAL DEFAULT 1,
    unit TEXT DEFAULT 'u',
    unit_price_ht REAL DEFAULT 0,
    discount_pct REAL DEFAULT 0,
    vat_rate REAL DEFAULT 20,
    total_ht REAL DEFAULT 0,
    total_vat REAL DEFAULT 0,
    total_ttc REAL DEFAULT 0,
    position INTEGER DEFAULT 0
  );
`);

// ───── Tiny query helper ─────
export const q = {
  all: (sql, ...p) => db.prepare(sql).all(...p),
  get: (sql, ...p) => db.prepare(sql).get(...p),
  run: (sql, ...p) => db.prepare(sql).run(...p),
  tx: (fn) => { db.exec("BEGIN"); try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } },
};

export { db };

// ───── Seed (idempotent — only when empty) ─────
function seedOnce() {
  const count = (t) => q.get(`SELECT COUNT(*) AS n FROM ${t}`).n;

  // Migrate the two tiles from the legacy JSON store if present and DB empty.
  const legacyPath = path.join(DATA_DIR, "db.json");
  let legacy = null;
  if (fs.existsSync(legacyPath)) {
    try { legacy = JSON.parse(fs.readFileSync(legacyPath, "utf8")); } catch (e) { /* ignore */ }
  }

  if (count("projects") === 0) {
    const projects = (legacy && legacy.projects) || [
      { id: "PRJ-1042", ref: "DEV-2026-0118", title: "Climatisation salle serveurs (étude)", client: "Mairie de Vincennes", contact: "S. Petit", amount: 18400, stage: "en_preparation", due: "2026-06-22", owner: "Karim Ben Salah", items: 12, orderId: null },
      { id: "PRJ-1039", ref: "DEV-2026-0109", title: "Remplacement chaudière collective", client: "Syndic Foch", contact: "C. Aubry", amount: 27300, stage: "pret_a_livrer", due: "2026-06-18", owner: "Tom Verdier", items: 15, orderId: null },
      { id: "PRJ-1037", ref: "DEV-2026-0098", title: "Réseau gaines + diffuseurs étage 2", client: "Clinique du Parc", contact: "É. Dubois", amount: 31200, stage: "installe", due: "2026-06-05", owner: "Léa Marchand", items: 22, orderId: null },
      { id: "PRJ-1036", ref: "DEV-2026-0091", title: "Entretien annuel CTA toiture", client: "Centre commercial Rivoli", contact: "B. Fontaine", amount: 6400, stage: "clos", due: "2026-05-28", owner: "Tom Verdier", items: 3, orderId: null },
    ];
    for (const p of projects) {
      q.run(`INSERT INTO projects (id,ref,title,client,contact,amount,stage,due,owner,items,order_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        p.id, p.ref, p.title, p.client, p.contact || "", p.amount || 0, p.stage || "recu", p.due || null, p.owner || null, p.items || 1, p.orderId || null);
    }
  }

  if (count("orders") === 0) {
    const orders = (legacy && legacy.orders) || [
      { id: "CMD-5012", refSage: "CO-2026-0204", title: "Climatisation salle serveurs", client: "Mairie de Vincennes", contact: "S. Petit", amount: 18400, items: 12, deliveryDate: "2026-06-22", owner: "Karim Ben Salah", status: "a_valider", projectId: null },
      { id: "CMD-5011", refSage: "CO-2026-0203", title: "Pompe à chaleur — gymnase", client: "Ville de Montreuil", contact: "L. Garnier", amount: 42600, items: 8, deliveryDate: "2026-07-04", owner: "Léa Marchand", status: "a_valider", projectId: null },
      { id: "CMD-5010", refSage: "CO-2026-0201", title: "Rideau d'air chaud entrée magasin", client: "Groupe Delpha", contact: "M. Roy", amount: 7300, items: 4, deliveryDate: "2026-07-10", owner: null, status: "a_valider", projectId: null },
      { id: "CMD-5009", refSage: "CO-2026-0198", title: "Maintenance préventive CTA", client: "Clinique du Parc", contact: "É. Dubois", amount: 5400, items: 6, deliveryDate: "2026-06-28", owner: "Tom Verdier", status: "a_valider", projectId: null },
    ];
    for (const o of orders) {
      q.run(`INSERT INTO orders (id,ref_sage,title,client,contact,amount,items,delivery_date,owner,status,project_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        o.id, o.refSage, o.title, o.client, o.contact || "", o.amount || 0, o.items || 1, o.deliveryDate || null, o.owner || null, o.status || "a_valider", o.projectId || null);
    }
  }

  if (count("company") === 0) {
    q.run(`INSERT INTO company (id,name,address,zip,city,siret,vat_number,phone,email,iban) VALUES (1,?,?,?,?,?,?,?,?,?)`,
      "Astorya", "12 rue de la Paix", "75002", "Paris", "812 345 678 00021", "FR40812345678", "01 84 80 00 00", "contact@astorya.fr", "FR76 3000 4000 0100 0001 2345 678");
  }
  if (count("users") === 0) {
    [["Karim Ben Salah", "karim@astorya.fr", "admin"], ["Léa Marchand", "lea@astorya.fr", "commercial"], ["Tom Verdier", "tom@astorya.fr", "commercial"]]
      .forEach(([n, e, r]) => q.run(`INSERT INTO users (name,email,role) VALUES (?,?,?)`, n, e, r));
  }
  if (count("vat_rates") === 0) {
    [["Taux normal 20%", 20, 1], ["Taux intermédiaire 10%", 10, 0], ["Taux réduit 5,5%", 5.5, 0], ["Exonéré 0%", 0, 0]]
      .forEach(([l, r, d]) => q.run(`INSERT INTO vat_rates (label,rate,is_default) VALUES (?,?,?)`, l, r, d));
  }
  if (count("payment_methods") === 0) {
    ["Virement", "Chèque", "Carte bancaire", "Prélèvement", "Espèces"].forEach((l) => q.run(`INSERT INTO payment_methods (label) VALUES (?)`, l));
  }
  if (count("payment_terms") === 0) {
    [["Comptant", 0], ["30 jours", 30], ["30 jours fin de mois", 30], ["45 jours", 45], ["60 jours", 60]]
      .forEach(([l, d]) => q.run(`INSERT INTO payment_terms (label,days) VALUES (?,?)`, l, d));
  }
  if (count("doc_sequences") === 0) {
    [["devis", "DE-", 1], ["commande", "CO-", 1], ["bl", "BL-", 1], ["facture", "FA-", 1], ["avoir", "AV-", 1]]
      .forEach(([t, p, n]) => q.run(`INSERT INTO doc_sequences (doc_type,prefix,next_number,padding) VALUES (?,?,?,5)`, t, p, n));
  }
  if (count("article_families") === 0) {
    ["Climatisation", "Chauffage", "Ventilation", "Prestations"].forEach((n) => q.run(`INSERT INTO article_families (name) VALUES (?)`, n));
  }
  if (count("articles") === 0) {
    const arts = [
      ["CLIM-MONO-25", "Climatiseur monosplit 2,5 kW", "u", 690, 20, 1, 24],
      ["CLIM-MULTI-50", "Climatiseur multisplit 5 kW", "u", 1490, 20, 1, 8],
      ["PAC-AIR-12", "Pompe à chaleur air/air 12 kW", "u", 3200, 20, 2, 5],
      ["GAINE-ALU-150", "Gaine aluminium Ø150 (3 m)", "ml", 18.5, 20, 3, 120],
      ["DIFF-PLAF-600", "Diffuseur plafonnier 600x600", "u", 74, 20, 3, 60],
      ["MO-POSE-H", "Main d'œuvre pose (heure)", "h", 55, 20, 4, 0],
      ["MO-MAINT-H", "Main d'œuvre maintenance (heure)", "h", 65, 20, 4, 0],
    ];
    arts.forEach(([ref, label, unit, price, vat, fam, stock]) =>
      q.run(`INSERT INTO articles (ref,label,unit,price_ht,vat_rate,family_id,stock) VALUES (?,?,?,?,?,?,?)`, ref, label, unit, price, vat, fam, stock));
  }
  if (count("customers") === 0) {
    const custs = [
      ["CL-001", "Mairie de Vincennes", "S. Petit", "marches@vincennes.fr", "01 43 98 65 00", "53 rue de Fontenay", "94300", "Vincennes", "FR12345678901", 2, 1],
      ["CL-002", "Ville de Montreuil", "L. Garnier", "achats@montreuil.fr", "01 48 70 60 00", "Place Jean Jaurès", "93100", "Montreuil", "FR23456789012", 3, 1],
      ["CL-003", "Clinique du Parc", "É. Dubois", "technique@cliniqueduparc.fr", "01 49 00 11 22", "8 av. du Parc", "92350", "Le Plessis", "FR34567890123", 2, 1],
      ["CL-004", "Groupe Delpha", "M. Roy", "m.roy@delpha.fr", "01 55 22 33 44", "21 quai de Seine", "75019", "Paris", "FR45678901234", 4, 3],
    ];
    custs.forEach(([code, name, contact, email, phone, addr, zip, city, vat, term, method]) =>
      q.run(`INSERT INTO customers (code,name,contact,email,phone,address,zip,city,vat_number,payment_term_id,payment_method_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        code, name, contact, email, phone, addr, zip, city, vat, term, method));
  }
}

seedOnce();
