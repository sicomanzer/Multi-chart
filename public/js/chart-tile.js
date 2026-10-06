/**
 * Chart tile: one symbol, one timeframe, N indicator instances.
 *
 * lightweight-charts v5 supports real multi-pane charts, which is what makes the
 * "price pane + RSI pane + MACD pane" layout in the brief possible without
 * stitching several charts together and syncing them by hand.
 *
 * Pane assignment rules:
 *   - overlay indicators live on pane 0 together with the price series
 *   - every pane indicator gets its own pane (index 1..n), in the order the
 *     user added them, and its height is user-settable
 *   - panes are rebuilt from scratch whenever the indicator list changes, which
 *     is cheaper to reason about than incremental add/remove bookkeeping
 *
 * The tile owns nothing but its own DOM node and series; the board owns
 * crosshair syncing, subscriptions and persistence.
 */
import { computeIndicator } from './ta.js';
import { formatPrice, formatCompact, formatMetric } from './format.js';

const {
  createChart,
  CandlestickSeries,
  BarSeries,
  LineSeries,
  HistogramSeries,
  AreaSeries,
  BaselineSeries,
  createSeriesMarkers,
  LineStyle,
  CrosshairMode,
  ColorType,
  PriceScaleMode,
} = window.LightweightCharts;

const MAIN_PANE = 0;

const CHART_SERIES = {
  candles: CandlestickSeries,
  bars: BarSeries,
  line: LineSeries,
  area: AreaSeries,
  baseline: BaselineSeries,
  heikin: CandlestickSeries,
};

export class ChartTile {
  /**
   * @param {HTMLElement} host element the tile owns
   * @param {object} config { id, symbol, timeframe, chartType, logScale, indicators, settings }
   * @param {object} catalog indicator catalog keyed by type
   */
  constructor(host, config, catalog, callbacks = {}) {
    this.host = host;
    this.config = config;
    this.catalog = catalog;
    this.callbacks = callbacks;

    this.bars = [];
    this.quote = null;
    this.fundamentals = null;   // { pe: {value, kind}, … } for this symbol
    this._fundamentalsPending = false;
    this.metricLabels = callbacks.metricLabels ?? {}; // metric key -> { label, hint }
    this.seriesRefs = [];      // lightweight-charts series created by this tile
    this.priceLines = [];      // createPriceLine handles, per main-pane series
    this.paneByIndicator = new Map(); // indicatorId -> pane index
    this.destroyed = false;
    this.loading = false;
    // Bar spacing the user asked for; `null` means "fit the loaded range". A
    // value here suppresses auto-fit so a candle refresh cannot yank the view.
    this.zoomSpacing = null;
    // Display precision, replaced by the price hint once bars arrive.
    this._precision = 2;

    this._buildChrome();
    this._buildChart();
    this.render();
  }

  // ── DOM ────────────────────────────────────────────────────────────────────

  _buildChrome() {
    const { symbol, timeframe } = this.config;
    const badge = symbol.split(':')[1] ?? symbol;
    const ex = symbol.split(':')[0] ?? '';

    // The board owns the host element (`tile-host`); the tile renders inside its
    // own wrapper so the two class vocabularies never collide.
    this.root = document.createElement('div');
    this.root.className = 'tile';
    this.root.innerHTML = `
      <header class="tile__bar">
        <button class="tile__title" type="button" title="Change symbol / settings">
          <span class="tile__badge">${ex}</span>
          <span class="tile__symbol">${escapeHtml(badge)}</span>
          <span class="tile__name" data-role="name"></span>
        </button>
        <div class="tile__price">
          <span class="tile__last" data-role="last">—</span>
          <span class="tile__change" data-role="change"></span>
        </div>
        <div class="tile__tools">
          <span class="tile__tf" data-role="tf" title="Timeframe">${timeframe}</span>
          <button class="icon-btn" data-act="indicators" title="Add indicator">ƒx</button>
          <button class="icon-btn" data-act="settings" title="Chart settings">⚙</button>
          <button class="icon-btn" data-act="focus" title="Maximise">⛶</button>
          <button class="icon-btn" data-act="close" title="Close chart">✕</button>
        </div>
      </header>
      <div class="tile__panes" data-role="panes"></div>
      <div class="tile__status" data-role="status" hidden></div>
      <footer class="tile__footer" data-role="footer">
        <div class="tile__fundamentals" data-role="fundamentals" hidden></div>
        <div class="tile__legend" data-role="legend"></div>
      </footer>
    `;
    this.host.appendChild(this.root);

    this.el = {
      name: this.root.querySelector('[data-role="name"]'),
      last: this.root.querySelector('[data-role="last"]'),
      change: this.root.querySelector('[data-role="change"]'),
      panes: this.root.querySelector('[data-role="panes"]'),
      status: this.root.querySelector('[data-role="status"]'),
      legend: this.root.querySelector('[data-role="legend"]'),
      fundamentals: this.root.querySelector('[data-role="fundamentals"]'),
      tf: this.root.querySelector('[data-role="tf"]'),
    };

    this.root.querySelector('[data-act="indicators"]')
      .addEventListener('click', () => this.callbacks.onAddIndicator?.(this));
    this.root.querySelector('[data-act="settings"]')
      .addEventListener('click', () => this.callbacks.onEditChart?.(this));
    this.root.querySelector('[data-act="focus"]')
      .addEventListener('click', () => this.callbacks.onFocus?.(this));
    this.root.querySelector('[data-act="close"]')
      .addEventListener('click', () => this.callbacks.onRemove?.(this));
    this.root.querySelector('.tile__title')
      .addEventListener('click', () => this.callbacks.onEditChart?.(this));
  }

