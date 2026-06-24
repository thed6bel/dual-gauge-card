// =============================================================================
//  Dual Gauge Card  –  v0.8.0
//  Maintained fork of custom-cards/dual-gauge-card
//  Changelog v0.8.0:
//    - Register card in window.customCards for HA card picker
//    - Add getCardSize() for proper HA layout
//    - Editor: full LitElement rewrite for reactive updates
//    - Editor: sync all fields when config changes externally
//    - Editor: add background_color + header fields
//    - Editor: native color picker alongside text input for thresholds
//    - Editor: validation feedback on missing entities
//    - Editor: color list rebuilt without losing focus
// =============================================================================

// ---------------------------------------------------------------------------
//  Main card
// ---------------------------------------------------------------------------

class DualGaugeCard extends HTMLElement {

  constructor() {
    super();
    this._templateSubscriptions = {};
    this._templateValues = {};
    this._resizeObserver = null;
  }

  static getConfigElement() {
    return document.createElement('dual-gauge-card-editor');
  }

  static getStubConfig() {
    return {
      title: '',
      precision: 2,
      outer: { entity: '', label: 'Outer', min: 0, max: 100 },
      inner: { entity: '', label: 'Inner', min: 0, max: 100 },
    };
  }

  getCardSize() {
    return 3;
  }

