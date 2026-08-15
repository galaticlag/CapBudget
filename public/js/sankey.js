'use strict';

// Thin wrapper around the vendored D3 + d3-sankey UMD bundles (loaded as plain
// <script> tags before this module, so they hang off window.d3).
// Renders a 5-column flow: revenue subcategories -> revenue categories -> center
// -> expense categories -> expense subcategories, all visible at once.
function renderSankey(container, { revenue, expense }, { formatValue, onNodeClick } = {}) {
  container.innerHTML = '';
  const d3 = window.d3;
  if (!d3 || !d3.sankey) {
    container.innerHTML = '<p class="empty-state">Impossible de charger le composant Sankey.</p>';
    return;
  }

  const width = Math.max(container.clientWidth || 720, 360);
  const height = Math.max(container.clientHeight || 420, 320);

  const nodes = [];
  const links = [];
  const nodeIndex = new Map();

  function addNode(id, name, color) {
    if (nodeIndex.has(id)) return nodeIndex.get(id);
    const idx = nodes.length;
    nodes.push({ id, name, color });
    nodeIndex.set(id, idx);
    return idx;
  }

  const centerIdx = addNode('__center__', '', '#94a3b8');

  for (const cat of revenue) {
    if (cat.amountCents <= 0) continue;
    const catIdx = addNode(`revcat:${cat.categoryId}`, cat.name, cat.color || '#22c55e');
    const subs = (cat.subcategories || []).filter((s) => s.amountCents > 0);
    if (subs.length === 0) {
      links.push({ source: catIdx, target: centerIdx, value: cat.amountCents, ref: { side: 'REVENUE', categoryId: cat.categoryId } });
    } else {
      links.push({ source: catIdx, target: centerIdx, value: cat.amountCents, ref: { side: 'REVENUE', categoryId: cat.categoryId } });
      for (const sub of subs) {
        const subIdx = addNode(`revsub:${sub.subcategoryId}`, sub.name, cat.color || '#22c55e');
        links.push({ source: subIdx, target: catIdx, value: sub.amountCents, ref: { side: 'REVENUE', categoryId: cat.categoryId, subcategoryId: sub.subcategoryId } });
      }
    }
  }
  for (const cat of expense) {
    if (cat.amountCents <= 0) continue;
    const catIdx = addNode(`expcat:${cat.categoryId}`, cat.name, cat.color || '#f87171');
    const subs = (cat.subcategories || []).filter((s) => s.amountCents > 0);
    if (subs.length === 0) {
      links.push({ source: centerIdx, target: catIdx, value: cat.amountCents, ref: { side: 'EXPENSE', categoryId: cat.categoryId } });
    } else {
      links.push({ source: centerIdx, target: catIdx, value: cat.amountCents, ref: { side: 'EXPENSE', categoryId: cat.categoryId } });
      for (const sub of subs) {
        const subIdx = addNode(`expsub:${sub.subcategoryId}`, sub.name, cat.color || '#f87171');
        links.push({ source: catIdx, target: subIdx, value: sub.amountCents, ref: { side: 'EXPENSE', categoryId: cat.categoryId, subcategoryId: sub.subcategoryId } });
      }
    }
  }

  if (links.length === 0) {
    container.innerHTML = '<p class="empty-state">Aucune transaction sur cette période.</p>';
    return;
  }

  const sankeyLayout = d3.sankey()
    .nodeId((d) => d.index)
    .nodeWidth(16)
    .nodePadding(14)
    .extent([[8, 8], [width - 8, height - 8]]);

  const graph = sankeyLayout({
    nodes: nodes.map((n, i) => ({ ...n, index: i })),
    links: links.map((l) => ({ ...l }))
  });

  const svg = d3.select(container).append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`);

  svg.append('g').attr('class', 'sankey-links')
    .selectAll('path')
    .data(graph.links)
    .join('path')
    .attr('d', d3.sankeyLinkHorizontal())
    .attr('stroke', (d) => d.source.color || '#94a3b8')
    .attr('stroke-opacity', 0.35)
    .attr('stroke-width', (d) => Math.max(1, d.width))
    .attr('fill', 'none')
    .style('cursor', 'pointer')
    .append('title')
    .text((d) => `${d.source.name || 'Budget'} → ${d.target.name || 'Budget'} : ${formatValue ? formatValue(d.value) : d.value}`);

  svg.selectAll('path.sankey-link-hit')
    .data(graph.links)
    .join('path')
    .attr('class', 'sankey-link-hit')
    .attr('d', d3.sankeyLinkHorizontal())
    .attr('stroke', 'transparent')
    .attr('stroke-width', (d) => Math.max(8, d.width))
    .attr('fill', 'none')
    .style('cursor', onNodeClick ? 'pointer' : 'default')
    .on('click', (event, d) => {
      if (onNodeClick && d.ref) onNodeClick(d.ref);
    });

  const nodeGroup = svg.append('g').attr('class', 'sankey-nodes')
    .selectAll('g')
    .data(graph.nodes)
    .join('g')
    .attr('transform', (d) => `translate(${d.x0},${d.y0})`)
    .style('cursor', (d) => (onNodeClick && d.id !== '__center__' ? 'pointer' : 'default'))
    .on('click', (event, d) => {
      if (!onNodeClick || d.id === '__center__') return;
      const [side, id] = d.id.split(':');
      const isRevenue = side.startsWith('rev');
      const isSub = side.endsWith('sub');
      onNodeClick(isSub
        ? { side: isRevenue ? 'REVENUE' : 'EXPENSE', subcategoryId: id }
        : { side: isRevenue ? 'REVENUE' : 'EXPENSE', categoryId: id });
    });

  nodeGroup.append('rect')
    .attr('width', (d) => d.x1 - d.x0)
    .attr('height', (d) => Math.max(1, d.y1 - d.y0))
    .attr('fill', (d) => d.color || '#94a3b8')
    .attr('rx', 4);

  nodeGroup.filter((d) => d.id !== '__center__').append('text')
    .attr('x', (d) => (d.x0 < width / 2 ? d.x1 - d.x0 + 8 : -8))
    .attr('y', (d) => (d.y1 - d.y0) / 2)
    .attr('dy', '0.35em')
    .attr('text-anchor', (d) => (d.x0 < width / 2 ? 'start' : 'end'))
    .attr('class', 'sankey-label')
    .text((d) => `${d.name} (${formatValue ? formatValue(d.value) : d.value})`);
}

export { renderSankey };

