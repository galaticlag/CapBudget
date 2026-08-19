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

  const rawWidth = container.clientWidth || 720;

  // Size the canvas to the data instead of a fixed CSS height + scrollbar: count
  // the tallest column's rows up front so every row keeps a constant, comfortable
  // padding and the "Flux du foyer" panel grows to fit instead of clipping/scrolling.
  const MAX_PADDING = 18;
  // Long subcategory names truncate to a single line with an ellipsis (see
  // wrapText below) rather than wrapping, so rows can sit at a tight, uniform
  // pitch even with many rows — a slightly bigger gap than compact mode just
  // keeps single-line labels from crowding their neighbor above/below.
  const DETAIL_PADDING = 20;
  const ROW_HEIGHT = 6;
  // Slack above/below the plotted rows so a label near the top/bottom edge never
  // gets clipped by the SVG's own height.
  const EXTRA_MARGIN = 24;
  const hasSubcategoryDetail = revenue.some((c) => (c.subcategories || []).some((s) => s.amountCents > 0))
    || expense.some((c) => (c.subcategories || []).some((s) => s.amountCents > 0));
  // Categories and their subcategories render in two SEPARATE columns (e.g. "expcat"
  // vs "expsub"), never stacked together in one — so the canvas height only needs to
  // fit whichever single column has the most rows, not categories+subcategories summed
  // (that previously sized the canvas for a column ~2x taller than any real one,
  // leaving a large empty gap above/below the actual diagram).
  const countPositive = (c) => (c.amountCents > 0 ? 1 : 0);
  const revCatCount = revenue.reduce((sum, c) => sum + countPositive(c), 0);
  const revSubCount = revenue.reduce((sum, c) => sum + (c.subcategories || []).filter((s) => s.amountCents > 0).length, 0);
  const expCatCount = expense.reduce((sum, c) => sum + countPositive(c), 0);
  const expSubCount = expense.reduce((sum, c) => sum + (c.subcategories || []).filter((s) => s.amountCents > 0).length, 0);
  const maxNodesInColumn = Math.max(1, revCatCount, revSubCount, expCatCount, expSubCount);
  const nodePadding = hasSubcategoryDetail ? DETAIL_PADDING : MAX_PADDING;
  // May grow further below if a low-value category has more subcategories than
  // its value-proportional share of the column can comfortably fit.
  let height = Math.max(220, maxNodesInColumn * ROW_HEIGHT + Math.max(0, maxNodesInColumn - 1) * nodePadding + EXTRA_MARGIN);

  const nodes = [];
  const links = [];
  const nodeIndex = new Map();
  const parentChildren = new Map(); // catIdx -> [subIdx, ...]

  function addNode(id, name, color) {
    if (nodeIndex.has(id)) return nodeIndex.get(id);
    const idx = nodes.length;
    nodes.push({ id, name, color });
    nodeIndex.set(id, idx);
    return idx;
  }

  const centerIdx = addNode('__center__', '', '#94a3b8');

  // Categories without an explicit `color` in the DB all used to fall back to the
  // same single default (green for revenue, red for expense) — with many
  // uncolored categories on one side, that side looked flatly monochrome. Instead,
  // spread auto-assigned categories evenly around the hue wheel (golden-angle step
  // avoids adjacent categories landing on similar hues), while still respecting an
  // explicit color from the DB when the household configured one.
  const GOLDEN_ANGLE = 137.508;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  function hexToHsl(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    if (!m) return null;
    const r = parseInt(m[1], 16) / 255, g = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0;
    const l = (max + min) / 2;
    const d = max - min;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    if (d !== 0) {
      switch (max) {
        case r: h = ((g - b) / d) % 6; break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4;
      }
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h, s: s * 100, l: l * 100 };
  }

  function hslToCss({ h, s, l }) {
    return `hsl(${h.toFixed(1)}, ${clamp(s, 0, 100).toFixed(0)}%, ${clamp(l, 0, 100).toFixed(0)}%)`;
  }

  function autoHsl(index) {
    return { h: (index * GOLDEN_ANGLE) % 360, s: 65, l: 50 };
  }

  function resolveCategoryHsl(explicitColor, autoIndex) {
    return hexToHsl(explicitColor) || autoHsl(autoIndex);
  }

  // Subcategories reuse their category's hue but alternate lighter/darker so they
  // read as "a family of the same category" rather than identical or unrelated colors.
  function subcategoryHsl(baseHsl, subPosition) {
    const magnitude = 12 + Math.floor(subPosition / 2) * 9;
    const delta = subPosition % 2 === 0 ? magnitude : -magnitude;
    return { h: baseHsl.h, s: clamp(baseHsl.s - 8, 30, 100), l: clamp(baseHsl.l + delta, 18, 82) };
  }

  // Real amounts in a household can span 1-2 orders of magnitude (e.g. a 30€
  // category next to a 7 600€ one). Laying out node/link heights linearly
  // proportional to those amounts crushes every small category down to an
  // unreadable/unclickable 1px sliver. A sqrt scale keeps big flows visibly
  // bigger while giving small ones enough height to be seen and tapped; the
  // real amount is unaffected and still shown in every label/tooltip.
  function scaleValue(v) {
    return Math.sqrt(Math.max(0, v));
  }

  function pushLink(source, target, rawValue, ref) {
    links.push({ source, target, value: scaleValue(rawValue), raw: rawValue, ref });
  }

  // Alphabetical order (category, then subcategory within it) keeps each category's
  // family of colors in one visually contiguous band and minimizes link crossings —
  // without it, node stacking order was effectively arbitrary and produced links
  // that crisscrossed and made unrelated categories' colors look mixed together.
  const sortByName = (a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
  const sortedRevenue = [...revenue].sort(sortByName);
  const sortedExpense = [...expense].sort(sortByName);

  let revenueColorIndex = 0;
  for (const cat of sortedRevenue) {
    if (cat.amountCents <= 0) continue;
    const catHsl = resolveCategoryHsl(cat.color, revenueColorIndex++);
    // BALANCED mode's promoted pseudo-categories (see promoteSubcategories in dashboard.js)
    // share one real categoryId across every sibling subcategory of that category — the id
    // must include subcategoryId too, or every sibling collapses into the same node.
    const catId = cat.subcategoryId ? `revcat:${cat.categoryId}:${cat.subcategoryId}` : `revcat:${cat.categoryId}`;
    const catIdx = addNode(catId, cat.name, hslToCss(catHsl));
    nodes[catIdx].raw = cat.amountCents;
    const subs = (cat.subcategories || []).filter((s) => s.amountCents > 0).sort(sortByName);
    if (subs.length === 0) {
      // BALANCED mode promotes each revenue subcategory to a standalone pseudo-category
      // (see promoteSubcategories in dashboard.js) — carries its own subcategoryId through
      // even though it has no nested subcategories of its own, so clicking it still
      // filters the transaction list at subcategory granularity.
      pushLink(catIdx, centerIdx, cat.amountCents, {
        side: 'REVENUE',
        categoryId: cat.categoryId,
        ...(cat.subcategoryId ? { subcategoryId: cat.subcategoryId } : {})
      });
    } else {
      pushLink(catIdx, centerIdx, cat.amountCents, { side: 'REVENUE', categoryId: cat.categoryId });
      subs.forEach((sub, subPosition) => {
        const subColor = hslToCss(sub.color ? hexToHsl(sub.color) : subcategoryHsl(catHsl, subPosition));
        const subIdx = addNode(`revsub:${sub.subcategoryId}`, sub.name, subColor);
        nodes[subIdx].raw = sub.amountCents;
        pushLink(subIdx, catIdx, sub.amountCents, { side: 'REVENUE', categoryId: cat.categoryId, subcategoryId: sub.subcategoryId });
        if (!parentChildren.has(catIdx)) parentChildren.set(catIdx, []);
        parentChildren.get(catIdx).push(subIdx);
      });
    }
  }
  let expenseColorIndex = 0;
  for (const cat of sortedExpense) {
    if (cat.amountCents <= 0) continue;
    const catHsl = resolveCategoryHsl(cat.color, expenseColorIndex++);
    const catIdx = addNode(`expcat:${cat.categoryId}`, cat.name, hslToCss(catHsl));
    nodes[catIdx].raw = cat.amountCents;
    const subs = (cat.subcategories || []).filter((s) => s.amountCents > 0).sort(sortByName);
    if (subs.length === 0) {
      pushLink(centerIdx, catIdx, cat.amountCents, { side: 'EXPENSE', categoryId: cat.categoryId });
    } else {
      pushLink(centerIdx, catIdx, cat.amountCents, { side: 'EXPENSE', categoryId: cat.categoryId });
      subs.forEach((sub, subPosition) => {
        const subColor = hslToCss(sub.color ? hexToHsl(sub.color) : subcategoryHsl(catHsl, subPosition));
        const subIdx = addNode(`expsub:${sub.subcategoryId}`, sub.name, subColor);
        nodes[subIdx].raw = sub.amountCents;
        pushLink(catIdx, subIdx, sub.amountCents, { side: 'EXPENSE', categoryId: cat.categoryId, subcategoryId: sub.subcategoryId });
        if (!parentChildren.has(catIdx)) parentChildren.set(catIdx, []);
        parentChildren.get(catIdx).push(subIdx);
      });
    }
  }

  if (links.length === 0) {
    container.innerHTML = '<p class="empty-state">Aucune transaction sur cette période.</p>';
    return;
  }

  // Without subcategory detail there are only 3 depths (revenue cat -> center ->
  // expense cat): a true 2-column read (revenue left, expense right). It fits at
  // the container's real width, no need for the wider mobile floor that the full
  // 5-column detail view requires for breathing room.
  const compactMode = !hasSubcategoryDetail;
  const width = compactMode
    ? Math.max(rawWidth, 360)
    : (rawWidth < 640 ? 640 : Math.max(rawWidth, 360));
  // Shared top inset for the layout extent AND the category re-stack anchor below —
  // d3-sankey vertically CENTERS a column that has fewer/smaller rows than the
  // tallest column in the diagram (e.g. 12 expense categories vs. 32 expense
  // subcategories sharing the same extent height), which left a large empty gap
  // above the shorter columns. Anchoring the re-stack to this fixed inset instead of
  // that column's own (centered) starting position removes the gap.
  const TOP_INSET = 16;

  // Keep a constant visual separation between rows by tuning the node padding
  // to the available height and the maximum node count in any column.
  const byDepth = new Map();
  for (const l of links) {
    byDepth.set(l.source, (byDepth.get(l.source) || 0) + 1);
    byDepth.set(l.target, (byDepth.get(l.target) || 0) + 1);
  }

  // Fixed left-to-right role order; a role only claims a column if at least one
  // node of that role actually exists (e.g. no "revsub" column when no revenue
  // category has subcategory detail), keeping columns contiguous either way.
  const roleOf = (id) => (id === '__center__' ? 'center' : id.split(':')[0]);
  // REVENUE for rev*/revcat/revsub node ids, EXPENSE for exp*, null for the center node.
  const nodeSide = (id) => {
    const role = roleOf(id);
    if (role === 'center') return null;
    return role.startsWith('rev') ? 'REVENUE' : 'EXPENSE';
  };
  const presentRoles = new Set(nodes.map((n) => roleOf(n.id)));
  const roleDepth = new Map(
    ['revsub', 'revcat', 'center', 'expcat', 'expsub']
      .filter((role) => presentRoles.has(role))
      .map((role, i) => [role, i])
  );

  const sankeyLayout = d3.sankey()
    .nodeId((d) => d.index)
    .nodeWidth(16)
    .nodePadding(nodePadding)
    // Keep our alphabetical build order instead of letting d3-sankey re-sort nodes
    // by its own heuristic, which is what was scrambling the vertical stacking.
    .nodeSort(null)
    // d3-sankey's default alignment ("justify") pushes any node with no OUTGOING
    // link to the last column — an expense category with no subcategories (e.g.
    // an uncategorized "Non affectée" bucket) has none, so it got shoved into the
    // subcategory column and overlapped real subcategory nodes. Pin every node's
    // column explicitly by role instead of letting graph topology decide it; only
    // roles that actually have nodes get a column, so this stays correct whether
    // only one side (or neither) has subcategory detail.
    .nodeAlign((d) => roleDepth.get(roleOf(d.id)))
    .extent([[8, TOP_INSET], [width - 8, height - 16]]);

  const graph = sankeyLayout({
    nodes: nodes.map((n, i) => ({ ...n, index: i })),
    links: links.map((l) => ({ ...l }))
  });

  // A category's row is sized proportionally to its own value, but a category with
  // MANY subcategories and a small total value (e.g. a bunch of tiny one-off
  // charges) can get a row too short to hold all of them at a readable height —
  // shrinking the child gap (below) only prevents overflow into the next sibling,
  // it can't make room that isn't there. Grow the row itself first, cascading the
  // extra room onto every following category in the same column (their relative
  // order/gaps are otherwise untouched); the diagram's overall height is grown to
  // match further down if this pushes the column past its original extent.
  for (const role of ['revcat', 'expcat']) {
    const catNodes = graph.nodes.filter((n) => roleOf(n.id) === role).sort((a, b) => a.y0 - b.y0);
    if (catNodes.length === 0) continue;
    let y = TOP_INSET;
    for (const cat of catNodes) {
      const childCount = (parentChildren.get(cat.index) || []).length;
      const naturalHeight = cat.y1 - cat.y0;
      const minHeight = childCount > 0
        ? childCount * ROW_HEIGHT + Math.max(0, childCount - 1) * nodePadding
        : naturalHeight;
      const desiredHeight = Math.max(naturalHeight, minHeight);
      cat.y0 = y;
      cat.y1 = y + desiredHeight;
      y = cat.y1 + nodePadding;
    }
  }

  // Every category also has exactly one direct link to/from the center node (the
  // aggregate flow), computed by d3-sankey against the category's OLD position —
  // stale now for any category that the restack above grew OR simply pushed down
  // via cascade from an earlier sibling growing. Left unfixed, that ribbon stays
  // anchored to where the category USED to be, visually detaching mid-flow from
  // its own (now-moved) node — this is what breaks the center/branches look.
  for (const link of graph.links) {
    if (link.target.index === centerIdx && roleOf(link.source.id) === 'revcat') {
      link.y0 = (link.source.y0 + link.source.y1) / 2;
    } else if (link.source.index === centerIdx && roleOf(link.target.id) === 'expcat') {
      link.y1 = (link.target.y0 + link.target.y1) / 2;
    }
  }

  // The center node's own height is purely proportional to total flow value, which
  // is computed independently of the category columns — once those grow to fit
  // subcategory labels (above) they can end up spanning far more vertical space
  // than center, leaving center a short bar stranded in the middle while every
  // ribbon to a top or bottom category swings at an extreme diagonal past it (the
  // "milieu cassé" look). Stretch center to the full vertical extent actually
  // covered by the category columns, then re-stack its incident links (still in
  // their existing, already non-crossing order) proportionally across that span,
  // so its own side reaches as far up/down as the categories it connects to.
  const allCatNodes = graph.nodes.filter((n) => roleOf(n.id) === 'revcat' || roleOf(n.id) === 'expcat');
  if (allCatNodes.length > 0) {
    const centerNode = graph.nodes[centerIdx];
    centerNode.y0 = Math.min(...allCatNodes.map((n) => n.y0));
    centerNode.y1 = Math.max(...allCatNodes.map((n) => n.y1));
    const span = centerNode.y1 - centerNode.y0;

    const restackOnCenter = (incidentLinks, getCenterY, setCenterY) => {
      if (incidentLinks.length === 0) return;
      const sorted = [...incidentLinks].sort((a, b) => getCenterY(a) - getCenterY(b));
      const totalValue = sorted.reduce((sum, l) => sum + (l.value || 0), 0) || 1;
      let y = centerNode.y0;
      for (const link of sorted) {
        const h = (link.value || 0) / totalValue * span;
        setCenterY(link, y + h / 2);
        y += h;
      }
    };

    restackOnCenter(
      graph.links.filter((l) => l.target.index === centerIdx),
      (l) => l.y1,
      (l, y) => { l.y1 = y; }
    );
    restackOnCenter(
      graph.links.filter((l) => l.source.index === centerIdx),
      (l) => l.y0,
      (l, y) => { l.y0 = y; }
    );
  }

  // Nest each category's subcategory children inside the category's own (natural,
  // d3-sankey-computed) vertical span, instead of leaving them at their position in
  // the shared subcategory column. That column holds every category's children
  // together, so it's scaled differently (more nodes packed into the same height)
  // than the category column — a category previously stretched to match its raw
  // children bounds could drift past a sibling that kept its own natural position
  // (e.g. an uncategorized "Non affectée" leaf right next to a tall category). The
  // category's own row is already non-overlapping and proportional to its total
  // value (== the sum of its children), so keep it as-is and fit the children inside.
  for (const [catIdx, subIdxs] of parentChildren) {
    const catNode = graph.nodes[catIdx];
    const children = subIdxs.map((i) => graph.nodes[i]);
    const totalValue = children.reduce((sum, c) => sum + (c.value || 0), 0) || 1;
    const span = catNode.y1 - catNode.y0;
    const minChildHeight = ROW_HEIGHT;
    // A category with many (often tiny-value) subcategories can need more room than
    // its own value-proportional span provides — if we kept a fixed nodePadding gap
    // between every child regardless, the stack would overflow past the category's
    // own bottom edge into the next sibling's slot. Shrink the gap (never grow it)
    // so the full stack always fits inside the parent, trading gap size for safety.
    const gapCount = Math.max(0, children.length - 1);
    const maxGap = gapCount > 0 ? (span - children.length * minChildHeight) / gapCount : nodePadding;
    const gap = Math.min(nodePadding, Math.max(0, maxGap));
    const available = Math.max(0, span - gapCount * gap);
    const scale = available / totalValue;
    let y = catNode.y0;
    for (const child of children) {
      const h = Math.max(minChildHeight, (child.value || 0) * scale);
      child.y0 = y;
      child.y1 = y + h;
      y += h + gap;
    }

    // d3-sankey computed this link's attach offset (y0/y1) from the child's OLD,
    // shared-column position — stale now that the child moved, so re-anchor it
    // flat against the child's new attach point (category's own position is
    // untouched, so its own link offsets, e.g. to/from the center node, stay valid).
    const subIdxSet = new Set(subIdxs);
    for (const link of graph.links) {
      if (link.source.index === catIdx && subIdxSet.has(link.target.index)) {
        link.y1 = (link.target.y0 + link.target.y1) / 2;
        link.y0 = link.y1;
      } else if (link.target.index === catIdx && subIdxSet.has(link.source.index)) {
        link.y0 = (link.source.y0 + link.source.y1) / 2;
        link.y1 = link.y0;
      }
    }
  }

  // Growing an undersized category's row above can push it (and every following
  // sibling in its column) past the canvas height the layout was originally sized
  // for — grow the canvas to fit rather than clipping the pushed-down rows.
  const contentBottom = Math.max(height - 16, ...graph.nodes.map((n) => n.y1));
  if (contentBottom > height - 16) {
    height = contentBottom + 16;
  }

  // In compact mode the center node is just a connector, not a real category: shrink
  // it to a thin spine so the diagram reads as revenue (left) / expense (right).
  if (compactMode) {
    const centerNode = graph.nodes[centerIdx];
    const midX = (centerNode.x0 + centerNode.x1) / 2;
    centerNode.x0 = midX - 3;
    centerNode.x1 = midX + 3;
  }

  const svg = d3.select(container).append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`);

  // Soft drop-shadow so each node reads as a small "glass" bar floating above the
  // links rather than a flat rectangle — a light, low-spread shadow keeps it
  // subtle at every zoom level instead of a heavy/cartoonish glow.
  svg.append('defs').append('filter')
    .attr('id', 'sankeyNodeShadow')
    .attr('x', '-60%').attr('y', '-60%').attr('width', '220%').attr('height', '220%')
    .append('feDropShadow')
    .attr('dx', 0).attr('dy', 1.5).attr('stdDeviation', 2.5)
    .attr('flood-color', 'rgba(15, 23, 42, 0.35)');

  const linkPaths = svg.append('g').attr('class', 'sankey-links')
    .selectAll('path')
    .data(graph.links)
    .join('path')
    .attr('class', 'sankey-link')
    .attr('d', d3.sankeyLinkHorizontal())
    // Color the flow by whichever endpoint is an actual category, not the neutral
    // center node — otherwise every link leaving the center (the whole expense side
    // when compact) rendered in the center's gray instead of the category's color.
    .attr('stroke', (d) => (d.source.id === '__center__' ? d.target.color : d.source.color) || '#94a3b8')
    .attr('stroke-opacity', 0.45)
    .attr('stroke-width', (d) => Math.max(2, d.width))
    .attr('stroke-linecap', 'round')
    .attr('fill', 'none')
    .style('cursor', 'pointer');

  linkPaths.append('title')
    .text((d) => `${d.source.name || 'Budget'} → ${d.target.name || 'Budget'} : ${formatValue ? formatValue(d.raw, d.ref?.side) : d.raw}`);

  // A ribbon is often only a few px thin — the real <path> is too thin a hit target
  // to hover/click reliably, so a wider transparent twin (never painted) captures
  // pointer events instead and highlights/forwards clicks to the real, visible link.
  svg.selectAll('path.sankey-link-hit')
    .data(graph.links)
    .join('path')
    .attr('class', 'sankey-link-hit')
    .attr('d', d3.sankeyLinkHorizontal())
    .attr('stroke', 'transparent')
    .attr('stroke-width', (d) => Math.max(8, d.width))
    .attr('fill', 'none')
    .style('cursor', onNodeClick ? 'pointer' : 'default')
    .on('mouseenter', (event, d) => {
      const i = graph.links.indexOf(d);
      linkPaths.nodes()[i]?.classList.add('sankey-link-active');
    })
    .on('mouseleave', (event, d) => {
      const i = graph.links.indexOf(d);
      linkPaths.nodes()[i]?.classList.remove('sankey-link-active');
    })
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
    .attr('class', 'sankey-node-rect')
    .attr('width', (d) => d.x1 - d.x0)
    .attr('height', (d) => Math.max(3, d.y1 - d.y0))
    .attr('fill', (d) => d.color || '#94a3b8')
    .attr('stroke', 'rgba(255, 255, 255, 0.45)')
    .attr('stroke-width', 1)
    .attr('rx', 5)
    .style('filter', 'url(#sankeyNodeShadow)');

  // Categories now keep their own right-sized row (grown to fit children if
  // needed, see the restack pass above) instead of being stretched arbitrarily to
  // match a children span computed elsewhere — so, like every other node, the
  // label centers vertically in the row instead of needing a special top pin.
  const labels = nodeGroup.filter((d) => d.id !== '__center__').append('text')
    .attr('x', (d) => (d.x0 < width / 2 ? d.x1 - d.x0 + 8 : -8))
    .attr('y', (d) => (d.y1 - d.y0) / 2)
    .attr('dy', '0.35em')
    .attr('text-anchor', (d) => (d.x0 < width / 2 ? 'start' : 'end'))
    .attr('class', 'sankey-label')
    .each(function (d) {
      d3.select(this).append('title').text(`${d.name} (${formatValue ? formatValue(d.raw, nodeSide(d.id)) : d.raw})`);
    });

  // Wrap width per label = the real gap to the next column in the direction the
  // label grows, not a flat fraction of the total width — a flat share works for 2
  // columns but a packed 5-column detail view leaves each side far less room, so a
  // long category name would otherwise run straight into the next column's own text.
  const columnXs = Array.from(new Set(graph.nodes.map((n) => Math.round(n.x0)))).sort((a, b) => a - b);
  function labelMaxWidth(d) {
    const growsRight = d.x0 < width / 2;
    const colIdx = columnXs.indexOf(Math.round(d.x0));
    const neighborX = growsRight ? columnXs[colIdx + 1] : columnXs[colIdx - 1];
    const gap = neighborX === undefined
      ? (growsRight ? width - d.x1 : d.x0)
      : (growsRight ? neighborX - d.x1 : d.x0 - neighborX);
    return clamp(gap - 20, 70, 260);
  }

  // The amount is the part users actually need to always be able to read, so it
  // must never be the thing that gets cut — only the category/subcategory name
  // is truncated (with an ellipsis) to make room for it within the label's
  // available width. Full "name (amount)" stays in the <title> tooltip above.
  labels.each(function (d) {
    const text = d3.select(this);
    const maxWidth = labelMaxWidth(d);
    const amountText = ` (${formatValue ? formatValue(d.raw, nodeSide(d.id)) : d.raw})`;
    const x = text.attr('x');
    const y = text.attr('y');

    const probe = text.append('tspan').text('');
    const measure = (str) => {
      probe.text(str);
      return probe.node() ? probe.node().getComputedTextLength() : 0;
    };

    const amountWidth = measure(amountText);
    const nameMaxWidth = Math.max(0, maxWidth - amountWidth);

    let name = d.name || '';
    if (measure(name) > nameMaxWidth) {
      let candidate = name;
      while (candidate.length > 1 && measure(`${candidate}\u2026`) > nameMaxWidth) {
        candidate = candidate.slice(0, -1).trimEnd();
      }
      name = candidate.length > 1 ? `${candidate}\u2026` : candidate;
    }
    probe.remove();

    text.append('tspan').attr('x', x).attr('y', y).text(name);
    text.append('tspan').text(amountText);
  });
}

export { renderSankey };