  disconnectedCallback() {
    Object.values(this._templateSubscriptions).forEach(fn => typeof fn === 'function' && fn());
    this._templateSubscriptions = {};
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this.card || !this.nodes) {
      this._createCard();
      this._setupTemplates();
    }
    this._update();
  }

  setConfig(config) {
    if (!config.inner || (!config.inner.entity && !config.inner.template)) {
      throw new Error('inner gauge requires either entity or template');
    }
    if (!config.outer || (!config.outer.entity && !config.outer.template)) {
      throw new Error('outer gauge requires either entity or template');
    }

    this.config = JSON.parse(JSON.stringify(config));

    if (this.config.min == null)       this.config.min = 0;
    if (this.config.max == null)       this.config.max = 100;
    if (this.config.precision == null) this.config.precision = 2;
    if (!this.config.hasOwnProperty('shadeInner'))   this.config.shadeInner = true;
    if (!this.config.hasOwnProperty('animate'))      this.config.animate = true;
    if (!this.config.hasOwnProperty('show_minmax'))  this.config.show_minmax = false;

    for (const g of ['inner', 'outer']) {
      const gc = this.config[g];
      if (gc.precision == null) gc.precision = this.config.precision;
      if (gc.min == null)       gc.min = this.config.min;
      if (gc.max == null)       gc.max = this.config.max;
      if (!gc.colors && this.config.colors) gc.colors = [...this.config.colors];
      if (gc.colors) gc.colors.sort((a, b) => a.value < b.value ? 1 : -1);
    }
  }

  async _setupTemplates() {
    for (const gauge of ['inner', 'outer']) {
      const cfg = this.config[gauge];
      if (cfg.template && !this._templateSubscriptions[gauge]) {
        try {
          this._templateSubscriptions[gauge] = await this._hass.connection.subscribeMessage(
            (result) => {
              this._templateValues[gauge] = result.result;
              if (this.nodes) this._updateGauge(gauge);
            },
            { type: 'render_template', template: cfg.template }
          );
        } catch (e) {
          console.error(`dual-gauge-card: template error for ${gauge}:`, e);
        }
      }
    }
  }

  _update() {
    const innerOk = this.config.inner.template || this._hass.states[this.config.inner.entity];
    const outerOk = this.config.outer.template || this._hass.states[this.config.outer.entity];

    if (!innerOk || !outerOk) {
      if (this.card) this.card.remove();
      this.nodes = null;
      this.card = document.createElement('ha-card');
      if (this.config.header) this.card.header = this.config.header;
      const msg = document.createElement('p');
      msg.style.cssText = 'background:#e8e87a;padding:8px;';
      const missing = [];
      if (!innerOk) missing.push(this.config.inner.entity);
      if (!outerOk) missing.push(this.config.outer.entity);
      msg.innerHTML = 'Entity not found:<br>- ' + missing.join('<br>- ');
      this.card.appendChild(msg);
      this.appendChild(this.card);
      return;
    }

    this._updateGauge('inner');
    this._updateGauge('outer');
  }

  _getGaugeValue(gauge) {
    const cfg = this.config[gauge];
    if (cfg.template) {
      const v = this._templateValues[gauge];
      return v !== undefined ? v : '-';
    }
    return this._getEntityStateValue(this._hass.states[cfg.entity], cfg.attribute);
  }

  _getUnit(gauge) {
    const cfg = this.config[gauge];
    if (cfg.unit !== undefined) return cfg.unit;
    if (cfg.entity && this._hass.states[cfg.entity]) {
      return this._hass.states[cfg.entity].attributes.unit_of_measurement || '';
    }
    return '';
  }

  _updateGauge(gauge) {
    const cfg   = this.config[gauge];
    const value = this._getGaugeValue(gauge);
    const unit  = this._getUnit(gauge);

    this._setCssVariable(this.nodes.content, gauge + '-angle', this._calculateRotation(value, cfg));
    const formatted = this._formatValue(value, cfg);
    this.nodes[gauge].value.innerHTML = unit ? `${formatted} ${unit}` : formatted;
    if (cfg.label) this.nodes[gauge].label.innerHTML = cfg.label;

    const color = this._findColor(value, cfg);
    if (color) this._setCssVariable(this.nodes.content, gauge + '-color', color);

    if (this.config.show_minmax && this.nodes[gauge].min) {
      this.nodes[gauge].min.innerHTML = cfg.min;
      this.nodes[gauge].max.innerHTML = cfg.max;
    }
  }

  _showDetails(gauge) {
    const cfg = this.config[gauge];
    if (!cfg.entity) return;
    const event = new Event('hass-more-info', { bubbles: true, cancelable: false, composed: true });
    event.detail = { entityId: cfg.entity };
    this.card.dispatchEvent(event);
  }

  _formatValue(value, gaugeConfig) {
    const num = parseFloat(value);
    if (!Number.isFinite(num)) return '-';
    let precision = gaugeConfig.precision;
    if (precision == null || isNaN(precision)) precision = 2;
    return num.toFixed(Math.max(0, Math.min(10, parseInt(precision, 10))));
  }

  _getEntityStateValue(entity, attribute) {
    if (!attribute) return isNaN(entity.state) ? '-' : entity.state;
    return isNaN(entity.attributes[attribute]) ? '-' : entity.attributes[attribute];
  }

  _calculateRotation(value, gaugeConfig) {
    if (isNaN(value)) return '180deg';
    const clamped = Math.min(Math.max(parseFloat(value), gaugeConfig.min), gaugeConfig.max);
    return (180 + (5 * (clamped - gaugeConfig.min)) / (gaugeConfig.max - gaugeConfig.min) / 10 * 360) + 'deg';
  }

  _findColor(value, gaugeConfig) {
    if (!gaugeConfig.colors) return;
    for (let i = 0; i < gaugeConfig.colors.length - 1; i++) {
      if (value >= gaugeConfig.colors[i].value) return gaugeConfig.colors[i].color;
    }
    return gaugeConfig.colors[gaugeConfig.colors.length - 1].color;
  }

  _createCard() {
    if (this.card) this.card.remove();
    this.card = document.createElement('ha-card');
    if (this.config.header) this.card.header = this.config.header;
    const content = document.createElement('div');
    this.card.appendChild(content);
    this.styles = document.createElement('style');
    this.card.appendChild(this.styles);
    this.appendChild(this.card);

    content.classList.add('gauge-dual-card');

    const minMaxHtml = this.config.show_minmax ? `
      <div class="gauge-minmax">
        <span class="gauge-min-outer"></span>
        <span class="gauge-max-outer"></span>
      </div>` : '';

    content.innerHTML = `
      <div class="gauge-dual">
        <div class="gauge-frame">
          <div class="gauge-background circle-container"><div class="circle"></div></div>
          <div class="outer-gauge circle-container"><div class="circle"></div></div>
          <div class="inner-gauge circle-container small-circle"><div class="circle"></div></div>
          <div class="gauge-value gauge-value-outer"></div>
          <div class="gauge-label gauge-label-outer"></div>
          <div class="gauge-value gauge-value-inner"></div>
          <div class="gauge-label gauge-label-inner"></div>
          <div class="gauge-title"></div>
          ${minMaxHtml}
        </div>
      </div>
    `;

    this.nodes = {
      content,
      title: content.querySelector('.gauge-title'),
      outer: {
        value: content.querySelector('.gauge-value-outer'),
        label: content.querySelector('.gauge-label-outer'),
        min:   content.querySelector('.gauge-min-outer'),
        max:   content.querySelector('.gauge-max-outer'),
      },
      inner: {
        value: content.querySelector('.gauge-value-inner'),
        label: content.querySelector('.gauge-label-inner'),
      }
    };

    if (this.config.title) {
      this.nodes.title.innerHTML = this.config.title;
      this.nodes.title.addEventListener('click', () => this._showDetails('outer'));
    }

    this.nodes.outer.value.addEventListener('click', () => this._showDetails('outer'));
    this.nodes.inner.value.addEventListener('click', () => this._showDetails('inner'));

    if (this.config.shadeInner)                    content.classList.add('shadeInner');
    if (!this.config.title && !this.config.header) content.classList.add('no-title');

    if (this.config.cardwidth) {
      this._setCssVariable(content, 'gauge-card-width', this.config.cardwidth + 'px');
    } else {
      this._resizeObserver = new ResizeObserver(entries => {
        const w = entries[0].contentRect.width;
        if (w > 0) this._setCssVariable(content, 'gauge-card-width', w + 'px');
      });
      this._resizeObserver.observe(this.card);
    }

    if (this.config.background_color) {
      this._setCssVariable(content, 'gauge-background-color', this.config.background_color);
    }
    if (this.config.stroke_width != null) {
      this._setCssVariable(content, 'custom-gauge-width', this.config.stroke_width + 'px');
    }

    this._initStyles();
  }

  _setCssVariable(node, variable, value) {
    node.style.setProperty('--' + variable, value);
  }

  _initStyles() {
    const t          = this.config.animate ? '.5s linear' : 'none';
    const gaugeWidth = this.config.stroke_width != null
      ? 'var(--custom-gauge-width)'
      : 'calc(var(--gauge-card-width) / 10.5)';
    const cardW      = this.config.cardwidth ? 'var(--gauge-card-width)' : '100%';

    this.styles.innerHTML = `
      .gauge-dual-card {
        --gauge-card-width: 300px;
        --outer-color: var(--primary-color);
        --inner-color: var(--primary-color);
        --gauge-background-color: var(--secondary-background-color);
        --outer-angle: 90deg;
        --inner-angle: 90deg;
        --gauge-width: ${gaugeWidth};
        --value-font-size: calc(var(--gauge-card-width) / 17);
        --title-font-size: calc(var(--gauge-card-width) / 14);
        --label-font-size: calc(var(--gauge-card-width) / 20);
        --minmax-font-size: calc(var(--gauge-card-width) / 26);
        width: ${cardW};
        padding: 16px;
        box-sizing: border-box;
        margin: 6px auto;
      }
      .gauge-dual-card div { box-sizing: border-box; }
      .gauge-dual { overflow: hidden; width: 100%; height: 0; padding-bottom: 50%; }
      .gauge-frame { width: 100%; height: 0; padding-bottom: 100%; position: relative; }
      .circle {
        position: absolute; top: 0; left: 0;
        width: 100%; height: 200%;
        border-radius: 100%;
        border: var(--gauge-width) solid;
        transition: border-color ${t};
      }
      .circle-container {
        position: absolute; transform-origin: 50% 100%;
        top: 0; left: 0; height: 50%; width: 100%;
        overflow: hidden;
        transition: transform ${t};
      }
      .small-circle .circle { top: 20%; left: 10%; width: 80%; height: 160%; }
      .gauge-background .circle {
        border: calc(var(--gauge-width) * 2 - 2px) solid var(--gauge-background-color);
      }
      .gauge-title {
        position: absolute; bottom: 51%; margin-bottom: 0.1em;
        text-align: center; width: 100%;
        font-size: var(--title-font-size);
        cursor: pointer;
      }
      .gauge-value, .gauge-label {
        position: absolute; bottom: 50%; width: 48%;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .gauge-value {
        margin-bottom: 14%;
        font-size: var(--value-font-size);
        font-weight: bold;
        cursor: pointer;
      }
      .gauge-label { font-size: var(--label-font-size); margin-bottom: 10%; }
      .no-title .gauge-value { margin-bottom: 4%; }
      .no-title .gauge-label { margin-bottom: 0%; }
      .gauge-value-outer, .gauge-label-outer {
        right: 50%; text-align: right; padding-right: 8px; color: var(--outer-color);
      }
      .gauge-value-inner, .gauge-label-inner {
        left: 50%; text-align: left; padding-left: 8px; color: var(--inner-color);
      }
      .outer-gauge { transform: rotate(var(--outer-angle)); }
      .outer-gauge .circle { border-color: var(--outer-color); }
      .inner-gauge { transform: rotate(var(--inner-angle)); }
      .inner-gauge .circle { border-color: var(--inner-color); }
      .shadeInner .gauge-value-inner,
      .shadeInner .gauge-label-inner,
      .shadeInner .inner-gauge .circle { filter: brightness(75%); }
      .gauge-minmax {
        position: absolute; bottom: 0; width: 100%;
        display: flex; justify-content: space-between;
        font-size: var(--minmax-font-size);
        color: var(--secondary-text-color);
        padding: 0 4%;
      }
    `;
  }
}

