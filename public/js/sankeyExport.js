'use strict';

// Exports a rendered Sankey <svg> (from sankey.js) as a shareable PNG: a title/
// subtitle header, the chart itself, and a small watermark, all baked onto a
// themed background card sized to the chart's own viewBox.
const NS = 'http://www.w3.org/2000/svg';

// getComputedStyle resolves CSS custom properties (var(--text) etc.) against the
// live, styled DOM — the exported image is rasterized from a detached data-URI
// document that has no access to our stylesheet/CSS variables, so every paint
// value must be baked in as a literal color at export time or labels/links would
// render with the browser's SVG default (black) regardless of the active theme.
function inlineComputedPaint(svgEl) {
  const clone = svgEl.cloneNode(true);
  const liveEls = svgEl.querySelectorAll('*');
  const cloneEls = clone.querySelectorAll('*');
  liveEls.forEach((liveEl, i) => {
    const cloneEl = cloneEls[i];
    if (!cloneEl) return;
    const cs = getComputedStyle(liveEl);
    if (cs.fill && cs.fill !== 'none') cloneEl.setAttribute('fill', cs.fill);
    if (cs.stroke && cs.stroke !== 'none') cloneEl.setAttribute('stroke', cs.stroke);
    if (cs.fontFamily) cloneEl.setAttribute('font-family', cs.fontFamily);
  });
  return clone;
}

async function exportSvgAsPng(svgEl, { filename = 'export.png', title, subtitle, scale = 2 } = {}) {
  if (!svgEl) throw new Error('Aucun graphique à exporter.');
  const viewBoxAttr = svgEl.getAttribute('viewBox') || `0 0 ${svgEl.getAttribute('width')} ${svgEl.getAttribute('height')}`;
  const [, , vbW, vbH] = viewBoxAttr.split(/\s+/).map(Number);

  const bodyStyles = getComputedStyle(document.body);
  const bgColor = bodyStyles.getPropertyValue('--bg-elevated').trim() || '#ffffff';
  const textColor = bodyStyles.getPropertyValue('--text').trim() || '#111827';
  const mutedColor = bodyStyles.getPropertyValue('--muted').trim() || '#64748b';
  const fontFamily = bodyStyles.fontFamily || 'sans-serif';

  const PAD = 28;
  const HEADER = title ? 58 : 0;
  const FOOTER = 26;
  const outW = Math.ceil(vbW + PAD * 2);
  const outH = Math.ceil(vbH + PAD * 2 + HEADER + FOOTER);

  const wrapper = document.createElementNS(NS, 'svg');
  wrapper.setAttribute('xmlns', NS);
  wrapper.setAttribute('width', String(outW));
  wrapper.setAttribute('height', String(outH));
  wrapper.setAttribute('viewBox', `0 0 ${outW} ${outH}`);

  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('width', String(outW));
  bg.setAttribute('height', String(outH));
  bg.setAttribute('rx', '20');
  bg.setAttribute('fill', bgColor);
  wrapper.appendChild(bg);

  if (title) {
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', String(PAD));
    t.setAttribute('y', '34');
    t.setAttribute('font-size', '19');
    t.setAttribute('font-weight', '700');
    t.setAttribute('font-family', fontFamily);
    t.setAttribute('fill', textColor);
    t.textContent = title;
    wrapper.appendChild(t);
  }
  if (subtitle) {
    const s = document.createElementNS(NS, 'text');
    s.setAttribute('x', String(PAD));
    s.setAttribute('y', '52');
    s.setAttribute('font-size', '13');
    s.setAttribute('font-family', fontFamily);
    s.setAttribute('fill', mutedColor);
    s.textContent = subtitle;
    wrapper.appendChild(s);
  }

  const chartClone = inlineComputedPaint(svgEl);
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('transform', `translate(${PAD}, ${PAD + HEADER})`);
  Array.from(chartClone.childNodes).forEach((child) => g.appendChild(child));
  wrapper.appendChild(g);

  const watermark = document.createElementNS(NS, 'text');
  watermark.setAttribute('x', String(outW - PAD));
  watermark.setAttribute('y', String(outH - 9));
  watermark.setAttribute('text-anchor', 'end');
  watermark.setAttribute('font-size', '11');
  watermark.setAttribute('font-family', fontFamily);
  watermark.setAttribute('fill', mutedColor);
  watermark.textContent = 'Généré avec Lyrava';
  wrapper.appendChild(watermark);

  const svgStr = new XMLSerializer().serializeToString(wrapper);
  const dataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgStr)}`;

  const img = new Image();
  const loaded = new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('Impossible de générer l\u2019image.'));
  });
  img.src = dataUri;
  await loaded;

  const canvas = document.createElement('canvas');
  canvas.width = outW * scale;
  canvas.height = outH * scale;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Impossible de générer l\u2019image.');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export { exportSvgAsPng };
