#!/usr/bin/env python3
"""Generate backend/data/constellations.json with IAU 88 constellations."""

import hashlib
import json
import math
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "constellations.json"

# Real-ish star patterns (ra deg, dec deg, mag) for well-known constellations
REAL = {
    "orion": [
        {"name": "Betelgeuse", "ra": 88.79, "dec": 7.41, "mag": 0.5},   # 0
        {"name": "Bellatrix",  "ra": 81.28, "dec": 6.35, "mag": 1.6},   # 1
        {"name": "Alnitak",    "ra": 85.19, "dec": -1.94, "mag": 1.7},  # 2
        {"name": "Alnilam",    "ra": 84.05, "dec": -1.20, "mag": 1.7},  # 3
        {"name": "Mintaka",    "ra": 82.56, "dec": -0.30, "mag": 2.0},  # 4
        {"name": "Rigel",      "ra": 78.63, "dec": -8.20, "mag": 0.1},  # 5
        {"name": "Saiph",      "ra": 86.94, "dec": -9.67, "mag": 2.1},  # 6
    ],
    "ursa_major": [
        {"name": "Dubhe",  "ra": 165.93, "dec": 61.75, "mag": 1.8},  # 0
        {"name": "Merak",  "ra": 165.46, "dec": 56.38, "mag": 2.4},  # 1
        {"name": "Phecda", "ra": 178.46, "dec": 53.69, "mag": 2.4},  # 2
        {"name": "Megrez", "ra": 183.86, "dec": 57.03, "mag": 3.3},  # 3
        {"name": "Alioth", "ra": 193.51, "dec": 55.96, "mag": 1.8},  # 4
        {"name": "Mizar",  "ra": 200.98, "dec": 54.93, "mag": 2.2},  # 5
        {"name": "Alkaid", "ra": 206.89, "dec": 49.31, "mag": 1.9},  # 6
    ],
    "cassiopeia": [
        {"name": "Schedar",   "ra": 10.13, "dec": 56.54, "mag": 2.2},  # 0
        {"name": "Caph",      "ra": 2.29,  "dec": 59.15, "mag": 2.3},  # 1
        {"name": "Gamma Cas", "ra": 14.18, "dec": 60.72, "mag": 2.5},  # 2
        {"name": "Ruchbah",   "ra": 21.45, "dec": 60.24, "mag": 2.7},  # 3
        {"name": "Segin",     "ra": 28.60, "dec": 63.67, "mag": 3.4},  # 4
    ],
    "cygnus": [
        {"name": "Deneb",     "ra": 310.36, "dec": 45.28, "mag": 1.3},  # 0
        {"name": "Albireo",   "ra": 292.68, "dec": 27.96, "mag": 3.0},  # 1
        {"name": "Sadr",      "ra": 305.56, "dec": 40.26, "mag": 2.2},  # 2
        {"name": "Gienah",    "ra": 303.40, "dec": 33.97, "mag": 2.5},  # 3
        {"name": "Delta Cyg", "ra": 296.24, "dec": 45.13, "mag": 2.9},  # 4
    ],
    "scorpius": [
        {"name": "Antares",  "ra": 247.35, "dec": -26.43, "mag": 1.0},  # 0
        {"name": "Shaula",   "ra": 263.40, "dec": -37.10, "mag": 1.6},  # 1
        {"name": "Sargas",   "ra": 264.33, "dec": -43.00, "mag": 1.9},  # 2
        {"name": "Dschubba", "ra": 240.08, "dec": -22.62, "mag": 2.3},  # 3
        {"name": "Acrab",    "ra": 241.36, "dec": -19.81, "mag": 2.6},  # 4
    ],
    "leo": [
        {"name": "Regulus",     "ra": 152.09, "dec": 11.97, "mag": 1.4},  # 0
        {"name": "Algieba",     "ra": 154.99, "dec": 19.84, "mag": 2.0},  # 1
        {"name": "Denebola",    "ra": 177.26, "dec": 14.57, "mag": 2.1},  # 2
        {"name": "Zosma",       "ra": 168.56, "dec": 20.52, "mag": 2.6},  # 3
        {"name": "Chertan",     "ra": 146.46, "dec": 15.43, "mag": 3.3},  # 4
    ],
    "taurus": [
        {"name": "Aldebaran", "ra": 68.98, "dec": 16.51, "mag": 0.9},  # 0
        {"name": "Elnath",    "ra": 81.57, "dec": 28.61, "mag": 1.7},  # 1
        {"name": "Alcyone",   "ra": 56.87, "dec": 24.11, "mag": 2.9},  # 2
        {"name": "Atlas",     "ra": 56.17, "dec": 24.05, "mag": 3.6},  # 3
    ],
    "gemini": [
        {"name": "Pollux",   "ra": 116.33, "dec": 28.03, "mag": 1.2},  # 0
        {"name": "Castor",   "ra": 113.65, "dec": 31.89, "mag": 1.6},  # 1
        {"name": "Alhena",   "ra": 99.43,  "dec": 16.40, "mag": 1.9},  # 2
        {"name": "Mebsuta",  "ra": 100.98, "dec": 25.13, "mag": 3.0},  # 3
    ],
    "lyra": [
        {"name": "Vega",    "ra": 279.23, "dec": 38.78, "mag": 0.0},  # 0
        {"name": "Sheliak", "ra": 282.52, "dec": 33.36, "mag": 3.5},  # 1
        {"name": "Sulafat", "ra": 284.74, "dec": 32.69, "mag": 3.3},  # 2
    ],
    "aquila": [
        {"name": "Altair",  "ra": 297.70, "dec": 8.87,  "mag": 0.8},  # 0
        {"name": "Tarazed", "ra": 296.56, "dec": 10.61, "mag": 2.7},  # 1
        {"name": "Alshain", "ra": 298.83, "dec": 6.41,  "mag": 3.7},  # 2
    ],
    "crux": [
        {"name": "Acrux",    "ra": 186.65, "dec": -63.10, "mag": 0.8},  # 0
        {"name": "Mimosa",   "ra": 191.93, "dec": -59.69, "mag": 1.3},  # 1
        {"name": "Gacrux",   "ra": 187.79, "dec": -57.11, "mag": 1.6},  # 2
        {"name": "Delta Cru","ra": 183.79, "dec": -58.75, "mag": 2.8},  # 3
    ],
    "pegasus": [
        {"name": "Markab",  "ra": 346.19, "dec": 15.21, "mag": 2.5},  # 0
        {"name": "Scheat",  "ra": 345.94, "dec": 28.08, "mag": 2.4},  # 1
        {"name": "Algenib", "ra": 3.31,   "dec": 15.18, "mag": 2.8},  # 2
        {"name": "Enif",    "ra": 326.05, "dec": 9.88,  "mag": 2.4},  # 3
    ],
    "bootes": [
        {"name": "Arcturus", "ra": 213.92, "dec": 19.18, "mag": -0.1},  # 0
        {"name": "Izar",     "ra": 221.25, "dec": 27.07, "mag": 2.4},   # 1
        {"name": "Muphrid",  "ra": 219.48, "dec": 18.40, "mag": 2.7},   # 2
    ],
    "canis_major": [
        {"name": "Sirius",  "ra": 101.29, "dec": -16.72, "mag": -1.5},  # 0
        {"name": "Adhara",  "ra": 104.66, "dec": -28.97, "mag": 1.5},   # 1
        {"name": "Wezen",   "ra": 111.02, "dec": -26.39, "mag": 1.8},   # 2
        {"name": "Mirzam",  "ra": 95.67,  "dec": -17.96, "mag": 2.0},   # 3
    ],
    "virgo": [
        {"name": "Spica",       "ra": 201.30, "dec": -11.16, "mag": 1.0},  # 0
        {"name": "Porrima",     "ra": 190.42, "dec": -1.45,  "mag": 2.7},  # 1
        {"name": "Vindemiatrix","ra": 195.82, "dec": 10.96,  "mag": 3.4},  # 2
    ],
    "sagittarius": [
        {"name": "Kaus Australis", "ra": 276.04, "dec": -34.38, "mag": 1.8},  # 0
        {"name": "Nunki",          "ra": 283.82, "dec": -26.30, "mag": 2.0},  # 1
        {"name": "Ascella",        "ra": 290.66, "dec": -29.88, "mag": 2.6},  # 2
        {"name": "Kaus Media",     "ra": 274.41, "dec": -29.83, "mag": 2.7},  # 3
    ],
    "perseus": [
        {"name": "Mirfak", "ra": 51.08, "dec": 49.86, "mag": 1.8},  # 0
        {"name": "Algol",  "ra": 47.04, "dec": 40.96, "mag": 2.1},  # 1
        {"name": "Atik",   "ra": 43.56, "dec": 49.24, "mag": 3.8},  # 2
    ],
    "andromeda": [
        {"name": "Alpheratz", "ra": 2.10,  "dec": 29.09, "mag": 2.1},  # 0
        {"name": "Mirach",    "ra": 17.43, "dec": 35.62, "mag": 2.1},  # 1
        {"name": "Almach",    "ra": 30.97, "dec": 42.33, "mag": 2.1},  # 2
    ],
}

