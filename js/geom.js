'use strict';
/* Geometrie tahů. Body jsou uložené úsporně: Int16 trojice [x*16, y*16, přítlak*1000] v bodech (1 pt = 1/72 palce). */
const PQ = 16;
const _geo = new WeakMap();

function encPts(a) {
  const o = new Int16Array(a.length);
  for (let i = 0; i < a.length; i += 3) {
    o[i] = clamp(Math.round(a[i] * PQ), -32760, 32760);
    o[i + 1] = clamp(Math.round(a[i + 1] * PQ), -32760, 32760);
    o[i + 2] = clamp(Math.round(a[i + 2] * 1000), 0, 1000);
  }
  return o;
}
function decPts(it) {
  const p = it.pts, n = p.length / 3, X = new Array(n), Y = new Array(n), P = new Array(n);
  for (let i = 0; i < n; i++) { X[i] = p[i * 3] / PQ; Y[i] = p[i * 3 + 1] / PQ; P[i] = p[i * 3 + 2] / 1000; }
  return { X, Y, P, n };
}

/* Ramer–Douglas–Peucker: vyhodí zbytečné body na rovných úsecích (šetří místo, tvar zůstává) */
function simplify(a, tol) {
  const n = a.length / 3;
  if (n < 3) return a;
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const st = [[0, n - 1]], t2 = tol * tol;
  while (st.length) {
    const [s, e] = st.pop();
    const ax = a[s * 3], ay = a[s * 3 + 1], bx = a[e * 3], by = a[e * 3 + 1];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let md = -1, mi = -1;
    for (let i = s + 1; i < e; i++) {
      const px = a[i * 3] - ax, py = a[i * 3 + 1] - ay;
      let d;
      if (l2 < 1e-9) d = px * px + py * py;
      else { const t = clamp((px * dx + py * dy) / l2, 0, 1), qx = px - t * dx, qy = py - t * dy; d = qx * qx + qy * qy; }
      if (d > md) { md = d; mi = i; }
    }
    if (md > t2) { keep[mi] = 1; st.push([s, mi], [mi, e]); }
  }
  const o = [];
  for (let i = 0; i < n; i++) if (keep[i]) o.push(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
  return o;
}

/* před vyhlazením přidá body poblíž vrcholů, aby se ostré rohy nezakulacovaly víc, než je potřeba */
function densify(X, Y, P, d) {
  const n = X.length, x = [X[0]], y = [Y[0]], p = [P[0]];
  for (let i = 1; i < n; i++) {
    const dx = X[i] - X[i - 1], dy = Y[i] - Y[i - 1], l = Math.hypot(dx, dy);
    if (l > 2.2 * d) {
      const t = d / l;
      x.push(X[i - 1] + dx * t, X[i] - dx * t); y.push(Y[i - 1] + dy * t, Y[i] - dy * t);
      p.push(P[i - 1] + (P[i] - P[i - 1]) * t, P[i] - (P[i] - P[i - 1]) * t);
    }
    x.push(X[i]); y.push(Y[i]); p.push(P[i]);
  }
  return { X: x, Y: y, P: p };
}

function circleCmds(c, cx, cy, r) {
  const k = 0.5523 * r;
  c.push(0, r2(cx + r), r2(cy),
    3, r2(cx + r), r2(cy + k), r2(cx + k), r2(cy + r), r2(cx), r2(cy + r),
    3, r2(cx - k), r2(cy + r), r2(cx - r), r2(cy + k), r2(cx - r), r2(cy),
    3, r2(cx - r), r2(cy - k), r2(cx - k), r2(cy - r), r2(cx), r2(cy - r),
    3, r2(cx + k), r2(cy - r), r2(cx + r), r2(cy - k), r2(cx + r), r2(cy), 4);
}
function centerCmds(X, Y) {
  const n = X.length, c = [0, r2(X[0]), r2(Y[0])];
  if (n === 1) { c.push(1, r2(X[0] + 0.02), r2(Y[0])); return c; }
  for (let i = 1; i < n - 1; i++) c.push(2, r2(X[i]), r2(Y[i]), r2((X[i] + X[i + 1]) / 2), r2((Y[i] + Y[i + 1]) / 2));
  c.push(1, r2(X[n - 1]), r2(Y[n - 1]));
  return c;
}
/* obrys jednoho hladkého úseku tahu s proměnnou tloušťkou (zakulacené konce) */
function subOutline(c, X, Y, R, a, b) {
  if (b <= a) { circleCmds(c, X[a], Y[a], Math.max(R[a], 0.05)); return; }
  const lx = [], ly = [], rx = [], ry = [];
  let dx0 = 1, dy0 = 0, fdx = 1, fdy = 0;
  const pushF = (ax, ay, x, y, dx, dy) => {
    const m = ax.length;
    if (m && (x - ax[m - 1]) * dx + (y - ay[m - 1]) * dy < 0) return;
    ax.push(x); ay.push(y);
  };
  for (let i = a; i <= b; i++) {
    let dx, dy;
    if (i === a) { dx = X[i + 1] - X[i]; dy = Y[i + 1] - Y[i]; }
    else if (i === b) { dx = X[i] - X[i - 1]; dy = Y[i] - Y[i - 1]; }
    else {
      const ax = X[i] - X[i - 1], ay = Y[i] - Y[i - 1], la = Math.hypot(ax, ay) || 1;
      const bx = X[i + 1] - X[i], by = Y[i + 1] - Y[i], lb = Math.hypot(bx, by) || 1;
      dx = ax / la + bx / lb; dy = ay / la + by / lb;
    }
    const l = Math.hypot(dx, dy);
    if (l < 1e-6) { dx = dx0; dy = dy0; } else { dx /= l; dy /= l; }
    dx0 = dx; dy0 = dy;
    if (i === a) { fdx = dx; fdy = dy; }
    const r = R[i];
    pushF(lx, ly, X[i] - dy * r, Y[i] + dx * r, dx, dy);
    pushF(rx, ry, X[i] + dy * r, Y[i] - dx * r, dx, dy);
  }
  const ring = [];
  for (let i = 0; i < lx.length; i++) ring.push(lx[i], ly[i]);
  const K = 6;
  for (let k = 1; k < K; k++) { // konec tahu
    const t = Math.PI * k / K, co = Math.cos(t), si = Math.sin(t), r = R[b];
    ring.push(X[b] + r * (-dy0 * co + dx0 * si), Y[b] + r * (dx0 * co + dy0 * si));
  }
  for (let i = rx.length - 1; i >= 0; i--) ring.push(rx[i], ry[i]);
  for (let k = 1; k < K; k++) { // začátek tahu
    const t = Math.PI * k / K, co = Math.cos(t), si = Math.sin(t), r = R[a];
    ring.push(X[a] + r * (fdy * co - fdx * si), Y[a] + r * (-fdx * co - fdy * si));
  }
  const m = ring.length / 2;
  c.push(0, r2((ring[m * 2 - 2] + ring[0]) / 2), r2((ring[m * 2 - 1] + ring[1]) / 2));
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    c.push(2, r2(ring[i * 2]), r2(ring[i * 2 + 1]), r2((ring[i * 2] + ring[j * 2]) / 2), r2((ring[i * 2 + 1] + ring[j * 2 + 1]) / 2));
  }
  c.push(4);
}
/* rovné úseky (rozpoznané tvary) – bez vyhlazování, rohy zůstanou ostré */
function polyCmds(X, Y) {
  const n = X.length, c = [0, r2(X[0]), r2(Y[0])];
  if (n === 1) { c.push(1, r2(X[0] + 0.02), r2(Y[0])); return c; }
  const closed = n > 3 && Math.abs(X[0] - X[n - 1]) < 0.07 && Math.abs(Y[0] - Y[n - 1]) < 0.07;
  for (let i = 1; i < (closed ? n - 1 : n); i++) c.push(1, r2(X[i]), r2(Y[i]));
  if (closed) c.push(4);
  return c;
}
/* hladká uzavřená křivka (kruh, elipsa); poslední bod opakuje první */
function closedCmds(X, Y) {
  const n = X.length - 1, c = [0, r2((X[0] + X[1]) / 2), r2((Y[0] + Y[1]) / 2)];
  for (let i = 1; i <= n; i++) { const a = i % n, b = (i + 1) % n; c.push(2, r2(X[a]), r2(Y[a]), r2((X[a] + X[b]) / 2), r2((Y[a] + Y[b]) / 2)); }
  c.push(4);
  return c;
}
function outlineCmds(X, Y, P, w) {
  const n = X.length, R = new Array(n), c = [];
  for (let i = 0; i < n; i++) R[i] = (w / 2) * (0.55 + 0.9 * Math.sqrt(P[i]));
  if (n === 1) { circleCmds(c, X[0], Y[0], Math.max(R[0], w / 2)); return c; }
  let a = 0;
  for (let i = 1; i < n - 1; i++) {
    const ax = X[i] - X[i - 1], ay = Y[i] - Y[i - 1], bx = X[i + 1] - X[i], by = Y[i + 1] - Y[i];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la < 1e-6 || lb < 1e-6) continue;
    if ((ax * bx + ay * by) / (la * lb) < 0.3) { subOutline(c, X, Y, R, a, i); a = i; }
  }
  subOutline(c, X, Y, R, a, n - 1);
  return c;
}

