import type { Crop } from "./types"

/**
 * Ecological ranges (temp, rain, ph) sourced from the FAO ECOCROP database.
 * Grouped across 8 botanical families to support multi-year crop rotation logic
 * (cereal -> legume -> root/tuber -> oilseed/vegetable break crops).
 */
export const CROPS: Crop[] = [
  // --- CEREALS (Poaceae: Heavy Nitrogen Feeders, Fibrous Roots) ---
  {
    id: "maize", name: "Maize", family: "Poaceae", legume: false,
    temp: { min: 10, optMin: 18, optMax: 33, max: 47 },
    rain: { min: 400, optMin: 600, optMax: 1200, max: 1800 },
    ph: { min: 4.5, optMin: 5.0, optMax: 7.0, max: 8.5 },
    waterNeedMm: 600, relIncome: 0.7,
  },
  {
    id: "sorghum", name: "Sorghum", family: "Poaceae", legume: false,
    temp: { min: 12, optMin: 27, optMax: 35, max: 40 },
    rain: { min: 300, optMin: 400, optMax: 600, max: 3000 },
    ph: { min: 4.5, optMin: 5.5, optMax: 7.5, max: 8.5 },
    waterNeedMm: 450, relIncome: 0.5,
  },
  {
    id: "millet", name: "Pearl millet", family: "Poaceae", legume: false,
    temp: { min: 12, optMin: 25, optMax: 35, max: 45 },
    rain: { min: 200, optMin: 400, optMax: 900, max: 1700 },
    ph: { min: 4.5, optMin: 5.0, optMax: 7.5, max: 8.5 },
    waterNeedMm: 350, relIncome: 0.4,
  },
  {
    id: "rice", name: "Rainfed rice", family: "Poaceae", legume: false,
    temp: { min: 10, optMin: 20, optMax: 30, max: 36 },
    rain: { min: 1000, optMin: 1500, optMax: 2000, max: 4000 },
    ph: { min: 4.5, optMin: 5.5, optMax: 7.0, max: 9.0 },
    waterNeedMm: 1000, relIncome: 0.6,
  },

  // --- LEGUMES (Fabaceae: Nitrogen Fixers) ---
  {
    id: "cowpea", name: "Cowpea", family: "Fabaceae", legume: true,
    temp: { min: 15, optMin: 25, optMax: 35, max: 40 },
    rain: { min: 300, optMin: 500, optMax: 1500, max: 4100 },
    ph: { min: 4.0, optMin: 5.5, optMax: 7.5, max: 8.8 },
    waterNeedMm: 400, relIncome: 0.55,
  },
  {
    id: "groundnut", name: "Groundnut", family: "Fabaceae", legume: true,
    temp: { min: 10, optMin: 22, optMax: 32, max: 45 },
    rain: { min: 400, optMin: 600, optMax: 1500, max: 4000 },
    ph: { min: 4.5, optMin: 5.5, optMax: 7.0, max: 8.5 },
    waterNeedMm: 500, relIncome: 0.65,
  },
  {
    id: "soybean", name: "Soybean", family: "Fabaceae", legume: true,
    temp: { min: 10, optMin: 20, optMax: 33, max: 38 },
    rain: { min: 450, optMin: 600, optMax: 1500, max: 1800 },
    ph: { min: 4.5, optMin: 5.5, optMax: 7.0, max: 8.5 },
    waterNeedMm: 550, relIncome: 0.7,
  },
  {
    id: "bambara", name: "Bambara groundnut", family: "Fabaceae", legume: true,
    temp: { min: 16, optMin: 20, optMax: 30, max: 38 },
    rain: { min: 300, optMin: 600, optMax: 1200, max: 3000 },
    ph: { min: 4.3, optMin: 5.0, optMax: 6.5, max: 7.5 },
    waterNeedMm: 400, relIncome: 0.6,
  },

  // --- ROOTS & TUBERS (Deep Soil Tillage & Potassium Demand) ---
  {
    id: "cassava", name: "Cassava", family: "Euphorbiaceae", legume: false,
    temp: { min: 10, optMin: 20, optMax: 29, max: 35 },
    rain: { min: 500, optMin: 1000, optMax: 1500, max: 5000 },
    ph: { min: 3.5, optMin: 5.5, optMax: 8.0, max: 9.0 },
    waterNeedMm: 800, relIncome: 0.65,
  },
  {
    id: "sweet_potato", name: "Sweet potato", family: "Convolvulaceae", legume: false,
    temp: { min: 10, optMin: 20, optMax: 30, max: 38 },
    rain: { min: 350, optMin: 750, optMax: 1000, max: 5000 },
    ph: { min: 4.2, optMin: 5.5, optMax: 6.5, max: 8.3 },
    waterNeedMm: 500, relIncome: 0.6,
  },

  // --- OILSEEDS & FIBERS (Deep Taproots, Striga & Pest Break Crops) ---
  {
    id: "sesame", name: "Sesame", family: "Pedaliaceae", legume: false,
    temp: { min: 10, optMin: 25, optMax: 30, max: 40 },
    rain: { min: 300, optMin: 500, optMax: 1000, max: 2000 },
    ph: { min: 4.5, optMin: 5.5, optMax: 7.5, max: 8.5 },
    waterNeedMm: 400, relIncome: 0.85,
  },
  {
    id: "cotton", name: "Cotton", family: "Malvaceae", legume: false,
    temp: { min: 15, optMin: 22, optMax: 35, max: 40 },
    rain: { min: 450, optMin: 700, optMax: 1200, max: 1800 },
    ph: { min: 4.5, optMin: 5.5, optMax: 7.5, max: 8.5 },
    waterNeedMm: 700, relIncome: 0.75,
  },
  {
    id: "roselle", name: "Roselle (Zobo)", family: "Malvaceae", legume: false,
    temp: { min: 12, optMin: 20, optMax: 30, max: 36 },
    rain: { min: 400, optMin: 800, optMax: 1600, max: 3500 },
    ph: { min: 4.5, optMin: 5.5, optMax: 7.0, max: 8.0 },
    waterNeedMm: 500, relIncome: 0.7,
  },

  // --- HORTICULTURAL / IRRIGATED ROTATION CROPS ---
  {
    id: "tomato", name: "Tomato", family: "Solanaceae", legume: false,
    temp: { min: 7, optMin: 20, optMax: 27, max: 35 },
    rain: { min: 400, optMin: 600, optMax: 1300, max: 1800 },
    ph: { min: 4.5, optMin: 5.5, optMax: 6.8, max: 8.5 },
    waterNeedMm: 600, relIncome: 0.9,
  },
  {
    id: "pepper", name: "Chili/Bell pepper", family: "Solanaceae", legume: false,
    temp: { min: 7, optMin: 21, optMax: 29, max: 35 },
    rain: { min: 300, optMin: 600, optMax: 1250, max: 3000 },
    ph: { min: 4.3, optMin: 5.5, optMax: 7.0, max: 8.7 },
    waterNeedMm: 600, relIncome: 0.85,
  },
  {
    id: "onion", name: "Onion", family: "Amaryllidaceae", legume: false,
    temp: { min: 4, optMin: 13, optMax: 24, max: 35 },
    rain: { min: 350, optMin: 500, optMax: 1000, max: 2500 },
    ph: { min: 4.5, optMin: 6.0, optMax: 7.0, max: 8.3 },
    waterNeedMm: 450, relIncome: 0.85,
  },
]
