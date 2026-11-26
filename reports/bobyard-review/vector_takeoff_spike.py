"""Can pypdf alone do a vector-PDF landscape takeoff?

Draws a synthetic plan at 1" = 20'-0" with known quantities, then recovers
them from the PDF content stream using only pypdf (the library the credit
analyzer already vendors into Pyodide). No ML, no rasterising.

The plan is idealised: identity CTM, no form XObjects, no layers, no pattern
fills. It shows the mechanism works, not that it survives real CAD exports.

    pip install pypdf reportlab
    python3 reports/bobyard-review/vector_takeoff_spike.py /tmp/plan.pdf
"""
import math, re, sys
from collections import Counter, defaultdict
from reportlab.pdfgen import canvas
from pypdf import PdfReader
from pypdf.generic import ContentStream

FT_PER_PT = 20 / 72                     # 1 inch of paper = 20 feet

def build(path):
    c = canvas.Canvas(path, pagesize=(1224, 792))   # 17x11 sheet
    c.setFont("Helvetica", 9)
    c.drawString(40, 40, "LANDSCAPE PLAN   SCALE: 1\" = 20'-0\"")
    truth = {}

    # Sod: hatch lines only, no boundary -- the hard case.  45 deg, 6 pt apart,
    # clipped analytically to an L-shaped region.
    poly = [(100, 100), (500, 100), (500, 250), (300, 250), (300, 450), (100, 450)]
    spacing = 6.0
    c.setLineWidth(0.25)
    d = spacing * math.sqrt(2)          # spacing measured along the x axis
    k = min(x - y for x, y in poly) + d / 2
    while k < max(x - y for x, y in poly):
        # Hatch line y = x - k, clipped to the polygon by sampling every 0.25 pt.
        pts = [(x / 4, x / 4 - k) for x in range(0, 4 * 1224)]
        runs, run = [], []
        for p in pts:
            if point_in(p, poly):
                run.append(p)
            elif run:
                runs.append(run); run = []
        if run: runs.append(run)
        for r in runs:
            if len(r) > 1:
                c.line(r[0][0], r[0][1], r[-1][0], r[-1][1])
        k += d
    truth["sod_sqft"] = shoelace(poly) * FT_PER_PT ** 2

    # Mulch bed: a closed, filled polygon -- the easy case.
    bed = [(650, 120), (900, 140), (950, 300), (760, 380), (640, 260)]
    c.setFillGray(0.85)
    p = c.beginPath(); p.moveTo(*bed[0])
    for q in bed[1:]: p.lineTo(*q)
    p.close(); c.drawPath(p, stroke=1, fill=1)
    truth["mulch_sqft"] = shoelace(bed) * FT_PER_PT ** 2

    # Steel edging: an open polyline.
    edge = [(100, 520), (400, 520), (520, 600), (800, 600)]
    c.setLineWidth(1.5)
    p = c.beginPath(); p.moveTo(*edge[0])
    for q in edge[1:]: p.lineTo(*q)
    c.drawPath(p, stroke=1, fill=0)
    truth["edging_lf"] = sum(dist(a, b) for a, b in zip(edge, edge[1:])) * FT_PER_PT

    # Two plant symbols, stamped repeatedly.
    c.setLineWidth(0.5)
    trees = [(1000 + 40 * i, 500 + 30 * (i % 3)) for i in range(7)]
    shrubs = [(1000 + 18 * i, 200) for i in range(12)]
    for x, y in trees:
        c.circle(x, y, 12); c.line(x - 12, y, x + 12, y); c.line(x, y - 12, x, y + 12)
    for x, y in shrubs:
        c.circle(x, y, 5)
    truth["tree_count"], truth["shrub_count"] = len(trees), len(shrubs)
    c.save()
    return truth

def point_in(p, poly):
    x, y = p; inside = False
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside

def shoelace(pts):
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]))) / 2

def dist(a, b): return math.hypot(b[0] - a[0], b[1] - a[1])

# ---------------------------------------------------------------- extraction