# Asterism lines: list of [star_i, star_j] index pairs forming the canonical figure.
ASTERISM_LINES = {
    # Orion: shoulders, belt, legs
    "orion": [[0, 1], [0, 3], [1, 4], [2, 3], [3, 4], [2, 5], [4, 6]],
    # Big Dipper: bowl + handle
    "ursa_major": [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]],
    # Cassiopeia W
    "cassiopeia": [[1, 0], [0, 2], [2, 3], [3, 4]],
    # Cygnus northern cross
    "cygnus": [[0, 2], [2, 1], [4, 2], [2, 3]],
    # Scorpius S-curve
    "scorpius": [[4, 3], [3, 0], [0, 2], [2, 1]],
    # Leo sickle + body
    "leo": [[4, 0], [0, 1], [1, 3], [3, 2], [2, 1]],
    # Taurus V + Pleiades
    "taurus": [[1, 0], [0, 2], [2, 3]],
    # Gemini twins
    "gemini": [[0, 1], [0, 2], [1, 3], [2, 3]],
    # Lyra triangle
    "lyra": [[0, 1], [1, 2], [2, 0]],
    # Aquila eagle
    "aquila": [[1, 0], [0, 2]],
    # Crux cross
    "crux": [[0, 2], [1, 3]],
    # Pegasus square + nose
    "pegasus": [[0, 1], [1, 2], [2, 0], [0, 3]],
    # Bootes kite
    "bootes": [[2, 0], [0, 1], [1, 2]],
    # Canis Major
    "canis_major": [[3, 0], [0, 2], [2, 1], [0, 1]],
    # Virgo chain
    "virgo": [[2, 1], [1, 0]],
    # Sagittarius teapot
    "sagittarius": [[3, 0], [0, 2], [2, 1], [3, 1]],
    # Perseus chain
    "perseus": [[2, 0], [0, 1]],
    # Andromeda chain
    "andromeda": [[0, 1], [1, 2]],
}