function strokeGeom(it) {
  let g = _geo.get(it);
  if (g) return g;
  const d0 = decPts(it);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < d0.n; i++) { x0 = Math.min(x0, d0.X[i]); y0 = Math.min(y0, d0.Y[i]); x1 = Math.max(x1, d0.X[i]); y1 = Math.max(y1, d0.Y[i]); }
  const fill = it.k === 'p' && it.pr && !it.d && !it.sp;
  let cmds;
  if (it.sp && Shapes.STRAIGHT[it.sp]) cmds = polyCmds(d0.X, d0.Y);
  else if (it.sp === 'ell' && d0.n > 8) cmds = closedCmds(d0.X, d0.Y);
  else {
    const d = densify(d0.X, d0.Y, d0.P, Math.max(0.8, it.w * 0.75));
    cmds = fill ? outlineCmds(d.X, d.Y, d.P, it.w) : centerCmds(d.X, d.Y);
  }
  const m = it.w * (fill ? 0.8 : 0.5) + 0.5;
  g = { cmds, fill, bbox: [x0 - m, y0 - m, x1 + m, y1 + m], path: null };
  _geo.set(it, g);
  return g;
}
function strokePath(it) {
  const g = strokeGeom(it);
  if (!g.path) {
    const p = new Path2D(), c = g.cmds;
    for (let i = 0; i < c.length;) {
      switch (c[i]) {
        case 0: p.moveTo(c[i + 1], c[i + 2]); i += 3; break;
        case 1: p.lineTo(c[i + 1], c[i + 2]); i += 3; break;
        case 2: p.quadraticCurveTo(c[i + 1], c[i + 2], c[i + 3], c[i + 4]); i += 5; break;
        case 3: p.bezierCurveTo(c[i + 1], c[i + 2], c[i + 3], c[i + 4], c[i + 5], c[i + 6]); i += 7; break;
        default: p.closePath(); i += 1;
      }
    }
    g.path = p;
  }
  return g.path;
}
/* stejná křivka jako operátory PDF (vektor) */
function cmdsToPdf(c) {
  let s = '', x = 0, y = 0;
  for (let i = 0; i < c.length;) {
    switch (c[i]) {
      case 0: x = c[i + 1]; y = c[i + 2]; s += `${x} ${y} m\n`; i += 3; break;
      case 1: x = c[i + 1]; y = c[i + 2]; s += `${x} ${y} l\n`; i += 3; break;
      case 2: {
        const qx = c[i + 1], qy = c[i + 2], ex = c[i + 3], ey = c[i + 4];
        s += `${r2(x + (qx - x) * 2 / 3)} ${r2(y + (qy - y) * 2 / 3)} ${r2(ex + (qx - ex) * 2 / 3)} ${r2(ey + (qy - ey) * 2 / 3)} ${ex} ${ey} c\n`;
        x = ex; y = ey; i += 5; break;
      }
      case 3: s += `${c[i + 1]} ${c[i + 2]} ${c[i + 3]} ${c[i + 4]} ${c[i + 5]} ${c[i + 6]} c\n`; x = c[i + 5]; y = c[i + 6]; i += 7; break;
      default: s += 'h\n'; i += 1;
    }
  }
  return s;
}
function dashFor(it) {
  if (!it.d) return [];
  const w = Math.max(it.w, 0.8), h = it.k === 'h';
  const a = (h ? 1.5 : 4) * w, g = (h ? 1.8 : 3) * w, dg = (h ? 1.7 : 2.4) * w;
  return it.d === 1 ? [r2(a), r2(g)] : it.d === 2 ? [0.01, r2(dg)] : [r2(a), r2(dg), 0.01, r2(dg)];
}

