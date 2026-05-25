/** Contenido de ayuda para el navegador 3D (modal). */

export const HELP_GUIDE_HTML = `
<div class="help-guide">
  <p class="help-lead">La Gran Biblioteca muestra tu bóveda como un <strong>grafo 3D</strong>. Empieza con pocos gestos; los paneles avanzados son opcionales.</p>

  <section class="help-block">
    <h3>En 30 segundos</h3>
    <ul>
      <li><strong>Buscar</strong> — barra superior, <kbd>Ctrl+K</kbd> o <kbd>/</kbd>. Clic en un resultado para volar al nodo.</li>
      <li><strong>Clic en un nodo</strong> — abre el panel de detalle a la derecha (contenido, vecinos).</li>
      <li><strong>Arrastrar</strong> — orbitar; rueda — zoom.</li>
      <li><strong>Restablecer todo</strong> — menú Ver, botón «Reset» o <kbd>R</kbd>; limpia búsquedas, filtros y vuelve al centro.</li>
    </ul>
  </section>

  <section class="help-block">
    <h3>Paneles izquierdos (Ver → o botones Tipos / Cobertura / Vista)</h3>
    <ul>
      <li><strong>Cobertura</strong> — resumen por workspace (volumen y estudio). Clic en una tarjeta aplica filtro + acerca la cámara.</li>
      <li><strong>Visualización</strong> — heatmap (estudio / densidad), workspaces, grado mínimo, aristas.</li>
      <li><strong>Tipos de nodo</strong> — ocultar carpetas, markdown, código, etc.</li>
    </ul>
    <p class="help-note">Puedes abrir varios a la vez; se apilan sin taparse. <kbd>Esc</kbd> cierra el último abierto.</p>
  </section>

  <section class="help-block">
    <h3>Mapa estructural (abajo a la izquierda)</h3>
    <p>Cambia entre <em>Workspace</em>, <em>Carpetas</em> y <em>Topics</em>. Clic en una burbuja para filtrar y centrar esa zona.</p>
  </section>

  <section class="help-block">
    <h3>Vista del agente (MCP / Cursor)</h3>
    <p>Si un agente publica un <em>lens</em>, aparece la barra «Vista del agente». Pulsa <strong>Aplicar</strong> para ver en el grafo los mismos filtros y resaltados que usa el agente.</p>
  </section>

  <section class="help-block">
    <h3>Focus y atajos</h3>
    <ul>
      <li><kbd>F</kbd> — modo focus (solo vecinos del nodo).</li>
      <li><kbd>Esc</kbd> — salir de focus, cerrar paneles o detalle.</li>
    </ul>
  </section>

  <section class="help-block">
    <h3>Grafo grande (miles de nodos)</h3>
    <p>La API muestra hasta ~1000 nodos prioritarios. El aviso naranja en la barra indica cuántos hay en total; usa <strong>Cobertura</strong> para elegir un workspace antes de explorar.</p>
  </section>
</div>
`

export function mountHelpGuideStyles(): void {
  if (document.getElementById('help-guide-styles')) return
  const style = document.createElement('style')
  style.id = 'help-guide-styles'
  style.textContent = `
    .help-guide { color: rgba(255,255,255,0.78); font-size: 12px; line-height: 1.55; max-height: 55vh; overflow-y: auto; padding-right: 6px; }
    .help-lead { margin-bottom: 14px; color: rgba(255,255,255,0.65); }
    .help-block { margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.06); }
    .help-block:last-child { border-bottom: none; }
    .help-block h3 { color: #4fc3f7; font-size: 12px; font-weight: 500; margin-bottom: 8px; letter-spacing: 0.3px; }
    .help-block ul { margin: 0; padding-left: 18px; }
    .help-block li { margin-bottom: 6px; }
    .help-note { font-size: 11px; color: rgba(255,255,255,0.45); margin-top: 8px; }
    .help-guide kbd { background: rgba(255,255,255,0.1); padding: 1px 5px; border-radius: 3px; font-size: 10px; font-family: inherit; }
  `
  document.head.appendChild(style)
}
