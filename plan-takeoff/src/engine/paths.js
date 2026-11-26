// Turn a pdf.js operator list into painted paths in page space.
//
// pdf.js hands back the page's drawing commands as two parallel arrays
// (`fnArray`, `argsArray`). This walks them once, tracks the transformation
// matrix through save/restore/transform and form XObjects, flattens curves,
// and emits one record per painted path with every point already in page
// coordinates. Nothing downstream needs to know about matrices.
//
// Two things are recorded besides geometry because the classifiers lean on
// them: which form XObject instance a path came from (a CAD block exported as
// an XObject is a symbol, and every path inside it belongs to the same
// symbol), and which optional-content group (CAD layer) it was drawn under.
//
// The `OPS` table is passed in rather than imported so this file has no
// dependency on pdf.js itself and can be unit-tested against any shape.

import { bboxOf } from './measure.js';

// pdf.js DrawOPS: the encoding of constructPath's packed Float32Array.
const MOVE = 0, LINE = 1, CURVE = 2, QUAD = 3, CLOSE = 4;

const IDENTITY = [1, 0, 0, 1, 0, 0];

/** outer ∘ m: apply m first, then outer. Matches canvas `ctx.transform`. */
function compose(m, outer) {
  const [a, b, c, d, e, f] = m;
  const [oa, ob, oc, od, oe, of] = outer;
  return [
    oa * a + oc * b, ob * a + od * b,
    oa * c + oc * d, ob * c + od * d,
    oa * e + oc * f + oe, ob * e + od * f + of,
  ];
}

function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function flattenCubic(p0, p1, p2, p3, n, out) {
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
}

function flattenQuad(p0, p1, p2, n, out) {
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
    ]);
  }
}

/** Decode constructPath's packed array into subpaths in local coordinates. */
function decode(data, curveSegments) {
  const subpaths = [];
  let cur = null;
  let hasCurves = false;
  let i = 0;
  while (i < data.length) {
    const op = data[i++];
    if (op === MOVE) {
      cur = { points: [[data[i], data[i + 1]]], closed: false };
      subpaths.push(cur);
      i += 2;
    } else if (op === LINE) {
      if (cur) cur.points.push([data[i], data[i + 1]]);
      i += 2;
    } else if (op === CURVE) {
      if (cur) {
        hasCurves = true;
        const p0 = cur.points[cur.points.length - 1];
        flattenCubic(p0, [data[i], data[i + 1]], [data[i + 2], data[i + 3]],
          [data[i + 4], data[i + 5]], curveSegments, cur.points);
      }
      i += 6;
    } else if (op === QUAD) {
      if (cur) {
        hasCurves = true;
        const p0 = cur.points[cur.points.length - 1];
        flattenQuad(p0, [data[i], data[i + 1]], [data[i + 2], data[i + 3]], curveSegments, cur.points);
      }
      i += 4;
    } else if (op === CLOSE) {
      if (cur) cur.closed = true;
    } else {
      break; // unknown encoding; keep what was decoded
    }
  }
  return { subpaths, hasCurves };
}

/**
 * @param {{fnArray: number[], argsArray: any[]}} opList  from page.getOperatorList()
 * @param {Record<string, number>} OPS                     pdf.js OPS table
 * @returns {Path[]}
 *
 * Path: { id, subpaths: [{points, closed}], stroke, fill, lineWidth, dash,
 *         strokeColor, fillColor, hasCurves, bbox, xobject, layer }
 */
export function extractPaths(opList, OPS, { curveSegments = 8 } = {}) {
  const { fnArray, argsArray } = opList;
  const paths = [];

  let ctm = IDENTITY;
  const ctmStack = [];
  let gs = { lineWidth: 1, dash: false, strokeColor: '#000000', fillColor: '#000000' };
  const gsStack = [];

  // Form XObjects nest; only the outermost instance is a symbol candidate.
  let xDepth = 0, xSerial = 0, xId = null;
  // Marked content nests too; an entry is an OCG id or null for non-layer content.
  const ocStack = [];

  const closeOps = new Set([OPS.closeStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const strokeOps = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke,
    OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const fillOps = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke,
    OPS.closeFillStroke, OPS.closeEOFillStroke]);

  const save = () => { ctmStack.push(ctm); gsStack.push(gs); gs = { ...gs }; };
  const restore = () => {
    if (ctmStack.length) { ctm = ctmStack.pop(); gs = gsStack.pop(); }
  };

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    switch (fn) {
      case OPS.save: save(); break;
      case OPS.restore: restore(); break;
      case OPS.transform: ctm = compose(args, ctm); break;

      case OPS.paintFormXObjectBegin:
        save();
        if (args && args[0]) ctm = compose(args[0], ctm);
        if (xDepth++ === 0) xId = ++xSerial;
        break;
      case OPS.paintFormXObjectEnd:
        restore();
        if (--xDepth <= 0) { xDepth = 0; xId = null; }
        break;

      case OPS.setLineWidth: gs.lineWidth = args[0]; break;
      case OPS.setDash: gs.dash = Array.isArray(args[0]) && args[0].length > 0; break;
      case OPS.setStrokeRGBColor: gs.strokeColor = args[0]; break;
      case OPS.setFillRGBColor: gs.fillColor = args[0]; break;

      case OPS.beginMarkedContent: ocStack.push(null); break;
      case OPS.beginMarkedContentProps:
        ocStack.push(args && args[0] === 'OC' && args[1] && args[1].id != null ? String(args[1].id) : null);
        break;
      case OPS.endMarkedContent: ocStack.pop(); break;

      case OPS.constructPath: {
        const paintOp = args[0];
        if (paintOp === OPS.endPath) break; // clipping path, not painted
        const packed = args[1];
        const data = packed && typeof packed[0] === 'object' ? packed[0] : packed;
        if (!data || !data.length) break;
        const { subpaths, hasCurves } = decode(data, curveSegments);
        if (!subpaths.length) break;
        if (closeOps.has(paintOp)) subpaths[subpaths.length - 1].closed = true;

        const pts = [];
        for (const sp of subpaths) {
          sp.points = sp.points.map(([x, y]) => apply(ctm, x, y));
          for (const p of sp.points) pts.push(p);
        }
        const det = Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]);
        let layer = null;
        for (let k = ocStack.length - 1; k >= 0; k--) {
          if (ocStack[k] != null) { layer = ocStack[k]; break; }
        }
        paths.push({
          id: paths.length,
          subpaths,
          stroke: strokeOps.has(paintOp),
          fill: fillOps.has(paintOp),
          lineWidth: gs.lineWidth * Math.sqrt(det),
          dash: gs.dash,
          strokeColor: gs.strokeColor,
          fillColor: gs.fillColor,
          hasCurves,
          bbox: bboxOf(pts),
          xobject: xId,
          layer,
        });
        break;
      }
      default:
        break;
    }
  }
  return paths;
}
