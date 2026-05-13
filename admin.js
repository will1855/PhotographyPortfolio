'use strict';
// ─── State ────────────────────────────────────────────────────────────────────
let sections      = [];   // all sections from DB
let imagesBySection = {}; // { slug: [imageObj, …] }
let activeSection = null; // slug of currently viewed section tab
let activePanel   = 'images';
let sortableInstance = null;
let orderChanged  = false;
let selectedHero  = {};   // { slug: [imageId1, imageId2, …] }
let siteConfig    = {};
let aboutProfileImageId = null;
let allImages     = [];   // flat list of all images (for about picker)

// ─── DOM refs ──────────────────────────────────────────────────────────────────
const loginPage      = document.getElementById('login-page');
const adminPage      = document.getElementById('admin-page');
const loginForm      = document.getElementById('login-form');
const loginError     = document.getElementById('login-error');
const loginBtn       = document.getElementById('login-btn');
const logoutBtn      = document.getElementById('logout-btn');
const adminSiteTitle = document.getElementById('admin-site-title');
const imageTabs      = document.getElementById('image-tabs');
const imageGrid      = document.getElementById('image-grid');
const uploadZone     = document.getElementById('upload-zone');
const fileInput      = document.getElementById('file-input');
const uploadProgress = document.getElementById('upload-progress');
const uploadProgressText = document.getElementById('upload-progress-text');
const saveOrderBtn   = document.getElementById('save-order-btn');
const toastContainer = document.getElementById('toast-container');

// ─── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

// ─── Panel navigation ──────────────────────────────────────────────────────────
document.getElementById('admin-sidebar').addEventListener('click', e => {
  const btn = e.target.closest('[data-panel]');
  if (!btn) return;
  showPanel(btn.dataset.panel);
});

function showPanel(name) {
  activePanel = name;
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
  document.getElementById(`panel-${name}`)?.classList.add('active');
  document.querySelector(`[data-panel="${name}"]`)?.classList.add('active');

  if (name === 'hero')     renderHeroPanel();
  if (name === 'about')    renderAboutPanel();
  if (name === 'settings') renderSettingsPanel();
  if (name === 'sections') renderSectionsPanel();
}

// ─── Auth ──────────────────────────────────────────────────────────────────────
async function checkSession() {
  try {
    const res = await fetch('/api/admin/session', { credentials: 'include' });
    if (res.ok) showDashboard();
    else        showLogin();
  } catch {
    showLogin();
  }
}

function showLogin() {
  loginPage.style.display = 'flex';
  adminPage.classList.remove('visible');
}

function showDashboard() {
  loginPage.style.display = 'none';
  adminPage.classList.add('visible');
  loadDashboard();
}

loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  loginError.style.display = 'none';
  loginBtn.disabled = true;
  loginBtn.textContent = 'Signing in…';

  const password = document.getElementById('admin-password').value;
  try {
    const res  = await fetch('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
      credentials: 'include',
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      showDashboard();
    } else {
      loginError.textContent = data.error || 'Incorrect password';
      loginError.style.display = 'block';
    }
  } catch {
    loginError.textContent = 'Connection error. Try again.';
    loginError.style.display = 'block';
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign in';
  }
});

logoutBtn.addEventListener('click', async () => {
  await fetch('/admin/logout', { method: 'POST', credentials: 'include' });
  showLogin();
});

// ─── Load dashboard ─────────────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const [configRes, sectionsRes] = await Promise.all([
      fetch('/api/site-config'),
      fetch('/api/admin/sections', { credentials: 'include' }),
    ]);
    siteConfig = await configRes.json();
    sections   = await sectionsRes.json();

    adminSiteTitle.textContent = siteConfig.site_title || 'Portfolio';
    document.title = `Admin — ${siteConfig.site_title || 'Portfolio'}`;

    // Pre-populate selectedHero from siteConfig sections
    for (const s of (siteConfig.sections || [])) {
      selectedHero[s.slug] = (s.heroes || []).map(h => h.id);
    }

    buildImageTabs();
    if (sections.length > 0) {
      activeSection = sections[0].slug;
      loadSectionImages(activeSection);
    }
  } catch (err) {
    toast('Failed to load dashboard', 'error');
    console.error(err);
  }
}

