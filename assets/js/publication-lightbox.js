(() => {
  const dialog = document.getElementById('publication-lightbox');
  const preview = dialog.querySelector('.pub-lightbox-image');
  const closeButton = dialog.querySelector('.pub-lightbox-close');
  let activeTrigger = null;

  document.querySelectorAll('.pub-figure-preview').forEach((trigger) => {
    trigger.addEventListener('click', () => {
      const thumbnail = trigger.querySelector('img');
      preview.src = thumbnail.currentSrc || thumbnail.src;
      preview.alt = thumbnail.alt;
      activeTrigger = trigger;
      dialog.showModal();
      document.documentElement.classList.add('pub-lightbox-open');
    });
  });

  closeButton.addEventListener('click', () => dialog.close());

  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) {
      dialog.close();
    }
  });

  dialog.addEventListener('close', () => {
    document.documentElement.classList.remove('pub-lightbox-open');
    preview.removeAttribute('src');
    preview.alt = '';
    activeTrigger?.focus({ preventScroll: true });
    activeTrigger = null;
  });
})();