// ---------------------------------------------------------------------------
//  Visual Editor  –  LitElement-based for reactive sync
// ---------------------------------------------------------------------------

const LitElement = Object.getPrototypeOf(customElements.get('ha-panel-lovelace') || customElements.get('hui-view') || HTMLElement);
const { html, css } = LitElement.prototype && LitElement.prototype.render ? LitElement : { html: String.raw, css: (s, ...v) => s.join('') };

const USE_LIT = LitElement !== HTMLElement;

class DualGaugeCardEditor extends (USE_LIT ? LitElement : HTMLElement) {

  // ---- LitElement reactive props ----
  static get properties() {
    return {
      hass:    { attribute: false },
      _config: { state: true },
    };
  }

  // ---- LitElement styles ----
  static get styles() {
    return USE_LIT ? (LitElement.styles || []) : [];
  }

  constructor() {
    super();
    this._config      = {};
    this._hass        = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (USE_LIT) {
      this.requestUpdate();
    } else {
      this.querySelectorAll('ha-entity-picker').forEach(p => { p.hass = hass; });
    }
  }

  get hass() { return this._hass; }

  setConfig(config) {
    this._config = JSON.parse(JSON.stringify(config));
    if (USE_LIT) {
      this.requestUpdate();
    } else {
      this._syncAllFields();
    }
  }