// ─── Image tabs ─────────────────────────────────────────────────────────────────
function buildImageTabs() {
  imageTabs.innerHTML = '';
  for (const s of sections) {
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (s.slug === activeSection ? ' active' : '');
    btn.textContent = s.nav_label || s.label;
    btn.dataset.slug = s.slug;
    btn.addEventListener('click', () => switchTab(s.slug));
    imageTabs.appendChild(btn);
  }
}

function switchTab(slug) {
  activeSection = slug;
  orderChanged = false;
  saveOrderBtn.style.display = 'none';
  document.querySelectorAll('#image-tabs .tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.slug === slug);
  });
  if (imagesBySection[slug]) {
    renderImageGrid(imagesBySection[slug]);
  } else {
    loadSectionImages(slug);
  }
}

async function loadSectionImages(slug) {
  imageGrid.innerHTML = '<p class="text-muted" style="padding:20px 0">Loading…</p>';
  try {
    const res  = await fetch(`/api/admin/images?section=${slug}`, { credentials: 'include' });
    const data = await res.json();
    imagesBySection[slug] = data;
    renderImageGrid(data);
  } catch {
    imageGrid.innerHTML = '<p class="text-error" style="padding:20px 0">Failed to load images</p>';
  }
}

const ROW_UNIT = 10;

function getNumCols() {
  const w = window.innerWidth;
  if (w > 1000) return 4;
  if (w > 700)  return 3;
  return 2;
}