# Narrative and observing hints for well-known constellations (Spanish UI).
ENRICHMENT = {
    "leo": {
        "summary_es": (
            "Leo domina el cielo de primavera en el hemisferio norte. "
            "Su estrella más brillante, Regulus, marca el «corazón del león»."
        ),
        "season": "Primavera (hemisferio norte)",
        "hemisphere": "norte",
    },
    "orion": {
        "summary_es": (
            "Orión es uno de los cielos más reconocibles del invierno boreal. "
            "El cinturón de tres estrellas apunta hacia Sirio y la Osa Mayor."
        ),
        "season": "Invierno (hemisferio norte)",
        "hemisphere": "norte",
    },
    "ursa_major": {
        "summary_es": (
            "La Osa Mayor circumpolar en latitudes medias del norte. "
            "Sus siete estrellas forman el Carro o el Cazo, útil para encontrar el Polo."
        ),
        "season": "Todo el año (circumpolar norte)",
        "hemisphere": "norte",
    },
    "scorpius": {
        "summary_es": (
            "Escorpio brilla en verano boreal con Antares, una supergigante roja. "
            "Su cola curva es fácil de distinguir cerca del horizonte sur."
        ),
        "season": "Verano (hemisferio norte)",
        "hemisphere": "ambos",
    },
    "cygnus": {
        "summary_es": (
            "El Cisne cruza la Vía Láctea de verano; Deneb es una de las estrellas "
            "del Triángulo de Verano junto a Vega y Altair."
        ),
        "season": "Verano (hemisferio norte)",
        "hemisphere": "norte",
    },
    "cassiopeia": {
        "summary_es": (
            "Casiopea forma una W distintiva en el cielo norte. "
            "Es circumpolar en muchas latitudes y complementa a la Osa Mayor."
        ),
        "season": "Otoño e invierno (hemisferio norte)",
        "hemisphere": "norte",
    },
    "taurus": {
        "summary_es": (
            "Tauro alberga Aldebarán y el cúmulo de las Pléyades. "
            "Visible en invierno boreal, precede a Orión en el horizonte."
        ),
        "season": "Invierno (hemisferio norte)",
        "hemisphere": "norte",
    },
    "crux": {
        "summary_es": (
            "La Cruz del Sur es un referente del cielo austral. "
            "Sus cuatro estrellas principales orientan hacia el polo sur celeste."
        ),
        "season": "Todo el año (hemisferio sur)",
        "hemisphere": "sur",
    },
}

