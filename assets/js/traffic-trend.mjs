const SITE = 'https://wenbo-wei.github.io/';
const HISTORY_URL = 'https://raw.githubusercontent.com/wenbo-wei/wenbo-wei.github.io/site-traffic/traffic.json';
const DAY = 86400000;
const SVG_NS = 'http://www.w3.org/2000/svg';

export function parseDisplayedCounter(text, locale) {
  const formatter = new Intl.NumberFormat(locale);
  const digits = new Intl.NumberFormat(locale, { useGrouping: false });
  let normalized = text.trim();
  for (let i = 0; i < 10; i++) normalized = normalized.split(digits.format(i)).join(String(i));
  const group = formatter.formatToParts(123456789).find(part => part.type === 'group')?.value;
  if (group) normalized = normalized.split(group).join('');
  normalized = normalized.replace(/[\s\u200e\u200f\u061c]/g, '');
  if (!/^\d+$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isSafeInteger(value) ? value : null;
}

export function normalizeHistory(data) {
  if (data?.version !== 1 || data.site !== SITE || !Array.isArray(data.samples)) {
    throw new Error('Unexpected traffic history');
  }
  let previous = -Infinity;
  return data.samples.map(sample => {
    const time = typeof sample?.at === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(sample.at) ? Date.parse(sample.at) : NaN;
    if (!Number.isFinite(time) || time <= previous || !Number.isSafeInteger(sample.views) || sample.views < 0) {
      throw new Error('Invalid traffic snapshot');
    }
    previous = time;
    return { time, views: sample.views };
  });
}

export function makeSeries(history, live, now = Date.now()) {
  const series = history.filter(point => point.time >= now - 30 * DAY && point.time <= now);
  if (live && Number.isSafeInteger(live.views) && live.views >= 0 && live.time <= now &&
      (!series.length || live.time > series.at(-1).time)) {
    series.push(live);
  }
  return series;
}

export function makeGeometry(series) {
  if (!series.length) return [];
  const first = series[0].time;
  const duration = series.at(-1).time - first;
  const values = series.map(point => point.views);
  const low = Math.min(...values);
  const high = Math.max(...values);
  return series.map(point => ({
    ...point,
    x: duration ? 10 + (point.time - first) / duration * 460 : 240,
    y: high === low ? 42 : 74 - (point.views - low) / (high - low) * 60,
  }));
}

export function makePaths(points) {
  const groups = [];
  for (const point of points) {
    const previous = groups.at(-1)?.at(-1);
    // Leave gaps when samples are missing or the upstream counter has reset.
    if (!previous || point.time - previous.time > 12 * 3600000 || point.views < previous.views) {
      groups.push([point]);
    } else {
      groups.at(-1).push(point);
    }
  }
  return groups.filter(group => group.length > 1).map(group => {
    let line = `M ${group[0].x} ${group[0].y}`;
    for (let i = 1; i < group.length; i++) {
      const a = group[i - 1], b = group[i], middle = (a.x + b.x) / 2;
      // Bounded control points avoid overshooting the observed counts.
      line += ` C ${middle} ${a.y}, ${middle} ${b.y}, ${b.x} ${b.y}`;
    }
    return { line, area: `${line} L ${group.at(-1).x} 84 L ${group[0].x} 84 Z` };
  });
}

function element(name, attributes = {}) {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

async function initTrend() {
  const root = document.getElementById('traffic-trend');
  if (!root) return;
  const chart = document.getElementById('traffic-trend-chart');
  const plot = document.getElementById('traffic-trend-plot');
  const title = document.getElementById('traffic-trend-title');
  const status = document.getElementById('traffic-trend-status');
  const tooltip = root.querySelector('.traffic-tooltip');
  const startLabel = document.getElementById('traffic-trend-start');
  const endLabel = document.getElementById('traffic-trend-end');
  const counter = document.getElementById('busuanzi_site_pv');
  const dateFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  let history = [], live = null, points = [], selected = 0, historyState = 'loading';
  let marker;

  function hideDetail() {
    tooltip.hidden = true;
    if (marker) marker.style.display = 'none';
  }

  function showDetail(index) {
    if (!points.length) return;
    selected = Math.max(0, Math.min(points.length - 1, index));
    const point = points[selected];
    tooltip.textContent = `${dateFormat.format(point.time)} · ${point.views.toLocaleString()} total views`;
    tooltip.hidden = false;
    marker.setAttribute('cx', point.x);
    marker.setAttribute('cy', point.y);
    marker.style.display = '';
  }

  function render() {
    points = makeGeometry(makeSeries(history, live));
    plot.replaceChildren();
    hideDetail();
    for (const path of makePaths(points)) {
      plot.append(element('path', { d: path.area, class: 'traffic-area' }));
      plot.append(element('path', { d: path.line, class: 'traffic-line' }));
    }
    for (const point of points) {
      const dot = element('circle', { cx: point.x, cy: point.y, r: 2.2, class: 'traffic-dot' });
      const detail = element('title');
      detail.textContent = `${dateFormat.format(point.time)}: ${point.views.toLocaleString()} total views`;
      dot.append(detail);
      plot.append(dot);
    }
    marker = element('circle', { r: 4, class: 'traffic-marker', style: 'display:none' });
    plot.append(marker);
    status.textContent = historyState === 'error' ? 'History unavailable' :
      historyState === 'loading' ? 'Loading…' : points.length < 2 ? 'Collecting history' : '';
    startLabel.textContent = points.length ? dateFormat.format(points[0].time) : '';
    endLabel.textContent = points.length > 1 ? dateFormat.format(points.at(-1).time) : '';
    title.textContent = points.length ? `Cumulative page views, from ${points[0].views} to ${points.at(-1).views}. Use arrow keys to inspect recorded samples.` : 'Cumulative page views. Waiting for recorded samples.';
  }

  function readLiveCount() {
    const text = counter?.textContent.trim() || '';
    const views = parseDisplayedCounter(text);
    if (views === null) return;
    if (!live || live.views !== views) {
      live = { time: Date.now(), views };
      render();
    }
  }

  chart.addEventListener('pointermove', event => {
    if (!points.length) return;
    const rect = chart.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * 480;
    const nearest = points.reduce((best, point, index) => Math.abs(point.x - x) < Math.abs(points[best].x - x) ? index : best, 0);
    showDetail(nearest);
  });
  chart.addEventListener('pointerleave', hideDetail);
  chart.addEventListener('focus', () => showDetail(points.length - 1));
  chart.addEventListener('blur', hideDetail);
  chart.addEventListener('keydown', event => {
    const next = { ArrowLeft: selected - 1, ArrowRight: selected + 1, Home: 0, End: points.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    showDetail(next);
  });
  if (counter) new MutationObserver(readLiveCount).observe(counter, { childList: true, subtree: true, characterData: true });
  readLiveCount();
  render();

  try {
    const response = await fetch(HISTORY_URL, { cache: 'no-cache', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('History request failed');
    history = normalizeHistory(await response.json());
    historyState = 'ready';
  } catch {
    historyState = 'error';
  }
  render();
}

if (typeof document !== 'undefined') initTrend();
