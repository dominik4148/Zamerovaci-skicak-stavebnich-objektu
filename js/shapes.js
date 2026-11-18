'use strict';
/* Rozpoznání tvarů: z ručně nakreslené čáry udělá přímku, šipku, obdélník, čtverec, kruh, elipsu,
   trojúhelník, hvězdu, parabolu nebo lomenou (pravoúhlou) čáru. Souřadnice jsou v bodech stránky. */
const Shapes = (() => {
  const DEG = Math.PI / 180;
  const D = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const rot = (p, c, s) => [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
  const STRAIGHT = { line: 1, arrow: 1, rect: 1, tri: 1, star: 1, poly: 1 };

  function toPts(raw) {
    const o = [];
    for (let i = 0; i < raw.length; i += 3) { const p = [raw[i], raw[i + 1]]; if (!o.length || D(o[o.length - 1], p) > 1e-3) o.push(p); }
    return o;
  }
  function pathLen(P) { let l = 0; for (let i = 1; i < P.length; i++) l += D(P[i - 1], P[i]); return l; }
  function resample(P, n) {
    const step = pathLen(P) / (n - 1), o = [P[0]];
    let acc = 0, prev = P[0];
    for (let i = 1; i < P.length && o.length < n; i++) {
      const cur = P[i];
      let d = D(prev, cur);
      while (d > 0 && acc + d >= step && o.length < n) {
        const t = (step - acc) / d;
        prev = [prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t];
        o.push(prev); d = D(prev, cur); acc = 0;
      }
      acc += d; prev = cur;
    }
    while (o.length < n) o.push(P[P.length - 1]);
    o[n - 1] = P[P.length - 1];
    return o;
  }
  function bbox(P) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of P) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    return [x0, y0, x1, y1];
  }
  function rdp(P, a, b, tol, out) {
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) { const d = distSeg(P[i][0], P[i][1], P[a][0], P[a][1], P[b][0], P[b][1]); if (d > md) { md = d; mi = i; } }
    if (md > tol) { rdp(P, a, mi, tol, out); out.push(mi); rdp(P, mi, b, tol, out); }
  }
  /* změna směru v bodě i (okno ±k vzorků); u uzavřené čáry je poslední bod stejný jako první */
  function turn(P, i, k, closed) {
    const n = P.length, m = n - 1;
    const a = closed ? P[((i - k) % m + m) % m] : P[Math.max(0, i - k)];
    const b = closed ? P[(i + k) % m] : P[Math.min(n - 1, i + k)];
    const ux = P[i][0] - a[0], uy = P[i][1] - a[1], vx = b[0] - P[i][0], vy = b[1] - P[i][1];
    return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  }
  function sharpness(P, i, closed) {
    const m = P.length - 1;
    let s = 0;
    for (let j = -2; j <= 2; j++) {
      const q = closed ? ((i + j) % m + m) % m : i + j;
      if (q < 1 && !closed || q > m - 1 && !closed) continue;
      s = Math.max(s, Math.abs(turn(P, q, 5, closed)));
    }
    return s;
  }
  function polyErr(P, V, closed) {
    let sum = 0;
    const m = closed ? V.length : V.length - 1;
    for (const p of P) {
      let d = Infinity;
      for (let i = 0; i < m; i++) { const a = V[i], b = V[(i + 1) % V.length]; d = Math.min(d, distSeg(p[0], p[1], a[0], a[1], b[0], b[1])); }
      sum += d;
    }
    return sum / P.length;
  }
  /* téměř vodorovné a svislé hrany se srovnají přesně */
  function snapEdges(V0, closed) {
    const V = V0.map(p => p.slice()), n = V.length, m = closed ? n : n - 1, lim = Math.sin(9 * DEG);
    for (let i = 0; i < m; i++) {
      const a = V[i], b = V[(i + 1) % n], l = D(a, b);
      if (l < 1e-6) continue;
      if (Math.abs(b[1] - a[1]) / l < lim) a[1] = b[1] = (a[1] + b[1]) / 2;
      else if (Math.abs(b[0] - a[0]) / l < lim) a[0] = b[0] = (a[0] + b[0]) / 2;
    }
    return V;
  }
  function snapHV(a, b) {
    const l = D(a, b), lim = Math.sin(2.5 * DEG);
    if (l < 1e-6) return b;
    if (Math.abs(b[1] - a[1]) / l < lim) return [b[0], a[1]];
    if (Math.abs(b[0] - a[0]) / l < lim) return [a[0], b[1]];
    return b;
  }
  const bez = (a, c, b, t) => [(1 - t) * (1 - t) * a[0] + 2 * t * (1 - t) * c[0] + t * t * b[0], (1 - t) * (1 - t) * a[1] + 2 * t * (1 - t) * c[1] + t * t * b[1]];
  function bezPts(a, c, b, n) { const o = []; for (let i = 0; i <= n; i++) o.push(bez(a, c, b, i / n)); return o; }

  /* ---------- otevřené tvary ---------- */
  function fitParabola(P, S, E) {
    const n = P.length;
    let T = P.map((p, i) => i / (n - 1)), C = null, err = 0;
    for (let it = 0; it < 4; it++) {
      let sx = 0, sy = 0, sw = 0;
      for (let i = 1; i < n - 1; i++) {
        const t = T[i], w = 2 * t * (1 - t);
        sx += w * (P[i][0] - (1 - t) * (1 - t) * S[0] - t * t * E[0]);
        sy += w * (P[i][1] - (1 - t) * (1 - t) * S[1] - t * t * E[1]);
        sw += w * w;
      }
      if (sw < 1e-9) return null;
      C = [sx / sw, sy / sw];
      const B = bezPts(S, C, E, 120);
      err = 0;
      T = P.map(p => { let bd = Infinity, bi = 0; for (let j = 0; j <= 120; j++) { const d = D(p, B[j]); if (d < bd) { bd = d; bi = j; } } err += bd; return bi / 120; });
      err /= n;
    }
    return { C, err };
  }
  function detectOpen(R, L, diag) {
    const P = resample(R, 96), n = P.length, S = P[0], E = P[n - 1], chord = D(S, E);
    let dev = 0;
    for (const p of P) dev = Math.max(dev, distSeg(p[0], p[1], S[0], S[1], E[0], E[1]));
    if (L < 1.2 * chord && dev < 0.075 * chord) return { kind: 'line', a: S, b: snapHV(S, E) };
    const idx = [0];
    rdp(P, 0, n - 1, Math.max(0.045 * diag, 0.8), idx);
    idx.push(n - 1);
    const V = idx.map(i => P[i]);
    // šipka: dlouhá rovná čára a na konci malá „stříška“
    if (V.length >= 4) {
      const T = V[1], d1 = D(S, T);
      let ok = d1 > 0.35 * L, far = 0;
      for (let i = 2; i < V.length && ok; i++) { const d = D(V[i], T); if (d > 0.6 * d1) ok = false; far = Math.max(far, d); }
      if (ok && far > 0.06 * d1) return { kind: 'arrow', a: S, b: snapHV(S, T) };
    }
    // lomená čára (všechny zlomy ostré) nebo hladký oblouk → parabola; vyhraje přesnější
    let poly = null, ep = Infinity;
    if (V.length >= 3 && V.length <= 10 && idx.slice(1, -1).every(i => sharpness(P, i, false) > 38 * DEG)) {
      const e = polyErr(P, V, false);
      if (e < 0.03 * diag) { poly = { kind: 'poly', open: true, P: snapEdges(V, false), th: 0 }; ep = e / L; }
    }
    let maxT = 0;
    for (let i = 5; i < n - 5; i++) maxT = Math.max(maxT, Math.abs(turn(P, i, 5, false)));
    if (chord > 0.15 * L) {
      const f = fitParabola(P, S, E);
      if (f && f.err / L < (maxT < 42 * DEG ? 0.022 : 0.009) && f.err / L < ep) return { kind: 'par', a: S, b: E, c: f.C, c0: f.C };
    }
    if (poly) return poly;
    return null;
  }

  /* ---------- uzavřené tvary ---------- */
  function starPts(c, R, r, a0) {
    const o = [];
    for (let i = 0; i < 10; i++) { const rr = i % 2 ? r : R, a = a0 + i * Math.PI / 5; o.push([c[0] + rr * Math.cos(a), c[1] + rr * Math.sin(a)]); }
    return o;
  }
  function starAngle(a0) { // špička nahoru, když je skoro nahoře
    const step = 72 * DEG;
    let d = ((a0 + 90 * DEG) % step + step) % step;
    if (d > step / 2) d -= step;
    return Math.abs(d) < 15 * DEG ? a0 - d : a0;
  }
  const centroid = P => { let x = 0, y = 0; for (const p of P) { x += p[0]; y += p[1]; } return [x / P.length, y / P.length]; };
  function detectClosed(R, diag) {
    const P = resample([...R, R[0]], 121), m = P.length - 1;
    const U = P.slice(0, m), c = centroid(U);
    let total = 0;
    for (let i = 0; i < m; i++) total += turn(P, i, 1, true);
    const wind = Math.round(Math.abs(total) / (2 * Math.PI));
    // rohy
    let far = 0, fi = 0;
    for (let i = 1; i < m; i++) { const d = D(P[i], P[0]); if (d > far) { far = d; fi = i; } }
    const idx = [0];
    rdp(P, 0, fi, Math.max(0.05 * diag, 0.8), idx); idx.push(fi); rdp(P, fi, m, Math.max(0.05 * diag, 0.8), idx);
    let vi = idx.filter(i => sharpness(P, i, true) > 38 * DEG);
    const keep = [];
    for (const i of vi) if (!keep.length || D(P[i], P[keep[keep.length - 1]]) > 0.09 * diag) keep.push(i);
    if (keep.length > 1 && D(P[keep[0]], P[keep[keep.length - 1]]) <= 0.09 * diag) keep.pop();
    const V = keep.map(i => P[i]);
    // hvězda nakreslená jedním tahem „přes sebe“
    if (wind >= 2 && V.length >= 4 && V.length <= 6) {
      const vc = centroid(V), Rr = V.reduce((s, p) => s + D(p, vc), 0) / V.length;
      return { kind: 'star', P: starPts(vc, Rr, Rr * 0.382, starAngle(Math.atan2(V[0][1] - vc[1], V[0][0] - vc[0]))), th: 0, uniform: true };
    }
    // elipsa / kruh
    let sxx = 0, syy = 0, sxy = 0;
    for (const p of U) { const dx = p[0] - c[0], dy = p[1] - c[1]; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    const tr = (sxx + syy) / 2, df = Math.sqrt((sxx - syy) * (sxx - syy) / 4 + sxy * sxy);
    const aspect = Math.sqrt(Math.max(1e-9, tr - df) / Math.max(1e-9, tr + df));
    let th = aspect > 0.82 ? 0 : 0.5 * Math.atan2(2 * sxy, sxx - syy);
    if (Math.abs(th) < 12 * DEG) th = 0; else if (Math.abs(th) > 78 * DEG) th = Math.PI / 2;
    const co = Math.cos(-th), si = Math.sin(-th), Lc = U.map(p => rot(p, co, si)), lb = bbox(Lc);
    let rx = (lb[2] - lb[0]) / 2, ry = (lb[3] - lb[1]) / 2;
    const ec = [(lb[0] + lb[2]) / 2, (lb[1] + lb[3]) / 2];
    let eErr = 0;
    for (const p of Lc) eErr += Math.abs(Math.hypot((p[0] - ec[0]) / Math.max(rx, 1e-6), (p[1] - ec[1]) / Math.max(ry, 1e-6)) - 1);
    eErr /= Lc.length;
    const ellipse = () => {
      const center = rot(ec, Math.cos(th), Math.sin(th));
      const circle = Math.min(rx, ry) / Math.max(rx, ry) > 0.82;
      if (circle) { rx = ry = (rx + ry) / 2; th = 0; }
      const c2 = Math.cos(th), s2 = Math.sin(th), o = [];
      for (let i = 0; i < 72; i++) { const a = i * Math.PI / 36, q = rot([rx * Math.cos(a), ry * Math.sin(a)], c2, s2); o.push([center[0] + q[0], center[1] + q[1]]); }
      return { kind: 'ell', P: o, th, uniform: circle };
    };
    const pErr = V.length >= 3 ? polyErr(U, V, true) / diag : 1;
    if (eErr < 0.09 && V.length <= 2) return ellipse();
    if (V.length >= 3 && pErr < 0.035) {
      if (V.length === 3) return { kind: 'tri', P: snapEdges(V, true), th: 0 };
      if (V.length === 4) {
        let right = true, ang = 0;
        for (let i = 0; i < 4; i++) {
          const a = V[(i + 3) % 4], b = V[i], d = V[(i + 1) % 4];
          const t = Math.abs(Math.atan2((b[0] - a[0]) * (d[1] - b[1]) - (b[1] - a[1]) * (d[0] - b[0]), (b[0] - a[0]) * (d[0] - b[0]) + (b[1] - a[1]) * (d[1] - b[1])));
          if (Math.abs(t - Math.PI / 2) > 24 * DEG) right = false;
          let e = Math.atan2(d[1] - b[1], d[0] - b[0]) % (Math.PI / 2);
          if (e > Math.PI / 4) e -= Math.PI / 2; else if (e < -Math.PI / 4) e += Math.PI / 2;
          ang += e / 4;
        }
        if (right) {
          const rth = Math.abs(ang) < 10 * DEG ? 0 : ang, rc = Math.cos(-rth), rs = Math.sin(-rth);
          const Q = V.map(p => rot(p, rc, rs)), xs = Q.map(p => p[0]).sort((a, b) => a - b), ys = Q.map(p => p[1]).sort((a, b) => a - b);
          let x0 = (xs[0] + xs[1]) / 2, x1 = (xs[2] + xs[3]) / 2, y0 = (ys[0] + ys[1]) / 2, y1 = (ys[2] + ys[3]) / 2;
          const w = x1 - x0, h = y1 - y0, square = Math.min(w, h) / Math.max(w, h) > 0.87;
          if (square) { const s = (w + h) / 4, mx = (x0 + x1) / 2, my = (y0 + y1) / 2; x0 = mx - s; x1 = mx + s; y0 = my - s; y1 = my + s; }
          const bc = Math.cos(rth), bs = Math.sin(rth);
          return { kind: 'rect', P: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(p => rot(p, bc, bs)), th: rth, uniform: square };
        }
        return { kind: 'poly', P: snapEdges(V, true), th: 0 };
      }
      if (V.length === 10) {
        const vc = centroid(V), rr = V.map(p => D(p, vc));
        const ev = (rr[0] + rr[2] + rr[4] + rr[6] + rr[8]) / 5, od = (rr[1] + rr[3] + rr[5] + rr[7] + rr[9]) / 5;
        if (Math.min(ev, od) / Math.max(ev, od) < 0.75) {
          const k = ev > od ? 0 : 1;
          return { kind: 'star', P: starPts(vc, Math.max(ev, od), Math.min(ev, od), starAngle(Math.atan2(V[k][1] - vc[1], V[k][0] - vc[0]))), th: 0, uniform: true };
        }
      }
      if (V.length <= 14) return { kind: 'poly', P: snapEdges(V, true), th: 0 };
    }
    if (eErr < 0.06) return ellipse();
    return null;
  }

  function detect(raw, w, minDiag) {
    const R = toPts(raw);
    if (R.length < 2) return null;
    const b = bbox(R), diag = Math.hypot(b[2] - b[0], b[3] - b[1]), L = pathLen(R);
    if (diag < minDiag || L < 1e-3) return null;
    const gap = D(R[0], R[R.length - 1]);
    let s = null;
    try { s = gap < 0.2 * L && gap < 0.45 * diag ? detectClosed(R, diag) : detectOpen(R, L, diag); } catch (e) { console.warn(e); }
    if (s) s.w = w;
    return s;
  }

  function arrowPts(a, b, w) {
    const len = D(a, b);
    if (len < 1e-6) return [a, b];
    const hl = Math.min(len * 0.6, clamp(len * 0.22, 5 + w, 16 + 2 * w)), ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
    const c = Math.cos(27 * DEG), s = Math.sin(27 * DEG);
    const h1 = [b[0] - hl * (ux * c - uy * s), b[1] - hl * (ux * s + uy * c)], h2 = [b[0] - hl * (ux * c + uy * s), b[1] - hl * (-ux * s + uy * c)];
    return [a, b, h1, b, h2];
  }
  function points(s) {
    const P = s.kind === 'line' ? [s.a, s.b] : s.kind === 'arrow' ? arrowPts(s.a, s.b, s.w || 1) : s.kind === 'par' ? bezPts(s.a, s.c, s.b, 48) : s.open ? s.P : [...s.P, s.P[0]];
    const o = [];
    for (const p of P) o.push(p[0], p[1], 0.5);
    return o;
  }
  /* dokud uživatel drží tužku, tvar se dá upravit: p0 = kde tužka stála při rozpoznání, pen = kde je teď */
  function adjust(s, p0, pen) {
    if (s.kind === 'line' || s.kind === 'arrow') return { ...s, b: snapHV(s.a, pen) };
    if (s.kind === 'par') {
      const l = D(s.a, s.b) || 1, nx = -(s.b[1] - s.a[1]) / l, ny = (s.b[0] - s.a[0]) / l, d = (pen[0] - p0[0]) * nx + (pen[1] - p0[1]) * ny;
      return { ...s, c: [s.c0[0] + 2 * d * nx, s.c0[1] + 2 * d * ny] };
    }
    const co = Math.cos(-s.th), si = Math.sin(-s.th), Lp = s.P.map(p => rot(p, co, si)), q0 = rot(p0, co, si), q = rot(pen, co, si), b = bbox(Lp);
    let A = null, best = -1;
    for (const cnr of [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]]) { const d = D(cnr, q0); if (d > best) { best = d; A = cnr; } }
    const ratio = (num, den) => Math.abs(den) < 1e-3 ? 1 : Math.max(0.05, num / den);
    let sx, sy;
    if (s.uniform) sx = sy = Math.max(0.05, D(q, A) / Math.max(1e-6, D(q0, A)));
    else { sx = ratio(q[0] - A[0], q0[0] - A[0]); sy = ratio(q[1] - A[1], q0[1] - A[1]); }
    const bc = Math.cos(s.th), bs = Math.sin(s.th);
    return { ...s, P: Lp.map(p => rot([A[0] + (p[0] - A[0]) * sx, A[1] + (p[1] - A[1]) * sy], bc, bs)) };
  }
  return { detect, points, adjust, snapHV, STRAIGHT };
})();