function layoutAdminGallery() {
  const numCols = getNumCols();
  const colWidth = imageGrid.offsetWidth / numCols;
  
  const logHeights = new Array(numCols).fill(0);
  const logGaps = []; 
  
  const pxHeights = new Array(numCols).fill(0);
  const pxGaps = []; 
  
  const lastItemInCol = new Array(numCols).fill(null);

  imageGrid.style.gridTemplateColumns = `repeat(${numCols}, 1fr)`;

  const cards = imageGrid.querySelectorAll('.image-card:not(.sortable-drag)');
  cards.forEach((card) => {
    const thumb = card.querySelector('.image-thumb');
    if (thumb) thumb.classList.remove('fill-gap');
    
    const id = card.dataset.id;
    const section = imagesBySection[activeSection] || [];
    const imgData = section.find(i => i.id === id);
    if (!imgData) return;

    const isWide = imgData.is_wide && numCols >= 3;
    const isFilled = imgData.is_filled;
    const spanCols = isWide ? 2 : 1;
    const aspect = (imgData.width && imgData.height) ? (imgData.height / imgData.width) : (2 / 3);
    
    const logH = spanCols * aspect;
    const pxH = Math.max(1, Math.round((colWidth * spanCols * aspect) / ROW_UNIT));

    if (isWide) {
      let bestLog = Infinity;
      let colStart = 0;
      for (let c = 0; c < numCols - 1; c++) {
        const h = Math.max(logHeights[c], logHeights[c + 1]);
        if (h < bestLog) { bestLog = h; colStart = c; }
      }
      
      const pxStart = Math.max(pxHeights[colStart], pxHeights[colStart + 1]);
      
      // Check for stretchable items above
      for (let c of [colStart, colStart + 1]) {
        console.log(`[isWide] Checking col ${c} for stretch above wide image. logHeight=${logHeights[c]}, bestLog=${bestLog}`);
        if (logHeights[c] < bestLog - 0.01) {
          const last = lastItemInCol[c];
          let stretched = false;
          console.log(`[isWide] Gap found in col ${c}. last item:`, last ? last.el.dataset.id : 'none', 'is_filled:', last ? last.is_filled : false);
          if (last && last.is_filled) {
            if (last.spanCols === 1) {
              stretched = true;
            } else if (last.spanCols === 2) {
              const other = (last.col === c) ? c + 1 : c - 1;
              if (lastItemInCol[other] === last) {
                stretched = true;
                logHeights[other] = bestLog;
                pxHeights[other] = pxStart;
              }
            }
          }
          if (stretched) {
            console.log(`[isWide] STRETCHING item ${last.el.dataset.id} from ${last.pxStart} to ${pxStart}`);
            last.el.style.gridRow = `${last.pxStart + 1} / span ${pxStart - last.pxStart}`;
            const t = last.el.querySelector('.image-thumb');
            if (t) t.classList.add('fill-gap');
            logHeights[c] = bestLog;
            pxHeights[c] = pxStart;
          }
        }
      }
      
      if (logHeights[colStart] < bestLog - 0.01) {
        logGaps.push({ col: colStart, start: logHeights[colStart], end: bestLog });
        pxGaps.push({ col: colStart, start: pxHeights[colStart], end: pxStart });
      }
      if (logHeights[colStart + 1] < bestLog - 0.01) {
        logGaps.push({ col: colStart + 1, start: logHeights[colStart + 1], end: bestLog });
        pxGaps.push({ col: colStart + 1, start: pxHeights[colStart + 1], end: pxStart });
      }

      card.style.gridColumn = `${colStart + 1} / span 2`;
      card.style.gridRow    = `${pxStart + 1} / span ${pxH}`;
      
      logHeights[colStart] = bestLog + logH;
      logHeights[colStart + 1] = bestLog + logH;
      pxHeights[colStart] = pxStart + pxH;
      pxHeights[colStart + 1] = pxStart + pxH;
      
      const itemRecord = { el: card, pxStart, spanCols, is_filled: isFilled, col: colStart };
      lastItemInCol[colStart] = itemRecord;
      lastItemInCol[colStart + 1] = itemRecord;
      
    } else {
      let placedInGap = false;
      const sortedGapIndices = logGaps.map((_, idx) => idx).sort((a, b) => logGaps[a].start - logGaps[b].start);
      
      for (let idx of sortedGapIndices) {
        const logGap = logGaps[idx];
        const pxGap = pxGaps[idx];
        
        if (logH <= (logGap.end - logGap.start) + 0.01) {
          card.style.gridColumn = `${logGap.col + 1}`;
          
          if (isFilled) {
            const remainingPx = pxGap.end - pxGap.start;
            card.style.gridRow = `${pxGap.start + 1} / span ${remainingPx}`;
            const t = card.querySelector('.image-thumb');
            if (t) t.classList.add('fill-gap');
            logGap.start = logGap.end;
            pxGap.start = pxGap.end;
          } else {
            card.style.gridRow = `${pxGap.start + 1} / span ${pxH}`;
            logGap.start += logH;
            pxGap.start += pxH;
          }
          
          placedInGap = true;
          
          if (logGap.start >= logGap.end - 0.01) {
            logGaps.splice(idx, 1);
            pxGaps.splice(idx, 1);
          }
          break;
        }
      }

      if (!placedInGap) {
        const minLog = Math.min(...logHeights);
        const colStart = logHeights.indexOf(minLog);
        const pxStart = pxHeights[colStart];
        
        card.style.gridColumn = `${colStart + 1}`;
        card.style.gridRow    = `${pxStart + 1} / span ${pxH}`;
        
        logHeights[colStart] = minLog + logH;
        pxHeights[colStart] = pxStart + pxH;
        
        lastItemInCol[colStart] = { el: card, pxStart, spanCols, is_filled: isFilled, col: colStart };
      }
    }
  });

  // Final pass: stretch filled items at the ragged bottom edge
  const maxPxHeight = Math.max(...pxHeights);
  for (let c = 0; c < numCols; c++) {
    const last = lastItemInCol[c];
    if (last && last.is_filled && pxHeights[c] < maxPxHeight) {
      let canStretch = false;
      if (last.spanCols === 1) canStretch = true;
      else if (last.spanCols === 2) {
        const other = last.col === c ? c + 1 : c - 1;
        if (lastItemInCol[other] === last) canStretch = true;
      }
      if (canStretch) {
        last.el.style.gridRow = `${last.pxStart + 1} / span ${maxPxHeight - last.pxStart}`;
        const t = last.el.querySelector('.image-thumb');
        if (t) t.classList.add('fill-gap');
        pxHeights[c] = maxPxHeight;
        if (last.spanCols === 2) {
          const other = last.col === c ? c + 1 : c - 1;
          pxHeights[other] = maxPxHeight;
        }
      }
    }
  }
}

let _adminLayoutTimer = null;
new ResizeObserver(() => {
  if (activeSection !== 'archive' && activeSection !== 'studies') return;
  clearTimeout(_adminLayoutTimer);
  _adminLayoutTimer = setTimeout(layoutAdminGallery, 120);
}).observe(imageGrid);

