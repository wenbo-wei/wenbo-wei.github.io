(() => {
  const dialog = document.getElementById('publication-lightbox');
  const preview = dialog.querySelector('.pub-lightbox-image');
  const closeButton = dialog.querySelector('.pub-lightbox-close');
  let activeTrigger = null;
  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let drag = null;
  let suppressClick = false;

  function updateTransform() {
    preview.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
  }

  function resetView() {
    scale = 1;
    translateX = 0;
    translateY = 0;
    suppressClick = false;
    updateTransform();
  }

  document.querySelectorAll('.pub-figure-preview').forEach((trigger) => {
    trigger.addEventListener('click', () => {
      const thumbnail = trigger.querySelector('img');
      preview.src = thumbnail.currentSrc || thumbnail.src;
      preview.alt = thumbnail.alt;
      activeTrigger = trigger;
      resetView();
      dialog.showModal();
      document.documentElement.classList.add('pub-lightbox-open');
    });
  });

  closeButton.addEventListener('click', () => dialog.close());

  dialog.addEventListener('click', (event) => {
    if (event.target !== preview && event.target !== dialog) return;
    if (!suppressClick) dialog.close();
    suppressClick = false;
  });

  dialog.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (drag) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? dialog.clientHeight : 1;
    const nextScale = Math.min(8, Math.max(0.25, scale * Math.exp(-event.deltaY * unit * 0.002)));
    const ratio = nextScale / scale;
    const bounds = preview.getBoundingClientRect();
    // Keep the point under the pointer stationary while zooming.
    translateX += (event.clientX - (bounds.left + bounds.width / 2)) * (1 - ratio);
    translateY += (event.clientY - (bounds.top + bounds.height / 2)) * (1 - ratio);
    scale = nextScale;
    updateTransform();
  }, { passive: false });

  dialog.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    suppressClick = false;
    if (event.target !== preview) return;
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      translateX,
      translateY,
      moved: false,
    };
    preview.setPointerCapture(event.pointerId);
    preview.classList.add('is-dragging');
  });

  preview.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    // Ignore small hand movements so an ordinary click still closes the image.
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 5) return;
    drag.moved = true;
    translateX = drag.translateX + deltaX;
    translateY = drag.translateY + deltaY;
    updateTransform();
  });

  function endDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    suppressClick = drag.moved || event.type !== 'pointerup';
    const tapped = event.pointerType === 'touch' && !suppressClick;
    drag = null;
    preview.classList.remove('is-dragging');
    if (preview.hasPointerCapture(event.pointerId)) {
      preview.releasePointerCapture(event.pointerId);
    }
    // Touch browsers do not always synthesize a click after pointer capture.
    if (tapped) dialog.close();
  }

  preview.addEventListener('pointerup', endDrag);
  preview.addEventListener('pointercancel', endDrag);
  preview.addEventListener('lostpointercapture', endDrag);
  preview.addEventListener('dragstart', (event) => event.preventDefault());

  window.addEventListener('resize', () => {
    if (dialog.open && !drag) resetView();
  });

  dialog.addEventListener('close', () => {
    // A queued close event must not clear a figure that has already reopened.
    if (dialog.open) return;
    if (drag) endDrag({ pointerId: drag.pointerId, type: 'cancel' });
    document.documentElement.classList.remove('pub-lightbox-open');
    preview.removeAttribute('src');
    preview.alt = '';
    activeTrigger?.focus({ preventScroll: true });
    activeTrigger = null;
  });
})();
