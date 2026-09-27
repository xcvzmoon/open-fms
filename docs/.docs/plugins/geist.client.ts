export default defineNuxtPlugin(() => {
  if (import.meta.server) {
    return;
  }

  const fontLink = document.createElement('link');
  fontLink.rel = 'stylesheet';
  fontLink.href = 'https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap';
  document.head.appendChild(fontLink);

  const style = document.createElement('style');
  style.textContent = `
html, body {
  font-family: 'Geist', ui-sans-serif, system-ui, sans-serif !important;
}
.included-kicker {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ui-text-dimmed);
}
.included-kicker::before {
  content: '';
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 999px;
  background: var(--ui-primary);
}
.included-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  border: 1px solid var(--ui-border);
  border-radius: 1.25rem;
  overflow: hidden;
}
.included-card {
  padding: 1.35rem 1.5rem 1.5rem;
  border-right: 1px solid var(--ui-border);
  border-bottom: 1px solid var(--ui-border);
  min-height: 10.5rem;
}
.included-card:nth-child(3n) { border-right: 0; }
.included-card:nth-last-child(-n + 3) { border-bottom: 0; }
.included-card-title {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  margin-bottom: 0.65rem;
  font-weight: 600;
  font-size: 1.05rem;
}
.included-card-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.12rem 0.55rem;
  border: 1px solid var(--ui-border);
  border-radius: 999px;
  font-size: 0.72rem;
  color: var(--ui-text-dimmed);
}
.included-card p {
  margin: 0;
  color: var(--ui-text-toned);
  line-height: 1.55;
  font-size: 0.95rem;
}
@media (max-width: 900px) {
  .included-grid { grid-template-columns: 1fr; }
  .included-card,
  .included-card:nth-child(3n),
  .included-card:nth-last-child(-n + 3) {
    border-right: 0;
    border-bottom: 1px solid var(--ui-border);
  }
  .included-card:last-child { border-bottom: 0; }
}
`;
  document.head.appendChild(style);
});