// ─── Image grid rendering ───────────────────────────────────────────────────────
function renderImageGrid(images) {
  imageGrid.innerHTML = '';
  orderChanged = false;
  saveOrderBtn.style.display = 'none';

  if (!images || images.length === 0) {
    imageGrid.innerHTML = '<div class="empty-state">No images yet. Upload some above.</div>';
    if (sortableInstance) { sortableInstance.destroy(); sortableInstance = null; }
    return;
  }

  // Find hero for this section from siteConfig
  const sectionConfig = (siteConfig.sections || []).find(s => s.slug === activeSection);

  for (const [index, img] of images.entries()) {
    imageGrid.appendChild(createImageCard(img, sectionConfig, index));
  }

  // Initial layout calculation
  requestAnimationFrame(layoutAdminGallery);

  // Attach SortableJS — forceFallback required for absolute positioning fixes
  if (sortableInstance) sortableInstance.destroy();
  sortableInstance = Sortable.create(imageGrid, {
    animation: 150,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    forceFallback: true,     
    fallbackTolerance: 3,
    onChange() {
      // Recompute masonry layout when DOM order changes during drag
      layoutAdminGallery();
    },
    onEnd() {
      layoutAdminGallery(); // Ensure final snap
      orderChanged = true;
      saveOrderBtn.style.display = 'inline-flex';
      // Refresh position number badges to match new visual order
      imageGrid.querySelectorAll('.image-card:not(.sortable-drag) .image-pos-badge').forEach((badge, i) => {
        badge.textContent = `#${i + 1}`;
      });
    },
  });
}

function createImageCard(img, sectionConfig, index) {
  const isHero = sectionConfig?.hero_image_id === img.id;

  const card = document.createElement('div');
  card.className = 'image-card' + (isHero ? ' hero-selected' : '');
  card.dataset.id = img.id;

  const ar = (img.width && img.height) ? `${img.width}/${img.height}` : '3/2';

  card.innerHTML = `
    ${isHero ? '<span class="image-card-badge">Hero</span>' : ''}
    <span class="drag-handle" title="Drag to reorder">⠿</span>
    <span class="image-pos-badge">#${(index ?? 0) + 1}</span>
    <img class="image-thumb" src="${img.public_url_thumb}" alt="${img.alt_text || ''}" loading="lazy" style="aspect-ratio: ${ar}">
    <div class="rotate-overlay" style="display:none;">
      <div class="spinner"></div>
    </div>
    <div class="image-card-actions">
      <button class="btn btn-secondary btn-sm wide-btn ${img.is_wide ? 'active' : ''}" data-id="${img.id}" title="${img.is_wide ? 'Make normal width' : 'Make 2-column wide'}">↔</button>
      <button class="btn btn-secondary btn-sm fill-btn ${img.is_filled ? 'active' : ''}" data-id="${img.id}" title="${img.is_filled ? 'Remove fill gap' : 'Stretch to fill gap below'}">⛶</button>
      <button class="btn btn-secondary btn-sm rotate-btn" data-id="${img.id}" data-degrees="-90" title="Rotate left">↺</button>
      <button class="btn btn-secondary btn-sm rotate-btn" data-id="${img.id}" data-degrees="90"  title="Rotate right">↻</button>
      <button class="btn btn-danger btn-sm delete-btn" data-id="${img.id}">✕</button>
    </div>
  `;
  return card;
}

// ─── Save order ──────────────────────────────────────────────────────────────────
saveOrderBtn.addEventListener('click', async () => {
  const ids = [...imageGrid.querySelectorAll('.image-card')].map(c => c.dataset.id);
  saveOrderBtn.disabled = true;
  try {
    const res = await fetch('/api/admin/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ section: activeSection, order: ids }),
    });
    if (res.ok) {
      toast('Order saved');
      orderChanged = false;
      saveOrderBtn.style.display = 'none';
      // Update local cache order
      const currentImgs = imagesBySection[activeSection] || [];
      imagesBySection[activeSection] = ids.map(id => currentImgs.find(i => i.id === id)).filter(Boolean);
    } else {
      toast('Failed to save order', 'error');
    }
  } catch {
    toast('Connection error', 'error');
  } finally {
    saveOrderBtn.disabled = false;
  }
});

