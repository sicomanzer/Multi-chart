/**
 * Two-language UI: English / Thai.
 *
 * Everything the desk shows that is *chrome* rather than market data — labels,
 * buttons, hints, toasts, dialog copy, and the indicator/metric/timeframe
 * metadata the server sends over — lives in the two tables below. Prices,
 * symbols, company names and JSON payloads are deliberately left alone: they
 * are data, not ours to translate.
 *
 * The chosen language is read from localStorage (falling back to the browser
 * locale) and applied while this module is evaluated, which happens before
 * `boot()` runs — so the first paint is already in the right language and the
 * `data-i18n` nodes in `index.html` are filled in.
 *
 * Switching language persists the choice and reloads the page. Every string in
 * the app is produced at render time, so one reload is the honest way to bring
 * open dialogs, generated forms and event-driven chrome back in the new
 * language rather than maintaining a second "re-render everything" path per
 * surface.
 */

const STORAGE_KEY = 'mctd:lang';

/** Languages the desk ships with; the button in the top bar toggles between. */
export const LANGS = ['en', 'th'];

const EN = {
  // ── Shell ────────────────────────────────────────────────────────────────
  'app.title': 'Trading Desk',
  'app.docTitle': 'Multi-chart trading desk',
  'common.loading': 'Loading…',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.apply': 'Apply',
  'common.close': 'Close',
  'common.delete': 'Delete',
  'common.rename': 'Rename',
  'common.copy': 'Copy',
  'common.create': 'Create',
  'common.add': 'Add',
  'common.search': 'Search',
  'common.remove': 'Remove',

  // ── Top bar ──────────────────────────────────────────────────────────────
  'top.addChart': '+ Chart',
  'top.addChartHint': 'Add a chart to the board',
  'top.watchlists': 'Watchlists',
  'top.watchlistsHint': 'Named symbol lists — load one onto the board in a click',
  'top.oversoldHint': 'Charts whose RSI is under its oversold line',
  'top.addIndicator': 'ƒx All',
  'top.addIndicatorHint': 'Add an indicator to every chart',
  'top.editIndicators': 'ƒx Edit All',
  'top.editIndicatorsHint': "Edit one indicator's settings on every chart at once",
  'top.zoomOutHint': 'Zoom out — every chart (−)',
  'top.zoomInHint': 'Zoom in — every chart (+)',
  'top.zoomResetHint': 'Reset zoom to the full range (0)',
  'top.fit': 'Fit',
  'top.fitHint': 'Fit every chart on screen',
  'top.settings': 'Settings',
  'top.settingsHint': 'Board settings',
  'top.mcp': 'MCP',
  'top.mcpHint': 'Run tradingview-mcp tools',
  'top.themeHint': 'Toggle theme',
  'top.workspacesHint': 'Saved boards',
  'top.filter': 'filter:',
  'top.save': 'Save',
  'top.saveHint': 'Save this board',
  'top.statusHint': 'MCP + stream status',
  'top.tfGroup': 'Timeframe for all charts',
  'top.tfHint': 'Timeframe applies to every chart · click the active one to reload',
  'top.langHint': 'Switch language',
  'top.filterCount': '{visible} shown · {hidden} hidden',

  // ── Empty state / status bar ─────────────────────────────────────────────
  'empty.title': 'No charts yet',
  'empty.body': 'Add a symbol to start watching the board.',
  'empty.cta': '+ Add first chart',
  'stat.zeroCharts': '0 charts',
  'stat.zeroIndicators': '0 indicators',
  'stat.quotesIdle': 'quotes: —',
  'stat.charts.one': '{n} chart',
  'stat.charts.other': '{n} charts',
  'stat.indicators.one': '{n} indicator',
  'stat.indicators.other': '{n} indicators',
  'stat.symbols.one': '{n} symbol',
  'stat.symbols.other': '{n} symbols',
  'stat.quotes': 'quotes: {t}',
  'stat.justNow': 'just now',
  'stat.secsAgo': '{n}s ago',
  'stat.layoutTitle': 'How the charts are sized to fit the screen',
  'stat.sourceTitle': 'Where the numbers come from',
  'stat.source': 'quotes: tradingview-mcp · candles: Yahoo chart API',
  'stat.saved': 'saved',
  'stat.saving': 'saving…',
  'stat.savedAt': 'saved {time}',
  'stat.layoutFixed': '{n} columns · scrolling',
  'stat.layoutCantFit': '{n} charts · cannot fit, scrolling',
  'stat.layoutFit': 'fit: {cols} × {rows} · {size}',
  'stat.layoutCompact': ' · compact',

  // ── Status pill ──────────────────────────────────────────────────────────
  'status.connecting': 'connecting…',
  'status.mcpReady': 'mcp ready',
  'status.mcpOffline': 'mcp offline',
  'status.mcpPing': 'mcp · {ms}ms',
  'status.waiting': 'waiting for the MCP server',

  // ── Board / workspace dropdown ───────────────────────────────────────────
  'ws.boards': 'Boards',
  'ws.watchlists': 'Watchlists',
  'ws.rename': 'Rename',
  'ws.renameHint': 'Rename this board',
  'ws.copy': 'Copy',
  'ws.copyHint': 'Duplicate this board',
  'ws.delete': 'Delete',
  'ws.deleteHint': 'Delete this board',
  'ws.confirmDelete': 'Confirm delete',
  'ws.renameTitle': 'Rename board',
  'ws.deleted': 'Board deleted',

  'top.nameCharts.one': '{name} · {n} chart',
  'top.nameCharts.other': '{name} · {n} charts',

  // ── Toasts ───────────────────────────────────────────────────────────────
  'toast.showAll': 'Showing every chart again',
  'toast.fit.ok': 'Fitted {charts} charts in {cols} × {rows}',
  'toast.fit.no': '{n} charts will not fit legibly — scrolling instead',
  'toast.zoomReset': 'Zoom reset to the full range',
  'toast.saved': 'Board saved',
  'toast.wl.empty': '"{name}" has no symbols yet',
  'toast.wl.showing.one': 'Showing {n} chart from "{name}"',
  'toast.wl.showing.other': 'Showing {n} charts from "{name}"',
  'toast.wl.none': 'None of "{name}" symbols are on this board — use Watchlists → Load',
  'toast.all': 'Showing all {n} charts',
  'toast.conflict': 'This board was changed in another tab or by the CLI — reloading it',
  'err.kind.board': 'board',
  'err.kind.watchlist': 'watchlist',
  'err.openKind': 'Could not open {kind}: {msg}',
  'err.saveLayout': 'Could not save layout: {msg}',
  'err.bootTitle': 'Could not start the desk',
  'err.bootBody': 'Check that the API is running on the same origin and that <code>tradingview-mcp-server</code> is installed for your Python.',

  // ── Oversold chip ────────────────────────────────────────────────────────
  'oversold.chip': '● {n} below {line}',

  // ── Board actions ────────────────────────────────────────────────────────
  'board.indicatorAdded.one': '{name} added to {n} chart',
  'board.indicatorAdded.other': '{name} added to {n} charts',
  'board.noChartHas': 'No chart on this board has {name}',
  'board.updated.one': '{name} updated on {n} chart',
  'board.updated.other': '{name} updated on {n} charts',
  'board.leftAlone.one': ' · {n} chart without it left alone',
  'board.leftAlone.other': ' · {n} charts without it left alone',
  'board.removed.one': '{name} removed from {n} chart',
  'board.removed.other': '{name} removed from {n} charts',
  'board.state.one': '{name} {state} on {n} chart',
  'board.state.other': '{name} {state} on {n} charts',
  'board.stateEnabled': 'enabled',
  'board.stateDisabled': 'disabled',
  'board.recorded.one': 'Recorded {n} symbol for today',
  'board.recorded.other': 'Recorded {n} symbols for today',

  // ── New chart dialog ─────────────────────────────────────────────────────
  'nc.title': 'New chart',
  'nc.sub': 'Add a symbol to the board.',
  'nc.symbol': 'Symbol',
  'nc.timeframe': 'Timeframe',
  'nc.startWith': 'Start with',
  'nc.rsiCheck': 'RSI(14) in its own pane',
  'nc.recent': 'Recent on this board',
  'nc.recentEmpty': 'Nothing on the board yet.',
  'nc.searching': 'Searching…',
  'nc.noMatch': 'No screener match. Typing {code} directly still works.',
  'nc.exchanges': 'Exchanges: {list}…',
  'nc.add': 'Add chart',
  'nc.typeFirst': 'Type a ticker first',
  'searchSet': 'Search SET',

  // ── Chart settings dialog ────────────────────────────────────────────────
  'cd.title': 'Chart settings',
  'cd.instrument': 'Instrument',
  'cd.accepts': 'Accepts CPF, SET:CPF or CPF.BK.',
  'cd.resolves': 'Resolves to {symbol} → {yahoo}',
  'cd.resolveFail': 'Could not resolve "{value}".',
  'cd.noMatch': 'No match. Type a ticker directly instead.',
  'cd.timeframe': 'Timeframe',
  'cd.rendering': 'Rendering',
  'cd.style': 'Style',
  'cd.logScale': 'Logarithmic price scale',
  'cd.autoscale': 'Auto-fit on data change',
  'cd.indicators': 'Indicators',
  'cd.indicatorsHint': 'Click a row to edit its parameters.',
  'cd.noIndicators': 'No indicators on this chart yet.',
  'cd.priceLevels': 'Price levels',
  'cd.priceLevelsHint': 'Horizontal lines drawn on the price chart.',
  'cd.price': 'Price',
  'cd.label': 'Label',
  'cd.colour': 'Colour',
  'cd.styleSolid': 'solid',
  'cd.styleDashed': 'dashed',
  'cd.styleDotted': 'dotted',
  'cd.removeLevel': 'Remove',
  'cd.addLevel': '+ Add level',
  'cd.ownPane': 'own pane',
  'cd.overlay': 'overlay',
  'cd.on': 'on',
  'cd.disabled': 'disabled',

  // ── Chart styles (shared by chart + board settings) ──────────────────────
  'style.candles': 'Candles',
  'style.heikin': 'Heikin Ashi',
  'style.bars': 'OHLC bars',
  'style.line': 'Line',
  'style.area': 'Area',
  'style.baseline': 'Baseline',

  // ── Tile chrome ──────────────────────────────────────────────────────────
  'tile.changeSymbol': 'Change symbol / settings',
  'tile.timeframe': 'Timeframe',
  'tile.addIndicator': 'Add indicator',
  'tile.settings': 'Chart settings',
  'tile.maximise': 'Maximise',
  'tile.close': 'Close chart',
  'tile.loadingRatios': 'loading ratios…',
  'tile.noFundamentals': 'no fundamental data',
  'tile.notReported': 'not reported',
  'tile.notShown': 'not shown (no room): {keys}',
  'tile.oversoldTitle': 'RSI {value} is below its {line} line',
  'tile.legendHint': 'Click to edit indicator',

  // ── Indicator picker / editor ────────────────────────────────────────────
  'ind.addTitle': 'Add indicator',
  'ind.addSub': 'Pick a study — every parameter stays editable afterwards.',
  'ind.filter': 'Filter indicators…',
  'ind.alreadyAdded': ' · already added',
  'ind.added': 'added',
  'ind.noMatch': 'No indicator matches that filter.',
  'ind.boardTitle': 'Indicator settings',
  'ind.boardSub.one': 'Pick one to edit it on every chart at once · {n} chart on this board',
  'ind.boardSub.other': 'Pick one to edit it on every chart at once · {n} charts on this board',
  'ind.onThisBoard': 'On this board',
  'ind.onCharts.one': 'on {n} chart',
  'ind.onCharts.other': 'on {n} charts',
  'ind.all': ' · all',
  'ind.mixed': ' · mixed settings',
  'ind.emptyToast': 'No indicators on the board yet — add one first.',
  'ind.unknown': 'Unknown indicator "{type}"',
  'ind.sub.one': '{short} · {n} setting',
  'ind.sub.other': '{short} · {n} settings',
  'ind.scopeStrong': 'Applies to all {n} charts',
  'ind.scopeTail': 'that have this indicator.',
  'ind.scopeDiff.one': '{n} of them uses different settings — applying overwrites it with what is shown here.',
  'ind.scopeDiff.other': '{n} of them use different settings — applying overwrites them with what is shown here.',
  'ind.calc': 'Calculation',
  'ind.calcScope': 'Changing a setting redraws every chart with this indicator.',
  'ind.calcOne': 'Changing a setting redraws this pane immediately.',
  'ind.noSettings': 'This indicator has no settings.',
  'ind.placement': 'Placement',
  'ind.placementHint': 'A pane indicator stacks its own sub-chart under the candles.',
  'ind.where': 'Where',
  'ind.wherePane': 'Own pane (below the price chart)',
  'ind.whereOverlay': 'Overlay on the price chart',
  'ind.paneHeight': 'Pane height (px)',
  'ind.enable': 'Enable',
  'ind.disable': 'Disable',
  'ind.scopeNote.one': ' on {n} chart',
  'ind.scopeNote.other': ' on {n} charts',

  // ── Indicator groups / names / parameters ────────────────────────────────
  'grp.Moving Average': 'Moving averages',
  'grp.Volatility': 'Volatility',
  'grp.Trend': 'Trend',
  'grp.Momentum': 'Momentum',
  'grp.Volume': 'Volume',
  'ind.name.sma': 'Simple Moving Average',
  'ind.name.ema': 'Exponential Moving Average',
  'ind.name.wma': 'Weighted Moving Average',
  'ind.name.vwma': 'Volume Weighted MA',
  'ind.name.hma': 'Hull Moving Average',
  'ind.name.bb': 'Bollinger Bands',
  'ind.name.keltner': 'Keltner Channels',
  'ind.name.donchian': 'Donchian Channels',
  'ind.name.macd': 'MACD',
  'ind.name.supertrend': 'SuperTrend',
  'ind.name.psar': 'Parabolic SAR',
  'ind.name.adx': 'ADX / DMI',
  'ind.name.ichimoku': 'Ichimoku Cloud',
  'ind.name.rsi': 'Relative Strength Index',
  'ind.name.stoch': 'Stochastic',
  'ind.name.stochRsi': 'Stochastic RSI',
  'ind.name.cci': 'Commodity Channel Index',
  'ind.name.roc': 'Rate of Change',
  'ind.name.mfi': 'Money Flow Index',
  'ind.name.williamsR': 'Williams %R',
  'ind.name.volume': 'Volume',
  'ind.name.obv': 'On Balance Volume',
  'ind.name.atr': 'Average True Range',
  'param.length': 'Length',
  'param.source': 'Source',
  'param.colour': 'Colour',
  'param.line_width': 'Line width',
  'param.show_last_value': 'Show last value',
  'param.fill_between_bands': 'Fill between bands',
  'param.basis_colour': 'Basis colour',
  'param.upper_colour': 'Upper colour',
  'param.lower_colour': 'Lower colour',
  'param.std_dev_multiplier': 'Std dev multiplier',
  'param.atr_multiplier': 'ATR multiplier',
  'param.atr_length': 'ATR length',
  'param.fast_length': 'Fast length',
  'param.slow_length': 'Slow length',
  'param.signal_length': 'Signal length',
  'param.macd_colour': 'MACD colour',
  'param.signal_colour': 'Signal colour',
  'param.histogram_up': 'Histogram up',
  'param.histogram_down': 'Histogram down',
  'param.zero_line': 'Zero line',
  'param.multiplier': 'Multiplier',
  'param.up_trend_colour': 'Up trend colour',
  'param.down_trend_colour': 'Down trend colour',
  'param.show_bands': 'Show bands',
  'param.start_acceleration': 'Start acceleration',
  'param.acceleration_step': 'Acceleration step',
  'param.max_acceleration': 'Max acceleration',
  'param.up_colour': 'Up colour',
  'param.down_colour': 'Down colour',
  'param.show_dots': 'Show dots',
  'param.adx_smoothing': 'ADX smoothing',
  'param.adx_colour': 'ADX colour',
  'param.+di_colour': '+DI colour',
  'param.-di_colour': '-DI colour',
  'param.conversion_length': 'Conversion length',
  'param.base_length': 'Base length',
  'param.span_b_length': 'Span B length',
  'param.tenkan_colour': 'Tenkan colour',
  'param.kijun_colour': 'Kijun colour',
  'param.cloud_up_fill': 'Cloud up fill',
  'param.cloud_down_fill': 'Cloud down fill',
  'param.show_chikou_span': 'Show Chikou span',
  'param.overbought': 'Overbought',
  'param.oversold': 'Oversold',
  'param.fill_overbought/oversold_zones': 'Fill overbought/oversold zones',
  'param.%k_length': '%K length',
  'param.%k_smoothing': '%K smoothing',
  'param.%d_length': '%D length',
  'param.%k_colour': '%K colour',
  'param.%d_colour': '%D colour',
  'param.rsi_length': 'RSI length',
  'param.stochastic_length': 'Stochastic length',
  'param.reference_lines': 'Reference lines',
  'param.upper': 'Upper',
  'param.lower': 'Lower',
  'param.show_zero_line': 'Show zero line',
  'param.volume_ma': 'Volume MA',
  'param.ma_length': 'MA length',
  'param.ma_colour': 'MA colour',
  'param.show_ma': 'Show MA',
  'param.show_signal_line': 'Show signal line',
  'param.use_rma_smoothing': 'Use RMA smoothing',
  'opt.None': 'None',

  // ── Timeframes ───────────────────────────────────────────────────────────
  'tf.1m': '1 minute',
  'tf.5m': '5 minutes',
  'tf.15m': '15 minutes',
  'tf.30m': '30 minutes',
  'tf.1h': '1 hour',
  'tf.4h': '4 hours',
  'tf.1d': '1 day',
  'tf.1w': '1 week',
  'tf.1M': '1 month',

  // ── Fundamental metric hints ─────────────────────────────────────────────
  'metric.hint.pe': 'price / trailing earnings',
  'metric.hint.pbv': 'price / book value',
  'metric.hint.pfcf': 'price / free cash flow — 1÷this is the FCF yield',
  'metric.hint.ps': 'price / sales',
  'metric.hint.pcf': 'price / operating cash flow',
  'metric.hint.evEbitda': 'enterprise value / EBITDA',
  'metric.hint.de': 'total debt / equity',
  'metric.hint.quickRatio': 'quick ratio (acid test)',
  'metric.hint.currentRatio': 'current ratio',
  'metric.hint.dividendYield': 'dividend yield',
  'metric.hint.roe': 'return on equity',
  'metric.hint.roic': 'return on invested capital',
  'metric.hint.roa': 'return on assets',
  'metric.hint.epsGrowth': 'earnings per share, year on year',
  'metric.hint.revenueGrowth': 'revenue, year on year',

  // ── Board settings dialog ────────────────────────────────────────────────
  'bs.title': 'Board settings',
  'bs.sub': 'Applies to every chart on this board.',
  'bs.layout': 'Layout',
  'bs.layoutHint': 'Auto fit sizes the grid so every chart is visible without scrolling.',
  'bs.sizing': 'Board sizing',
  'bs.auto': 'Auto fit to screen',
  'bs.fixed': 'Fixed columns (scroll if needed)',
  'bs.columns': 'Columns',
  'bs.columnsN.one': '{n} column',
  'bs.columnsN.other': '{n} columns',
  'bs.theme': 'Theme',
  'bs.dark': 'Dark',
  'bs.light': 'Light',
  'bs.defaultTf': 'Default timeframe',
  'bs.defaultStyle': 'Default chart style',
  'bs.footer': 'Chart footer',
  'bs.footerHint': 'The strip under each chart: valuation ratios, indicator values, or both.',
  'bs.show': 'Show',
  'bs.footerFund': 'Fundamentals only (P/E, P/BV, D/E, yield)',
  'bs.footerInd': 'Indicator values only',
  'bs.footerBoth': 'Both (ratios on top, indicators below)',
  'bs.refresh': 'Refresh ratios now',
  'bs.refreshHint': 'Bypass the 30-minute cache and re-query the screener',
  'bs.refreshing': 'Refreshing…',
  'bs.fundamentals': 'Fundamentals',
  'bs.history': 'Recorded history',
  'bs.record': 'Record today now',
  'bs.recordHint': "Write today's ratios for every chart on this board, replacing today's row",
  'bs.recording': 'Recording…',
  'bs.whichRatios': 'Which ratios',
  'bs.metricsMissing': 'Metric list unavailable',
  'bs.ratios': 'ratios',
  'bs.since': ' (since {since}, last {last})',
  'bs.histShort': '. Too few days yet for any trend to mean much.',
  'bs.histEmpty': 'Nothing recorded yet. Ratios are written automatically each time the board loads; it starts now and cannot be back-filled.',
  'bs.days.one': '{n} day recorded',
  'bs.days.other': '{n} days recorded',
  'bs.live': 'Live data',
  'bs.liveHint': 'Quotes are pushed by the server over SSE; the MCP screener is polled once per interval for the whole board.',
  'bs.poll': 'Quote poll interval',
  'bs.liveQuotes': 'Live quotes (turn off to freeze the board)',
  'bs.syncCrosshair': 'Mirror crosshair across every chart',
  'bs.syncTimeScale': 'Link zoom/pan between charts',
  'bs.showGrid': 'Show grid lines',
  'bs.showWatermark': 'Show last-price marker inside the chart',
  'bs.alert': 'Oversold alert',
  'bs.alertHint': 'Flags any chart whose RSI is under the oversold line configured on that chart. It refreshes whenever candles reload — on board load, on every intraday tick, and after an indicator edit. Not on every quote tick, so it never disagrees with the number drawn in the pane.',
  'bs.alertCheck': 'Show a green alert button when a chart is oversold',
  'bs.connection': 'Connection',
  'poll.5': '5 seconds (fastest)',
  'poll.10': '10 seconds (default)',
  'poll.20': '20 seconds',
  'poll.30': '30 seconds',
  'poll.60': '60 seconds (relaxed)',
  'poll.120': '2 minutes (background)',

  // ── Watchlists dialog ────────────────────────────────────────────────────
  'wl.title': 'Watchlists',
  'wl.sub': 'Named symbol lists. Load one onto the board in a click — no limit on how many you keep.',
  'wl.lists': 'Lists',
  'wl.showAll': 'Show all ({shown}/{total})',
  'wl.new': '+ New',
  'wl.newPlaceholder': 'Name this list',
  'wl.create': 'Create',
  'wl.emptyLists': 'No watchlists yet. Create one, or save the current board as a list.',
  'wl.previewEmpty': 'empty',
  'wl.saveBoard': 'Save this board ({n})',
  'wl.seedPlaceholder': 'Name the list ({n} symbols)',
  'wl.selectHint': 'Select a list, or create a new one.',
  'wl.listName': 'List name',
  'wl.duplicate': 'Duplicate',
  'wl.pressAgain': 'press again',
  'wl.created': 'Created "{name}".',
  'wl.needName': 'A watchlist needs a name',
  'wl.savedToast': 'Saved {n} symbols as "{name}"',
  'wl.deletedToast': 'Watchlist deleted. The board was not touched.',
  'wl.act.create': 'Create list',
  'wl.act.saveBoard': 'Save board as list',
  'wl.act.rename': 'Rename',
  'wl.act.duplicate': 'Duplicate',
  'wl.act.delete': 'Delete',
  'wl.act.remove': 'Remove symbol',
  'wl.act.add': 'Add',
  'wl.actFailed': '{label} failed: {msg}',
  'wl.addSymbols': 'Add symbols',
  'wl.addSymbolsHint': 'Accepts CPF, SET:CPF, CPF.BK, or several separated by commas.',
  'wl.addPlaceholder': 'CPF, PTTEP, SET:SCB…',
  'wl.add': 'Add',
  'wl.full': 'List is full — {n} not added',
  'wl.added.one': 'Added {n} symbol(s)',
  'wl.added.other': 'Added {n} symbols',
  'wl.addFailed': 'Add failed: {msg}',
  'wl.searchFailed': 'Search failed',
  'wl.noMatch': 'No screener match',
  'wl.addedFromScreener': 'Added {n} from the screener',
  'wl.symbols': 'Symbols',
  'wl.symbolsHint': 'Click ✕ to drop one. A dot means it is already drawn on the board.',
  'wl.noSymbols': 'Nothing here yet.',
  'wl.onBoard': 'already on the board',
  'wl.remove': 'Remove {symbol}',
  'wl.loadTitle': 'Load onto this board',
  'wl.boardDefault': 'Board default ({tf})',
  'wl.rsiCheck': 'Start each new chart with an RSI pane',
  'wl.load.one': 'Load {n} symbol',
  'wl.load.other': 'Load {n} symbols',
  'wl.loadFailed': 'Could not load watchlists: {msg}',
  'wl.report.added': 'added {n}',
  'wl.report.already': '{n} already on the board',
  'wl.report.dup': '{n} repeated',
  'wl.report.full.one': '{n} left out — the board holds at most {limit}',
  'wl.report.full.other': '{n} left out — the board holds at most {limit}',

  // ── Oversold list dialog ─────────────────────────────────────────────────
  'os.title': 'RSI below its oversold line',
  'os.sub.one': '{n} chart on this board. Each is judged against its own RSI setting.',
  'os.sub.other': '{n} charts on this board. Each is judged against its own RSI setting.',
  'os.subNone': 'Nothing is below its line right now.',
  'os.hint': 'The alert re-checks whenever a chart reloads its candles, which is every minute while the tab is visible and whenever a board loads.',
  'os.deepest': 'Deepest: {symbol} at RSI {value} against a {line} line.',
  'os.charts': 'Charts',
  'os.chartsHint': 'Click a row to bring that chart up full screen.',
  'os.note': "Change a chart's line from Settings, or from the RSI legend entry — clicking it opens its editor.",
  'os.rowTitle': '{symbol} · {tf} · RSI({length}) {value}, line {line} — click to maximise',

  // ── MCP console ──────────────────────────────────────────────────────────
  'mcp.title': 'MCP tools',
  'mcp.sub': 'tradingview-mcp · direct tool access',
  'mcp.loading': 'Loading tools…',
  'mcp.run': 'Run tool',
  'mcp.pick': 'Pick a tool on the left.',
  'mcp.noTools': 'MCP server returned no tools.',
  'mcp.noToolsErr': 'Is <code>tradingview-mcp-server</code> installed?',
  'mcp.noArgs': 'This tool takes no arguments.',
  'mcp.ready': '{name} ready — press Run.',
  'mcp.running': 'Running…',
  'mcp.error': 'Error [{code}]: {msg}',
  'mcp.failed': '{name} failed',
};