  // ---- Helpers ----

  _fire() {
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: JSON.parse(JSON.stringify(this._config)) },
      bubbles: true,
      composed: true,
    }));
  }

  _set(path, value) {
    const cfg   = JSON.parse(JSON.stringify(this._config));
    const parts = path.split('.');
    let obj = cfg;
    for (let i = 0; i < parts.length - 1; i++) {
      if (obj[parts[i]] == null) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    const key = parts[parts.length - 1];
    if (value === null || value === undefined || value === '') {
      delete obj[key];
    } else {
      obj[key] = value;
    }
    this._config = cfg;
    if (USE_LIT) this.requestUpdate();
    this._fire();
  }

  // ---- Rendering ----

  render() {
    if (!this._config) return USE_LIT ? html`` : '';
    const c = this._config;
    const o = c.outer || {};
    const i = c.inner || {};

    const content = this._buildEditorHTML(c, o, i);

    if (USE_LIT) {
      return html`${this._styleTag()}${content}`;
    } else {
      this.innerHTML = this._styleTag() + content;
      this._attachListeners();
    }
  }

  // ---- HTML template (used both by LitElement and plain HTMLElement) ----

  _buildEditorHTML(c, o, i) {
    const chk = (val) => val !== false ? 'checked' : '';

    const colorsHtml = (gauge, colors) => (colors || []).map((col, idx) => `
      <div class="color-row" data-gauge="${gauge}" data-idx="${idx}">
        <input class="cv" type="number" placeholder="≥ value" value="${col.value ?? ''}">
        <input class="cc" type="text" placeholder="var(--label-badge-green)" value="${col.color || ''}">
        <input class="cp" type="color" value="${this._toHex(col.color)}" title="Pick color">
        <button class="cd" title="Remove">✕</button>
      </div>
    `).join('');

    const outerMissing = !o.entity && !o.template ? 'dgce-error' : '';
    const innerMissing = !i.entity && !i.template ? 'dgce-error' : '';

    return `
      <div class="dgce">

        <h3>General</h3>

        <div class="fr">
          <label>Card title (ha-card header)</label>
          <input id="g-header" type="text" value="${c.header || ''}" placeholder="optional">
        </div>
        <div class="fr">
          <label>Title inside gauge</label>
          <input id="g-title" type="text" value="${c.title || ''}" placeholder="optional">
        </div>
        <div class="fr">
          <label>Precision (decimal places)</label>
          <input id="g-precision" type="number" min="0" max="10" value="${c.precision ?? 2}">
        </div>
        <div class="fr">
          <label>Card width px (empty = auto)</label>
          <input id="g-cardwidth" type="number" value="${c.cardwidth || ''}" placeholder="auto">
        </div>
        <div class="fr">
          <label>Stroke width px (empty = auto)</label>
          <input id="g-stroke" type="number" value="${c.stroke_width || ''}" placeholder="auto">
        </div>
        <div class="fr">
          <label>Background color (empty = auto)</label>
          <div class="color-pair">
            <input id="g-bgcolor-text" type="text" value="${c.background_color || ''}" placeholder="var(--secondary-background-color)">
            <input id="g-bgcolor-pick" type="color" value="${this._toHex(c.background_color)}" title="Pick color">
          </div>
        </div>
        <div class="fr">
          <label>Shade inner gauge</label>
          <input id="g-shade" type="checkbox" ${chk(c.shadeInner !== false)}>
        </div>
        <div class="fr">
          <label>Animate transitions</label>
          <input id="g-animate" type="checkbox" ${chk(c.animate !== false)}>
        </div>
        <div class="fr">
          <label>Show min / max labels</label>
          <input id="g-minmax" type="checkbox" ${chk(c.show_minmax)}>
        </div>

        <h3 class="${outerMissing}">Outer Gauge ${outerMissing ? '⚠ entity required' : ''}</h3>
        <div id="outer-picker-wrap"></div>
        <div class="fr">
          <label>Label</label>
          <input id="o-label" type="text" value="${o.label || ''}" placeholder="kW">
        </div>
        <div class="fr">
          <label>Unit (empty = from entity)</label>
          <input id="o-unit" type="text" value="${o.unit !== undefined ? o.unit : ''}" placeholder="auto">
        </div>
        <div class="fr">
          <label>Min</label>
          <input id="o-min" type="number" value="${o.min ?? 0}">
        </div>
        <div class="fr">
          <label>Max</label>
          <input id="o-max" type="number" value="${o.max ?? 100}">
        </div>
        <div class="fr">
          <label>Precision override (empty = inherit)</label>
          <input id="o-precision" type="number" min="0" max="10" value="${o.precision != null && o.precision !== c.precision ? o.precision : ''}" placeholder="inherit">
        </div>
        <div class="colors-section">
          <span>Color thresholds — applied when value ≥ threshold</span>
          <div class="colors-list-outer">${colorsHtml('outer', o.colors)}</div>
          <button class="add-btn add-outer">+ Add threshold</button>
        </div>

        <h3 class="${innerMissing}">Inner Gauge ${innerMissing ? '⚠ entity required' : ''}</h3>
        <div id="inner-picker-wrap"></div>
        <div class="fr">
          <label>Label</label>
          <input id="i-label" type="text" value="${i.label || ''}" placeholder="Amp">
        </div>
        <div class="fr">
          <label>Unit (empty = from entity)</label>
          <input id="i-unit" type="text" value="${i.unit !== undefined ? i.unit : ''}" placeholder="auto">
        </div>
        <div class="fr">
          <label>Min</label>
          <input id="i-min" type="number" value="${i.min ?? 0}">
        </div>
        <div class="fr">
          <label>Max</label>
          <input id="i-max" type="number" value="${i.max ?? 100}">
        </div>
        <div class="fr">
          <label>Precision override (empty = inherit)</label>
          <input id="i-precision" type="number" min="0" max="10" value="${i.precision != null && i.precision !== c.precision ? i.precision : ''}" placeholder="inherit">
        </div>
        <div class="colors-section">
          <span>Color thresholds — applied when value ≥ threshold</span>
          <div class="colors-list-inner">${colorsHtml('inner', i.colors)}</div>
          <button class="add-btn add-inner">+ Add threshold</button>
        </div>

      </div>
    `;
  }

  _styleTag() {
    const s = `
      <style>
        .dgce { padding: 16px 0; }
        .dgce h3 {
          margin: 20px 0 10px;
          padding-bottom: 6px;
          border-bottom: 1px solid var(--divider-color);
          font-size: 12px; font-weight: 600;
          text-transform: uppercase; letter-spacing: .06em;
          color: var(--secondary-text-color);
        }
        .dgce h3:first-child { margin-top: 0; }
        .dgce h3.dgce-error { color: var(--error-color); border-color: var(--error-color); }
        .fr {
          display: flex; align-items: center;
          justify-content: space-between;
          margin-bottom: 10px; gap: 10px;
        }
        .fr label { font-size: 14px; color: var(--primary-text-color); flex: 1; min-width: 0; }
        .fr input[type=text],
        .fr input[type=number] {
          width: 150px; padding: 6px 8px;
          border: 1px solid var(--divider-color);
          border-radius: 4px;
          background: var(--card-background-color);
          color: var(--primary-text-color);
          font-size: 14px; flex-shrink: 0;
        }
        .fr input[type=checkbox] { width: 18px; height: 18px; cursor: pointer; flex-shrink: 0; }
        .color-pair { display: flex; gap: 6px; align-items: center; }
        .color-pair input[type=text] { width: 120px; }
        input[type=color] {
          width: 32px; height: 32px; padding: 2px; border-radius: 4px;
          border: 1px solid var(--divider-color); cursor: pointer;
          background: none; flex-shrink: 0;
        }
        ha-entity-picker { display: block; width: 100%; margin-bottom: 10px; }
        .colors-section > span {
          display: block; font-size: 12px;
          color: var(--secondary-text-color); margin-bottom: 6px;
        }
        .color-row {
          display: flex; gap: 6px; align-items: center; margin-bottom: 4px;
        }
        .color-row .cv {
          width: 80px; padding: 4px 6px;
          border: 1px solid var(--divider-color); border-radius: 4px;
          background: var(--card-background-color);
          color: var(--primary-text-color); font-size: 13px; flex-shrink: 0;
        }
        .color-row .cc {
          flex: 1; padding: 4px 6px; min-width: 60px;
          border: 1px solid var(--divider-color); border-radius: 4px;
          background: var(--card-background-color);
          color: var(--primary-text-color); font-size: 13px;
        }
        .color-row .cp {
          width: 28px; height: 28px; flex-shrink: 0;
        }
        .color-row .cd {
          background: none; border: none; cursor: pointer;
          color: var(--error-color); font-size: 15px; padding: 2px 4px; flex-shrink: 0;
        }
        .add-btn {
          display: block; width: 100%; margin-top: 6px;
          padding: 5px; border-radius: 4px;
          border: 1px dashed var(--primary-color);
          background: none; color: var(--primary-color);
          cursor: pointer; font-size: 13px;
        }
        .add-btn:hover { background: var(--primary-color); color: white; }
      </style>
    `;
    if (USE_LIT) {
      // Return as template literal for LitElement
      return s;
    }
    return s;
  }

  // ---- After DOM is updated, inject entity pickers and listeners ----

  updated() {
    // LitElement calls this after render()
    this._injectPickers();
    this._attachListeners();
  }

  connectedCallback() {
    if (USE_LIT) {
      super.connectedCallback && super.connectedCallback();
    } else {
      this.render();
    }
  }

  _injectPickers() {
    for (const gauge of ['outer', 'inner']) {
      const wrap = this.querySelector(`#${gauge}-picker-wrap`);
      if (!wrap || wrap.querySelector('ha-entity-picker')) continue;
      const cfg    = this._config[gauge] || {};
      const picker = document.createElement('ha-entity-picker');
      picker.className = `entity-picker-${gauge}`;
      picker.hass      = this._hass;
      picker.value     = cfg.entity || '';
      picker.label     = 'Entity';
      picker.allowCustomEntity = false;
      picker.addEventListener('value-changed', e => {
        const v = e.detail.value;
        const updated = JSON.parse(JSON.stringify(this._config));
        if (!updated[gauge]) updated[gauge] = {};
        if (v) {
          updated[gauge].entity = v;
          delete updated[gauge].template;
        } else {
          delete updated[gauge].entity;
        }
        this._config = updated;
        if (USE_LIT) this.requestUpdate();
        this._fire();
      });
      wrap.appendChild(picker);
    }

    // Sync hass on existing pickers
    this.querySelectorAll('ha-entity-picker').forEach(p => { p.hass = this._hass; });
  }

  _attachListeners() {
    // Prevent double-binding by using a flag on the root element
    const root = this.querySelector('.dgce');
    if (!root || root._listenersAttached) return;
    root._listenersAttached = true;

    const bind = (id, path, transform) => {
      const el = this.querySelector(`#${id}`);
      if (!el || el._bound) return;
      el._bound = true;
      el.addEventListener('change', e => {
        const raw = el.type === 'checkbox' ? el.checked : e.target.value;
        this._set(path, transform ? transform(raw) : raw);
      });
    };

    bind('g-header',     'header',        v => v || null);
    bind('g-title',      'title',         v => v || null);
    bind('g-precision',  'precision',     v => v !== '' ? parseInt(v) : null);
    bind('g-cardwidth',  'cardwidth',     v => v ? parseInt(v) : null);
    bind('g-stroke',     'stroke_width',  v => v ? parseInt(v) : null);
    bind('g-shade',      'shadeInner',    v => v);
    bind('g-animate',    'animate',       v => v);
    bind('g-minmax',     'show_minmax',   v => v);

    // Background color — text + native picker in sync
    const bgText = this.querySelector('#g-bgcolor-text');
    const bgPick = this.querySelector('#g-bgcolor-pick');
    if (bgText && !bgText._bound) {
      bgText._bound = true;
      bgText.addEventListener('change', e => {
        const v = e.target.value || null;
        if (bgPick) bgPick.value = this._toHex(v);
        this._set('background_color', v);
      });
    }
    if (bgPick && !bgPick._bound) {
      bgPick._bound = true;
      bgPick.addEventListener('input', e => {
        if (bgText) bgText.value = e.target.value;
        this._set('background_color', e.target.value);
      });
    }

    for (const [g, p] of [['o', 'outer'], ['i', 'inner']]) {
      bind(`${g}-label`,     `${p}.label`,     v => v || null);
      bind(`${g}-unit`,      `${p}.unit`,      v => v !== '' ? v : null);
      bind(`${g}-min`,       `${p}.min`,       v => parseFloat(v));
      bind(`${g}-max`,       `${p}.max`,       v => parseFloat(v));
      bind(`${g}-precision`, `${p}.precision`, v => v !== '' ? parseInt(v) : null);
    }

    // Color rows (delegated on containers)
    for (const gauge of ['outer', 'inner']) {
      const container = this.querySelector(`.colors-list-${gauge}`);
      if (container && !container._bound) {
        container._bound = true;
        container.addEventListener('change', e => {
          const row = e.target.closest('.color-row');
          if (!row) return;
          const idx = parseInt(row.dataset.idx);
          const cfg = JSON.parse(JSON.stringify(this._config));
          if (!cfg[gauge].colors) cfg[gauge].colors = [];
          if (e.target.classList.contains('cv')) {
            cfg[gauge].colors[idx].value = parseFloat(e.target.value);
          } else if (e.target.classList.contains('cc')) {
            cfg[gauge].colors[idx].color = e.target.value;
            // sync color picker
            const cp = row.querySelector('.cp');
            if (cp) cp.value = this._toHex(e.target.value);
          }
          this._config = cfg;
          if (USE_LIT) this.requestUpdate();
          this._fire();
        });
        container.addEventListener('input', e => {
          if (!e.target.classList.contains('cp')) return;
          const row = e.target.closest('.color-row');
          if (!row) return;
          const idx = parseInt(row.dataset.idx);
          const cfg = JSON.parse(JSON.stringify(this._config));
          if (!cfg[gauge].colors) cfg[gauge].colors = [];
          cfg[gauge].colors[idx].color = e.target.value;
          // sync text input
          const cc = row.querySelector('.cc');
          if (cc) cc.value = e.target.value;
          this._config = cfg;
          if (USE_LIT) this.requestUpdate();
          this._fire();
        });
        container.addEventListener('click', e => {
          if (!e.target.classList.contains('cd')) return;
          const row = e.target.closest('.color-row');
          if (!row) return;
          const idx = parseInt(row.dataset.idx);
          const cfg = JSON.parse(JSON.stringify(this._config));
          cfg[gauge].colors.splice(idx, 1);
          this._config = cfg;
          if (USE_LIT) this.requestUpdate();
          else this._rebuildColorList(gauge);
          this._fire();
        });
      }
    }

    // Add threshold buttons
    const addOuter = this.querySelector('.add-outer');
    const addInner = this.querySelector('.add-inner');
    if (addOuter && !addOuter._bound) {
      addOuter._bound = true;
      addOuter.addEventListener('click', () => {
        const cfg = JSON.parse(JSON.stringify(this._config));
        if (!cfg.outer.colors) cfg.outer.colors = [];
        cfg.outer.colors.push({ value: 0, color: '' });
        this._config = cfg;
        if (USE_LIT) this.requestUpdate();
        else this._rebuildColorList('outer');
        this._fire();
      });
    }
    if (addInner && !addInner._bound) {
      addInner._bound = true;
      addInner.addEventListener('click', () => {
        const cfg = JSON.parse(JSON.stringify(this._config));
        if (!cfg.inner.colors) cfg.inner.colors = [];
        cfg.inner.colors.push({ value: 0, color: '' });
        this._config = cfg;
        if (USE_LIT) this.requestUpdate();
        else this._rebuildColorList('inner');
        this._fire();
      });
    }
  }

  // Fallback for plain HTMLElement path: rebuild only the color list rows
  _rebuildColorList(gauge) {
    const container = this.querySelector(`.colors-list-${gauge}`);
    if (!container) return;
    const colors = this._config[gauge]?.colors || [];
    container.innerHTML = colors.map((c, idx) => `
      <div class="color-row" data-gauge="${gauge}" data-idx="${idx}">
        <input class="cv" type="number" placeholder="≥ value" value="${c.value ?? ''}">
        <input class="cc" type="text" placeholder="var(--label-badge-green)" value="${c.color || ''}">
        <input class="cp" type="color" value="${this._toHex(c.color)}" title="Pick color">
        <button class="cd" title="Remove">✕</button>
      </div>
    `).join('');
    // Re-apply heading error state
    this._syncValidation();
  }

  _syncValidation() {
    for (const gauge of ['outer', 'inner']) {
      const h = this.querySelector(`h3.${gauge === 'outer' ? '' : ''}`)
      // find all h3, check which one belongs to inner/outer by text content
      this.querySelectorAll('h3').forEach(h3 => {
        const txt = h3.textContent.toLowerCase();
        if (txt.includes(gauge + ' gauge')) {
          const cfg = this._config[gauge] || {};
          const missing = !cfg.entity && !cfg.template;
          h3.classList.toggle('dgce-error', missing);
          h3.textContent = (gauge.charAt(0).toUpperCase() + gauge.slice(1)) + ' Gauge' + (missing ? ' ⚠ entity required' : '');
        }
      });
    }
  }

  // Plain HTMLElement: sync all field values when setConfig is called
  _syncAllFields() {
    if (!this.querySelector('.dgce')) { this.render(); return; }
    const c = this._config;
    const o = c.outer || {};
    const i = c.inner || {};

    const set = (id, val) => { const el = this.querySelector(`#${id}`); if (el) el.value = val ?? ''; };
    const setChk = (id, val) => { const el = this.querySelector(`#${id}`); if (el) el.checked = !!val; };

    set('g-header',    c.header    || '');
    set('g-title',     c.title     || '');
    set('g-precision', c.precision ?? 2);
    set('g-cardwidth', c.cardwidth || '');
    set('g-stroke',    c.stroke_width || '');
    set('g-bgcolor-text', c.background_color || '');
    set('g-bgcolor-pick', this._toHex(c.background_color));
    setChk('g-shade',   c.shadeInner !== false);
    setChk('g-animate', c.animate   !== false);
    setChk('g-minmax',  c.show_minmax);

    set('o-label',     o.label     || '');
    set('o-unit',      o.unit      !== undefined ? o.unit : '');
    set('o-min',       o.min       ?? 0);
    set('o-max',       o.max       ?? 100);
    set('o-precision', o.precision != null && o.precision !== c.precision ? o.precision : '');

    set('i-label',     i.label     || '');
    set('i-unit',      i.unit      !== undefined ? i.unit : '');
    set('i-min',       i.min       ?? 0);
    set('i-max',       i.max       ?? 100);
    set('i-precision', i.precision != null && i.precision !== c.precision ? i.precision : '');

    this._rebuildColorList('outer');
    this._rebuildColorList('inner');

    // Sync entity pickers
    for (const gauge of ['outer', 'inner']) {
      const p = this.querySelector(`.entity-picker-${gauge}`);
      const cfg = this._config[gauge] || {};
      if (p) { p.value = cfg.entity || ''; p.hass = this._hass; }
    }

    this._syncValidation();
  }

  // ---- Utility: convert CSS variable or hex to #rrggbb for input[type=color] ----
  _toHex(color) {
    if (!color) return '#000000';
    if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
    if (/^#[0-9a-fA-F]{3}$/.test(color)) {
      const [, r, g, b] = color.match(/^#(.)(.)(.)$/);
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    // CSS variable or named color — fall back to black; can't resolve without DOM
    return '#000000';
  }
}

// ---------------------------------------------------------------------------
//  Registration
// ---------------------------------------------------------------------------

customElements.define('dual-gauge-card',        DualGaugeCard);
customElements.define('dual-gauge-card-editor', DualGaugeCardEditor);

// Register in HA card picker
window.customCards = window.customCards || [];
window.customCards.push({
  type:        'dual-gauge-card',
  name:        'Dual Gauge Card',
  description: 'Displays two concentric gauge arcs for any two numeric entities.',
  preview:     false,
});
