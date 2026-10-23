'use strict';

import { state, dom, logImageLoad } from './state.js';
import { openLightbox } from './lightbox.js';
import { groupWorkRows, workRowMetrics } from './workLayout.js?v=1';

const ROW_UNIT = 10; // px — grid-auto-rows value; must match CSS in style.css
let _layoutTimer = null;

// Dynamic scroll reveal observer (bypassed for initial FCP images)
export const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('revealed');
      revealObserver.unobserve(entry.target);
    }
  });
}, {
  rootMargin: '0px 0px -60px 0px',
  threshold: 0.05
});

// Captions observer: fires when the caption text itself enters the viewport
export const captionObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('caption-revealed');
      captionObserver.unobserve(entry.target);
    }
  });
}, {
  rootMargin: '0px 0px -40px 0px',
  threshold: 0.1
});

/**
 * Triggers image load fade-in after a short deliberate delay.
 * @param {HTMLImageElement} img
 */
function triggerFadeIn(img) {
  if (img._fadeTriggered) return;
  img._fadeTriggered = true;

  const applyClass = () => {
    setTimeout(() => {
      img.classList.add('loaded');
    }, 50);
  };

  if (window.activeViewTransition) {
    // Race the transition against a 2-second timeout so images
    // never stay hidden if the tab is backgrounded mid-transition.
    const timeout = new Promise(resolve => setTimeout(resolve, 2000));
    Promise.race([window.activeViewTransition, timeout])
      .then(applyClass)
      .catch(applyClass);
  } else {
    applyClass();
  }
}

/**
 * Computes columns based on viewport width.
 * @returns {number} Column count
 */
export function getNumCols() {
  const w = window.innerWidth;
  if (w > 1000) return 4;
  if (w > 700)  return 3;
  return 2;
}

/**
 * Computes and stamps explicit grid placement CSS attributes on every gallery image.
 * Uses fractional aspect-ratio math for consistency and integer px values to prevent cropping.
 */