const TH = {
  // ── Shell ────────────────────────────────────────────────────────────────
  'app.title': 'กระดานเทรด',
  'app.docTitle': 'แผงเทรดหลายกราฟ',
  'common.loading': 'กำลังโหลด…',
  'common.cancel': 'ยกเลิก',
  'common.save': 'บันทึก',
  'common.apply': 'นำไปใช้',
  'common.close': 'ปิด',
  'common.delete': 'ลบ',
  'common.rename': 'เปลี่ยนชื่อ',
  'common.copy': 'ทำสำเนา',
  'common.create': 'สร้าง',
  'common.add': 'เพิ่ม',
  'common.search': 'ค้นหา',
  'common.remove': 'ลบออก',

  // ── Top bar ──────────────────────────────────────────────────────────────
  'top.addChart': '+ กราฟ',
  'top.addChartHint': 'เพิ่มกราฟเข้ากระดาน',
  'top.watchlists': 'รายการเฝ้าดู',
  'top.watchlistsHint': 'รายการหุ้นที่ตั้งชื่อไว้ — โหลดลงกระดานได้ในคลิกเดียว',
  'top.oversoldHint': 'กราฟที่ RSI ต่ำกว่าเส้นขายมากเกินไป',
  'top.addIndicator': 'ƒx ทั้งหมด',
  'top.addIndicatorHint': 'เพิ่มตัวบ่งชี้ให้ทุกกราฟ',
  'top.editIndicators': 'ƒx แก้ไขทั้งหมด',
  'top.editIndicatorsHint': 'แก้ไขค่าของตัวบ่งชี้เดียวบนทุกกราฟพร้อมกัน',
  'top.zoomOutHint': 'ซูมออก — ทุกกราฟ (−)',
  'top.zoomInHint': 'ซูมเข้า — ทุกกราฟ (+)',
  'top.zoomResetHint': 'รีเซ็ตซูมกลับช่วงเต็ม (0)',
  'top.fit': 'พอดีจอ',
  'top.fitHint': 'จัดทุกกราฟให้พอดีหน้าจอ',
  'top.settings': 'ตั้งค่า',
  'top.settingsHint': 'ตั้งค่ากระดาน',
  'top.mcp': 'MCP',
  'top.mcpHint': 'เรียกใช้เครื่องมือ tradingview-mcp',
  'top.themeHint': 'สลับธีม',
  'top.workspacesHint': 'กระดานที่บันทึกไว้',
  'top.filter': 'กรอง:',
  'top.save': 'บันทึก',
  'top.saveHint': 'บันทึกกระดานนี้',
  'top.statusHint': 'สถานะ MCP + สตรีม',
  'top.tfGroup': 'กรอบเวลาของทุกกราฟ',
  'top.tfHint': 'กรอบเวลาใช้กับทุกกราฟ · คลิกกรอบเวลาที่ใช้อยู่เพื่อโหลดข้อมูลใหม่',
  'top.filterCount': 'แสดง {visible} · ซ่อน {hidden}',
  'top.langHint': 'สลับภาษา',

  // ── Empty state / status bar ─────────────────────────────────────────────
  'empty.title': 'ยังไม่มีกราฟ',
  'empty.body': 'เพิ่มสัญลักษณ์หุ้นเพื่อเริ่มดูกระดาน',
  'empty.cta': '+ เพิ่มกราฟแรก',
  'stat.zeroCharts': '0 กราฟ',
  'stat.zeroIndicators': '0 ตัวบ่งชี้',
  'stat.quotesIdle': 'ราคา: —',
  'stat.charts.one': '{n} กราฟ',
  'stat.charts.other': '{n} กราฟ',
  'stat.indicators.one': '{n} ตัวบ่งชี้',
  'stat.indicators.other': '{n} ตัวบ่งชี้',
  'stat.symbols.one': '{n} สัญลักษณ์',
  'stat.symbols.other': '{n} สัญลักษณ์',
  'stat.quotes': 'ราคา: {t}',
  'stat.justNow': 'เมื่อครู่',
  'stat.secsAgo': '{n} วินาทีที่แล้ว',
  'stat.layoutTitle': 'วิธีปรับขนาดกราฟให้พอดีหน้าจอ',
  'stat.sourceTitle': 'ที่มาของตัวเลข',
  'stat.source': 'ราคา: tradingview-mcp · แท่งเทียน: Yahoo chart API',
  'stat.saved': 'บันทึกแล้ว',
  'stat.saving': 'กำลังบันทึก…',
  'stat.savedAt': 'บันทึกแล้ว {time}',
  'stat.layoutFixed': '{n} คอลัมน์ · เลื่อนดู',
  'stat.layoutCantFit': '{n} กราฟ · ไม่พอ เลื่อนดู',
  'stat.layoutFit': 'พอดี: {cols} × {rows} · {size}',
  'stat.layoutCompact': ' · กระชับ',

  // ── Status pill ──────────────────────────────────────────────────────────
  'status.connecting': 'กำลังเชื่อมต่อ…',
  'status.mcpReady': 'mcp พร้อม',
  'status.mcpOffline': 'mcp ขาดการเชื่อมต่อ',
  'status.mcpPing': 'mcp · {ms}ms',
  'status.waiting': 'กำลังรอเซิร์ฟเวอร์ MCP',

  // ── Board / workspace dropdown ───────────────────────────────────────────
  'ws.boards': 'กระดาน',
  'ws.watchlists': 'รายการเฝ้าดู',
  'ws.rename': 'เปลี่ยนชื่อ',
  'ws.renameHint': 'เปลี่ยนชื่อกระดานนี้',
  'ws.copy': 'ทำสำเนา',
  'ws.copyHint': 'ทำสำเนากระดานนี้',
  'ws.delete': 'ลบ',
  'ws.deleteHint': 'ลบกระดานนี้',
  'ws.confirmDelete': 'ยืนยันลบ',
  'ws.renameTitle': 'เปลี่ยนชื่อกระดาน',
  'ws.deleted': 'ลบกระดานแล้ว',

  'top.nameCharts.one': '{name} · {n} กราฟ',
  'top.nameCharts.other': '{name} · {n} กราฟ',

  // ── Toasts ───────────────────────────────────────────────────────────────
  'toast.showAll': 'แสดงทุกกราฟแล้ว',
  'toast.fit.ok': 'จัด {charts} กราฟลงใน {cols} × {rows} พอดี',
  'toast.fit.no': 'กราฟ {n} ใบอ่านไม่ไหว — เลื่อนดูแทน',
  'toast.zoomReset': 'รีเซ็ตซูมกลับช่วงเต็ม',
  'toast.saved': 'บันทึกกระดานแล้ว',
  'toast.wl.empty': '"{name}" ยังไม่มีสัญลักษณ์',
  'toast.wl.showing.one': 'แสดง {n} กราฟจาก "{name}"',
  'toast.wl.showing.other': 'แสดง {n} กราฟจาก "{name}"',
  'toast.wl.none': 'ไม่มีสัญลักษณ์ของ "{name}" อยู่บนกระดานนี้ — ใช้ รายการเฝ้าดู → โหลด',
  'toast.all': 'แสดงทั้งหมด {n} กราฟ',
  'toast.conflict': 'กระดานนี้ถูกแก้ไขในแท็บอื่นหรือโดย CLI — กำลังโหลดใหม่',
  'err.kind.board': 'กระดาน',
  'err.kind.watchlist': 'รายการเฝ้าดู',
  'err.openKind': 'เปิด{kind}ไม่สำเร็จ: {msg}',
  'err.saveLayout': 'บันทึกเลย์เอาต์ไม่สำเร็จ: {msg}',
  'err.bootTitle': 'เปิดเดสก์ไม่สำเร็จ',
  'err.bootBody': 'ตรวจสอบว่า API รันบน origin เดียวกัน และติดตั้ง <code>tradingview-mcp-server</code> ให้กับ Python ของคุณแล้ว',

  // ── Oversold chip ────────────────────────────────────────────────────────
  'oversold.chip': '● {n} ต่ำกว่า {line}',

  // ── Board actions ────────────────────────────────────────────────────────
  'board.indicatorAdded.one': 'เพิ่ม {name} ให้ {n} กราฟ',
  'board.indicatorAdded.other': 'เพิ่ม {name} ให้ {n} กราฟ',
  'board.noChartHas': 'ไม่มีกราฟบนกระดานนี้ที่มี {name}',
  'board.updated.one': 'อัปเดต {name} บน {n} กราฟ',
  'board.updated.other': 'อัปเดต {name} บน {n} กราฟ',
  'board.leftAlone.one': ' · เว้น {n} กราฟที่ไม่มีไว้',
  'board.leftAlone.other': ' · เว้น {n} กราฟที่ไม่มีไว้',
  'board.removed.one': 'ลบ {name} ออกจาก {n} กราฟ',
  'board.removed.other': 'ลบ {name} ออกจาก {n} กราฟ',
  'board.state.one': '{name} · {state} บน {n} กราฟ',
  'board.state.other': '{name} · {state} บน {n} กราฟ',
  'board.stateEnabled': 'เปิดใช้งาน',
  'board.stateDisabled': 'ปิดใช้งาน',
  'board.recorded.one': 'บันทึก {n} สัญลักษณ์ของวันนี้แล้ว',
  'board.recorded.other': 'บันทึก {n} สัญลักษณ์ของวันนี้แล้ว',

  // ── New chart dialog ─────────────────────────────────────────────────────
  'nc.title': 'กราฟใหม่',
  'nc.sub': 'เพิ่มสัญลักษณ์เข้ากระดาน',
  'nc.symbol': 'สัญลักษณ์',
  'nc.timeframe': 'กรอบเวลา',
  'nc.startWith': 'เริ่มต้นด้วย',
  'nc.rsiCheck': 'RSI(14) ในแผ่นของตัวเอง',
  'nc.recent': 'ใช้ล่าสุดบนกระดานนี้',
  'nc.recentEmpty': 'ยังไม่มีกราฟบนกระดาน',
  'nc.searching': 'กำลังค้นหา…',
  'nc.noMatch': 'ไม่พบในสกรีนเนอร์ พิมพ์ {code} โดยตรงก็ยังใช้ได้',
  'nc.exchanges': 'ตลาดหลักทรัพย์: {list}…',
  'nc.add': 'เพิ่มกราฟ',
  'nc.typeFirst': 'พิมพ์ชื่อหุ้นก่อน',
  'searchSet': 'ค้นหา SET',

  // ── Chart settings dialog ────────────────────────────────────────────────
  'cd.title': 'ตั้งค่ากราฟ',
  'cd.instrument': 'ตราสาร',
  'cd.accepts': 'รองรับ CPF, SET:CPF หรือ CPF.BK',
  'cd.resolves': 'แปลงเป็น {symbol} → {yahoo}',
  'cd.resolveFail': 'แปลง "{value}" ไม่สำเร็จ',
  'cd.noMatch': 'ไม่พบ พิมพ์ชื่อหุ้นโดยตรงแทน',
  'cd.timeframe': 'กรอบเวลา',
  'cd.rendering': 'การแสดงผล',
  'cd.style': 'รูปแบบ',
  'cd.logScale': 'แกนราคาแบบลอการิทึม',
  'cd.autoscale': 'ปรับพอดีอัตโนมัติเมื่อข้อมูลเปลี่ยน',
  'cd.indicators': 'ตัวบ่งชี้',
  'cd.indicatorsHint': 'คลิกแถวเพื่อแก้พารามิเตอร์',
  'cd.noIndicators': 'กราฟนี้ยังไม่มีตัวบ่งชี้',
  'cd.priceLevels': 'ระดับราคา',
  'cd.priceLevelsHint': 'เส้นแนวนอนที่วาดบนกราฟราคา',
  'cd.price': 'ราคา',
  'cd.label': 'ป้าย',
  'cd.colour': 'สี',
  'cd.styleSolid': 'เต็ม',
  'cd.styleDashed': 'เส้นประ',
  'cd.styleDotted': 'จุด',
  'cd.removeLevel': 'ลบระดับนี้',
  'cd.addLevel': '+ เพิ่มระดับ',
  'cd.ownPane': 'แผ่นของตัวเอง',
  'cd.overlay': 'ทับบนกราฟ',
  'cd.on': 'เปิด',
  'cd.disabled': 'ปิด',

  // ── Chart styles ─────────────────────────────────────────────────────────
  'style.candles': 'แท่งเทียน',
  'style.heikin': 'Heikin Ashi',
  'style.bars': 'แท่ง OHLC',
  'style.line': 'เส้น',
  'style.area': 'พื้นที่',
  'style.baseline': 'เส้นฐาน',

  // ── Tile chrome ──────────────────────────────────────────────────────────
  'tile.changeSymbol': 'เปลี่ยนสัญลักษณ์ / ตั้งค่า',
  'tile.timeframe': 'กรอบเวลา',
  'tile.addIndicator': 'เพิ่มตัวบ่งชี้',
  'tile.settings': 'ตั้งค่ากราฟ',
  'tile.maximise': 'ขยายเต็มจอ',
  'tile.close': 'ปิดกราฟ',
  'tile.loadingRatios': 'กำลังโหลดอัตราส่วน…',
  'tile.noFundamentals': 'ไม่มีข้อมูลพื้นฐาน',
  'tile.notReported': 'ไม่มีการรายงาน',
  'tile.notShown': 'ไม่แสดง (ไม่มีที่ว่าง): {keys}',
  'tile.oversoldTitle': 'RSI {value} ต่ำกว่าเส้น {line}',
  'tile.legendHint': 'คลิกเพื่อแก้ไขตัวบ่งชี้',

  // ── Indicator picker / editor ────────────────────────────────────────────
  'ind.addTitle': 'เพิ่มตัวบ่งชี้',
  'ind.addSub': 'เลือกตัวศึกษา — ทุกพารามิเตอร์แก้ไขได้ภายหลัง',
  'ind.filter': 'กรองตัวบ่งชี้…',
  'ind.alreadyAdded': ' · เพิ่มแล้ว',
  'ind.added': 'เพิ่มแล้ว',
  'ind.noMatch': 'ไม่มีตัวบ่งชี้ตรงกับที่กรอง',
  'ind.boardTitle': 'ตั้งค่าตัวบ่งชี้',
  'ind.boardSub.one': 'เลือกตัวหนึ่งเพื่อแก้บนทุกกราฟพร้อมกัน · {n} กราฟบนกระดานนี้',
  'ind.boardSub.other': 'เลือกตัวหนึ่งเพื่อแก้บนทุกกราฟพร้อมกัน · {n} กราฟบนกระดานนี้',
  'ind.onThisBoard': 'บนกระดานนี้',
  'ind.onCharts.one': 'บน {n} กราฟ',
  'ind.onCharts.other': 'บน {n} กราฟ',
  'ind.all': ' · ทั้งหมด',
  'ind.mixed': ' · ค่าปนกัน',
  'ind.emptyToast': 'ยังไม่มีตัวบ่งชี้บนกระดาน — เพิ่มก่อน',
  'ind.unknown': 'ไม่รู้จักตัวบ่งชี้ "{type}"',
  'ind.sub.one': '{short} · ปรับได้ {n} ค่า',
  'ind.sub.other': '{short} · ปรับได้ {n} ค่า',
  'ind.scopeStrong': 'มีผลกับทุก {n} กราฟ',
  'ind.scopeTail': 'ที่มีตัวบ่งชี้นี้',
  'ind.scopeDiff.one': '{n} รายการใช้ค่าต่างกัน — กดนำไปใช้จะเขียนทับด้วยค่าที่แสดงอยู่',
  'ind.scopeDiff.other': '{n} รายการใช้ค่าต่างกัน — กดนำไปใช้จะเขียนทับด้วยค่าที่แสดงอยู่',
  'ind.calc': 'การคำนวณ',
  'ind.calcScope': 'เปลี่ยนค่าแล้วจะวาดใหม่ทุกกราฟที่มีตัวบ่งชี้นี้ทันที',
  'ind.calcOne': 'เปลี่ยนค่าแล้วจะวาดแผ่นนี้ใหม่ทันที',
  'ind.noSettings': 'ตัวบ่งชี้นี้ไม่มีค่าตั้ง',
  'ind.placement': 'ตำแหน่ง',
  'ind.placementHint': 'ตัวบ่งชี้แบบแผ่นจะวางกราฟย่อยใต้แท่งเทียน',
  'ind.where': 'วางที่',
  'ind.wherePane': 'แผ่นของตัวเอง (ใต้กราฟราคา)',
  'ind.whereOverlay': 'ทับบนกราฟราคา',
  'ind.paneHeight': 'ความสูงแผ่น (px)',
  'ind.enable': 'เปิดใช้',
  'ind.disable': 'ปิดใช้',
  'ind.scopeNote.one': ' · {n} กราฟ',
  'ind.scopeNote.other': ' · {n} กราฟ',

  // ── Indicator groups / names / parameters ────────────────────────────────
  'grp.Moving Average': 'ค่าเฉลี่ยเคลื่อนที่',
  'grp.Volatility': 'ความผันผวน',
  'grp.Trend': 'แนวโน้ม',
  'grp.Momentum': 'โมเมนตัม',
  'grp.Volume': 'ปริมาณซื้อขาย',
  'ind.name.sma': 'ค่าเฉลี่ยเคลื่อนที่อย่างง่าย',
  'ind.name.ema': 'ค่าเฉลี่ยเคลื่อนที่เอ็กซ์โพเนนเชียล',
  'ind.name.wma': 'ค่าเฉลี่ยเคลื่อนที่ถ่วงน้ำหนัก',
  'ind.name.vwma': 'ค่าเฉลี่ยถ่วงน้ำหนักตามปริมาณ',
  'ind.name.hma': 'ค่าเฉลี่ยเคลื่อนที่ Hull',
  'ind.name.bb': 'แถบโบลลิงเจอร์',
  'ind.name.keltner': 'ช่องเคลต์เนอร์',
  'ind.name.donchian': 'ช่องดอนเชียน',
  'ind.name.macd': 'MACD',
  'ind.name.supertrend': 'SuperTrend',
  'ind.name.psar': 'พาราโบลิก SAR',
  'ind.name.adx': 'ADX / DMI',
  'ind.name.ichimoku': 'เมฆอิชิโมกุ',
  'ind.name.rsi': 'ดัชนีความแข็งแกร่งสัมพัทธ์',
  'ind.name.stoch': 'สโตคาสติก',
  'ind.name.stochRsi': 'สโตคาสติก RSI',
  'ind.name.cci': 'ดัชนีช่องสินค้าโภคภัณฑ์',
  'ind.name.roc': 'อัตราการเปลี่ยนแปลงราคา',
  'ind.name.mfi': 'ดัชนีกระแสเงิน',
  'ind.name.williamsR': 'วิลเลียมส์ %R',
  'ind.name.volume': 'ปริมาณซื้อขาย',
  'ind.name.obv': 'ปริมาณสมดุล',
  'ind.name.atr': 'ช่วงจริงเฉลี่ย',
  'param.length': 'จำนวนแท่ง',
  'param.source': 'แหล่งข้อมูล',
  'param.colour': 'สี',
  'param.line_width': 'ความหนาเส้น',
  'param.show_last_value': 'แสดงค่าล่าสุด',
  'param.fill_between_bands': 'ระบายระหว่างแถบ',
  'param.basis_colour': 'สีเส้นฐาน',
  'param.upper_colour': 'สีเส้นบน',
  'param.lower_colour': 'สีเส้นล่าง',
  'param.std_dev_multiplier': 'ตัวคูณส่วนเบี่ยงเบนมาตรฐาน',
  'param.atr_multiplier': 'ตัวคูณ ATR',
  'param.atr_length': 'จำนวนแท่ง ATR',
  'param.fast_length': 'จำนวนแท่งเร็ว',
  'param.slow_length': 'จำนวนแท่งช้า',
  'param.signal_length': 'จำนวนแท่งสัญญาณ',
  'param.macd_colour': 'สีเส้น MACD',
  'param.signal_colour': 'สีเส้นสัญญาณ',
  'param.histogram_up': 'ฮิสโตแกรมขาขึ้น',
  'param.histogram_down': 'ฮิสโตแกรมขาลง',
  'param.zero_line': 'เส้นศูนย์',
  'param.multiplier': 'ตัวคูณ',
  'param.up_trend_colour': 'สีแนวโน้มขึ้น',
  'param.down_trend_colour': 'สีแนวโน้มลง',
  'param.show_bands': 'แสดงแถบ',
  'param.start_acceleration': 'ค่าเร่งต้น',
  'param.acceleration_step': 'ขั้นการเร่ง',
  'param.max_acceleration': 'ค่าเร่งสูงสุด',
  'param.up_colour': 'สีขาขึ้น',
  'param.down_colour': 'สีขาลง',
  'param.show_dots': 'แสดงจุด',
  'param.adx_smoothing': 'การปรับค่าเรียบ ADX',
  'param.adx_colour': 'สีเส้น ADX',
  'param.+di_colour': 'สีเส้น +DI',
  'param.-di_colour': 'สีเส้น -DI',
  'param.conversion_length': 'จำนวนแท่งคอนเวอร์ชัน',
  'param.base_length': 'จำนวนแท่งฐาน',
  'param.span_b_length': 'จำนวนแท่งสแปน B',
  'param.tenkan_colour': 'สีเส้นเทนكان',
  'param.kijun_colour': 'สีเส้นคิจุน',
  'param.cloud_up_fill': 'สีระบายเมฆขาขึ้น',
  'param.cloud_down_fill': 'สีระบายเมฆขาลง',
  'param.show_chikou_span': 'แสดงสแปนชิโกะ',
  'param.overbought': 'เขตซื้อเกิน',
  'param.oversold': 'เขตขายเกิน',
  'param.fill_overbought/oversold_zones': 'ระบายเขตซื้อเกิน/ขายเกิน',
  'param.%k_length': 'จำนวนแท่ง %K',
  'param.%k_smoothing': 'การปรับค่าเรียบ %K',
  'param.%d_length': 'จำนวนแท่ง %D',
  'param.%k_colour': 'สีเส้น %K',
  'param.%d_colour': 'สีเส้น %D',
  'param.rsi_length': 'จำนวนแท่ง RSI',
  'param.stochastic_length': 'จำนวนแท่งสโตคาสติก',
  'param.reference_lines': 'เส้นอ้างอิง',
  'param.upper': 'บน',
  'param.lower': 'ล่าง',
  'param.show_zero_line': 'แสดงเส้นศูนย์',
  'param.volume_ma': 'ค่าเฉลี่ยปริมาณ',
  'param.ma_length': 'จำนวนแท่งค่าเฉลี่ย',
  'param.ma_colour': 'สีเส้นค่าเฉลี่ย',
  'param.show_ma': 'แสดงค่าเฉลี่ย',
  'param.show_signal_line': 'แสดงเส้นสัญญาณ',
  'param.use_rma_smoothing': 'ใช้การปรับค่าเรียบ RMA',
  'opt.None': 'ไม่ใช้',

  // ── Timeframes ───────────────────────────────────────────────────────────
  'tf.1m': '1 นาที',
  'tf.5m': '5 นาที',
  'tf.15m': '15 นาที',
  'tf.30m': '30 นาที',
  'tf.1h': '1 ชั่วโมง',
  'tf.4h': '4 ชั่วโมง',
  'tf.1d': '1 วัน',
  'tf.1w': '1 สัปดาห์',
  'tf.1M': '1 เดือน',

  // ── Fundamental metric hints ─────────────────────────────────────────────
  'metric.hint.pe': 'ราคา / กำไรต่อหุ้นย้อนหลัง',
  'metric.hint.pbv': 'ราคา / มูลค่าทางบัญชี',
  'metric.hint.pfcf': 'ราคา / กระแสเงินสดอิสระ — 1÷ค่านี้คือผลตอบแทน FCF',
  'metric.hint.ps': 'ราคา / รายได้',
  'metric.hint.pcf': 'ราคา / กระแสเงินสดจากดำเนินงาน',
  'metric.hint.evEbitda': 'มูลค่ากิจการ / EBITDA',
  'metric.hint.de': 'หนี้สินรวม / ส่วนของผู้ถือหุ้น',
  'metric.hint.quickRatio': 'อัตราส่วนสภาพคล่องทันที',
  'metric.hint.currentRatio': 'อัตราส่วนหมุนเวียน',
  'metric.hint.dividendYield': 'อัตราผลตอบแทนเงินปันผล',
  'metric.hint.roe': 'ผลตอบแทนส่วนของผู้ถือหุ้น',
  'metric.hint.roic': 'ผลตอบแทนจากเงินลงทุน',
  'metric.hint.roa': 'ผลตอบแทนจากสินทรัพย์',
  'metric.hint.epsGrowth': 'กำไรต่อหุ้น เทียบปีต่อปี',
  'metric.hint.revenueGrowth': 'รายได้ เทียบปีต่อปี',

  // ── Board settings dialog ────────────────────────────────────────────────
  'bs.title': 'ตั้งค่ากระดาน',
  'bs.sub': 'มีผลกับทุกกราฟบนกระดานนี้',
  'bs.layout': 'เลย์เอาต์',
  'bs.layoutHint': 'ปรับพอดีอัตโนมัติจะจัดตารางให้ทุกกราฟเห็นโดยไม่ต้องเลื่อน',
  'bs.sizing': 'การจัดขนาดกระดาน',
  'bs.auto': 'ปรับพอดีหน้าจออัตโนมัติ',
  'bs.fixed': 'จำนวนคอลัมน์คงที่ (เลื่อนดูถ้าจำเป็น)',
  'bs.columns': 'จำนวนคอลัมน์',
  'bs.columnsN.one': '{n} คอลัมน์',
  'bs.columnsN.other': '{n} คอลัมน์',
  'bs.theme': 'ธีม',
  'bs.dark': 'มืด',
  'bs.light': 'สว่าง',
  'bs.defaultTf': 'กรอบเวลาเริ่มต้น',
  'bs.defaultStyle': 'รูปแบบกราฟเริ่มต้น',
  'bs.footer': 'แถบล่างกราฟ',
  'bs.footerHint': 'แถบใต้แต่ละกราฟ: อัตราส่วนมูลค่า ค่าตัวบ่งชี้ หรือทั้งสองอย่าง',
  'bs.show': 'แสดง',
  'bs.footerFund': 'เฉพาะพื้นฐาน (P/E, P/BV, D/E, เงินปันผล)',
  'bs.footerInd': 'เฉพาะค่าตัวบ่งชี้',
  'bs.footerBoth': 'ทั้งสอง (อัตราส่วนบน ตัวบ่งชี้ล่าง)',
  'bs.refresh': 'โหลดอัตราส่วนใหม่',
  'bs.refreshHint': 'ข้ามแคช 30 นาทีแล้วสกรีนใหม่',
  'bs.refreshing': 'กำลังโหลดใหม่…',
  'bs.fundamentals': 'ข้อมูลพื้นฐาน',
  'bs.history': 'ประวัติที่บันทึกไว้',
  'bs.record': 'บันทึกวันนี้เดี๋ยวนี้',
  'bs.recordHint': 'เขียนอัตราส่วนของวันนี้สำหรับทุกกราฟบนกระดาน แทนที่แถววันนี้',
  'bs.recording': 'กำลังบันทึก…',
  'bs.whichRatios': 'อัตราส่วนที่ต้องการ',
  'bs.metricsMissing': 'ไม่มีรายการเมตริก',
  'bs.ratios': 'อัตราส่วน',
  'bs.since': ' (ตั้งแต่ {since} · ล่าสุด {last})',
  'bs.histShort': ' ยังบันทึกวันน้อยเกินกว่าแนวโน้มจะมีนัย',
  'bs.histEmpty': 'ยังไม่มีการบันทึก อัตราส่วนจะถูกเขียนอัตโนมัติทุกครั้งที่โหลดกระดาน — เริ่มตอนนี้และย้อนหลังไม่ได้',
  'bs.days.one': 'บันทึก {n} วัน',
  'bs.days.other': 'บันทึก {n} วัน',
  'bs.live': 'ข้อมูลสด',
  'bs.liveHint': 'ราคาถูกผลักจากเซิร์ฟเวอร์ผ่าน SSE และสกรีนเนอร์ MCP ถูกดึงทุก ๆ ช่วงเวลาสำหรับทั้งกระดาน',
  'bs.poll': 'ช่วงเวลาดึงราคา',
  'bs.liveQuotes': 'ราคาสด (ปิดเพื่อหยุดกระดาน)',
  'bs.syncCrosshair': 'ส่องกากบาทข้ามทุกกราฟ',
  'bs.syncTimeScale': 'ผูกซูม/เลื่อนระหว่างกราฟ',
  'bs.showGrid': 'แสดงเส้นกริด',
  'bs.showWatermark': 'แสดงเครื่องหมายราคาล่าสุดในกราฟ',
  'bs.alert': 'แจ้งเตือนเขตขายเกิน',
  'bs.alertHint': 'แจ้งเตือนเมื่อ RSI ของกราฟใดต่ำกว่าเส้นขายเกินที่ตั้งไว้ในกราฟนั้น ตรวจใหม่ทุกครั้งที่โหลดแท่งเทียน — ตอนโหลดกระดาน ทุก tic ระหว่างวัน และหลังแก้ตัวบ่งชี้ ไม่ใช่ทุก tic ราคา จึงไม่ขัดกับตัวเลขในแผ่น',
  'bs.alertCheck': 'แสดงปุ่มแจ้งเตือนสีเขียวเมื่อมีกราฟขายเกิน',
  'bs.connection': 'การเชื่อมต่อ',
  'poll.5': '5 วินาที (เร็วที่สุด)',
  'poll.10': '10 วินาที (ค่าเริ่มต้น)',
  'poll.20': '20 วินาที',
  'poll.30': '30 วินาที',
  'poll.60': '60 วินาที (สบาย ๆ)',
  'poll.120': '2 นาที (แบ็กกราวนด์)',

  // ── Watchlists dialog ────────────────────────────────────────────────────
  'wl.title': 'รายการเฝ้าดู',
  'wl.sub': 'รายการหุ้นที่ตั้งชื่อไว้ โหลดลงกระดานได้ในคลิกเดียว — เก็บไว้กี่รายการก็ได้',
  'wl.lists': 'รายการ',
  'wl.showAll': 'แสดงทั้งหมด ({shown}/{total})',
  'wl.new': '+ ใหม่',
  'wl.newPlaceholder': 'ตั้งชื่อรายการนี้',
  'wl.create': 'สร้าง',
  'wl.emptyLists': 'ยังไม่มีรายการเฝ้าดู สร้างใหม่ หรือบันทึกกระดานปัจจุบันเป็นรายการ',
  'wl.previewEmpty': 'ว่าง',
  'wl.saveBoard': 'บันทึกกระดานนี้ ({n})',
  'wl.seedPlaceholder': 'ตั้งชื่อรายการ ({n} สัญลักษณ์)',
  'wl.selectHint': 'เลือกรายการ หรือสร้างรายการใหม่',
  'wl.listName': 'ชื่อรายการ',
  'wl.duplicate': 'ทำสำเนา',
  'wl.pressAgain': 'กดอีกครั้ง',
  'wl.created': 'สร้าง "{name}" แล้ว',
  'wl.needName': 'รายการต้องมีชื่อ',
  'wl.savedToast': 'บันทึก {n} สัญลักษณ์เป็น "{name}" แล้ว',
  'wl.deletedToast': 'ลบรายการแล้ว กระดานไม่ได้ถูกแก้',
  'wl.act.create': 'สร้างรายการ',
  'wl.act.saveBoard': 'บันทึกกระดานเป็นรายการ',
  'wl.act.rename': 'เปลี่ยนชื่อ',
  'wl.act.duplicate': 'ทำสำเนา',
  'wl.act.delete': 'ลบ',
  'wl.act.remove': 'ลบสัญลักษณ์',
  'wl.act.add': 'เพิ่ม',
  'wl.actFailed': '{label} ไม่สำเร็จ: {msg}',
  'wl.addSymbols': 'เพิ่มสัญลักษณ์',
  'wl.addSymbolsHint': 'รองรับ CPF, SET:CPF, CPF.BK หรือหลายตัวคั่นด้วยจุลภาค',
  'wl.addPlaceholder': 'CPF, PTTEP, SET:SCB…',
  'wl.add': 'เพิ่ม',
  'wl.full': 'รายการเต็ม — ไม่ได้เพิ่ม {n} ตัว',
  'wl.added.one': 'เพิ่ม {n} สัญลักษณ์แล้ว',
  'wl.added.other': 'เพิ่ม {n} สัญลักษณ์แล้ว',
  'wl.addFailed': 'เพิ่มไม่สำเร็จ: {msg}',
  'wl.searchFailed': 'ค้นหาไม่สำเร็จ',
  'wl.noMatch': 'ไม่พบในสกรีนเนอร์',
  'wl.addedFromScreener': 'เพิ่ม {n} ตัวจากสกรีนเนอร์',
  'wl.symbols': 'สัญลักษณ์',
  'wl.symbolsHint': 'คลิก ✕ เพื่อลบออก จุดสีเขียวหมายถึงมีบนกระดานแล้ว',
  'wl.noSymbols': 'ยังไม่มีสัญลักษณ์',
  'wl.onBoard': 'มีบนกระดานแล้ว',
  'wl.remove': 'ลบ {symbol}',
  'wl.loadTitle': 'โหลดลงกระดานนี้',
  'wl.boardDefault': 'ค่าเริ่มต้นของกระดาน ({tf})',
  'wl.rsiCheck': 'เริ่มกราฟใหม่ทุกใบด้วยแผ่น RSI',
  'wl.load.one': 'โหลด {n} สัญลักษณ์',
  'wl.load.other': 'โหลด {n} สัญลักษณ์',
  'wl.loadFailed': 'โหลดรายการเฝ้าดูไม่สำเร็จ: {msg}',
  'wl.report.added': 'เพิ่ม {n}',
  'wl.report.already': '{n} มีบนกระดานแล้ว',
  'wl.report.dup': '{n} ซ้ำ',
  'wl.report.full.one': 'ตัดออก {n} — กระดานรับได้สูงสุด {limit}',
  'wl.report.full.other': 'ตัดออก {n} — กระดานรับได้สูงสุด {limit}',

  // ── Oversold list dialog ─────────────────────────────────────────────────
  'os.title': 'RSI ต่ำกว่าเส้นขายเกิน',
  'os.sub.one': '{n} กราฟบนกระดานนี้ แต่ละกราฟเทียบกับค่า RSI ของตัวเอง',
  'os.sub.other': '{n} กราฟบนกระดานนี้ แต่ละกราฟเทียบกับค่า RSI ของตัวเอง',
  'os.subNone': 'ตอนนี้ไม่มีกราฟใดต่ำกว่าเส้นของตัวเอง',
  'os.hint': 'ระบบจะตรวจอีกครั้งทุกครั้งที่กราฟโหลดแท่งเทียนใหม่ คือทุกนาทีขณะแท็บนี้เปิดอยู่ และทุกครั้งที่โหลดกระดาน',
  'os.deepest': 'ต่ำสุด: {symbol} ที่ RSI {value} เทียบเส้น {line}',
  'os.charts': 'กราฟ',
  'os.chartsHint': 'คลิกแถวเพื่อขยายกราฟนั้นเต็มจอ',
  'os.note': 'เปลี่ยนเส้นของแต่ละกราฟได้จากหน้าตั้งค่า หรือคลิกที่รายการ RSI ในแถบล่างเพื่อเปิดตัวแก้ไข',
  'os.rowTitle': '{symbol} · {tf} · RSI({length}) {value} เส้น {line} — คลิกเพื่อขยาย',

  // ── MCP console ──────────────────────────────────────────────────────────
  'mcp.title': 'เครื่องมือ MCP',
  'mcp.sub': 'tradingview-mcp · เข้าถึงเครื่องมือโดยตรง',
  'mcp.loading': 'กำลังโหลดเครื่องมือ…',
  'mcp.run': 'รันเครื่องมือ',
  'mcp.pick': 'เลือกเครื่องมือทางซ้าย',
  'mcp.noTools': 'เซิร์ฟเวอร์ MCP ไม่ส่งเครื่องมือมา',
  'mcp.noToolsErr': 'ติดตั้ง <code>tradingview-mcp-server</code> แล้วหรือยัง?',
  'mcp.noArgs': 'เครื่องมือนี้ไม่รับอาร์กิวเมนต์',
  'mcp.ready': '{name} พร้อม — กด Run',
  'mcp.running': 'กำลังรัน…',
  'mcp.error': 'ข้อผิดพลาด [{code}]: {msg}',
  'mcp.failed': '{name} ล้มเหลว',
};

