/**
 * src/llm/examples/dsl-examples.ts
 *
 * English DSL examples extracted from GeoRender/web/dsl/examples.js.
 * Each entry: { id, input, expected }
 *   id       — zero-padded number matching the snapshot file
 *   input    — plain English geometry description (sent to LLM)
 *   expected — exact DSL JSON the LLM should produce
 *
 * Use: feed `input` to the LLM, compare parsed output to `expected`.
 */

export interface DslExample {
  id: string;
  input: string;
  expected: {
    objects: unknown[];
    constraints: unknown[];
    constructions: unknown[];
    targets: unknown[];
  };
}

export const DSL_EXAMPLES: DslExample[] = [
  // ── Group 1 — Points, segments, lines ────────────────────────────────────
  {
    id: "01",
    input: "Segment AB.",
    expected: {
      objects: [{ type: "segment", points: ["A", "B"] }],
      constraints: [],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "02",
    input: "Segment AB with midpoint M.",
    expected: {
      objects: [
        { type: "segment", points: ["A", "B"] },
        { type: "point", name: "M" },
      ],
      constraints: [{ type: "midpoint", point: "M", of: ["A", "B"] }],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "03",
    input: "Line d and point A on line d.",
    expected: {
      objects: [
        { type: "line", name: "d" },
        { type: "point", name: "A" },
      ],
      constraints: [{ type: "on_line", point: "A", line: "d" }],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "04",
    input: "Line d and point M not on line d.",
    expected: {
      objects: [
        { type: "line", name: "d" },
        { type: "point", name: "M" },
      ],
      constraints: [],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "05",
    input: "Two lines a and b intersecting at O.",
    expected: {
      objects: [
        { type: "line", name: "a" },
        { type: "line", name: "b" },
        { type: "point", name: "O" },
      ],
      constraints: [{ type: "intersection", point: "O", of: ["a", "b"] }],
      constructions: [],
      targets: [],
    },
  },

  // ── Group 2 — Basic triangles ─────────────────────────────────────────────
  {
    id: "06",
    input: "Triangle ABC.",
    expected: {
      objects: [{ type: "triangle", points: ["A", "B", "C"] }],
      constraints: [],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "07",
    input: "Triangle ABC with midpoint M of side BC.",
    expected: {
      objects: [
        { type: "triangle", points: ["A", "B", "C"] },
        { type: "point", name: "M" },
      ],
      constraints: [{ type: "midpoint", point: "M", of: ["B", "C"] }],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "08",
    input: "Triangle ABC with median AM.",
    expected: {
      objects: [
        { type: "triangle", points: ["A", "B", "C"] },
        { type: "point", name: "M" },
      ],
      constraints: [{ type: "midpoint", point: "M", of: ["A", "BC"] }],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "09",
    input: "Triangle ABC with angle bisector AK.",
    expected: {
      objects: [
        { type: "triangle", points: ["A", "B", "C"] },
        { type: "point", name: "K" },
      ],
      constraints: [
        { type: "equal_angle", angles: [["A", "B", "K"], ["K", "B", "C"]] },
      ],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "10",
    input: "Triangle ABC with altitude AH.",
    expected: {
      objects: [
        { type: "triangle", points: ["A", "B", "C"] },
        { type: "point", name: "H" },
      ],
      constraints: [
        { type: "perpendicular", line1: "AH", line2: "BC" },
        { type: "intersection", point: "H", of: ["AH", "BC"] },
      ],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "11",
    input: "Triangle ABC with median AM and altitude AH.",
    expected: {
      objects: [
        { type: "triangle", points: ["A", "B", "C"] },
        { type: "point", name: "M" },
        { type: "point", name: "H" },
        { type: "segment", points: ["A", "M"] },
        { type: "segment", points: ["A", "H"] },
      ],
      constraints: [
        { type: "midpoint", point: "M", of: ["B", "C"] },
        { type: "perpendicular", line1: "AH", line2: "BC" },
      ],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "12",
    input: "Triangle ABC with median AM, angle bisector BK, and altitude CH.",
    expected: {
      objects: [
        { type: "triangle", points: ["A", "B", "C"] },
        { type: "point", name: "M" },
        { type: "point", name: "K" },
        { type: "point", name: "H" },
        { type: "segment", points: ["A", "M"] },
        { type: "segment", points: ["B", "K"] },
        { type: "segment", points: ["C", "H"] },
      ],
      constraints: [
        { type: "midpoint", point: "M", of: ["A", "BC"] },
        { type: "equal_angle", angles: [["B", "K", "C"], ["K", "B", "A"]] },
        { type: "perpendicular", line1: "CH", line2: "AB" },
      ],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "13",
    input: "Triangle ABC. Let G be the centroid (intersection of the three medians).",
    expected: {
      objects: [
        { type: "triangle", points: ["A", "B", "C"] },
        { type: "point", name: "G" },
      ],
      constraints: [
        { type: "midpoint", point: "D", of: ["A", "B"] },
        { type: "segment", points: ["A", "D"] },
        { type: "midpoint", point: "E", of: ["B", "C"] },
        { type: "segment", points: ["B", "E"] },
        { type: "midpoint", point: "F", of: ["A", "C"] },
        { type: "segment", points: ["C", "F"] },
        { type: "intersection", point: "G", of: ["AD", "BE"] },
      ],
      constructions: [
        { type: "midpoint", point: "D", of: ["A", "B"] },
        { type: "midpoint", point: "E", of: ["B", "C"] },
        { type: "midpoint", point: "F", of: ["A", "C"] },
      ],
      targets: [],
    },
  },
  {
    id: "14",
    input: "Triangle ABC. Let I be the incenter (intersection of the three angle bisectors).",
    expected: {
      objects: [
        { type: "triangle", points: ["A", "B", "C"] },
        { type: "point", name: "I" },
      ],
      constraints: [
        { type: "equal_angle", angles: [["B", "A", "I"], ["I", "A", "C"]] },
        { type: "equal_angle", angles: [["A", "B", "I"], ["I", "B", "C"]] },
        { type: "equal_angle", angles: [["A", "C", "I"], ["I", "C", "B"]] },
        { type: "intersection", point: "I", of: ["AI", "BI", "CI"] },
      ],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "15",
    input: "Triangle ABC. Let H be the orthocenter (intersection of the three altitudes).",
    expected: {
      objects: [
        { type: "triangle", points: ["A", "B", "C"] },
        { type: "point", name: "H" },
      ],
      constraints: [
        { type: "perpendicular", line1: "AH", line2: "BC" },
        { type: "intersection", point: "H", of: ["AH", "BC"] },
        { type: "perpendicular", line1: "BH", line2: "AC" },
        { type: "intersection", point: "H", of: ["BH", "AC"] },
        { type: "perpendicular", line1: "CH", line2: "AB" },
        { type: "intersection", point: "H", of: ["CH", "AB"] },
      ],
      constructions: [],
      targets: [],
    },
  },

  // ── Group 3 — Special triangles ───────────────────────────────────────────
  {
    id: "16",
    input: "Triangle ABC. Let M be the midpoint of BC, N of CA, P of AB.",
    expected: {
      objects: [
        { type: "triangle", points: ["A", "B", "C"] },
        { type: "point", name: "M" },
        { type: "point", name: "N" },
        { type: "point", name: "P" },
      ],
      constraints: [
        { type: "midpoint", point: "M", of: ["B", "C"] },
        { type: "midpoint", point: "N", of: ["C", "A"] },
        { type: "midpoint", point: "P", of: ["A", "B"] },
      ],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "17",
    input: "Triangle ABC. Medians AM, BN, CP meet at G.",
    expected: {
      objects: [
        { type: "triangle", points: ["A", "B", "C"] },
        { type: "point", name: "G" },
        { type: "segment", points: ["A", "M"] },
        { type: "segment", points: ["B", "N"] },
        { type: "segment", points: ["C", "P"] },
      ],
      constraints: [
        { type: "midpoint", point: "M", of: ["B", "C"] },
        { type: "intersection", point: "G", of: ["AM", "BN"] },
        { type: "midpoint", point: "N", of: ["A", "C"] },
        { type: "intersection", point: "G", of: ["BN", "CP"] },
        { type: "midpoint", point: "P", of: ["A", "B"] },
      ],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "18",
    input: "Triangle ABC. Angle bisectors AD, BE, CF meet at I.",
    expected: {
      objects: [
        { type: "triangle", points: ["A", "B", "C"] },
        { type: "point", name: "I" },
        { type: "segment", points: ["A", "D"] },
        { type: "segment", points: ["B", "E"] },
        { type: "segment", points: ["C", "F"] },
      ],
      constraints: [
        { type: "equal_angle", angles: [["A", "I", "D"], ["D", "I", "B"]] },
        { type: "equal_angle", angles: [["B", "I", "E"], ["E", "I", "C"]] },
        { type: "equal_angle", angles: [["A", "I", "F"], ["F", "I", "C"]] },
        { type: "intersection", point: "I", of: ["AI", "BI", "CI"] },
      ],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "19",
    input: "Triangle ABC. Altitudes AD, BE, CF meet at H.",
    expected: {
      objects: [
        { type: "triangle", points: ["A", "B", "C"] },
        { type: "point", name: "D" },
        { type: "point", name: "E" },
        { type: "point", name: "F" },
        { type: "point", name: "H" },
      ],
      constraints: [
        { type: "perpendicular", line1: "AD", line2: "BC" },
        { type: "intersection", point: "D", of: ["AD", "BC"] },
        { type: "perpendicular", line1: "BE", line2: "AC" },
        { type: "intersection", point: "E", of: ["BE", "AC"] },
        { type: "perpendicular", line1: "CF", line2: "AB" },
        { type: "intersection", point: "F", of: ["CF", "AB"] },
        { type: "intersection", point: "H", of: ["AD", "BE"] },
      ],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "20",
    input: "Acute triangle ABC. Draw altitudes AD, BE, CF.",
    expected: {
      objects: [
        { type: "triangle", points: ["A", "B", "C"] },
        { type: "point", name: "D" },
        { type: "point", name: "E" },
        { type: "point", name: "F" },
      ],
      constraints: [
        { type: "perpendicular", line1: "AD", line2: "BC" },
        { type: "perpendicular", line1: "BE", line2: "AC" },
        { type: "perpendicular", line1: "CF", line2: "AB" },
      ],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "21",
    input: "Right triangle ABC (right angle at A). Let M be the midpoint of BC.",
    expected: {
      objects: [
        { type: "triangle", points: ["A", "B", "C"] },
        { type: "point", name: "M" },
      ],
      constraints: [
        { type: "right_triangle", vertices: ["A", "B", "C"] },
        { type: "midpoint", point: "M", of: ["B", "C"] },
      ],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "22",
    input: "Isosceles triangle ABC (vertex A). Draw altitude AH.",
    expected: {
      objects: [
        { type: "triangle", points: ["A", "B", "C"] },
        { type: "point", name: "H" },
      ],
      constraints: [
        { type: "isosceles_triangle", base: "BC", vertex: "A" },
        { type: "perpendicular", line1: "AH", line2: "BC" },
        { type: "intersection", point: "H", of: ["AH", "BC"] },
      ],
      constructions: [],
      targets: [],
    },
  },

  // ── Group 4 — Basic circles ───────────────────────────────────────────────
  {
    id: "23",
    input: "Circle with center O.",
    expected: {
      objects: [{ type: "circle", center: "O" }],
      constraints: [],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "24",
    input: "Circle with center O and radius OA.",
    expected: {
      objects: [
        { type: "circle", center: "O" },
        { type: "point", name: "A" },
      ],
      constraints: [{ type: "on_circle", point: "A", circle: "O" }],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "25",
    input: "Circle (O) and point A on circle (O).",
    expected: {
      objects: [
        { type: "circle", center: "O" },
        { type: "point", name: "A" },
      ],
      constraints: [{ type: "on_circle", point: "A", circle: "O" }],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "26",
    input: "Circle (O) and chord AB.",
    expected: {
      objects: [
        { type: "circle", center: "O" },
        { type: "segment", points: ["A", "B"] },
      ],
      constraints: [],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "27",
    input: "Circle (O) with diameter AB.",
    expected: {
      objects: [
        { type: "circle", center: "O" },
        { type: "segment", points: ["A", "B"] },
      ],
      constraints: [{ type: "diameter", circle: "O", points: ["A", "B"] }],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "28",
    input: "Circle (O) with diameter CD.",
    expected: {
      objects: [
        { type: "circle", center: "O" },
        { type: "segment", points: ["C", "D"] },
      ],
      constraints: [{ type: "diameter", circle: "O", points: ["C", "D"] }],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "29",
    input: "Circle (O) with radius OA. Draw the tangent at A.",
    expected: {
      objects: [
        { type: "circle", center: "O" },
        { type: "point", name: "A" },
      ],
      constraints: [{ type: "tangent", at: "A", line: "At", circle: "O" }],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "30",
    input: "Circle (O) with radius OB. Draw the tangent at B.",
    expected: {
      objects: [
        { type: "circle", center: "O" },
        { type: "point", name: "B" },
      ],
      constraints: [{ type: "tangent", at: "B", line: "BT", circle: "O" }],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "31",
    input: "Circle (O) with diameter AB. Draw tangent Ax at A.",
    expected: {
      objects: [
        { type: "circle", center: "O" },
        { type: "segment", points: ["A", "B"] },
      ],
      constraints: [
        { type: "diameter", circle: "O", points: ["A", "B"] },
        { type: "tangent", at: "A", line: "Ax", circle: "O" },
      ],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "32",
    input: "Circle (O) with diameter CD. Draw tangent Cx at C and tangent Dy at D.",
    expected: {
      objects: [
        { type: "circle", center: "O" },
        { type: "segment", points: ["C", "D"] },
      ],
      constraints: [
        { type: "diameter", circle: "O", points: ["C", "D"] },
        { type: "tangent", at: "C", line: "Cx", circle: "O" },
        { type: "tangent", at: "D", line: "Dy", circle: "O" },
      ],
      constructions: [],
      targets: [],
    },
  },

  // ── Group 5 — Points on circle, tangents ──────────────────────────────────
  {
    id: "33",
    input: "Circle (O) with diameter CD. Point E on circle (O), E ≠ C, D.",
    expected: {
      objects: [
        { type: "circle", center: "O" },
        { type: "segment", points: ["C", "D"] },
        { type: "point", name: "E" },
      ],
      constraints: [
        { type: "diameter", circle: "O", points: ["C", "D"] },
        { type: "on_circle", point: "E", circle: "O" },
      ],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "34",
    input: "Circle (O) with diameter AB. Point M on circle (O), M ≠ A, B.",
    expected: {
      objects: [
        { type: "circle", center: "O" },
        { type: "segment", points: ["A", "B"] },
        { type: "point", name: "M" },
      ],
      constraints: [
        { type: "diameter", circle: "O", points: ["A", "B"] },
        { type: "on_circle", point: "M", circle: "O" },
      ],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "35",
    input: "Circle (O) with diameter CD. Point E on circle (O), E ≠ C, D.",
    expected: {
      objects: [
        { type: "circle", center: "O" },
        { type: "segment", points: ["C", "D"] },
        { type: "point", name: "E" },
      ],
      constraints: [
        { type: "diameter", circle: "O", points: ["C", "D"] },
        { type: "on_circle", point: "E", circle: "O" },
      ],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "36",
    input: "Circle (O) with diameter CD. Point E on circle (O), E ≠ C, D. Draw EH ⊥ CD at H.",
    expected: {
      objects: [
        { type: "circle", center: "O" },
        { type: "segment", points: ["C", "D"] },
        { type: "point", name: "E" },
        { type: "line", name: "EH" },
        { type: "point", name: "H" },
      ],
      constraints: [
        { type: "diameter", circle: "O", points: ["C", "D"] },
        { type: "on_circle", point: "E", circle: "O" },
        { type: "perpendicular", line1: "EH", line2: "CD" },
      ],
      constructions: [{ type: "intersection", point: "H", of: ["EH", "CD"] }],
      targets: [],
    },
  },
  {
    id: "37",
    input: "Circle (O) with diameter CD. Tangent at C is line Cx. Point E on circle (O), E ≠ C, D.",
    expected: {
      objects: [
        { type: "circle", center: "O" },
        { type: "point", name: "C" },
        { type: "point", name: "D" },
        { type: "line", name: "Cx" },
        { type: "point", name: "E" },
      ],
      constraints: [
        { type: "diameter", circle: "O", points: ["C", "D"] },
        { type: "tangent", at: "C", line: "Cx", circle: "O" },
        { type: "on_circle", point: "E", circle: "O" },
      ],
      constructions: [],
      targets: [],
    },
  },
  {
    id: "38",
    input: "Circle (O) with diameter CD. Tangent at C is Cx. Point E on circle (O), E ≠ C, D. Through O draw a line perpendicular to CE.",
    expected: {
      objects: [
        { type: "circle", center: "O" },
        { type: "point", name: "C" },
        { type: "point", name: "D" },
        { type: "line", name: "Cx" },
        { type: "point", name: "E" },
        { type: "segment", points: ["C", "D"] },
        { type: "line", name: "l1" },
      ],
      constraints: [
        { type: "diameter", circle: "O", points: ["C", "D"] },
        { type: "tangent", at: "C", line: "Cx", circle: "O" },
        { type: "on_circle", point: "E", circle: "O" },
      ],
      constructions: [{ type: "perpendicular", line1: "l1", line2: "CE" }],
      targets: [],
    },
  },
  {
    id: "39",
    input: "Circle (O) with diameter CD. Tangent at C is Cx. Point E on circle (O), E ≠ C, D. Through O draw a line perpendicular to CE, meeting Cx at A.",
    expected: {
      objects: [
        { type: "circle", center: "O" },
        { type: "point", name: "C" },
        { type: "point", name: "D" },
        { type: "line", name: "Cx" },
        { type: "point", name: "E" },
        { type: "segment", points: ["C", "D"] },
        { type: "line", name: "l1" },
      ],
      constraints: [
        { type: "diameter", circle: "O", points: ["C", "D"] },
        { type: "tangent", at: "C", line: "Cx", circle: "O" },
        { type: "on_circle", point: "E", circle: "O" },
      ],
      constructions: [
        { type: "perpendicular", line1: "l1", line2: "CE" },
        { type: "intersection", point: "A", of: ["l1", "Cx"] },
      ],
      targets: [],
    },
  },
  {
    id: "40",
    input: "Circle (O) with diameter CD. Tangent Cx at C; E on circle. Through O draw l1 ⊥ CE meeting Cx at A. Tangent at D (line Ay) meets AE at B. Draw EH ⊥ CD.",
    expected: {
      objects: [
        { type: "circle", center: "O" },
        { type: "point", name: "C" },
        { type: "point", name: "D" },
        { type: "line", name: "Cx" },
        { type: "point", name: "E" },
        { type: "segment", points: ["O", "A"] },
        { type: "segment", points: ["C", "D"] },
        { type: "line", name: "Ay" },
        { type: "point", name: "B" },
        { type: "segment", points: ["A", "E"] },
        { type: "segment", points: ["A", "H"] },
        { type: "point", name: "H" },
      ],
      constraints: [
        { type: "diameter", circle: "O", points: ["C", "D"] },
        { type: "tangent", at: "C", line: "Cx", circle: "O" },
        { type: "on_circle", point: "E", circle: "O" },
      ],
      constructions: [
        { type: "perpendicular", line1: "l1", line2: "CE" },
        { type: "intersection", point: "A", of: ["l1", "Cx"] },
        { type: "tangent", at: "D", line: "Ay", circle: "O" },
        { type: "intersection", point: "B", of: ["Ay", "AE"] },
        { type: "perpendicular", line1: "EH", line2: "CD" },
      ],
      targets: [
        { type: "tangent", line: "AE", circle: "O" },
        { type: "statement", text: "AC + BD = AB" },
        { type: "right_angle", triangle: "AOB" },
      ],
    },
  },
];
