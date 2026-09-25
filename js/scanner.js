// Serial-number scanner: live camera view with a framed scan window.
//  • Barcode mode — continuous detection (native BarcodeDetector when available, ZXing otherwise).
//  • Printed-text mode — on-device OCR (Tesseract, self-hosted) tuned for serial characters,
//    auto-accepting when two consecutive reads agree, or on demand with the shutter button.
// Resolves with { value, source: 'barcode' | 'ocr', format } or null when cancelled.
import { h } from './ui.js';
import { icon } from './icons.js';
import { t, num } from './i18n.js';

const MODE_KEY = 'azs.scanMode';
// Absolute asset URL relative to the app's location (works at / and under a sub-path such as GitHub Pages).
const asset = (p) => new URL(p, document.baseURI).href;
const SERIAL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/.: ';

// ---------------------------------------------------------------- lazy engines

const scripts = new Map();
function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { scripts.delete(src); reject(new Error(`Failed to load ${src}`)); };
      document.head.append(s);
    }));
  }
  return scripts.get(src);
}

let barcodeEngine = null;
async function getBarcodeEngine() {
  if (barcodeEngine) return barcodeEngine;
  if ('BarcodeDetector' in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (formats.length) {
        const detector = new window.BarcodeDetector({ formats });
        barcodeEngine = async (canvas) => {
          const found = await detector.detect(canvas);
          return found.length ? { text: found[0].rawValue, format: found[0].format.toUpperCase() } : null;
        };
        return barcodeEngine;
      }
    } catch { /* fall back to ZXing */ }
  }
  await loadScript(asset('vendor/zxing/index.min.js'));
  const Z = window.ZXing;
  const hints = new Map();
  const F = Z.BarcodeFormat;
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [F.CODE_128, F.CODE_39, F.CODE_93, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E,
    F.ITF, F.CODABAR, F.QR_CODE, F.DATA_MATRIX, F.PDF_417, F.AZTEC]);
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  const reader = new Z.MultiFormatReader();
  reader.setHints(hints);
  barcodeEngine = async (canvas) => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const { width, height } = canvas;
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const gray = new Uint8ClampedArray(width * height);
    for (let i = 0, j = 0; j < gray.length; i += 4, j += 1) gray[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
    try {
      const bitmap = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.RGBLuminanceSource(gray, width, height)));
      const r = reader.decodeWithState(bitmap);
      return { text: r.getText(), format: String(F[r.getBarcodeFormat()]) };
    } catch {
      return null; // NotFound / Checksum / Format exceptions — just no code in this frame
    } finally {
      reader.reset();
    }
  };
  return barcodeEngine;
}

let ocrWorker = null;
function getOcrWorker() {
  if (!ocrWorker) {
    ocrWorker = (async () => {
      await loadScript(asset('vendor/tesseract/tesseract.min.js'));
      const worker = await window.Tesseract.createWorker('eng', 1, {
        workerPath: asset('vendor/tesseract/worker.min.js'),
        corePath: asset('vendor/tesseract-core'),
        langPath: asset('vendor/tessdata'),
        workerBlobURL: false,
      }, { load_system_dawg: '0', load_freq_dawg: '0' });
      await worker.setParameters({
        tessedit_char_whitelist: SERIAL_CHARS,
        tessedit_pageseg_mode: '6',
        preserve_interword_spaces: '1',
      });
      return worker;
    })().catch((err) => { ocrWorker = null; throw err; });
  }
  return ocrWorker;
}