export function layoutGallery() {
  if (!dom.gallery || dom.gallery.classList.contains('work-editorial')) return; // Guard: not on home/gallery page
  const numCols = getNumCols();
  const containerWidth = dom.gallery.offsetWidth > 0 ? dom.gallery.offsetWidth : window.innerWidth;
  const colWidth = containerWidth / numCols;
  
  const logHeights = new Array(numCols).fill(0);
  const logGaps = []; 
  
  const pxHeights = new Array(numCols).fill(0);
  const pxGaps = []; 
  
  const lastItemInCol = new Array(numCols).fill(null);

  dom.gallery.style.gridTemplateColumns = `repeat(${numCols}, 1fr)`;

  const imgs = dom.gallery.querySelectorAll('img');
  imgs.forEach((img, i) => {
    img.classList.remove('fill-gap');
    const imgData = state.images[i];
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
        if (logHeights[c] < bestLog - 0.01) {
          const last = lastItemInCol[c];
          let stretched = false;
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
            last.el.style.gridRow = `${last.pxStart + 1} / span ${pxStart - last.pxStart}`;
            last.el.classList.add('fill-gap');
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

      img.style.gridColumn = `${colStart + 1} / span 2`;
      img.style.gridRow    = `${pxStart + 1} / span ${pxH}`;
      
      logHeights[colStart] = bestLog + logH;
      logHeights[colStart + 1] = bestLog + logH;
      pxHeights[colStart] = pxStart + pxH;
      pxHeights[colStart + 1] = pxStart + pxH;
      
      const itemRecord = { el: img, pxStart, spanCols, is_filled: isFilled, col: colStart };
      lastItemInCol[colStart] = itemRecord;
      lastItemInCol[colStart + 1] = itemRecord;
      
    } else {
      let placedInGap = false;
      const sortedGapIndices = logGaps.map((_, idx) => idx).sort((a, b) => logGaps[a].start - logGaps[b].start);
      
      for (let idx of sortedGapIndices) {
        const logGap = logGaps[idx];
        const pxGap = pxGaps[idx];
        
        if (logH <= (logGap.end - logGap.start) + 0.01) {
          img.style.gridColumn = `${logGap.col + 1}`;
          
          if (isFilled) {
            const remainingPx = pxGap.end - pxGap.start;
            img.style.gridRow = `${pxGap.start + 1} / span ${remainingPx}`;
            img.classList.add('fill-gap');
            logGap.start = logGap.end;
            pxGap.start = pxGap.end;
          } else {
            img.style.gridRow = `${pxGap.start + 1} / span ${pxH}`;
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
        
        img.style.gridColumn = `${colStart + 1}`;
        img.style.gridRow    = `${pxStart + 1} / span ${pxH}`;
        
        logHeights[colStart] = minLog + logH;
        pxHeights[colStart] = pxStart + pxH;
        
        lastItemInCol[colStart] = { el: img, pxStart, spanCols, is_filled: isFilled, col: colStart };
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
        last.el.classList.add('fill-gap');
        pxHeights[c] = maxPxHeight;
        if (last.spanCols === 2) {
          const other = last.col === c ? c + 1 : c - 1;
          pxHeights[other] = maxPxHeight;
        }
      }
    }
  }
}

/**
 * Iterates over state.images, dynamically generates standard responsive image tags,
 * attaches click observers, registers scroll reveals, and triggers layout calculations.
 */
export function renderGallery() {
  if (!dom.gallery) return;
  dom.gallery.innerHTML = '';

  state.images.forEach((imgData, index) => {
    const img    = document.createElement('img');
    
    img.alt      = imgData.alt_text || imgData.title || '';
    img.loading  = index < 8 ? 'eager' : 'lazy';
    if (index < 8) img.fetchPriority = 'high';
    img.decoding = 'async';

    // Set aspect-ratio so the element has correct proportions even before load (Zero CLS)
    img.style.aspectRatio = (imgData.width && imgData.height)
      ? `${imgData.width} / ${imgData.height}` : '3 / 2';
    if (imgData.width)  img.setAttribute('width',  imgData.width);
    if (imgData.height) img.setAttribute('height', imgData.height);

    img.addEventListener('load', () => triggerFadeIn(img));
    img.addEventListener('click', () => openLightbox(index));

    // Set fallback source URL
    const fallbackSrc = imgData.public_url_grid_thumb || imgData.public_url_thumb;
    
    // Set srcset first for modern responsive image loading to avoid double-fetching
    if (imgData.public_url_grid_thumb && imgData.public_url_thumb) {
      img.srcset = `${imgData.public_url_grid_thumb} 600w, ${imgData.public_url_thumb} 1600w`;
      
      // Sizes attribute helps the browser know how large the image is laid out
      if (imgData.is_wide) {
        // Wide images: 2 columns on desktop/tablet (>700px), 1 column on mobile (<=700px)
        img.sizes = '(min-width: 1000px) 50vw, (min-width: 700px) 67vw, 50vw';
      } else {
        // Normal images: 1 column always (4 columns on >1000px, 3 columns on >700px, 2 columns on <=700px)
        img.sizes = '(min-width: 1000px) 25vw, (min-width: 700px) 33vw, 50vw';
      }
      
      logImageLoad(imgData.public_url_grid_thumb, 'gallery-grid-thumb (600w WebP)');
      logImageLoad(imgData.public_url_thumb, 'gallery-standard-thumb (1600w WebP)');
    } else {
      logImageLoad(fallbackSrc, 'gallery-fallback-thumb');
    }
    
    img.src = fallbackSrc;
    if (img.complete) {
      triggerFadeIn(img);
    }
    dom.gallery.appendChild(img);

    // Apply scroll reveal animation (bypass for first 4 initial photos)
    if (index >= 4) {
      img.classList.add('reveal-on-scroll');
      revealObserver.observe(img);
    } else {
      img.classList.add('revealed');
    }
  });

  // Run layout after DOM is painted so gallery.offsetWidth is accurate
  requestAnimationFrame(layoutGallery);
}

// Re-layout on resize (debounced) to maintain masonry layout integrity
new ResizeObserver(() => {
  clearTimeout(_layoutTimer);
  _layoutTimer = setTimeout(layoutGallery, 120);
}).observe(document.body);

// ─── Work / Editorial Layout ───────────────────────────────────────────────

// 1200 design units wide. Public page renders as: value / 12 vw
const WORK_CANVAS_W = 1200;

/**
 * Renders the editorial "My Work" layout.
 * Uses a JSON layout if provided; otherwise falls back to a beautiful default
 * editorial flow with alternating image sizes and horizontal positions.
 *
 * @param {Array}  images     - Full images array for this section
 * @param {Object} layoutData - JSON layout from /api/layout, or null
 */
export function renderWorkLayout(images, layoutData) {
  if (!dom.gallery) return;
  dom.gallery.innerHTML = '';

  // Apply background color if configured
  if (layoutData?.backgroundColor) {
    document.documentElement.style.setProperty('--bg', layoutData.backgroundColor);
  } else {
    document.documentElement.style.setProperty('--bg', '');
  }

  // Enable cinematic background on all editorial sections
  document.body.classList.add('cinematic-bg-active');

  // Inject intro text above the gallery if present
  const prevIntro = document.getElementById('work-intro');
  if (prevIntro) prevIntro.remove();

  if (layoutData?.intro) {
    const main = dom.gallery.closest('main');
    if (main) {
      const introEl = document.createElement('div');
      introEl.id = 'work-intro';
      introEl.className = 'work-intro';
      introEl.innerHTML = `<p class="work-intro-text">${_escapeWorkHtml(layoutData.intro)}</p>`;
      main.insertBefore(introEl, dom.gallery);
    }
  }

  if (layoutData?.items?.length > 0) {
    // Custom layout maps absolute elements to any image in the full archive pool
    _renderCustomWorkLayout(images, layoutData);
  } else {
    // Default fallback layout shows first 18 images
    const defaultImages = images.slice(0, 18);
    _renderDefaultWorkLayout(defaultImages);
  }
}

/**
 * Default editorial layout: flow-based with programmed positional rhythm.
 * Each image gets a size + horizontal offset based on its index position.
 * No JSON needed — always looks editorial out of the box.
 */
function _renderDefaultWorkLayout(images) {
  const gallery = dom.gallery;
  gallery.className = 'gallery work-editorial';
  gallery.style.height = '';
  gallery.style.position = '';

  // Alternating pattern: [width, marginLeft, gap] — creates editorial rhythm
  const patterns = [
    { width: '55%',  ml: '10%', gap: '40vh' },
    { width: '35%',  ml: '55%', gap: '45vh' },
    { width: '50%',  ml: '25%', gap: '70vh' },
    { width: '38%',  ml: '5%',  gap: '80vh' },
    { width: '42%',  ml: '50%', gap: '75vh' },
    { width: '48%',  ml: '15%', gap: '70vh' },
  ];

  images.forEach((imgData, index) => {
    const p = patterns[index % patterns.length];

    const item = document.createElement('div');
    item.className = 'work-item';
    item.style.setProperty('--item-w', p.width);
    item.style.setProperty('--item-ml', p.ml);
    item.style.setProperty('--item-mb', p.gap);
    
    item.style.width = 'var(--item-w)';
    item.style.marginLeft = 'var(--item-ml)';
    item.style.marginBottom = 'var(--item-mb)';

    const img = document.createElement('img');
    setWorkImage(img, imgData, index, parseFloat(p.width));

    item.appendChild(img);

    // Add caption below image
    if (imgData.title && imgData.title.trim()) {
      const captionEl = document.createElement('div');
      captionEl.className = 'work-item-caption';
      captionEl.textContent = imgData.title;
      item.appendChild(captionEl);
      captionObserver.observe(captionEl);
    }

    gallery.appendChild(item);

    // Scroll-reveal (skip first 3 so they show immediately)
    if (index >= 3) {
      item.classList.add('reveal-on-scroll');
      revealObserver.observe(item);
    } else {
      item.classList.add('revealed');
    }
  });
  requestAnimationFrame(fitWorkCaptions);
}

/**
 * Custom layout: places items in a vertical staggered editorial list.
 * Reads version 2 list format layout data.
 */
function _renderCustomWorkLayout(images, layoutData) {
  const gallery = dom.gallery;
  gallery.className = 'gallery work-editorial work-editorial--custom';
  gallery.style.position = ''; gallery.style.height = '';
  const layout = convertLayoutV1toV2(layoutData, images);
  gallery.style.setProperty('--caption-fs', `${Number(layout.titleFontSize)||14}px`);
  let order=0;
  const validItems=layout.items.filter(item=>images.some(image=>image.id===item.imageId));
  for(const row of groupWorkRows(validItems)) {
    const metrics=workRowMetrics(row),paired=row.length===2;
    let wrapper=gallery;
    if(paired){
      wrapper=document.createElement('div');wrapper.className='work-row work-row--pair';
      wrapper.style.width=`${metrics.width}%`;wrapper.style.marginLeft=`${metrics.offset}%`;
      wrapper.style.marginBottom=`${metrics.gap}vh`;
      wrapper.style.gridTemplateColumns=metrics.widths.map(width=>`${width}fr`).join(' ');
      gallery.appendChild(wrapper);
    }
    row.forEach((item,index)=>{
      const data=images.find(image=>image.id===item.imageId);
      const el=document.createElement('div');
      el.className=`work-item pos-${paired?'below':item.captionPosition||'below'}`;
      el.style.setProperty('--item-w',`${metrics.width}%`);
      el.style.setProperty('--item-ml',`${metrics.offset}%`);
      el.style.setProperty('--item-mb',`${metrics.gap}vh`);
      const image=document.createElement('img');
      const percent=paired?metrics.width*metrics.widths[index]/metrics.widths.reduce((a,b)=>a+b,0):metrics.width;
      setWorkImage(image,data,order++,percent);
      el.appendChild(image);
      if(item.caption?.trim()){
        const cap=document.createElement('div');cap.className=`work-item-caption align-${item.captionAlign||'left'}`;
        cap.textContent=item.caption;el.appendChild(cap);captionObserver.observe(cap);
      }
      wrapper.appendChild(el);
      el.classList.add('reveal-on-scroll');revealObserver.observe(el);
    });
  }
  requestAnimationFrame(fitWorkCaptions);
}

function setWorkImage(image, data, order, percent) {
  image.alt=data.alt_text||data.title||'';
  image.loading=order<2?'eager':'lazy';image.decoding='async';
  if(order===0)image.fetchPriority='high';
  if(data.width&&data.height){image.width=data.width;image.height=data.height;image.style.aspectRatio=`${data.width}/${data.height}`}
  const width=data.width||3200,candidates=[];
  if(data.public_url_grid_thumb)candidates.push(`${data.public_url_grid_thumb} ${Math.min(600,width)}w`);
  if(data.public_url_thumb&&width>600)candidates.push(`${data.public_url_thumb} ${Math.min(1600,width)}w`);
  if(data.public_url_full&&width>1600)candidates.push(`${data.public_url_full} ${width}w`);
  if(candidates.length)image.srcset=candidates.join(', ');
  image.sizes=`(max-width: 768px) 90vw, (min-width: 1400px) ${Math.round(1320*percent/100)}px, calc((100vw - 80px) * ${(percent/100).toFixed(4)})`;
  image.addEventListener('load',()=>triggerFadeIn(image));
  image.src=data.public_url_thumb||data.public_url_full;
  if(image.complete&&image.naturalWidth)triggerFadeIn(image);
}

function fitWorkCaptions() {
  if(!dom.gallery?.classList.contains('work-editorial'))return;
  const viewport=document.documentElement.clientWidth;
  for(const item of dom.gallery.querySelectorAll('.work-item.pos-left,.work-item.pos-right')){
    item.classList.remove('caption-stacked');
    const rect=item.getBoundingClientRect();
    const available=item.classList.contains('pos-left')?rect.left-44:viewport-rect.right-44;
    item.classList.toggle('caption-stacked',available<150);
    item.style.setProperty('--caption-space',`${Math.max(0,Math.min(240,available))}px`);
  }
}
window.addEventListener('resize',()=>requestAnimationFrame(fitWorkCaptions),{passive:true});


/**
 * Safely converts layout JSON from freeform v1 structure to list-based staggered v2 structure.
 */
export function convertLayoutV1toV2(layoutData, images) {
  if (!layoutData || !Array.isArray(layoutData.items)) {
    return { version: 2, intro: layoutData?.intro || '', backgroundColor: layoutData?.backgroundColor || '#050505', items: [] };
  }
  if (layoutData.version === 2) {
    if (Array.isArray(layoutData.items)) {
      layoutData.items.forEach(item => {
        if (!item.captionPosition) item.captionPosition = 'below';
        if (!item.captionAlign) item.captionAlign = 'left';
      });
    }
    return layoutData;
  }

  const items = [];
  const v1Items = [...layoutData.items];
  
  // Sort old absolute items by y coordinate
  v1Items.sort((a, b) => a.y - b.y);

  // Group images and find nearby text boxes to merge as captions
  const v1Images = v1Items.filter(i => i.type === 'image');
  const v1Texts = v1Items.filter(i => i.type === 'text');

  v1Images.forEach((imgItem, idx) => {
    const imgData = images.find(i => i.id === imgItem.imageId);
    if (!imgData) return;

    // Find nearby text box (within 300px vertically below the image)
    let caption = '';
    const nearbyTextIdx = v1Texts.findIndex(t => t.y >= imgItem.y && t.y <= imgItem.y + imgItem.h + 300);
    if (nearbyTextIdx !== -1) {
      caption = v1Texts[nearbyTextIdx].content || '';
      v1Texts.splice(nearbyTextIdx, 1);
    } else {
      caption = imgData.title || '';
    }

    // Estimate width and offset as percentages of 1200px stage
    const width = Math.max(20, Math.min(80, Math.round((imgItem.w / 1200) * 100)));
    const offset = Math.max(0, Math.min(100 - width, Math.round((imgItem.x / 1200) * 100)));

    // Estimate gap based on y-distance to the next image
    let gap = 80; // default 80vh
    if (idx < v1Images.length - 1) {
      const nextImg = v1Images[idx + 1];
      const pxGap = nextImg.y - (imgItem.y + imgItem.h);
      if (pxGap > 0) {
        gap = Math.max(10, Math.min(120, Math.round(pxGap / 10)));
      }
    }

    items.push({
      id: imgItem.id || `item-${Date.now()}-${idx}`,
      type: 'image',
      imageId: imgItem.imageId,
      caption: caption,
      width: width,
      offset: offset,
      gap: gap,
      captionPosition: 'below',
      captionAlign: 'left'
    });
  });

  return {
    version: 2,
    intro: layoutData.intro || '',
    backgroundColor: layoutData.backgroundColor || '#050505',
    items: items
  };
}

function _escapeWorkHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