/* ---------- testy zásahu ---------- */
function ptInPoly(x, y, poly) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
function segX(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax), d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx), d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}
function lineHitsPoly(X, Y, poly, closed) {
  const n = X.length;
  for (let i = 0; i < n; i++) if (ptInPoly(X[i], Y[i], poly)) return true;
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % n;
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++)
      if (segX(X[i], Y[i], X[j], Y[j], poly[a][0], poly[a][1], poly[b][0], poly[b][1])) return true;
  }
  return false;
}
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 < 1e-9 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
function polyBBox(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  return [x0, y0, x1, y1];
}
const bbHit = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/* rohy obrázku / textu (otočené kolem levého horního rohu) */
function boxSize(it) { return it.t === 't' ? [it.w * it.sc, Txt.height(it) * it.sc] : [it.w, it.h]; }
function boxCorners(it) {
  const [w, h] = boxSize(it), c = Math.cos(it.r || 0), s = Math.sin(it.r || 0);
  return [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => [it.x + x * c - y * s, it.y + x * s + y * c]);
}
function itemBBox(it) { return it.t === 's' ? strokeGeom(it).bbox : polyBBox(boxCorners(it)); }
function itemHitsPoly(it, poly, pbb) {
  if (!bbHit(itemBBox(it), pbb)) return false;
  if (it.t === 's') { const d = decPts(it); return lineHitsPoly(d.X, d.Y, poly, false); }
  const c = boxCorners(it);
  return lineHitsPoly(c.map(p => p[0]), c.map(p => p[1]), poly, true) || ptInPoly(poly[0][0], poly[0][1], c);
}
function itemHitsPoint(it, x, y, tol) {
  if (it.t === 's') {
    const bb = strokeGeom(it).bbox;
    if (x < bb[0] - tol || x > bb[2] + tol || y < bb[1] - tol || y > bb[3] + tol) return false;
    const d = decPts(it), lim = tol + it.w / 2;
    if (d.n === 1) return Math.hypot(x - d.X[0], y - d.Y[0]) <= lim;
    for (let i = 0; i < d.n - 1; i++) if (distSeg(x, y, d.X[i], d.Y[i], d.X[i + 1], d.Y[i + 1]) <= lim) return true;
    return false;
  }
  return ptInPoly(x, y, boxCorners(it));
}