/** Pulls plausible serial numbers out of OCR text, best first. */
export function serialCandidates(text) {
  const out = new Map();
  const add = (s, score) => {
    const v = s.replace(/^[-/.:]+|[-/.:]+$/g, '');
    if (v.length < 4 || v.length > 40 || !/\d/.test(v)) return;
    out.set(v, Math.max(out.get(v) || 0, score + Math.min(v.length, 16) + (v.match(/\d/g).length / v.length) * 4));
  };
  for (const raw of String(text).toUpperCase().split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const labelled = /^(S\s*\/?\s*N|SER(IAL)?(\s*(NO|NUMBER|#))?)\s*[:.#-]?\s*/.exec(line);
    const body = labelled ? line.slice(labelled[0].length) : line;
    const bonus = labelled ? 12 : 0;
    const tokens = body.split(/\s+/).filter(Boolean);
    tokens.forEach((tok) => add(tok, bonus));
    if (tokens.length > 1 && tokens.length <= 4) add(tokens.join(''), bonus - 3); // serials printed with spaces
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

// ---------------------------------------------------------------- UI

export function openScanner({ check } = {}) {
  return new Promise((resolve) => {
    let mode = 'barcode';
    try { mode = localStorage.getItem(MODE_KEY) === 'ocr' ? 'ocr' : 'barcode'; } catch { /* ignore */ }

    let stream = null;
    let track = null;
    let running = false;
    let paused = false;
    let busy = false;
    let lastOcr = null;
    let zoomSteps = null;
    let zoomIndex = 0;
    let torchOn = false;
    let loopTimer = null;
    let done = false;

    const video = h('video.scan-video', { playsinline: true, muted: true, autoplay: true });
    const windowEl = h('div.scan-window', h('span.scan-laser'));
    const hint = h('p.scan-hint');
    const status = h('div.scan-status', { role: 'status', 'aria-live': 'polite' });
    const torchBtn = h('button.scan-tool', { type: 'button', hidden: true, 'aria-label': t('scan.torch'), onclick: toggleTorch }, icon('zap', 20));
    const zoomBtn = h('button.scan-tool', { type: 'button', hidden: true, 'aria-label': t('scan.zoom'), onclick: cycleZoom }, h('span.zoom-label', '1×'));
    const shutter = h('button.scan-shutter', { type: 'button', 'aria-label': t('scan.capture'), onclick: () => readNow() }, h('span'));

    const modeBtns = ['barcode', 'ocr'].map((m) => h('button.seg-btn', {
      type: 'button', dataset: { mode: m }, onclick: () => setMode(m),
    }, icon(m === 'barcode' ? 'barcode' : 'text', 16), h('span', t(`scan.mode.${m}`))));

    // Result sheet
    const resultInput = h('input.scan-result-input', { type: 'text', dir: 'ltr', autocomplete: 'off', spellcheck: false, 'aria-label': t('scan.result') });
    const resultMeta = h('p.scan-result-meta');
    const resultWarn = h('p.scan-result-warn', { hidden: true }, icon('alert', 16), h('span', t('err.DUPLICATE_SERIAL')));
    const candidatesEl = h('div.scan-candidates');
    const confirmBtn = h('button.btn.primary.lg', { type: 'button', onclick: confirm }, icon('check', 18), t('scan.confirm'));
    const sheet = h('div.scan-sheet', { hidden: true, role: 'dialog', 'aria-label': t('scan.result') },
      h('div.sheet-grip'),
      h('p.eyebrow', t('scan.result')),
      resultInput,
      resultMeta,
      resultWarn,
      candidatesEl,
      h('p.muted.small', t('scan.resultHint')),
      h('div.sheet-actions',
        h('button.btn.subtle.lg', { type: 'button', onclick: rescan }, icon('refresh', 18), t('scan.rescan')),
        confirmBtn));

    const root = h('div.scanner', { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('scan.title') },
      video,
      h('div.scan-shade', windowEl, hint),
      h('header.scan-top',
        h('button.scan-tool', { type: 'button', 'aria-label': t('common.cancel'), onclick: () => finish(null) }, icon('x', 22)),
        h('h2', t('scan.title')),
        h('div.scan-tools', zoomBtn, torchBtn)),
      h('footer.scan-bottom',
        status,
        h('div.seg.dark', modeBtns),
        shutter),
      sheet);

    document.body.append(root);
    document.body.classList.add('no-scroll');
    history.pushState({ azsScanner: true }, '');
    window.addEventListener('popstate', onPop);
    document.addEventListener('keydown', onKey);
    setMode(mode, true);
    start();

    function onPop() { finish(null, true); }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); if (!sheet.hidden) rescan(); else finish(null); }
      if (e.key === 'Enter' && !sheet.hidden) { e.preventDefault(); confirm(); }
    }

    function setStatus(text, spinning = false) {
      status.replaceChildren(...(text ? [spinning ? h('span.spinner.light') : null, h('span', text)].filter(Boolean) : []));
    }

    function setMode(m, initial = false) {
      mode = m;
      try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ }
      root.dataset.mode = m;
      modeBtns.forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
      hint.textContent = t(`scan.hint.${m}`);
      lastOcr = null;
      setStatus('');
      if (m === 'ocr') {
        setStatus(t('scan.loadingOcr'), true);
        getOcrWorker().then(() => { if (mode === 'ocr' && !paused) setStatus(''); })
          .catch(() => setStatus(t('err.NETWORK')));
      } else {
        getBarcodeEngine().catch(() => setStatus(t('err.NETWORK')));
      }
      if (!initial) schedule(0);
    }

    async function start() {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return fatal(t('scan.err.insecure'));
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
      } catch (err) {
        const msg = err.name === 'NotAllowedError' ? 'scan.err.denied' : err.name === 'NotFoundError' || err.name === 'OverconstrainedError' ? 'scan.err.nocamera' : 'scan.err.generic';
        return fatal(t(msg));
      }
      if (done) return stop();
      video.srcObject = stream;
      [track] = stream.getVideoTracks();
      try { await video.play(); } catch { /* autoplay with muted+playsinline should succeed */ }
      const caps = track.getCapabilities?.() || {};
      if (caps.focusMode?.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
      if (caps.torch) torchBtn.hidden = false;
      if (caps.zoom && caps.zoom.max >= 2) {
        zoomSteps = [Math.max(1, caps.zoom.min), 2, ...(caps.zoom.max >= 3 ? [3] : [])];
        zoomBtn.hidden = false;
      }
      running = true;
      schedule(300);
    }

    function fatal(message) {
      root.classList.add('failed');
      hint.textContent = '';
      setStatus('');
      shutter.disabled = true;
      windowEl.replaceChildren(h('div.scan-error', icon('alert', 28), h('p', message)));
    }

    function schedule(ms) {
      clearTimeout(loopTimer);
      if (!running || paused || done) return;
      loopTimer = setTimeout(tick, ms);
    }

    async function tick() {
      if (!running || paused || busy || done) return schedule(150);
      busy = true;
      try {
        if (mode === 'barcode') {
          const engine = await getBarcodeEngine();
          const hit = await engine(grabFrame({ pad: 0.18, maxWidth: 1280 }));
          if (hit?.text && !paused && mode === 'barcode') {
            showResult(hit.text.trim(), 'barcode', { format: hit.format.replace(/_/g, '-') });
          }
        } else {
          const worker = await getOcrWorker();
          if (mode !== 'ocr' || paused) return;
          const read = await recognize(worker);
          // Two consecutive frames agreeing on the same serial is a strong stability signal.
          // Also require reasonable confidence and length, so a half-framed label (e.g. "LV24") isn't auto-accepted;
          // the shutter button still accepts whatever is read.
          if (read.best && read.best === lastOcr?.best && read.conf >= 60 && read.best.length >= 6 && !paused && mode === 'ocr') {
            showResult(read.best, 'ocr', { conf: read.conf, candidates: read.candidates });
          }
          lastOcr = read;
        }
      } catch {
        /* keep scanning */
      } finally {
        busy = false;
        schedule(mode === 'barcode' ? 120 : 350);
      }
    }

    async function recognize(worker) {
      const canvas = grabFrame({ pad: 0, maxWidth: 1600, minWidth: 900, enhance: true });
      const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true }); // blocks => confidence
      const candidates = serialCandidates(data.text);
      return { best: candidates[0] || null, candidates, conf: Math.round(data.confidence || 0) };
    }

    async function readNow() {
      if (!running || paused) return;
      if (mode === 'barcode') return schedule(0);
      clearTimeout(loopTimer);
      while (busy) await new Promise((r) => setTimeout(r, 50));
      busy = true;
      setStatus(t('scan.reading'), true);
      try {
        const worker = await getOcrWorker();
        const read = await recognize(worker);
        if (read.best) showResult(read.best, 'ocr', { conf: read.conf, candidates: read.candidates });
        else setStatus(t('scan.noText'));
      } catch {
        setStatus(t('err.GENERIC'));
      } finally {
        busy = false;
        if (!paused) schedule(1200);
      }
    }

    /** Copies the scan-window area of the current video frame to a canvas. */
    function grabFrame({ pad, maxWidth, minWidth = 0, enhance = false }) {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const box = video.getBoundingClientRect();
      const win = windowEl.getBoundingClientRect();
      let sx; let sy; let sw; let sh;
      if (box.width && win.width) {
        const scale = Math.max(box.width / vw, box.height / vh); // object-fit: cover
        const offX = (box.width - vw * scale) / 2;
        const offY = (box.height - vh * scale) / 2;
        sx = (win.left - box.left - offX) / scale;
        sy = (win.top - box.top - offY) / scale;
        sw = win.width / scale;
        sh = win.height / scale;
      } else {
        // Layout not measurable (e.g. page hidden mid-scan): use a centred crop of the frame.
        sw = vw * 0.8;
        sh = mode === 'ocr' ? sw / 3.6 : sw / 1.7;
        sx = (vw - sw) / 2;
        sy = (vh - sh) / 2;
      }
      sx -= sw * pad; sy -= sh * pad; sw *= 1 + 2 * pad; sh *= 1 + 2 * pad;
      sx = Math.max(0, sx); sy = Math.max(0, sy);
      sw = Math.min(vw - sx, sw); sh = Math.min(vh - sy, sh);

      let out = Math.min(maxWidth, Math.max(minWidth, sw));
      const k = out / sw;
      out = Math.round(out);
      const canvas = document.createElement('canvas');
      canvas.width = out;
      canvas.height = Math.round(sh * k);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      if (enhance) enhanceForOcr(ctx, canvas.width, canvas.height);
      return canvas;
    }

    function showResult(value, source, { format, conf, candidates = [] } = {}) {
      paused = true;
      clearTimeout(loopTimer);
      video.pause();
      navigator.vibrate?.(60);
      root.classList.add('has-result');
      setStatus('');
      resultInput.value = value;
      resultInput.dataset.source = source;
      resultInput.dataset.format = format || '';
      resultMeta.replaceChildren(icon(source === 'barcode' ? 'barcode' : 'text', 14),
        h('span', source === 'barcode' ? t('scan.via.barcode', { format }) : t('scan.via.ocr', { conf: num(conf) })));
      const others = candidates.filter((c) => c !== value).slice(0, 4);
      candidatesEl.replaceChildren(...(others.length ? [
        h('p.muted.small', t('scan.candidates')),
        h('div.chips', others.map((c) => h('button.chip', { type: 'button', dir: 'ltr', onclick: () => { resultInput.value = c; runCheck(); } }, c))),
      ] : []));
      sheet.hidden = false;
      runCheck();
    }

    let checkSeq = 0;
    async function runCheck() {
      resultWarn.hidden = true;
      if (!check) return;
      const seq = ++checkSeq;
      try {
        const dup = await check(resultInput.value);
        if (seq === checkSeq) resultWarn.hidden = !dup;
      } catch { /* offline — the server re-checks on save anyway */ }
    }
    resultInput.addEventListener('input', () => { clearTimeout(resultInput._t); resultInput._t = setTimeout(runCheck, 350); });

    function rescan() {
      sheet.hidden = true;
      root.classList.remove('has-result');
      lastOcr = null;
      paused = false;
      video.play().catch(() => {});
      schedule(400);
    }

    function confirm() {
      const value = resultInput.value.trim();
      if (!value) return resultInput.focus();
      const original = resultInput.dataset.source;
      finish({ value, source: original, format: resultInput.dataset.format || null });
    }

    async function toggleTorch() {
      torchOn = !torchOn;
      try {
        await track.applyConstraints({ advanced: [{ torch: torchOn }] });
        torchBtn.classList.toggle('on', torchOn);
      } catch { torchOn = false; }
    }

    async function cycleZoom() {
      zoomIndex = (zoomIndex + 1) % zoomSteps.length;
      const z = zoomSteps[zoomIndex];
      try {
        await track.applyConstraints({ advanced: [{ zoom: z }] });
        zoomBtn.firstChild.textContent = `${Math.round(z)}×`;
      } catch { /* unsupported */ }
    }

    function stop() {
      running = false;
      clearTimeout(loopTimer);
      stream?.getTracks().forEach((tr) => tr.stop());
    }

    function finish(result, fromPop = false) {
      if (done) return;
      done = true;
      stop();
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('keydown', onKey);
      if (!fromPop && history.state?.azsScanner) history.back();
      root.classList.add('closing');
      document.body.classList.remove('no-scroll');
      setTimeout(() => root.remove(), 180);
      resolve(result);
    }
  });
}

/** Greyscale + contrast stretch (+ invert light-on-dark labels) to help OCR. */
function enhanceForOcr(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const hist = new Uint32Array(256);
  const g = new Uint8ClampedArray(w * h);
  let sum = 0;
  for (let i = 0, j = 0; j < g.length; i += 4, j += 1) {
    const v = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    g[j] = v; hist[v] += 1; sum += v;
  }
  const pct = (p) => {
    let acc = 0;
    const target = g.length * p;
    for (let v = 0; v < 256; v += 1) { acc += hist[v]; if (acc >= target) return v; }
    return 255;
  };
  const lo = pct(0.02);
  const hi = Math.max(lo + 1, pct(0.98));
  const invert = sum / g.length < 110; // mostly dark → probably light text on dark label
  for (let i = 0, j = 0; j < g.length; i += 4, j += 1) {
    let v = ((g[j] - lo) * 255) / (hi - lo);
    if (invert) v = 255 - v;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}