// ─── Delete image ────────────────────────────────────────────────────────────────
imageGrid.addEventListener('click', async e => {
  // ── Wide toggle ──
  const wideBtn = e.target.closest('.wide-btn');
  if (wideBtn) {
    const id      = wideBtn.dataset.id;
    const section = imagesBySection[activeSection] || [];
    const img     = section.find(i => i.id === id);
    if (!img) return;
    const newWide = !img.is_wide;
    wideBtn.disabled = true;
    try {
      const res  = await fetch(`/api/admin/image/${id}/wide`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ is_wide: newWide }),
      });
      if (res.ok) {
        img.is_wide = newWide;
        wideBtn.classList.toggle('active', newWide);
        wideBtn.title = newWide ? 'Make normal width' : 'Make 2-column wide';
        layoutAdminGallery();
        toast(newWide ? 'Image set to wide (2 columns)' : 'Image set to normal width');
      } else {
        toast('Failed to update', 'error');
      }
    } catch {
      toast('Connection error', 'error');
    } finally {
      wideBtn.disabled = false;
    }
    return;
  }

  // ── Fill toggle ──
  const fillBtn = e.target.closest('.fill-btn');
  if (fillBtn) {
    const id      = fillBtn.dataset.id;
    const section = imagesBySection[activeSection] || [];
    const img     = section.find(i => i.id === id);
    if (!img) return;
    const newFilled = !img.is_filled;
    fillBtn.disabled = true;
    try {
      const res  = await fetch(`/api/admin/image/${id}/fill`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ is_filled: newFilled }),
      });
      if (res.ok) {
        img.is_filled = newFilled;
        fillBtn.classList.toggle('active', newFilled);
        fillBtn.title = newFilled ? 'Remove fill gap' : 'Stretch to fill gap below';
        layoutAdminGallery();
        toast(newFilled ? 'Image set to fill gap below' : 'Image fill removed');
      } else {
        toast('Failed to update', 'error');
      }
    } catch {
      toast('Connection error', 'error');
    } finally {
      fillBtn.disabled = false;
    }
    return;
  }

  // ── Rotate ──
  const rotateBtn = e.target.closest('.rotate-btn');
  if (rotateBtn) {
    const id      = rotateBtn.dataset.id;
    const degrees = Number(rotateBtn.dataset.degrees);
    const card    = rotateBtn.closest('.image-card');
    const overlay = card.querySelector('.rotate-overlay');

    // Show spinner, disable both rotate buttons on this card
    card.querySelectorAll('.rotate-btn').forEach(b => b.disabled = true);
    overlay.style.display = 'flex';

    try {
      const res  = await fetch(`/api/admin/image/${id}/rotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ degrees }),
      });
      const data = await res.json();

      if (res.ok) {
        toast('Image rotated');
        // Update local cache
        const section = imagesBySection[activeSection] || [];
        const idx = section.findIndex(i => i.id === id);
        if (idx !== -1) section[idx] = data;

        // Bust the thumbnail cache by appending a timestamp query param
        const thumb = card.querySelector('.image-thumb');
        if (thumb) thumb.src = data.public_url_thumb + '?t=' + Date.now();
      } else {
        toast(data.error || 'Rotation failed', 'error');
      }
    } catch {
      toast('Connection error', 'error');
    } finally {
      overlay.style.display = 'none';
      card.querySelectorAll('.rotate-btn').forEach(b => b.disabled = false);
    }
    return;
  }

  // ── Delete ──
  const deleteBtn = e.target.closest('.delete-btn');
  if (!deleteBtn) return;
  const id = deleteBtn.dataset.id;
  if (!confirm('Delete this image? This cannot be undone.')) return;

  try {
    const res = await fetch(`/api/admin/image/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (res.ok) {
      toast('Image deleted');
      imagesBySection[activeSection] = (imagesBySection[activeSection] || []).filter(i => i.id !== id);
      renderImageGrid(imagesBySection[activeSection]);
    } else {
      const d = await res.json();
      toast(d.error || 'Delete failed', 'error');
    }
  } catch {
    toast('Connection error', 'error');
  }
});

// ─── Upload ──────────────────────────────────────────────────────────────────────
uploadZone.addEventListener('click', () => fileInput.click());

uploadZone.addEventListener('dragover', e => {
  e.preventDefault();
  uploadZone.classList.add('dragover');
});
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  handleFiles(e.dataTransfer.files);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) handleFiles(fileInput.files);
  fileInput.value = '';
});

