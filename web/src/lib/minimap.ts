// The minimap of the municipality page, drawn at build time as a small inline SVG: the
// state's outline, the municipalities of the immediate region in a light tone and the
// municipality in the text colour, with a ring at its representative point when it is too
// small to see. The state's mesh (geo/state/<UF>.topo.json) gives the municipalities; the
// states' mesh (geo/states.topo.json, more simplified) gives the outline, decoded in the same
// frame so the two line up. Paths are simplified (Douglas–Peucker, half a unit of the
// 1,000-unit frame) and rounded to whole units: at the minimap's size a unit is a fraction of
// a pixel, and the worst region (36 municipalities) stays near 2.5 KB with gzip.
import { decodeTopology, linesToPath, type MapGeometry } from "../components/explore/geometry";
import { loadDataFile } from "./data";
import type { GeoTopoJson } from "../types/data/topology";

const TOLERANCE = 0.5;
/** Below this size (map units) the municipality also gets a ring, to be found at all. */
const SMALL = 14;
const PAD = 12;

function simplify(ring: Float32Array, tolerance = TOLERANCE): Float32Array {
  const n = ring.length / 2;
  if (n <= 3) return ring;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop() ?? [0, 0];
    const ax = ring[2 * a] ?? 0;
    const ay = ring[2 * a + 1] ?? 0;
    const bx = ring[2 * b] ?? 0;
    const by = ring[2 * b + 1] ?? 0;
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    let worst = -1;
    let at = -1;
    for (let k = a + 1; k < b; k++) {
      const px = (ring[2 * k] ?? 0) - ax;
      const py = (ring[2 * k + 1] ?? 0) - ay;
      // A closed ring starts and ends at the same point: the distance is then to that point.
      const d = length === 0 ? Math.hypot(px, py) : Math.abs(dy * px - dx * py) / length;
      if (d > worst) {
        worst = d;
        at = k;
      }
    }
    if (worst > tolerance && at > 0) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  const out: number[] = [];
  for (let k = 0; k < n; k++) if (keep[k]) out.push(ring[2 * k] ?? 0, ring[2 * k + 1] ?? 0);
  return Float32Array.from(out);
}

interface StateMaps {
  municipalities: MapGeometry;
  outline: Float32Array[];
}

const cache = new Map<string, Promise<StateMaps>>();

function stateMaps(uf: string, stateId: number): Promise<StateMaps> {
  let maps = cache.get(uf);
  if (!maps) {
    maps = (async () => {
      const municipalities = await decodeTopology(
        loadDataFile<GeoTopoJson>(`geo/state/${uf}.topo.json`),
        "municipalities",
        {},
      );
      const states = await decodeTopology(loadDataFile<GeoTopoJson>("geo/states.topo.json"), "states", {
        frame: municipalities.frame,
      });
      const k = states.ids.indexOf(stateId);
      return { municipalities, outline: (states.rings[k] ?? []).map((ring) => simplify(ring)) };
    })();
    cache.set(uf, maps);
  }
  return maps;
}

export interface Minimap {
  viewBox: string;
  outline: string;
  region: string;
  municipality: string;
  /** A ring at the representative point, for a municipality too small to see. */
  marker: { x: number; y: number } | null;
}

export async function minimap(uf: string, stateId: number, regionIds: number[], id: number): Promise<Minimap> {
  const { municipalities: m, outline } = await stateMaps(uf, stateId);
  const ringsOf = (code: number) => (m.rings[m.ids.indexOf(code)] ?? []).map((ring) => simplify(ring));
  const own = ringsOf(id);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of own) {
    for (let k = 0; k < ring.length; k += 2) {
      minX = Math.min(minX, ring[k] ?? 0);
      maxX = Math.max(maxX, ring[k] ?? 0);
      minY = Math.min(minY, ring[k + 1] ?? 0);
      maxY = Math.max(maxY, ring[k + 1] ?? 0);
    }
  }
  const g = m.ids.indexOf(id);
  const small = Math.max(maxX - minX, maxY - minY) < SMALL;
  return {
    viewBox: [-PAD, -PAD, Math.round(m.width) + 2 * PAD, Math.round(m.height) + 2 * PAD].join(" "),
    outline: linesToPath(outline, 0),
    region: linesToPath(regionIds.filter((code) => code !== id).flatMap(ringsOf), 0),
    municipality: linesToPath(own, 0),
    marker: small ? { x: Math.round(m.points[2 * g] ?? 0), y: Math.round(m.points[2 * g + 1] ?? 0) } : null,
  };
}