/**
 * Resolve the language once, at module load.
 * @returns {'en'|'th'}
 */
function detect() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (LANGS.includes(saved)) return saved;
  } catch { /* private mode / disabled storage */ }
  const nav = (typeof navigator !== 'undefined' ? navigator.language : '') || '';
  return nav.toLowerCase().startsWith('th') ? 'th' : 'en';
}

let lang = detect();

export function getLang() { return lang; }
export function isThai() { return lang === 'th'; }

/**
 * Translate a key.
 *
 * @param {string} key
 * @param {object} [vars] values substituted for `{name}` placeholders
 * @param {string} [fallback] returned when neither language has the key —
 *   used for server-provided labels (indicator names, timeframe names) that we
 *   have no entry for
 */
export function t(key, vars, fallback) {
  let s = (lang === 'th' ? TH[key] : undefined) ?? EN[key];
  if (s == null) return fallback ?? key;
  if (vars) {
    s = s.replace(/\{(\w+)\}/g, (m, name) => (vars[name] != null ? String(vars[name]) : m));
  }
  return s;
}

/**
 * Plural form. English gets a real singular/plural pair; Thai has no plural
 * marker, so both keys carry the same wording — but the pair exists so the
 * English side never reads "{n} chart(s)".
 *
 * @param {string} base key without the `.one` / `.other` suffix
 * @param {number} n
 */