/* ---------- transformace (posun, měřítko, otočení) m=[a,b,c,d,e,f] ---------- */
function transformItem(it, m) {
  const k = Math.hypot(m[0], m[1]), th = Math.atan2(m[1], m[0]);
  if (it.t === 's') {
    const p = it.pts, o = new Int16Array(p.length);
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i] / PQ, y = p[i + 1] / PQ;
      o[i] = clamp(Math.round((m[0] * x + m[2] * y + m[4]) * PQ), -32760, 32760);
      o[i + 1] = clamp(Math.round((m[1] * x + m[3] * y + m[5]) * PQ), -32760, 32760);
      o[i + 2] = p[i + 2];
    }
    return { ...it, pts: o, w: Math.max(0.1, it.w * k) };
  }
  const n = { ...it, x: m[0] * it.x + m[2] * it.y + m[4], y: m[1] * it.x + m[3] * it.y + m[5], r: (it.r || 0) + th };
  if (it.t === 't') n.sc = it.sc * k; else { n.w = it.w * k; n.h = it.h * k; }
  return n;
}
const matMul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const matT = (x, y) => [1, 0, 0, 1, x, y];
function matAbout(cx, cy, k, th) {
  const c = Math.cos(th) * k, s = Math.sin(th) * k;
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
}

/* ---------- guma: vymaže jen část tahu pod gumou a tah rozdělí ---------- */
function eraseStroke(it, cx, cy, R) {
  const bb = strokeGeom(it).bbox;
  if (cx < bb[0] - R || cx > bb[2] + R || cy < bb[1] - R || cy > bb[3] + R) return null;
  const { X, Y, P, n } = decPts(it), Re = R + it.w * 0.3, R2 = Re * Re;
  const ins = new Array(n);
  let changed = false;
  for (let i = 0; i < n; i++) { ins[i] = (X[i] - cx) ** 2 + (Y[i] - cy) ** 2 < R2; if (ins[i]) changed = true; }
  const runs = [];
  let cur = [];
  const close = () => { if (cur.length >= 6) runs.push(cur); cur = []; };
  const at = (i, t) => [X[i] + (X[i + 1] - X[i]) * t, Y[i] + (Y[i + 1] - Y[i]) * t, P[i] + (P[i + 1] - P[i]) * t];
  for (let i = 0; i < n; i++) {
    if (!ins[i]) cur.push(X[i], Y[i], P[i]);
    if (i === n - 1) break;
    if (ins[i] && ins[i + 1]) continue;
    const dx = X[i + 1] - X[i], dy = Y[i + 1] - Y[i], fx = X[i] - cx, fy = Y[i] - cy;
    const a = dx * dx + dy * dy, b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - R2;
    let disc = b * b - 4 * a * c;
    if (a < 1e-9 || disc <= 0) continue;
    disc = Math.sqrt(disc);
    const t1 = (-b - disc) / (2 * a), t2 = (-b + disc) / (2 * a);
    if (!ins[i] && !ins[i + 1]) {
      if (t1 > 0 && t2 < 1) { cur.push(...at(i, t1)); close(); cur = at(i, t2); changed = true; }
    } else if (!ins[i]) { cur.push(...at(i, clamp(t1, 0, 1))); close(); }
    else { cur = at(i, clamp(t2, 0, 1)); }
  }
  close();
  if (!changed) return null;
  return runs.map(r => {
    const n = { ...it, id: uid(), pts: encPts(r) };
    if (it.sp === 'ell' || it.sp === 'par') delete n.sp; else if (it.sp && it.sp !== 'line') n.sp = 'poly';
    return n;
  });
}
