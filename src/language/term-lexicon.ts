/**
 * Geometry Term Lexicon — Layer 2
 *
 * Canonical multilingual glossary for geometry terms.
 * Maps each canonical concept to its surface forms in VI / EN / SV.
 *
 * Used by:
 *   - normalize-phrases.ts  (phrase detection)
 *   - fewshot-selector.ts   (topic tagging)
 *   - prompt-builder.ts     (language-aware hints)
 */

export interface TermEntry {
  /** Canonical concept identifier. */
  canonical: string;
  vi: string[];
  en: string[];
  sv: string[];
}

export const GEOMETRY_TERM_LEXICON: TermEntry[] = [
  {
    canonical: "circle",
    vi: ["đường tròn", "vòng tròn", "hình tròn"],
    en: ["circle"],
    sv: ["cirkel"],
  },
  {
    canonical: "tangent",
    vi: ["tiếp tuyến", "tiếp điểm"],
    en: ["tangent"],
    sv: ["tangent"],
  },
  {
    canonical: "perpendicular",
    vi: ["vuông góc", "⊥", "kẻ đường vuông góc"],
    en: ["perpendicular", "⊥"],
    sv: ["vinkelrät", "rät vinkeln"],
  },
  {
    canonical: "parallel",
    vi: ["song song", "∥"],
    en: ["parallel", "∥"],
    sv: ["parallell", "∥"],
  },
  {
    canonical: "midpoint",
    vi: ["trung điểm"],
    en: ["midpoint", "mid-point"],
    sv: ["mittpunkt"],
  },
  {
    canonical: "intersection",
    vi: ["giao điểm", "cắt nhau", "cắt tại", "gặp nhau"],
    en: ["intersection", "intersect", "meet at"],
    sv: ["skärningspunkt", "skär", "möts vid"],
  },
  {
    canonical: "diameter",
    vi: ["đường kính"],
    en: ["diameter"],
    sv: ["diameter"],
  },
  {
    canonical: "radius",
    vi: ["bán kính"],
    en: ["radius"],
    sv: ["radii", "radius"],
  },
  {
    canonical: "altitude",
    vi: ["đường cao", "đường cao"],
    en: ["altitude", "height"],
    sv: ["höjd"],
  },
  {
    canonical: "median",
    vi: ["đường trung tuyến", "trung tuyến"],
    en: ["median"],
    sv: ["median"],
  },
  {
    canonical: "angle_bisector",
    vi: ["phân giác góc", "tia phân giác", "phân giác"],
    en: ["angle bisector", "bisector"],
    sv: ["vinkelbisektris"],
  },
  {
    canonical: "inscribed",
    vi: ["nội tiếp"],
    en: ["inscribed in"],
    sv: ["inskriven i"],
  },
  {
    canonical: "circumscribed",
    vi: ["ngoại tiếp"],
    en: ["circumscribed"],
    sv: ["omskriven"],
  },
  {
    canonical: "point_on_circle",
    vi: ["thuộc đường tròn", "nằm trên đường tròn", "lấy điểm", "vẽ điểm", "trên đường tròn"],
    en: ["lies on the circle", "is on the circle", "on the circle", "on circle"],
    sv: ["ligger på cirkeln", "på cirkeln"],
  },
  {
    canonical: "right_angle",
    vi: ["góc vuông", "vuông 90"],
    en: ["right angle", "90 degree"],
    sv: ["rät vinkel"],
  },
  {
    canonical: "centroid",
    vi: ["trọng tâm"],
    en: ["centroid"],
    sv: ["tyngdpunkt"],
  },
  {
    canonical: "orthocenter",
    vi: ["trực tâm"],
    en: ["orthocenter"],
    sv: ["ortocenter"],
  },
  {
    canonical: "incenter",
    vi: ["tâm nội tiếp", "tâm đường tròn nội tiếp"],
    en: ["incenter"],
    sv: ["incenter"],
  },
  {
    canonical: "circumcenter",
    vi: ["tâm ngoại tiếp", "tâm đường tròn ngoại tiếp"],
    en: ["circumcenter"],
    sv: ["omskrivningscentrum"],
  },
  {
    canonical: "foot",
    vi: ["chân đường vuông góc", "hình chiếu"],
    en: ["foot of perpendicular", "foot"],
    sv: ["fot till vinkelräten"],
  },
];

/** Build a lookup: canonical name → TermEntry */
export const LEXICON_BY_CANONICAL = new Map<string, TermEntry>(
  GEOMETRY_TERM_LEXICON.map((e) => [e.canonical, e])
);