ENTRIES = [
    ("andromeda", "Andromeda", "Andrómeda"),
    ("antlia", "Antlia", "Antlia"),
    ("apus", "Apus", "Apus"),
    ("aquarius", "Aquarius", "Acuario"),
    ("aquila", "Aquila", "Águila"),
    ("ara", "Ara", "Ara"),
    ("aries", "Aries", "Aries"),
    ("auriga", "Auriga", "Auriga"),
    ("bootes", "Bootes", "Boyero"),
    ("caelum", "Caelum", "Caelum"),
    ("camelopardalis", "Camelopardalis", "Camelopardalis"),
    ("cancer", "Cancer", "Cáncer"),
    ("canes_venatici", "Canes Venatici", "Canes Venatici"),
    ("canis_major", "Canis Major", "Can Mayor"),
    ("canis_minor", "Canis Minor", "Can Menor"),
    ("capricornus", "Capricornus", "Capricornio"),
    ("carina", "Carina", "Carina"),
    ("cassiopeia", "Cassiopeia", "Casiopea"),
    ("centaurus", "Centaurus", "Centaurus"),
    ("cepheus", "Cepheus", "Cefeo"),
    ("cetus", "Cetus", "Cetos"),
    ("chamaeleon", "Chamaeleon", "Camaleón"),
    ("circinus", "Circinus", "Circinus"),
    ("columba", "Columba", "Columba"),
    ("coma_berenices", "Coma Berenices", "Coma Berenices"),
    ("corona_australis", "Corona Australis", "Corona Austral"),
    ("corona_borealis", "Corona Borealis", "Corona Boreal"),
    ("corvus", "Corvus", "Cuervo"),
    ("crater", "Crater", "Crater"),
    ("crux", "Crux", "Cruz del Sur"),
    ("cygnus", "Cygnus", "Cisne"),
    ("delphinus", "Delphinus", "Delfín"),
    ("dorado", "Dorado", "Dorado"),
    ("draco", "Draco", "Dragón"),
    ("equuleus", "Equuleus", "Equuleus"),
    ("eridanus", "Eridanus", "Eridano"),
    ("fornax", "Fornax", "Fornax"),
    ("gemini", "Gemini", "Géminis"),
    ("grus", "Grus", "Grus"),
    ("hercules", "Hercules", "Hércules"),
    ("horologium", "Horologium", "Horologium"),
    ("hydra", "Hydra", "Hydra"),
    ("hydrus", "Hydrus", "Hydrus"),
    ("indus", "Indus", "Indus"),
    ("lacerta", "Lacerta", "Lacerta"),
    ("leo", "Leo", "Leo"),
    ("leo_minor", "Leo Minor", "Leo Menor"),
    ("lepus", "Lepus", "Liebre"),
    ("libra", "Libra", "Libra"),
    ("lupus", "Lupus", "Lupus"),
    ("lynx", "Lynx", "Lince"),
    ("lyra", "Lyra", "Lira"),
    ("mensa", "Mensa", "Mensa"),
    ("microscopium", "Microscopium", "Microscopium"),
    ("monoceros", "Monoceros", "Unicornio"),
    ("musca", "Musca", "Mosca"),
    ("norma", "Norma", "Norma"),
    ("octans", "Octans", "Octans"),
    ("ophiuchus", "Ophiuchus", "Ofiuco"),
    ("orion", "Orion", "Orión"),
    ("pavo", "Pavo", "Pavo"),
    ("pegasus", "Pegasus", "Pegaso"),
    ("perseus", "Perseus", "Perseo"),
    ("phoenix", "Phoenix", "Fénix"),
    ("pictor", "Pictor", "Pictor"),
    ("pisces", "Pisces", "Piscis"),
    ("piscis_austrinus", "Piscis Austrinus", "Piscis Austrino"),
    ("puppis", "Puppis", "Puppis"),
    ("pyxis", "Pyxis", "Pyxis"),
    ("reticulum", "Reticulum", "Reticulum"),
    ("sagitta", "Sagitta", "Sagitta"),
    ("sagittarius", "Sagittarius", "Sagitario"),
    ("scorpius", "Scorpius", "Escorpio"),
    ("sculptor", "Sculptor", "Sculptor"),
    ("scutum", "Scutum", "Scutum"),
    ("serpens", "Serpens", "Serpens"),
    ("sextans", "Sextans", "Sextans"),
    ("taurus", "Taurus", "Tauro"),
    ("telescopium", "Telescopium", "Telescopium"),
    ("triangulum", "Triangulum", "Triángulo"),
    ("triangulum_australe", "Triangulum Australe", "Triángulo Austral"),
    ("tucana", "Tucana", "Tucana"),
    ("ursa_major", "Ursa Major", "Osa Mayor"),
    ("ursa_minor", "Ursa Minor", "Osa Menor"),
    ("vela", "Vela", "Vela"),
    ("virgo", "Virgo", "Virgo"),
    ("volans", "Volans", "Volans"),
    ("vulpecula", "Vulpecula", "Vulpecula"),
]