async function handleFiles(fileList) {
  if (!activeSection) return toast('Select a section tab first', 'warning');
  const files = [...fileList].slice(0, 10);

  const formData = new FormData();
  formData.append('section', activeSection);
  for (const f of files) formData.append('images', f);

  uploadProgress.classList.add('visible');
  uploadProgressText.textContent = `Uploading ${files.length} image${files.length > 1 ? 's' : ''}…`;
  uploadZone.style.pointerEvents = 'none';

  try {
    const res  = await fetch('/api/admin/upload', {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    const data = await res.json();

    if (!res.ok) {
      toast(data.error || 'Upload failed', 'error');
      return;
    }

    const count   = data.uploaded?.length || 0;
    const errCount = data.errors?.length || 0;

    if (count > 0) {
      toast(`${count} image${count > 1 ? 's' : ''} uploaded`);
      imagesBySection[activeSection] = [
        ...(imagesBySection[activeSection] || []),
        ...data.uploaded,
      ];
      renderImageGrid(imagesBySection[activeSection]);
    }
    if (errCount > 0) {
      toast(`${errCount} file(s) failed — check sizes/types`, 'error');
    }
  } catch {
    toast('Upload connection error', 'error');
  } finally {
    uploadProgress.classList.remove('visible');
    uploadZone.style.pointerEvents = '';
  }
}

// ─── Hero panel ──────────────────────────────────────────────────────────────────
function renderHeroPanel() {
  const container = document.getElementById('hero-sections-container');
  container.innerHTML = '';

  for (const section of sections) {
    const sc = (siteConfig.sections || []).find(s => s.slug === section.slug) || {};
    const images = imagesBySection[section.slug] || [];

    const group = document.createElement('div');
    group.className = 'hero-section-group';
    group.innerHTML = `
      <div class="hero-section-title">${section.label}</div>
      <div class="hero-meta-fields">
        <div class="field">
          <label>Kicker text</label>
          <input type="text" class="hero-kicker" data-slug="${section.slug}" value="${sc.hero_kicker || ''}" placeholder="e.g. Archive">
        </div>
        <div class="field">
          <label>Link text</label>
          <input type="text" class="hero-link-text" data-slug="${section.slug}" value="${sc.hero_link_text || ''}" placeholder="e.g. View moments">
        </div>
      </div>
      ${(sc.heroes || []).length > 0 ? `
        <div class="current-hero-preview">
          <div style="display:flex;gap:12px;overflow-x:auto;padding-bottom:8px;">
            ${sc.heroes.map(h => `
              <div style="display:flex; flex-direction:column; align-items:center; gap:6px;">
                <img src="${h.thumb_url || h.full_url}" style="width:60px;height:40px;border-radius:4px; object-fit: cover;">
                <select class="hero-focal-select" data-id="${h.id}" style="font-size:0.7rem; padding:1px; max-width:70px; border-radius:3px; background:var(--surface); color:var(--text); border:1px solid var(--border);">
                  <option value="center" ${h.focal_point === 'center' ? 'selected' : ''}>Center</option>
                  <option value="top" ${h.focal_point === 'top' ? 'selected' : ''}>Top</option>
                  <option value="bottom" ${h.focal_point === 'bottom' ? 'selected' : ''}>Bottom</option>
                  <option value="left" ${h.focal_point === 'left' ? 'selected' : ''}>Left</option>
                  <option value="right" ${h.focal_point === 'right' ? 'selected' : ''}>Right</option>
                </select>
              </div>
            `).join('')}
          </div>
          <span style="font-size:0.8rem;color:var(--muted);">${sc.heroes.length} images in slideshow</span>
          <button class="btn btn-danger btn-sm clear-hero-btn" data-slug="${section.slug}">Clear all</button>
        </div>` : ''}
      <p class="text-muted" style="margin-bottom:10px;font-size:0.8rem;">Click images to toggle in slideshow:</p>
      <div class="image-grid-picker hero-picker" data-slug="${section.slug}">
        ${images.length === 0
          ? '<div class="empty-state" style="grid-column:1/-1">Upload images to this section first</div>'
          : images.map(img => {
              const isSelected = (selectedHero[section.slug] || []).includes(img.id);
              return `
                <div class="image-card ${isSelected ? 'hero-selected' : ''}" data-id="${img.id}" style="cursor:pointer;">
                  <img class="image-thumb" src="${img.public_url_thumb}" alt="" loading="lazy">
                </div>`;
            }).join('')}
      </div>
      <div class="row mt-sm">
        <button class="btn btn-primary btn-sm save-hero-btn" data-slug="${section.slug}">Save slideshow for ${section.label}</button>
      </div>
      <hr class="divider">
    `;
    container.appendChild(group);
  }

  // Hero picker click
  container.onclick = e => {
    const card = e.target.closest('.hero-picker .image-card');
    if (card) {
      const picker = card.closest('.hero-picker');
      const slug   = picker.dataset.slug;
      const imgId  = card.dataset.id;
      
      if (!selectedHero[slug]) selectedHero[slug] = [];
      const idx = selectedHero[slug].indexOf(imgId);
      
      if (idx > -1) {
        selectedHero[slug].splice(idx, 1);
        card.classList.remove('hero-selected');
      } else {
        selectedHero[slug].push(imgId);
        card.classList.add('hero-selected');
      }
    }

    const clearBtn = e.target.closest('.clear-hero-btn');
    if (clearBtn) {
      selectedHero[clearBtn.dataset.slug] = [];
      saveHero(clearBtn.dataset.slug);
    }

    const saveBtn = e.target.closest('.save-hero-btn');
    if (saveBtn) saveHero(saveBtn.dataset.slug);
  };

  // Hero focal picker change
  container.onchange = async e => {
    const focalSelect = e.target.closest('.hero-focal-select');
    if (focalSelect) {
      const imgId = focalSelect.dataset.id;
      const focalPoint = focalSelect.value;
      focalSelect.disabled = true;
      try {
        const res = await fetch(`/api/admin/image/${imgId}/focal`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ focal_point: focalPoint }),
        });
        if (res.ok) {
          toast('Mobile focal point updated');
          // Refresh site config so the frontend gets it
          const cfg = await fetch('/api/site-config');
          siteConfig = await cfg.json();
          // We don't necessarily need to re-render the whole panel just for this dropdown,
          // but we can to ensure state is clean. The select will stay where they put it anyway.
        } else {
          toast('Failed to update focal point', 'error');
        }
      } catch {
        toast('Connection error', 'error');
      } finally {
        focalSelect.disabled = false;
      }
    }
  };
}