  _buildChart() {
    const s = this.config.settings ?? {};
    const theme = this.callbacks.getTheme?.() ?? 'dark';

    this.chart = createChart(this.el.panes, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: theme === 'dark' ? '#8b93a7' : '#4a5568',
        fontSize: 10,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        attributionLogo: false,
        panes: { separatorColor: theme === 'dark' ? '#1d2433' : '#d8dee9', separatorHoverColor: '#2f6df6', enableResize: true },
      },
      grid: {
        vertLines: { color: s.showGrid ? gridColor(theme, 0.05) : 'transparent' },
        horzLines: { color: s.showGrid ? gridColor(theme, 0.05) : 'transparent' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#5b6b8c', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#2f6df6' },
        horzLine: { color: '#5b6b8c', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#2f6df6' },
      },
      rightPriceScale: {
        borderColor: gridColor(theme, 0.18),
        scaleMargins: { top: 0.12, bottom: 0.12 },
        entireTextOnly: true,
      },
      timeScale: {
        borderColor: gridColor(theme, 0.18),
        timeVisible: this.config.timeframe !== '1d' && this.config.timeframe !== '1w' && this.config.timeframe !== '1M',
        secondsVisible: false,
        rightOffset: 2,
        barSpacing: 7,
        minBarSpacing: 0.5,
        fixLeftEdge: true,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: { time: true, price: false }, mouseWheel: true, pinch: true },
      localization: {
        priceFormatter: (price) => formatPrice(price, this._precision),
      },
    });

    // Crosshair relay: the board decides whether to mirror it across tiles.
    this.chart.subscribeCrosshairMove((param) => {
      this.callbacks.onCrosshair?.(this, param);
    });
    this.chart.subscribeClick((param) => {
      if (param.time) this.callbacks.onTimeClick?.(this, param.time, param.point);
    });
    // Remember any manual zoom (wheel or drag) so a candle refresh cannot undo
    // it. Without this the user scrolls one chart, walks away, and comes back to
    // a refitted view.
    //
    // The time scale also reports range changes for reasons that are *not* the
    // user — new bars arriving, our own auto-fit, `applyOptions` — so listening
    // to those would pin the view and stop later bars from extending it. A DOM
    // gesture is the only trustworthy signal; see `_noteZoomGesture`.
    // Capture phase, deliberately: the library handles the wheel on an inner
    // pane element, so a bubbling listener here would run *after* the scaling
    // was applied and see no change to measure.
    this.el.panes.addEventListener('wheel', () => this._noteZoomGesture(), { capture: true, passive: true });
    this.el.panes.addEventListener('pointerdown', () => this._noteZoomGesture(), { capture: true });

    // The chart auto-sizes itself, but pane heights are explicit, so they have
    // to be re-applied whenever the tile changes size.
    // The footer trim depends on the tile width, so it has to be re-run when
    // the tile resizes (auto-fit changes the column width on every window
    // resize).
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => {
        clearTimeout(this._resizeTimer);
        this._resizeTimer = setTimeout(() => {
          this._applyPaneHeights();
          if (this.fundamentals) this.renderFooter();
        }, 60);
      });
      this._resizeObserver.observe(this.el.panes);
    }
  }

  // ── Data ───────────────────────────────────────────────────────────────────

  setBars(payload) {
    this.bars = payload?.bars ?? [];
    this._precision = payload?.meta?.priceHint ?? this._precision;
    this.el.name.textContent = payload?.meta?.name ?? '';
    this.render();
  }

  setQuote(quote) {
    if (!quote) return;
    const previous = this.quote?.price;
    this.quote = quote;

    this.el.last.textContent = quote.price != null
      ? formatPrice(quote.price, this._precision)
      : '—';

    const pct = quote.changePercent ?? this._computeChangePct(quote);
    if (pct == null) {
      this.el.change.textContent = '';
      this.el.change.className = 'tile__change';
    } else {
      const up = pct >= 0;
      this.el.change.textContent = `${up ? '+' : ''}${pct.toFixed(2)}%`;
      this.el.change.className = `tile__change ${up ? 'is-up' : 'is-down'}`;
      if (previous != null && quote.price != null && previous !== quote.price) {
        this.el.last.classList.remove('flash-up', 'flash-down');
        void this.el.last.offsetWidth; // restart the CSS animation
        this.el.last.classList.add(quote.price > previous ? 'flash-up' : 'flash-down');
      }
    }

    // Update the forming candle in place so intraday boards move without a
    // full refetch.
    if (quote.price != null && this.bars.length) {
      const last = this.bars[this.bars.length - 1];
      const live = this._isLiveBar(last);
      if (live) {
        last.close = quote.price;
        last.high = Math.max(last.high, quote.price);
        last.low = Math.min(last.low, quote.price);
        this._mainSeries?.update({
          time: last.time,
          open: last.open,
          high: last.high,
          low: last.low,
          close: last.close,
        });
        // Indicator series are left alone: they are derived from whole bars and
        // only change on a candle refresh (see `refreshIntraday` in the board).
        // Re-pushing individual points here fights the library's update rules.
      }
    }
  }

  _computeChangePct(quote) {
    if (quote.change != null && quote.prevClose) return (quote.change / quote.prevClose) * 100;
    return null;
  }

  /** True when the last bar is still forming for this timeframe. */
  _isLiveBar(bar) {
    const secs = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800 }[this.config.timeframe];
    if (!secs) return false;
    return Date.now() / 1000 - bar.time < secs * 1.2;
  }

  setError(message) {
    this.el.status.hidden = !message;
    this.el.status.textContent = message ?? '';
  }

  setLoading(loading) {
    this.loading = loading;
    this.host.classList.toggle('is-loading', loading);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  /** Rebuild every series from the current bars + indicator list. */
  render() {
    if (this.destroyed) return;
    this.host.dataset.chartId = this.config.id;
    this.host.dataset.timeframe = this.config.timeframe;

    this._teardownPanes();
    this._renderPriceSeries();
    this._renderIndicators();

    this.el.tf.textContent = this.config.timeframe;
    this.root.dataset.chartType = this.config.chartType;
    this.host.dataset.chartType = this.config.chartType;
    this.renderFooter();
  }

  // ── Footer strip (fundamentals + indicator values) ────────────────────────

  /** Paint the strip under the chart from the current fundamentals payload. */
  renderFooter() {
    const settings = this.config.settings ?? {};
    const mode = settings.footerMode ?? 'both';
    const node = this.el.fundamentals;
    if (!node) return;

    if (mode === 'indicators') {
      node.hidden = true;
      node.innerHTML = '';
      return;
    }

    const metrics = settings.footerMetrics ?? [];
    const data = this.fundamentals;
    const narrow = this.host.clientWidth > 0 && this.host.clientWidth < 330;

    if (!data || metrics.length === 0) {
      node.hidden = false;
      node.innerHTML = `<span class="tile__fundamentals__pending">${this._fundamentalsPending ? 'loading ratios…' : 'no fundamental data'}</span>`;
      return;
    }

    const parts = metrics.map((key) => {
      const entry = data[key];
      const label = this.metricLabels?.[key]?.label ?? key.toUpperCase();
      const title = [label, this.metricLabels?.[key]?.hint, entry?.value == null ? 'not reported' : null]
        .filter(Boolean).join(' · ');
      const tone = entry?.value == null ? '' : entry.kind === 'percent' ? 'is-up' : '';
      return { key, html: `<span class="tile__metric" title="${escapeHtml(title)}">`
        + `<b>${escapeHtml(label)}</b><i class="${tone}">${escapeHtml(formatMetric(entry, { compact: narrow }))}</i>`
        + '</span>' };
    });

    node.hidden = false;
    // Show as many metrics as the tile can hold: a narrow chart with eight
    // ratios would otherwise clip the last ones with no indication. The full
    // set stays in the tooltip.
    let shown = parts;
    const overflows = () => node.scrollWidth > node.clientWidth + 1;
    node.innerHTML = parts.map((p) => p.html).join('');
    while (shown.length > 1 && overflows()) {
      shown = shown.slice(0, -1);
      node.innerHTML = shown.map((p) => p.html).join('');
    }
    if (shown.length < parts.length) {
      const hiddenKeys = parts.slice(shown.length).map((p) => p.key);
      node.title = `not shown (no room): ${hiddenKeys.join(', ')}`;
    } else {
      node.removeAttribute('title');
    }
  }

  setFundamentals(data, { pending = false } = {}) {
    this.fundamentals = data ?? null;
    this._fundamentalsPending = pending;
    this.renderFooter();
  }

  _teardownPanes() {
    for (const ref of this.seriesRefs) {
      try { this.chart.removeSeries(ref.series); } catch { /* already gone */ }
      try { ref.markerPlugin?.setMarkers([]); } catch { /* no-op */ }
    }
    this.seriesRefs = [];
    this.priceLines = [];

    // Drop every pane except the first; overlay indicators live there.
    while (this.chart.panes().length > 1) {
      this.chart.removePane(this.chart.panes().length - 1);
    }
    this.paneByIndicator.clear();
  }

  _renderPriceSeries() {
    const s = this.config.settings ?? {};
    const definition = CHART_SERIES[this.config.chartType] ?? CandlestickSeries;
    const isCandleLike = definition === CandlestickSeries || definition === BarSeries;
    const precision = this._precision ?? 2;

    const options = {
      priceLineVisible: true,
      lastValueVisible: true,
      priceFormat: { type: 'price', precision, minMove: 10 ** -precision },
    };

    if (definition === CandlestickSeries) {
      const bars = this.config.chartType === 'heikin'
        ? barsToHeikinAshi(this.bars)
        : this.bars;
      Object.assign(options, {
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderUpColor: '#26a69a',
        borderDownColor: '#ef5350',
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
        borderVisible: false,
      });
      this._mainSeries = this.chart.addSeries(definition, options, MAIN_PANE);
      this._mainSeries.setData(bars.map(toCandle));
      this._attachPriceLines(this._mainSeries);
    } else if (definition === BarSeries) {
      Object.assign(options, { upColor: '#26a69a', downColor: '#ef5350', thinBars: false });
      this._mainSeries = this.chart.addSeries(definition, options, MAIN_PANE);
      this._mainSeries.setData(this.bars.map((b) => ({
        time: b.time, open: b.open, high: b.high, low: b.low, close: b.close,
      })));
      this._attachPriceLines(this._mainSeries);
    } else if (definition === AreaSeries) {
      Object.assign(options, {
        lineColor: '#2962ff', lineWidth: 2, topColor: 'rgba(41,98,255,0.28)', bottomColor: 'rgba(41,98,255,0.02)',
      });
      this._mainSeries = this.chart.addSeries(definition, options, MAIN_PANE);
      this._mainSeries.setData(this.bars.map(toValue));
      this._attachPriceLines(this._mainSeries);
    } else if (definition === BaselineSeries) {
      Object.assign(options, {
        topLineColor: '#26a69a', bottomLineColor: '#ef5350', lineWidth: 2,
        topFillColor1: 'rgba(38,166,154,0.22)', topFillColor2: 'rgba(38,166,154,0.02)',
        bottomFillColor1: 'rgba(239,83,80,0.02)', bottomFillColor2: 'rgba(239,83,80,0.22)',
        baselineValue: this.bars.length ? this.bars[0].open : 0,
      });
      this._mainSeries = this.chart.addSeries(definition, options, MAIN_PANE);
      this._mainSeries.setData(this.bars.map(toValue));
      this._attachPriceLines(this._mainSeries);
    } else {
      Object.assign(options, { color: '#2962ff', lineWidth: 2 });
      this._mainSeries = this.chart.addSeries(LineSeries, options, MAIN_PANE);
      this._mainSeries.setData(this.bars.map(toValue));
      this._attachPriceLines(this._mainSeries);
    }

    this.seriesRefs.push({ series: this._mainSeries, pane: MAIN_PANE, kind: 'price' });
    this._mainSeries.applyOptions({ priceScaleMode: this.config.logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal });

    if (s.showWatermark && this.bars.length) {
      const mark = this.bars[this.bars.length - 1];
      this._mainMarkerPlugin = createSeriesMarkers(this._mainSeries, [{
        time: mark.time,
        position: 'aboveBar',
        color: mark.close >= mark.open ? '#26a69a' : '#ef5350',
        shape: mark.close >= mark.open ? 'arrowUp' : 'arrowDown',
        text: `${formatPrice(mark.close, this._precision)}`,
      }]);
    } else {
      this._mainMarkerPlugin = null;
    }

    if (isCandleLike || definition === LineSeries) this._maybeFit();
  }

  /** Draw the horizontal price levels configured for this chart. */
  _attachPriceLines(series) {
    const levels = this.config.priceLines ?? [];
    for (const level of levels) {
      const value = Number(level.value);
      if (!Number.isFinite(value)) continue;
      const handle = series.createPriceLine({
        price: value,
        color: level.color ?? '#f7a600',
        lineWidth: level.width ?? 1,
        lineStyle: level.style === 'dashed' ? LineStyle.Dashed
          : level.style === 'dotted' ? LineStyle.Dotted
          : LineStyle.Solid,
        axisLabelVisible: level.label !== false,
        title: level.title ?? '',
      });
      this.priceLines.push(handle);
    }
  }

  _renderIndicators() {
    this.paneByIndicator.clear();
    this._paneHeights = [];
    const legendRows = [];

    for (const instance of this.config.indicators ?? []) {
      if (instance.enabled === false) continue;
      const def = this.catalog[instance.type];
      if (!def) continue;

      const result = computeIndicator(instance.type, this.bars, instance.params);
      if (!result) continue;

      const wantsOwnPane = (instance.placement ?? def.placement) === 'pane';
      const paneIndex = wantsOwnPane ? this._ensurePane(instance, def) : MAIN_PANE;

      // Band fills go in first so the band's own lines draw on top of them.
      if (!wantsOwnPane) this._addBandFills(result, paneIndex);

      for (const plot of result.plots) {
        const series = this._addPlotSeries(plot, paneIndex, instance);
        if (!series) continue;

        if (plot.priceScaleId) {
          this._ensureOverlayScale(paneIndex, plot.priceScaleId);
          series.applyOptions({ priceScaleId: plot.priceScaleId });
        }

        for (const level of result.levels ?? []) {
          series.createPriceLine({
            price: level.value,
            color: level.color ?? '#787b86',
            lineWidth: level.width ?? 1,
            lineStyle: level.lineStyle === 'dashed' ? LineStyle.Dashed
              : level.lineStyle === 'dotted' ? LineStyle.Dotted
              : LineStyle.Solid,
            axisLabelVisible: false,
            title: '',
          });
        }

        if (plot.key === result.plots[0]?.key) {
          legendRows.push({
            id: instance.id,
            label: def.short,
            color: plot.color ?? '#2962ff',
            values: this._legendValues(result),
          });
        }
      }

      if (result.fixed) this._pinScale(paneIndex);
    }

    this._applyPaneHeights();
    this._renderLegend(legendRows);
  }

  /**
   * Shaded region between two plot lines.
   *
   * lightweight-charts has no polygon primitive, so the band is faked with two
   * stacked area series: the upper line fills downward with the band colour, and
   * the lower line paints the same region again with the pane background. What
   * survives is a fill strictly between the two lines.
   */
  _addBandFills(result, paneIndex) {
    const bg = getComputedStyle(this.host).backgroundColor || '#0e121c';
    for (const band of result.bands ?? []) {
      const upper = result.plots.find((p) => p.key === band.upper);
      const lower = result.plots.find((p) => p.key === band.lower);
      if (!upper?.data?.length || !lower?.data?.length) continue;

      const fill = withAlpha(band.color, 0.14);

      const fillTop = this.chart.addSeries(AreaSeries, {
        lineColor: 'transparent',
        lineWidth: 0,
        topColor: fill,
        bottomColor: fill,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      }, paneIndex);
      fillTop.setData(upper.data);

      const fillBottom = this.chart.addSeries(AreaSeries, {
        lineColor: 'transparent',
        lineWidth: 0,
        topColor: bg,
        bottomColor: bg,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      }, paneIndex);
      fillBottom.setData(lower.data);

      this.seriesRefs.push({ series: fillTop, pane: paneIndex, kind: 'bandfill' });
      this.seriesRefs.push({ series: fillBottom, pane: paneIndex, kind: 'bandfill' });
    }
  }

  /**
   * Breathing room around a bounded oscillator pane (RSI, Stoch, %R).
   *
   * A hard min/max cannot be pinned: the library only exposes `autoScale` plus
   * scale *margins*, which add empty space outside the data. Leaving autoscale
   * on and using symmetric margins gives the same visual result without
   * fighting the API — and the reference lines (70/30, 80/20) keep the scale
   * honest.
   */
  _pinScale(paneIndex) {
    try {
      this.chart.priceScale('right', paneIndex).applyOptions({
        autoScale: true,
        scaleMargins: { top: 0.06, bottom: 0.06 },
      });
    } catch { /* library refused the change; autoscale stays on */ }
  }

  _addPlotSeries(plot, paneIndex, instance) {
    const opts = {
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      ...(plot.lineVisible === false ? { lineVisible: false, lastValueVisible: false } : {}),
    };

    if (plot.type === 'histogram') {
      const series = this.chart.addSeries(HistogramSeries, {
        ...opts,
        color: plot.color ?? '#2962ff',
        priceFormat: plot.priceFormat === 'volume'
          ? { type: 'volume' }
          : { type: 'price', precision: 2, minMove: 0.01 },
      }, paneIndex);
      series.setData(plot.data);
      this.seriesRefs.push({ series, pane: paneIndex, kind: 'indicator', id: instance.id, key: plot.key, type: 'histogram' });
      return series;
    }

    if (plot.type === 'area') {
      const series = this.chart.addSeries(AreaSeries, {
        ...opts,
        lineColor: plot.color ?? '#2962ff',
        lineWidth: plot.lineWidth ?? 1,
        topColor: 'transparent',
        bottomColor: 'transparent',
      }, paneIndex);
      series.setData(plot.data);
      this.seriesRefs.push({ series, pane: paneIndex, kind: 'indicator', id: instance.id, key: plot.key });
      return series;
    }

    const series = this.chart.addSeries(LineSeries, {
      ...opts,
      color: plot.color ?? '#2962ff',
      lineWidth: plot.lineWidth ?? 1,
      lineStyle: plot.lineStyle === 2 ? LineStyle.Dashed
        : plot.lineStyle === 3 ? LineStyle.Dotted
        : LineStyle.Solid,
      crosshairMarkerRadius: 2,
    }, paneIndex);
    series.setData(plot.data);
    this.seriesRefs.push({ series, pane: paneIndex, kind: 'indicator', id: instance.id, key: plot.key });
    return series;
  }

  /** Volume-on-price-scale helper for the volume MA. */
  _ensureOverlayScale(paneIndex, priceScaleId) {
    try {
      const scale = this.chart.priceScale(priceScaleId, paneIndex);
      scale.applyOptions({
        visible: false,
        scaleMargins: { top: 0.78, bottom: 0 },
        autoScale: true,
      });
      return scale;
    } catch {
      return null;
    }
  }

  _ensurePane(instance, def) {
    const existing = this.paneByIndicator.get(instance.id);
    if (existing !== undefined && this.chart.panes()[existing]) return existing;
    this.chart.addPane();
    const index = this.chart.panes().length - 1;
    this.paneByIndicator.set(instance.id, index);
    this._paneHeights[index - 1] = instance.paneHeight ?? def.defaultPaneHeight ?? 110;
    return index;
  }

  /**
   * Give the price pane whatever vertical space the indicator panes did not
   * claim. Without this the library hands the leftover space to the panes
   * unevenly, which squeezes RSI into a sliver as soon as a second pane exists.
   *
   * The price pane is sized last on purpose: `setHeight` redistributes the
   * remaining space, so whoever goes last ends up with the leftovers.
   */
  _applyPaneHeights() {
    cancelAnimationFrame(this._paneHeightFrame);
    // One frame after the panes exist, so the container has a measured height.
    this._paneHeightFrame = requestAnimationFrame(() => {
      const panes = this.chart.panes();
      if (panes.length < 2 || this.destroyed) return;

      const total = this.el.panes.clientHeight;
      if (!total) return;

      // On a short tile an indicator pane may claim at most this share, so the
      // price chart is never squeezed to a sliver by the pane below it.
      const maxShare = total < 320 ? 0.38 : 0.5;
      const heights = panes
        .slice(1)
        .map((_, i) => Math.min(this._paneHeights[i] ?? 110, Math.round(total * maxShare)));

      // If the indicators still want more than the tile has, scale them down
      // together and keep the price pane a usable floor.
      const claimed = heights.reduce((a, b) => a + b, 0);
      const budget = Math.max(0, total - 120);
      const scale = claimed > budget && claimed > 0 ? budget / claimed : 1;
      const finalHeights = heights.map((h) => (scale < 1 ? Math.max(64, Math.floor(h * scale)) : h));
      const used = finalHeights.reduce((a, b) => a + b, 0);
      const main = Math.max(80, total - used - 8); // 8px ≈ pane separators

      try {
        panes.forEach((pane, i) => {
          if (i > 0) pane.setHeight(finalHeights[i - 1]);
        });
        panes[0].setHeight(main);
      } catch { /* the library clamps to the container; nothing to do */ }
    });
  }

  _legendValues(result) {
    return result.labels.map((label) => {
      const plot = result.plots.find((pl) => pl.label === label);
      const last = plot?.data?.at(-1)?.value;
      return `${label}: ${last == null ? '—' : formatCompact(last)}`;
    });
  }

  _renderLegend(rows) {
    // In fundamentals-only mode the indicator readout is hidden, but the legend
    // still has to be rebuilt (and left empty) so a mode switch is instant.
    const indicatorsOnly = (this.config.settings?.footerMode ?? 'both') === 'fundamentals';
    if (!rows.length || indicatorsOnly) {
      this.el.legend.innerHTML = '';
      this.el.legend.hidden = true;
      return;
    }
    this.el.legend.hidden = false;
    this.el.legend.innerHTML = rows.map((row) => `
      <span class="legend__item" data-indicator="${escapeHtml(row.id)}" title="Click to edit indicator">
        <i style="background:${escapeHtml(row.color)}"></i>
        <b>${escapeHtml(row.label)}</b>
        ${row.values.map((v) => `<span>${escapeHtml(v)}</span>`).join('')}
      </span>
    `).join('');

    for (const node of this.el.legend.querySelectorAll('[data-indicator]')) {
      node.addEventListener('click', () => {
        this.callbacks.onEditIndicator?.(this, node.dataset.indicator);
      });
    }
  }

  /**
   * Change this chart's horizontal zoom.
   *
   * Bar spacing is the lever: TradingView's wheel zoom moves it, and every bar
   * gets wider (fewer visible) or narrower (more visible). Returns false when the
   * request would be clamped away, so the board can tell "nothing moved" from
   * "already at the limit".
   *
   * The spacing is tracked here rather than read back from the chart, because
   * `applyOptions` only lands on the next paint: two clicks in one frame would
   * both measure the old value and collapse into a single step.
   */
  zoom(factor, { min = 0.5, max = 80 } = {}) {
    const base = this.zoomSpacing ?? this.chart.timeScale().options().barSpacing ?? 6;
    const next = Math.min(max, Math.max(min, base * factor));
    if (Math.abs(next - base) < 0.0001) return false;
    this.zoomSpacing = next;
    this.chart.applyOptions({ timeScale: { barSpacing: next } });
    return true;
  }

  /**
   * A real zoom gesture (wheel or drag) just happened on this chart: remember
   * the resulting bar spacing so a candle refresh cannot undo it.
   *
   * The library applies the scaling on its own tick, so the spacing is sampled
   * for a few frames rather than read once. A wheel over the *price* axis zooms
   * vertically and never moves the time scale, and a drag only pans — neither
   * changes the spacing, so neither pins the view and auto-fit keeps running.
   */
  _noteZoomGesture() {
    const before = this.chart.timeScale().options().barSpacing;
    clearTimeout(this._zoomGestureTimer);
    let samples = 0;
    const sample = () => {
      const spacing = this.chart.timeScale().options().barSpacing;
      if (Number.isFinite(spacing) && spacing > 0 && Math.abs(spacing - before) > before * 0.02) {
        this.zoomSpacing = spacing;
        return;
      }
      samples += 1;
      if (samples < 8) this._zoomGestureTimer = setTimeout(sample, 40);
    };
    this._zoomGestureTimer = setTimeout(sample, 40);
  }

  /** Current bar spacing, i.e. how wide one candle is drawn. */
  get zoomLevel() {
    return this.zoomSpacing ?? this.chart.timeScale().options().barSpacing ?? null;
  }

  /** Drop the manual zoom and show the whole loaded history. */
  fitContent() {
    this.zoomSpacing = null;
    try {
      this.chart.timeScale().fitContent();
    } catch { /* no data yet */ }
  }

  _maybeFit() {
    // `autoscale` governs the price axis; a manual zoom is about time and must
    // survive data refreshes until the symbol or timeframe changes.
    if (this.config.autoscale === false || this.zoomSpacing != null) return;
    this.fitContent();
  }

  /** Bar at (or nearest before) a timestamp — different charts have different bars. */
  _barAt(time) {
    let low = 0;
    let high = this.bars.length - 1;
    let found = null;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const bar = this.bars[mid];
      if (bar.time === time) { found = bar; break; }
      if (bar.time < time) { found = bar; low = mid + 1; } else high = mid - 1;
    }
    return found;
  }

  /** Mirror another tile's crosshair onto the same timestamp. */
  syncCrosshair(time) {
    if (!time) {
      this.clearCrosshair();
      return;
    }
    const bar = this._barAt(time);
    try {
      this.chart.setCrosshairPosition(
        { time: bar?.time ?? time, price: bar?.close ?? 0 },
        undefined,
      );
    } catch { /* outside the loaded range; leave this chart alone */ }
  }

  clearCrosshair() {
    this.chart.clearCrosshairPosition();
  }

  applyTheme(theme) {
    const text = theme === 'dark' ? '#8b93a7' : '#4a5568';
    this.chart.applyOptions({
      layout: { textColor: text },
      grid: {
        vertLines: { color: gridColor(theme, 0.05) },
        horzLines: { color: gridColor(theme, 0.05) },
      },
      rightPriceScale: { borderColor: gridColor(theme, 0.18) },
      timeScale: { borderColor: gridColor(theme, 0.18) },
    });
  }

  snapshot() {
    return {
      id: this.config.id,
      symbol: this.config.symbol,
      timeframe: this.config.timeframe,
      chartType: this.config.chartType,
      logScale: this.config.logScale,
      autoscale: this.config.autoscale,
      indicators: this.config.indicators.map((i) => ({ ...i, params: { ...i.params } })),
      priceLines: this.config.priceLines ?? [],
    };
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this._resizeTimer);
    clearTimeout(this._zoomGestureTimer);
    cancelAnimationFrame(this._paneHeightFrame);
    this._resizeObserver?.disconnect();
    try { this.chart.remove(); } catch { /* already removed */ }
    // Take the host element with us: leaving an empty shell in the grid reads as
    // a broken chart.
    this.host.remove();
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const gridColor = (theme, alpha) =>
  (theme === 'dark' ? `rgba(139,147,167,${alpha})` : `rgba(74,85,104,${alpha})`);