def _stable_hash(s: str) -> int:
    """Deterministic hash independent of PYTHONHASHSEED."""
    return int(hashlib.md5(s.encode()).hexdigest(), 16)


def synthetic_stars(cid: str, count: int = 7) -> list:
    stars = []
    base = _stable_hash(cid) % 360
    for i in range(count):
        angle = math.radians(base + i * (360.0 / count))
        ra = 100.0 + 50.0 * math.cos(angle) + i * 3.0
        dec = 30.0 * math.sin(angle) + (i - count / 2) * 4.0
        stars.append({
            "name": f"{cid}_{i}",
            "ra": ra,
            "dec": dec,
            "mag": 1.5 + (i % 4) * 0.8,
        })
    return stars


def synthetic_lines(n: int) -> list:
    """Generate a connected star-polygon figure for n points in a ring."""
    ring = [[i, (i + 1) % n] for i in range(n)]
    # Add skip-2 diagonals for a more recognizable star-like figure
    if n >= 5:
        diag = [[i, (i + 2) % n] for i in range(0, n, 2)]
        return ring + diag
    return ring


def _center_from_stars(stars: list) -> tuple[float, float]:
    if not stars:
        return 0.0, 0.0
    ras = [float(s["ra"]) for s in stars]
    decs = [float(s["dec"]) for s in stars]
    return sum(ras) / len(ras), sum(decs) / len(decs)


def build_constellations() -> list:
    constellations = []
    for cid, name, name_es in ENTRIES:
        stars = REAL.get(cid) or synthetic_stars(cid)
        lines = ASTERISM_LINES.get(cid) or synthetic_lines(len(stars))
        center_ra, center_dec = _center_from_stars(stars)
        aliases = [name.lower().replace(" ", "_"), name_es.lower().replace(" ", "_")]
        if cid == "ursa_major":
            aliases.extend(["osa_mayor", "great_bear", "big_dipper"])
        if cid == "orion":
            aliases.extend(["orion", "ori"])
        entry = {
            "id": cid,
            "name": name,
            "name_es": name_es,
            "aliases": aliases,
            "stars": stars,
            "lines": lines,
            "center_ra": round(center_ra, 4),
            "center_dec": round(center_dec, 4),
        }
        extra = ENRICHMENT.get(cid)
        if extra:
            entry.update(extra)
        constellations.append(entry)
    return constellations


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    constellations = build_constellations()
    OUT.write_text(
        json.dumps({"constellations": constellations}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"Wrote {len(constellations)} constellations to {OUT}")


if __name__ == "__main__":
    main()