async function saveHero(slug) {
  const group = document.querySelector(`.hero-picker[data-slug="${slug}"]`).closest('.hero-section-group');
  const body = {
    section:        slug,
    hero_image_ids: selectedHero[slug] || [],
    hero_kicker:    group.querySelector('.hero-kicker').value,
    hero_link_text: group.querySelector('.hero-link-text').value,
  };
  try {
    const res = await fetch('/api/admin/hero', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    if (res.ok) {
      toast('Hero saved');
      // Refresh site config
      const cfg = await fetch('/api/site-config');
      siteConfig = await cfg.json();
    } else {
      toast('Failed to save hero', 'error');
    }
  } catch {
    toast('Connection error', 'error');
  }
}

// ─── About panel ─────────────────────────────────────────────────────────────────
function renderAboutPanel() {
  document.getElementById('about-title-input').value    = siteConfig.about_title || '';
  document.getElementById('about-text-input').value     = siteConfig.about_text  || '';
  document.getElementById('contact-email-input').value  = siteConfig.contact_email || '';
  document.getElementById('instagram-url-input').value  = siteConfig.instagram_url || '';

  // Build flat all-images list if not done
  allImages = Object.values(imagesBySection).flat();
  
  const preview    = document.getElementById('about-profile-preview');
  const previewImg = document.getElementById('about-profile-img');

  if (siteConfig.about_profile_url) {
    preview.style.display = 'flex';
    previewImg.src = siteConfig.about_profile_url;
  } else {
    preview.style.display = 'none';
  }
}

// ─── Profile Image Upload ────────────────────────────────────────────────────────
const uploadProfileBtn = document.getElementById('upload-profile-btn');
const profileFileInput = document.getElementById('profile-file-input');

uploadProfileBtn?.addEventListener('click', () => profileFileInput.click());

profileFileInput?.addEventListener('change', async () => {
  if (!profileFileInput.files.length) return;
  const file = profileFileInput.files[0];
  profileFileInput.value = '';

  const formData = new FormData();
  formData.append('image', file);

  uploadProfileBtn.disabled = true;
  uploadProfileBtn.textContent = 'Uploading…';

  try {
    const res = await fetch('/api/admin/upload-profile', {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    const data = await res.json();

    if (res.ok) {
      toast('Profile photo updated');
      siteConfig.about_profile_url = data.public_url;
      siteConfig.about_profile_storage_path = data.storage_path;
      siteConfig.about_profile_image_id = null;
      renderAboutPanel();
    } else {
      toast(data.error || 'Upload failed', 'error');
    }
  } catch {
    toast('Connection error', 'error');
  } finally {
    uploadProfileBtn.disabled = false;
    uploadProfileBtn.textContent = 'Upload profile photo';
  }
});


document.getElementById('remove-profile-btn').addEventListener('click', async () => {
  if (!confirm('Remove profile photo?')) return;
  
  try {
    const res = await fetch('/api/admin/site-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        ...siteConfig,
        about_profile_storage_path: null,
        about_profile_image_id: null
      }),
    });
    if (res.ok) {
      toast('Profile photo removed');
      siteConfig.about_profile_url = null;
      renderAboutPanel();
    }
  } catch {
    toast('Connection error', 'error');
  }
});