/** Turn `#rrggbb` into `rgba(r,g,b,alpha)`; pass `rgb()`/`rgba()` through. */
function withAlpha(color, alpha) {
  const s = String(color ?? '').trim();
  if (/^rgba?\(/.test(s)) {
    const nums = s.match(/[\d.]+/g) ?? [];
    return `rgba(${nums[0] ?? 0}, ${nums[1] ?? 0}, ${nums[2] ?? 0}, ${alpha})`;
  }
  const hex = s.replace('#', '');
  if (!/^[0-9a-f]{3,8}$/i.test(hex)) return s;
  const full = hex.length === 3 || hex.length === 4
    ? [...hex].slice(0, 3).map((c) => c + c).join('')
    : hex.slice(0, 6);
  const n = Number.parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const toCandle = (b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close });
const toValue = (b) => ({ time: b.time, value: b.close });

/** Heikin-Ashi smoothing, matching the desktop terminal's rendering. */
function barsToHeikinAshi(bars) {
  const out = [];
  let prevOpen = null;
  let prevClose = null;
  for (const b of bars) {
    const close = (b.open + b.high + b.low + b.close) / 4;
    const open = prevOpen == null ? (b.open + b.close) / 2 : (prevOpen + prevClose) / 2;
    const high = Math.max(b.high, open, close);
    const low = Math.min(b.low, open, close);
    out.push({ time: b.time, open, high, low, close });
    prevOpen = open;
    prevClose = close;
  }
  return out;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
