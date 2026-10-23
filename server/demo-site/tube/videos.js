function render(grid, titles) {
  grid.innerHTML = '';
  for (const t of titles) {
    const a = document.createElement('a');
    a.className = 'video';
    a.href = `watch.html?t=${encodeURIComponent(t)}`;
    a.innerHTML = '<div class="thumb">▶</div><h3></h3><p>Tubely · 1.2M views</p>';
    a.querySelector('h3').textContent = t;
    grid.appendChild(a);
  }
}