export function tp(base, n, vars) {
  return t(`${base}.${Math.abs(n) === 1 ? 'one' : 'other'}`, { n, ...vars });
}

/** Persist and apply a new language. Reloads: see the note at the top. */
export function setLang(next) {
  if (!LANGS.includes(next) || next === lang) return;
  lang = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  document.documentElement.lang = next;
  location.reload();
}

export function toggleLang() {
  setLang(lang === 'th' ? 'en' : 'th');
}

/**
 * Fill every `data-i18n` node in a subtree.
 *
 *   data-i18n            → textContent
 *   data-i18n-title       → title
 *   data-i18n-placeholder → placeholder
 *   data-i18n-aria        → aria-label
 *
 * Static markup in `index.html` keeps its English text as the no-JS fallback;
 * this swaps it for the active language before the board boots.
 */
export function applyStatic(root = document) {
  if (!root?.querySelectorAll) return;
  for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of root.querySelectorAll('[data-i18n-title]')) node.title = t(node.dataset.i18nTitle);
  for (const node of root.querySelectorAll('[data-i18n-placeholder]')) node.placeholder = t(node.dataset.i18nPlaceholder);
  for (const node of root.querySelectorAll('[data-i18n-aria]')) node.setAttribute('aria-label', t(node.dataset.i18nAria));
}

