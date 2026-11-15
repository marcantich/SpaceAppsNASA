// Loads the target sites (Moon / Mars) and the known Earth analogs from app/data/.
const BASE = `${import.meta.env.BASE_URL}data/`;

async function getJson(name) {
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`Could not load data/${name} (HTTP ${res.status})`);
  return res.json();
}

/** Target sites (their real cards, written next to each body's grid) and known Earth analogs. */
export async function loadSites() {
  const [moon, mars, analogos] = await Promise.all([
    getJson('luna/objetivos.json'),
    getJson('marte/objetivos.json'),
    getJson('analogos_conocidos.json'),
  ]);
  return {
    targets: [...moon.objetivos, ...mars.objetivos], // [{ id, name, body, lat, lon, type, h3, features, extras }]
    analogs: analogos.analogos, // [{ name, country, lat, lon, analog_of, environment, notes }]
  };
}