def paths(page, reader):
    """Yield (segments, painted_with) per painted path.  Handles m/l/c/re/h
    and the paint operators; ignores CTM because reportlab emits identity."""
    cur, sub, out = [], None, []
    for operands, op in ContentStream(page.get_contents(), reader).operations:
        op = op.decode() if isinstance(op, bytes) else op
        v = [float(o) for o in operands] if op in "mlcre" else []
        if op == "m":
            sub = [(v[0], v[1])]; cur.append(sub)
        elif op == "l":
            sub.append((v[0], v[1]))
        elif op == "c":
            sub.append(("c", (v[0], v[1]), (v[2], v[3]), (v[4], v[5])))
        elif op == "re":
            x, y, w, h = v; cur.append([(x, y), (x + w, y), (x + w, y + h), (x, y + h), (x, y)])
        elif op == "h" and sub:
            sub.append(sub[0])
        elif op in ("S", "s", "f", "F", "f*", "B", "B*", "b", "b*"):
            if op in ("s", "b", "b*") and sub: sub.append(sub[0])
            out.append((cur, op)); cur, sub = [], None
        elif op == "n":
            cur, sub = [], None
    return out

def flat(sub):
    pts, last = [], None
    for s in sub:
        if s and s[0] == "c":
            # 8-point flattening of the Bezier
            (x1, y1), (x2, y2), (x3, y3) = s[1:]
            x0, y0 = last
            for i in range(1, 9):
                t = i / 8; u = 1 - t
                pts.append((u**3*x0 + 3*u*u*t*x1 + 3*u*t*t*x2 + t**3*x3,
                            u**3*y0 + 3*u*u*t*y1 + 3*u*t*t*y2 + t**3*y3))
            last = (x3, y3)
        else:
            pts.append(s); last = s
    return pts

def fingerprint(path):
    """Translation-invariant signature of a painted path, rounded to 0.5 pt."""
    allp = [p for sub in path for p in flat(sub)]
    ox, oy = min(p[0] for p in allp), min(p[1] for p in allp)
    return tuple(tuple((round((x - ox) * 2), round((y - oy) * 2)) for x, y in flat(sub)) for sub in path)

def main(pdf):
    reader = PdfReader(pdf)
    page = reader.pages[0]
    text = page.extract_text()
    m = re.search(r'SCALE:\s*1"\s*=\s*(\d+)\'', text)
    ft_per_pt = int(m.group(1)) / 72
    got = {}

    segs = []          # stroked straight 2-point lines -> hatch candidates
    symbols = defaultdict(list)
    for path, op in paths(page, reader):
        curved = any(s and s[0] == "c" for sub in path for s in sub)
        if op in ("B", "b", "f", "F", "f*", "b*", "B*") and not curved:
            got["mulch_sqft"] = sum(shoelace(flat(sub)[:-1]) for sub in path) * ft_per_pt ** 2
        elif curved:
            # A symbol is a curved path plus whatever strokes follow at the same spot;
            # keep it simple: fingerprint the curved path itself.
            symbols[fingerprint(path)].append(path)
        elif len(path) == 1 and len(path[0]) == 2:
            segs.append(path[0])
        elif len(path) == 1 and len(path[0]) > 2:
            pts = flat(path[0])
            got["edging_lf"] = sum(dist(a, b) for a, b in zip(pts, pts[1:])) * ft_per_pt

    # Hatch: group 2-point segments by angle, find the dominant spacing, then
    # area ~= sum(length) * spacing.  Each hatch line stands for a strip.
    by_angle = defaultdict(list)
    for a, b in segs:
        ang = round(math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 180)
        by_angle[ang].append((a, b))
    ang, lines = max(by_angle.items(), key=lambda kv: len(kv[1]))
    th = math.radians(ang)
    nx, ny = -math.sin(th), math.cos(th)                   # unit normal
    offs = sorted({round(a[0] * nx + a[1] * ny, 2) for a, _ in lines})
    gaps = Counter(round(b - a, 1) for a, b in zip(offs, offs[1:]))
    spacing = gaps.most_common(1)[0][0]
    got["sod_sqft"] = sum(dist(a, b) for a, b in lines) * spacing * ft_per_pt ** 2

    counts = sorted((len(v) for v in symbols.values()), reverse=True)
    got["shrub_count"], got["tree_count"] = counts[0], counts[1]
    return got, ft_per_pt, ang, spacing

if __name__ == "__main__":
    out = sys.argv[1]
    truth = build(out)
    got, ftpp, ang, spacing = main(out)
    print(f"scale read from title block: 1 pt = {ftpp:.4f} ft;  hatch at {ang} deg, {spacing} pt apart\n")
    print(f"{'quantity':<14}{'truth':>12}{'recovered':>12}{'error':>9}")
    for k in truth:
        t, g = truth[k], got.get(k)
        err = f"{(g - t) / t * 100:+.2f}%" if g is not None else "n/a"
        print(f"{k:<14}{t:>12.1f}{(g if g is not None else float('nan')):>12.1f}{err:>9}")