/** Time-of-day string for "saved 14:03", following the active language. */
export function timeString(date = new Date()) {
  return date.toLocaleTimeString(lang === 'th' ? 'th-TH' : 'en-US');
}

/** Timeframe label from `/api/meta`, translated for the ones we know about. */
export function tfLabel(id, fallback = '') {
  return t(`tf.${id}`, null, fallback);
}

/** Key form used to look a parameter label up in the `param.*` table. */
export function paramKey(label) {
  return `param.${String(label ?? '').trim().toLowerCase().replace(/\s+/g, '_')}`;
}

/**
 * Translate the indicator catalog the server sent.
 *
 * Done on the client rather than in `server/indicator-catalog.js`: the catalog
 * is also the shape the calculation code validates against (`type`, `params[].id`,
 * ranges, defaults), so only the human-readable `name` / `group` / `label`
 * fields are swapped out and every id and value stays exactly as it came.
 * Returns the input untouched when the language is English.
 */
export function localizeCatalog(catalog, groups) {
  if (lang === 'en') return { catalog, groups };
  const out = {};
  for (const [type, def] of Object.entries(catalog ?? {})) {
    out[type] = {
      ...def,
      name: t(`ind.name.${type}`, null, def.name),
      group: t(`grp.${def.group}`, null, def.group),
      params: (def.params ?? []).map((p) => ({
        ...p,
        label: t(paramKey(p.label ?? p.id), null, p.label ?? p.id),
        ...(p.labels
          ? { labels: Object.fromEntries(Object.entries(p.labels).map(([k, v]) => [k, t(`opt.${v}`, null, v)])) }
          : {}),
      })),
    };
  }
  return {
    catalog: out,
    groups: (groups ?? []).map((g) => t(`grp.${g}`, null, g)),
  };
}

/** Metric hints only — the labels are standard ratio shorthand (P/E, ROE). */
export function localizeMetrics(metrics) {
  return (metrics ?? []).map((m) => ({ ...m, hint: t(`metric.hint.${m.key}`, null, m.hint) }));
}

// Apply to the static document as soon as this module is evaluated. Module
// scripts are deferred, so the DOM already exists and the very first paint is
// in the right language.
document.documentElement.lang = lang;
applyStatic(document);