document.getElementById('save-about-btn').addEventListener('click', async () => {
  const body = {
    about_title:            document.getElementById('about-title-input').value,
    about_text:             document.getElementById('about-text-input').value,
    contact_email:          document.getElementById('contact-email-input').value,
    instagram_url:          document.getElementById('instagram-url-input').value,
    about_profile_storage_path: siteConfig.about_profile_storage_path || null,
    about_profile_image_id:     siteConfig.about_profile_image_id || null,
  };
  try {
    const res = await fetch('/api/admin/site-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    if (res.ok) {
      toast('About page saved');
      const cfg = await fetch('/api/site-config');
      siteConfig = await cfg.json();
    } else {
      toast('Failed to save', 'error');
    }
  } catch {
    toast('Connection error', 'error');
  }
});

// ─── Settings panel ───────────────────────────────────────────────────────────────
function renderSettingsPanel() {
  document.getElementById('site-title-input').value      = siteConfig.site_title    || '';
  document.getElementById('settings-contact-email').value = siteConfig.contact_email || '';
  document.getElementById('settings-instagram').value    = siteConfig.instagram_url || '';
}

document.getElementById('save-settings-btn').addEventListener('click', async () => {
  const body = {
    site_title:    document.getElementById('site-title-input').value,
    contact_email: document.getElementById('settings-contact-email').value,
    instagram_url: document.getElementById('settings-instagram').value,
  };
  try {
    const res = await fetch('/api/admin/site-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    if (res.ok) {
      toast('Settings saved');
      adminSiteTitle.textContent = body.site_title || 'Portfolio';
      const cfg = await fetch('/api/site-config');
      siteConfig = await cfg.json();
    } else {
      toast('Failed to save settings', 'error');
    }
  } catch {
    toast('Connection error', 'error');
  }
});

// ─── Sections panel ───────────────────────────────────────────────────────────────
function renderSectionsPanel() {
  const list = document.getElementById('sections-list');
  list.innerHTML = '';

  for (const section of sections) {
    const div = document.createElement('div');
    div.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:20px;margin-bottom:14px;';
    div.innerHTML = `
      <div class="settings-grid" style="margin-bottom:12px;">
        <div class="field">
          <label>Label</label>
          <input type="text" class="sec-label" data-slug="${section.slug}" value="${section.label}">
        </div>
        <div class="field">
          <label>Nav label</label>
          <input type="text" class="sec-nav-label" data-slug="${section.slug}" value="${section.nav_label || section.label}">
        </div>
      </div>
      <div class="row">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:var(--muted);font-size:0.85rem;text-transform:none;letter-spacing:0;">
          <input type="checkbox" class="sec-visible" data-slug="${section.slug}" ${section.is_visible ? 'checked' : ''}>
          Visible in navigation
        </label>
        <button class="btn btn-secondary btn-sm save-section-btn" data-slug="${section.slug}">Save</button>
      </div>
    `;
    list.appendChild(div);
  }

  list.addEventListener('click', async e => {
    const btn = e.target.closest('.save-section-btn');
    if (!btn) return;
    const slug = btn.dataset.slug;
    const body = {
      section:    slug,
      label:      list.querySelector(`.sec-label[data-slug="${slug}"]`).value,
      nav_label:  list.querySelector(`.sec-nav-label[data-slug="${slug}"]`).value,
      is_visible: list.querySelector(`.sec-visible[data-slug="${slug}"]`).checked,
    };
    try {
      const res = await fetch('/api/admin/section-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast(`Section "${body.label}" saved`);
        // Refresh
        const sRes = await fetch('/api/admin/sections', { credentials: 'include' });
        sections = await sRes.json();
        buildImageTabs();
        renderSectionsPanel();
      } else {
        toast('Failed to save section', 'error');
      }
    } catch {
      toast('Connection error', 'error');
    }
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────────
checkSession();
